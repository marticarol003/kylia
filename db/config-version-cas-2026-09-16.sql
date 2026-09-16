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
-- 1 · LA COLUMNA
-- ═════════════════════════════════════════════════════════════════
-- `default 0` + `not null` hace que TODAS las filas existentes arranquen en 0,
-- así que no hay caso especial para "nunca guardó": el primer guardado va con
-- base_version = 0 como cualquier otro. En PG11+ un default constante no
-- reescribe la tabla: es metadato, instantáneo.
alter table usuarios
  add column if not exists config_version bigint not null default 0;

comment on column usuarios.config_version is
  'Versión de config_app. El guardado es un UPDATE condicionado a esta columna (compare-and-set): 0 filas = conflicto. La incrementa quien escribe, en el mismo statement.';

-- Cordura. NOT VALID primero: se aplica a lo que entre desde ya sin escanear la
-- tabla; se valida en el paso 3, cuando ya sabemos que no hay nada raro.
alter table usuarios drop constraint if exists usuarios_config_version_ck;
alter table usuarios add  constraint usuarios_config_version_ck
  check (config_version >= 0) not valid;

-- ═════════════════════════════════════════════════════════════════
-- 2 · QUE POSTGREST LA RECONOZCA
-- ═════════════════════════════════════════════════════════════════
-- Sin esto PostgREST sigue con su schema cache viejo y el filtro
-- `config_version=eq.N` devuelve 400: NINGÚN guardado de config funcionaría.
notify pgrst, 'reload schema';

-- Comprobar desde fuera antes de seguir. Tiene que dar 200:
--   curl -s -o /dev/null -w "%{http_code}\n" \
--     "$SUPABASE_URL/rest/v1/usuarios?limit=1&select=id,config_version" \
--     -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"

-- ═════════════════════════════════════════════════════════════════
-- 3 · VERIFICACIÓN
-- ═════════════════════════════════════════════════════════════════
select count(*)                                   as filas,
       count(*) filter (where config_version = 0) as en_cero,
       min(config_version) as minima, max(config_version) as maxima
  from usuarios;                                  -- todas a 0 antes de desplegar

alter table usuarios validate constraint usuarios_config_version_ck;

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
--    que no hay que deshacer nada. La columna puede quedarse.
-- b) Quitarla del todo (solo si se descarta el diseño):
--      alter table usuarios drop constraint if exists usuarios_config_version_ck;
--      alter table usuarios drop column if exists config_version;
--      notify pgrst, 'reload schema';
--    ⚠️ Con el código NUEVO delante esto deja los guardados de config en 400: el
--    filtro apunta a una columna que ya no existe. Hacer (a) ANTES que (b).
--
-- NO se toca `config_app`: esta migración solo añade la columna que ordena sus
-- escrituras. Los datos de configuración no se leen, ni se copian, ni se migran.
