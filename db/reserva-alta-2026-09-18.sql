-- ─────────────────────────────────────────────────────────────────────────
-- RESERVA DE PROPIETARIO PARA ALTAS POR ENLACE — 18-sep-2026
-- ─────────────────────────────────────────────────────────────────────────
--
-- QUÉ ARREGLA. Cuando alguien pide un enlace con un correo que todavía no es de
-- nadie, el propietario se reserva en ese momento y la cuenta nace al canjear.
-- La reserva se hacía con `crypto.randomUUID()` en el proceso, y eso NO es
-- único entre instancias: dos peticiones simultáneas —dos lambdas distintas—
-- leen las dos que no hay reserva, generan dos UUID distintos y crean dos
-- accesos apuntando a propietarios diferentes. Al canjear los dos enlaces nacen
-- DOS cuentas con el mismo correo; a partir de ahí `propietarioPorEmail()`
-- devuelve conflicto —correctamente— y esa persona deja de recibir enlaces.
--
-- Reproducido con intercalado forzado (tests/test-correo-no-acreditado.mjs).
--
-- CÓMO LO ARREGLA. La unicidad la da la BASE, que es el único sitio donde
-- existe de verdad: una tabla cuya CLAVE PRIMARIA es el correo normalizado. Las
-- dos peticiones intentan insertar; una gana, la otra recibe 23505 y LEE la
-- reserva ganadora. Las dos acaban con el mismo propietario reservado.
--
-- Por qué una tabla aparte y no una restricción sobre las existentes:
--   · `unique(email)` en `usuarios` NO vale: hay zonas legacy que comparten
--     legítimamente el correo de su propietario, y esa restricción las rompería.
--   · un índice único parcial sobre `accesos(email) where usado_en is null`
--     tampoco: impediría tener dos enlaces pendientes a la vez, que es algo
--     legítimo —pides otro porque el primero tarda— y que hoy funciona.
-- Esta tabla no toca nada existente y solo la usa el alta por enlace.
--
-- IDEMPOTENTE: se puede ejecutar las veces que haga falta.
--
-- ⚠️ EJECUTADA EN PRODUCCIÓN EL 19-sep-2026, en dos tiempos: primero el
-- `create table` (sin los permisos, que faltaban en la primera versión de este
-- fichero) y después el bloque de permisos, con la tabla todavía VACÍA y el
-- código sin desplegar. Verificado por consulta: `anon` y `authenticated` ya no
-- aparecen en `information_schema.role_table_grants`.
--
-- ⚠️ Y `create table if not exists` NO VALIDA LA FORMA: si ya existiera una
-- tabla con este nombre y otras columnas, no lanzaría y esto parecería correcto.
-- Comprobarlo con la consulta de más abajo, no darlo por hecho.

create table if not exists reservas_alta (
  -- El correo NORMALIZADO (minúsculas, sin espacios), tal y como lo normaliza
  -- api/_acceso.js antes de tocar nada. Es la clave: una reserva por correo.
  email          text        primary key,
  -- El uuid que tendrá esa cuenta cuando alguien canjee un enlace. Mientras
  -- tanto no existe ninguna fila en `usuarios`: una reserva no es una cuenta.
  propietario_id uuid        not null,
  creado         timestamptz not null default now()
);

-- ── PERMISOS: NADIE MÁS QUE EL SERVIDOR ──────────────────────────────────
-- Lo único que hay en esta tabla son CORREOS de gente que ha pedido un enlace
-- y todavía no tiene cuenta. No hay otro dato. Una tabla nueva en `public` la
-- enruta PostgREST, así que sin esto la lista de correos queda alcanzable con
-- la clave anon.
--
-- Mismo criterio que db/congelar-lamina-riego-2026-09-14.sql, donde ya se
-- decidió que duplicar el agujero de RLS que arrastran las tablas viejas no
-- tiene defensa. El backend habla con la service_role, que ignora RLS: no se
-- le añade ninguna política porque no necesita ninguna, y así nadie más entra.
revoke all on reservas_alta from public, anon, authenticated;
alter table reservas_alta enable row level security;

-- PostgREST cachea el esquema. Sin recargarlo, el primer INSERT contra una
-- tabla recién creada puede fallar con 42P01 —"no existe"— aunque exista.
notify pgrst, 'reload schema';

comment on table reservas_alta is
  'Reserva del uuid de propietario para un correo que aún no tiene cuenta. La clave primaria sobre el correo es lo que impide que dos peticiones simultáneas reserven dos propietarios distintos. La cuenta se crea al canjear el enlace, no aquí.';

-- ── Comprobaciones, solo lectura ──────────────────────────────────────────
-- Después de ejecutar, estas cuatro dicen si quedó bien. La primera es la que
-- descarta una tabla previa incompatible, y no es opcional.
--
--   select column_name, data_type, is_nullable
--     from information_schema.columns where table_name = 'reservas_alta';
--   -- email text NO · propietario_id uuid NO · creado timestamptz NO
--
--   select a.attname from pg_index i join pg_attribute a
--       on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
--    where i.indrelid = 'reservas_alta'::regclass and i.indisprimary;
--   -- tiene que ser `email`: ahí vive la exclusión
--
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'reservas_alta';
--   -- NI anon NI authenticated
--
--   select relrowsecurity from pg_class where relname = 'reservas_alta';
--   -- true

-- ── Higiene ───────────────────────────────────────────────────────────────
-- Una reserva cuyo propietario YA existe en `usuarios` ha cumplido su función.
-- No estorba —se lee y da el mismo id—, pero se puede limpiar de vez en cuando.
-- NO se cuelga de ningún cron: borrar una reserva viva partiría en dos una
-- cuenta en curso.
--
--   delete from reservas_alta r
--    where exists (select 1 from usuarios u where u.id = r.propietario_id)
--      and r.creado < now() - interval '30 days';
