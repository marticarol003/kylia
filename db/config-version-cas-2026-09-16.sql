-- ─────────────────────────────────────────────────────────────────
-- config_version: compare-and-set para config_app (16-sep-2026)  ·  NO EJECUTADA
-- ─────────────────────────────────────────────────────────────────
-- INDEPENDIENTE de db/congelar-lamina-riego-2026-09-14.sql, que está EJECUTADA y
-- CERRADA. No comparten tabla de trabajo, ni pasos, ni ventana. No mezclarlas.
--
-- EL PROBLEMA. `config_app` se escribía con un PATCH incondicional:
--     PATCH /usuarios?id=eq.<X>   body: { config_app: <foto> }
-- El último POST que llegue gana, y "el último que llega" no es "el último que se
-- pidió": dos guardados en vuelo pueden terminar al revés y dejar en el servidor
-- una configuración VIEJA. La cola del cliente (app/index.html, encolarConfig)
-- serializa lo que sale de ESTE navegador, pero no puede hacer nada contra dos
-- dispositivos a la vez, ni contra una petición que el servidor procesa tarde
-- después de que el cliente la haya abortado por timeout. Abortar en el cliente
-- no detiene al servidor.
--
-- LA SOLUCIÓN. Una versión en la fila y un UPDATE condicional. El orden lo
-- impone Postgres en UN solo statement, no JavaScript:
--     PATCH /usuarios?id=eq.<X>&config_version=eq.<base>
--     body: { config_app: <foto>, config_version: <base+1> }
--     Prefer: return=representation
--   · 1 fila devuelta → escrito, y la respuesta trae la versión nueva.
--   · 0 filas         → la versión ya se movió: CONFLICTO, no se escribe nada.
-- Nunca SELECT → comprobar → UPDATE: eso es la misma carrera con más pasos.

-- ═════════════════════════════════════════════════════════════════
-- 1 · ESQUEMA · IDEMPOTENTE Y NO DESTRUCTIVO
-- ═════════════════════════════════════════════════════════════════
-- ⚠️ EN LA PRODUCCIÓN DE MARTÍ ESTO YA ESTÁ HECHO: la columna existe, la
-- constraint existe y está VALIDADA. Este bloque es un no-op ahí y NO hace falta
-- volver a ejecutarlo. Se deja para que el fichero describa el estado final y
-- valga en cualquier otro entorno.
--
-- La versión anterior hacía `drop constraint if exists` + `add … not valid`, que
-- sobre una constraint ya validada la DEGRADA: la borra y la recrea sin validar,
-- dejando de garantizar lo que ya garantizaba. Un fichero de migración que
-- empeora el esquema cuando se reejecuta no es idempotente, es destructivo. Lo
-- cazó Codex.
--
-- Aquí no se borra nada nunca. Cada pieza se crea SOLO si falta, y la validación
-- solo corre si está pendiente.
do $$
begin
  -- Columna: si falta, se crea. `default 0` + `not null` hace que todas las filas
  -- existentes arranquen en 0, así que el primer guardado no necesita caso
  -- especial. En PG11+ un default constante es metadato: no reescribe la tabla.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'usuarios' and column_name = 'config_version'
  ) then
    alter table usuarios add column config_version bigint not null default 0;
    raise notice 'config_version creada';
  else
    raise notice 'config_version ya existe: no se toca';
  end if;

  -- Constraint: si falta, se crea NOT VALID (no bloquea la tabla). Si ya está,
  -- NO se borra ni se recrea.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'usuarios'::regclass and conname = 'usuarios_config_version_ck'
  ) then
    alter table usuarios add constraint usuarios_config_version_ck
      check (config_version >= 0) not valid;
    raise notice 'constraint creada (not valid)';
  end if;

  -- Validar SOLO si está pendiente. Si ya está validada, esto no se ejecuta y la
  -- constraint se queda exactamente como estaba.
  if exists (
    select 1 from pg_constraint
     where conrelid = 'usuarios'::regclass and conname = 'usuarios_config_version_ck'
       and not convalidated
  ) then
    alter table usuarios validate constraint usuarios_config_version_ck;
    raise notice 'constraint validada';
  else
    raise notice 'constraint ya validada: no se toca';
  end if;
end $$;

comment on column usuarios.config_version is
  'Versión de config_app. El guardado es un UPDATE condicionado a esta columna (compare-and-set): 0 filas = conflicto. La incrementa quien escribe, en el mismo statement.';

-- ⚠️ `config_app` NO SE TOCA en ningún punto de este fichero: ni se lee, ni se
-- copia, ni se migra, ni se pone a un valor por defecto. Esta migración solo
-- añade la columna que ORDENA sus escrituras.

-- ═════════════════════════════════════════════════════════════════
-- 2 · QUE POSTGREST LA RECONOZCA
-- ═════════════════════════════════════════════════════════════════
-- Solo hace falta si el bloque de arriba ha creado algo. Si no ha cambiado nada,
-- es inofensivo.
notify pgrst, 'reload schema';

-- Comprobar desde fuera antes de desplegar el código. Tiene que dar 200:
--   curl -s -o /dev/null -w "%{http_code}\n" \
--     "$SUPABASE_URL/rest/v1/usuarios?limit=1&select=id,config_version" \
--     -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"

-- ═════════════════════════════════════════════════════════════════
-- 3 · VERIFICACIÓN · SOLO LECTURA
-- ═════════════════════════════════════════════════════════════════
select count(*)                                    as filas,
       count(*) filter (where config_version = 0)  as en_cero,
       min(config_version) as minima, max(config_version) as maxima
  from usuarios;

-- La constraint tiene que salir convalidated = true. Si sale false, el bloque de
-- arriba la validará en la siguiente pasada; no hay que borrarla.
select conname, convalidated, pg_get_constraintdef(oid) as definicion
  from pg_constraint
 where conrelid = 'usuarios'::regclass and conname = 'usuarios_config_version_ck';

-- ═════════════════════════════════════════════════════════════════
-- 4 · PROBAR EL CAS A MANO, SIN TOCAR DATOS
-- ═════════════════════════════════════════════════════════════════
-- Sobre una fila real, en una transacción que se deshace. Demuestra las dos
-- mitades: la base correcta escribe UNA fila, la vieja escribe CERO.
begin;
  -- guarda: que la fila elegida existe y en qué versión está
  select id, config_version from usuarios where id = :propietario limit 1;

  -- con la base correcta → 1 fila
  update usuarios set config_version = config_version + 1
   where id = :propietario and config_version = :base
   returning id, config_version;

  -- con la base YA consumida → 0 filas, que es el conflicto
  update usuarios set config_version = config_version + 1
   where id = :propietario and config_version = :base
   returning id, config_version;
rollback;

-- ═════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═════════════════════════════════════════════════════════════════
-- a) Volver al código anterior: el UPDATE incondicional ignora la columna, así
--    que no hay que deshacer nada. La columna puede quedarse, y es lo que
--    recomiendo: quitarla no arregla nada y sí puede romper.
-- b) Quitarla del todo (solo si se descarta el diseño):
--      alter table usuarios drop constraint if exists usuarios_config_version_ck;
--      alter table usuarios drop column if exists config_version;
--      notify pgrst, 'reload schema';
--    ⚠️ Con el código NUEVO delante esto deja los guardados de config en 400: el
--    filtro apunta a una columna que ya no existe. Hacer (a) ANTES que (b).
--
-- NO se toca `config_app`: esta migración solo añade la columna que ordena sus
-- escrituras. Los datos de configuración no se leen, ni se copian, ni se migran.
