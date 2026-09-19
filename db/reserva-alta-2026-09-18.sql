-- ─────────────────────────────────────────────────────────────────────────
-- RESERVA DE PROPIETARIO PARA ALTAS POR ENLACE — 18-sep-2026
-- (estructura endurecida el 19-sep-2026)
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
--
-- ─────────────────────────────────────────────────────────────────────────
-- IDEMPOTENCIA: LA DE VERDAD, NO LA DE `IF NOT EXISTS`
-- ─────────────────────────────────────────────────────────────────────────
-- `create table if not exists` NO valida la forma: con una tabla homónima de
-- otras columnas no lanza, y la migración parecería correcta mientras el código
-- falla en producción. Aquí se COMPRUEBA la estructura y se aborta si no cuadra.
--
-- Los cuatro estados que tiene que atender, y qué hace en cada uno:
--
--   A. No existe          → la crea entera, con PK y check.
--   B. Existe y es válida → no toca nada; reaplica RLS y grants.
--   C. Existe, es válida, pero le falta el check → comprueba que TODAS las
--      filas ya cumplen la regla y solo entonces lo añade. Si alguna no cumple,
--      ABORTA: no se reescribe el correo de nadie.
--   D. Existe y es incompatible → excepción explícita y la transacción entera
--      se revierte.
--
-- NO hay DROP, ni DELETE, ni UPDATE, ni INSERT de reparación, ni renombrados.
-- Volver a ejecutarla sobre una base correcta es un no-op funcional.
--
-- TODO va cualificado con `public.`: no se depende del search_path.
--
-- ⚠️ EJECUTADA EN PRODUCCIÓN EL 19-sep-2026 en su PRIMERA versión, que solo
-- creaba la tabla, y después el bloque de permisos, con la tabla vacía y el
-- código sin desplegar. Esta versión está pensada para volver a ejecutarse
-- sobre ese estado: validará la estructura, añadirá el check que falta y
-- concederá a service_role los privilegios que nunca se le dieron
-- explícitamente. Cero filas modificadas.

begin;

do $migracion$
declare
  v_oid        oid;
  v_pk         text[];
  v_def        text;
  v_malas      bigint;
  -- Lo que tiene que haber, columna a columna.
  v_col_tipo   text;
  v_col_null   text;
  v_col_def    text;
begin
  select c.oid into v_oid
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'reservas_alta' and c.relkind = 'r';

  if v_oid is null then
    -- ── A · no existe ────────────────────────────────────────────────────
    create table public.reservas_alta (
      -- El correo NORMALIZADO, tal y como lo normaliza api/_acceso.js antes de
      -- tocar nada. Es la clave: una reserva por correo, y la exclusión entre
      -- instancias vive aquí.
      email          text        not null,
      -- El uuid que tendrá esa cuenta cuando alguien canjee un enlace. Mientras
      -- tanto no existe ninguna fila en `usuarios`: una reserva no es una cuenta.
      propietario_id uuid        not null,
      creado         timestamptz not null default now(),
      constraint reservas_alta_pkey primary key (email),
      -- ⚠️ LA NORMALIZACIÓN, EXIGIDA POR LA BASE. Si solo la garantiza el
      -- código, basta un camino nuevo que olvide normalizar para que
      -- "A@x.es" y "a@x.es" sean dos reservas distintas y vuelvan las dos
      -- cuentas. La clave primaria solo es única sobre lo que le llega.
      constraint reservas_alta_email_normalizado_ck
        check (email = lower(btrim(email)))
    );
    raise notice 'reservas_alta: creada';
  else
    -- ── D · comprobación de estructura, columna a columna ────────────────
    -- Cualquier desviación aborta y revierte la transacción entera.
    select data_type, is_nullable, column_default
      into v_col_tipo, v_col_null, v_col_def
      from information_schema.columns
     where table_schema = 'public' and table_name = 'reservas_alta'
       and column_name = 'email';
    if v_col_tipo is null then
      raise exception 'public.reservas_alta: falta la columna email';
    end if;
    if v_col_tipo <> 'text' then
      raise exception 'public.reservas_alta.email: tipo % y se esperaba text', v_col_tipo;
    end if;
    if v_col_null <> 'NO' then
      raise exception 'public.reservas_alta.email: admite NULL y no debe';
    end if;

    select data_type, is_nullable
      into v_col_tipo, v_col_null
      from information_schema.columns
     where table_schema = 'public' and table_name = 'reservas_alta'
       and column_name = 'propietario_id';
    if v_col_tipo is null then
      raise exception 'public.reservas_alta: falta la columna propietario_id';
    end if;
    if v_col_tipo <> 'uuid' then
      raise exception 'public.reservas_alta.propietario_id: tipo % y se esperaba uuid', v_col_tipo;
    end if;
    if v_col_null <> 'NO' then
      raise exception 'public.reservas_alta.propietario_id: admite NULL y no debe';
    end if;

    select data_type, is_nullable, column_default
      into v_col_tipo, v_col_null, v_col_def
      from information_schema.columns
     where table_schema = 'public' and table_name = 'reservas_alta'
       and column_name = 'creado';
    if v_col_tipo is null then
      raise exception 'public.reservas_alta: falta la columna creado';
    end if;
    if v_col_tipo <> 'timestamp with time zone' then
      raise exception 'public.reservas_alta.creado: tipo % y se esperaba timestamptz', v_col_tipo;
    end if;
    if v_col_null <> 'NO' then
      raise exception 'public.reservas_alta.creado: admite NULL y no debe';
    end if;
    if v_col_def is null or v_col_def not like '%now()%' then
      raise exception 'public.reservas_alta.creado: default % y se esperaba now()',
        coalesce(v_col_def, '(ninguno)');
    end if;

    -- La PRIMARY KEY, y que sea EXCLUSIVAMENTE sobre email.
    select array_agg(a.attname order by a.attname)
      into v_pk
      from pg_catalog.pg_index i
      join pg_catalog.pg_attribute a
        on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
     where i.indrelid = v_oid and i.indisprimary;
    if v_pk is null then
      raise exception 'public.reservas_alta: no tiene PRIMARY KEY; la exclusión depende de ella';
    end if;
    if v_pk <> array['email']::text[] then
      raise exception 'public.reservas_alta: la PK es (%) y tiene que ser solo (email)',
        array_to_string(v_pk, ', ');
    end if;

    -- ── C · el check de normalización ────────────────────────────────────
    select pg_catalog.pg_get_constraintdef(c.oid)
      into v_def
      from pg_catalog.pg_constraint c
     where c.conrelid = v_oid
       and c.conname = 'reservas_alta_email_normalizado_ck';

    if v_def is null then
      -- No está. Antes de añadirlo se mira si TODAS las filas ya cumplen: si
      -- alguna no, se aborta. No se reescribe el correo de nadie.
      select count(*) into v_malas
        from public.reservas_alta
       where email is distinct from lower(btrim(email));
      if v_malas > 0 then
        raise exception
          'public.reservas_alta: % fila(s) con el correo sin normalizar. Revisarlas a mano antes de migrar: no se reescriben automáticamente.',
          v_malas;
      end if;
      alter table public.reservas_alta
        add constraint reservas_alta_email_normalizado_ck
        check (email = lower(btrim(email)));
      raise notice 'reservas_alta: check de normalización añadido';
    else
      -- Está. Que se llame igual no basta: tiene que DECIR lo mismo.
      if position('lower(btrim(email))' in regexp_replace(lower(v_def), '\s+', '', 'g')) = 0
         or position('email=' in regexp_replace(lower(v_def), '\s+', '', 'g')) = 0 then
        raise exception
          'public.reservas_alta: el constraint reservas_alta_email_normalizado_ck existe pero dice otra cosa: %', v_def;
      end if;
    end if;
  end if;
end
$migracion$;

-- ── PERMISOS: NADIE MÁS QUE EL SERVIDOR ──────────────────────────────────
-- Lo único que hay en esta tabla son CORREOS de gente que ha pedido un enlace y
-- todavía no tiene cuenta. No hay otro dato. Una tabla nueva en `public` la
-- enruta PostgREST, así que sin esto la lista de correos queda alcanzable con
-- la clave anon. Mismo criterio que db/congelar-lamina-riego-2026-09-14.sql.
--
-- No se crea NINGUNA policy: sin policies y con RLS activa, quien no la eluda
-- no lee nada. El backend va con service_role, que la elude.
alter table public.reservas_alta enable row level security;

revoke all privileges on table public.reservas_alta from PUBLIC;
revoke all privileges on table public.reservas_alta from anon;
revoke all privileges on table public.reservas_alta from authenticated;

-- ⚠️ RLS Y GRANTS SON DOS CAPAS DISTINTAS. Que service_role eluda RLS no le da
-- privilegios de tabla: esos se conceden aquí, explícitamente, y solo los dos
-- que usa api/_acceso.js —INSERT con return=representation, y el SELECT de la
-- reserva ganadora cuando pierde la carrera—. Nada de depender de los default
-- privileges históricos de Supabase, que pueden no estar.
grant select, insert on table public.reservas_alta to service_role;

comment on table public.reservas_alta is
  'Reserva del uuid de propietario para un correo que aún no tiene cuenta. La clave primaria sobre el correo es lo que impide que dos peticiones simultáneas reserven dos propietarios distintos. La cuenta se crea al canjear el enlace, no aquí.';

commit;

-- PostgREST cachea el esquema. Sin recargarlo, el primer INSERT contra una
-- tabla recién creada puede fallar con 42P01 —"no existe"— aunque exista. Va
-- DESPUÉS del commit: recargar un esquema que no llegó a confirmarse no tiene
-- sentido.
notify pgrst, 'reload schema';

-- ── Higiene ───────────────────────────────────────────────────────────────
-- Una reserva cuyo propietario YA existe en `usuarios` ha cumplido su función.
-- No estorba —se lee y da el mismo id—, pero se puede limpiar de vez en cuando.
-- NO se cuelga de ningún cron: borrar una reserva viva partiría en dos una
-- cuenta en curso.
--
--   delete from public.reservas_alta r
--    where exists (select 1 from public.usuarios u where u.id = r.propietario_id)
--      and r.creado < now() - interval '30 days';
