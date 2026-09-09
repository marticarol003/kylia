-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Límite de uso de los endpoints públicos · 2026-09-09
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. Es idempotente.
--
-- QUÉ RESUELVE: /api/ia y /api/sentinel eran públicos, sin límite y con CORS
-- abierto. Un bucle de peticiones podía quemar la cuota de Gemini, el crédito
-- de Anthropic (producto-fertilizante sale a buscar al mercado en vivo, y esa
-- sí cuesta dinero por consulta) y el tiempo de ejecución de Vercel. No había
-- forma de enterarse hasta ver la factura.
--
-- ⚠️ MIENTRAS ESTO NO SE EJECUTE, NO HAY PROTECCIÓN. api/_limite.js falla
-- ABIERTO a propósito —deja pasar y avisa por consola— porque un guardia de
-- coste no puede tumbar el producto de un agricultor real si falta una tabla.
-- Es el mismo criterio que ya costó dos sustos: el 500 de /api/pago del 13-ago
-- por pedir columnas de una migración sin ejecutar, y la auth fail-closed de
-- los crons que hubo que revertir el 28-jul. Pero significa que hasta que no
-- pegues esto, el agujero sigue abierto.
--
-- LA IP NO SE GUARDA. `clave` es un HMAC-SHA256 truncado de la IP. Una IP es un
-- dato personal y guardarla sería un tratamiento que la política de privacidad
-- no declara; con el hash se puede contar cuántas veces ha llamado alguien sin
-- poder saber quién es. Pon LIMITE_SALT en Vercel para que además sea
-- irreversible (si no, se usa una sal por defecto que está en el código).

create table if not exists limite_uso (
  id      bigserial   primary key,
  clave   text        not null,   -- HMAC de la IP, nunca la IP
  recurso text        not null,   -- 'ia:recomendacion', 'sentinel:punto'…
  momento timestamptz not null default now()
);

comment on table  limite_uso is
  'Contador de uso de los endpoints públicos, compartido entre instancias de Vercel. Se poda solo (ver _limite.js).';
comment on column limite_uso.clave is
  'HMAC-SHA256 truncado de la IP. NUNCA la IP en claro: es un dato personal y la política de privacidad no declara ese tratamiento.';

-- La consulta del guardia es siempre (recurso, clave, últimas 24 h).
create index if not exists idx_limite_uso_ventana
  on limite_uso (recurso, clave, momento desc);
-- Y el barrido borra por fecha.
create index if not exists idx_limite_uso_momento
  on limite_uso (momento);

-- ── Comprobar ────────────────────────────────────────────────────
select count(*) as filas,
       count(distinct clave)   as claves_distintas,
       count(distinct recurso) as recursos,
       min(momento) as mas_antigua,
       max(momento) as mas_reciente
  from limite_uso;

-- ── Barrido manual (el automático va en _limite.js, 1 de cada 50) ─
-- delete from limite_uso where momento < now() - interval '26 hours';
