-- ─────────────────────────────────────────────────────────────────
-- Congelar la lámina de cada riego (14-sep-2026)
-- ─────────────────────────────────────────────────────────────────
-- EL PROBLEMA. `laminaRiego` convierte duración × caudal en mm usando el caudal
-- ACTUAL de la parcela. Eso es deliberado —afinar un caudal tiene que mover las
-- decisiones de hoy— pero significa que REESCRIBE EL PASADO: el riego de 60 min
-- que en julio valía 15 mm pasa a valer 5,4 mm en cuanto se remide el caudal con
-- el vaso, y con él se mueve el balance del ciclo entero y el reveal del piloto.
--
-- Un piloto ciego que cambia de números cada vez que se afina un dato no se
-- puede validar. Así que el evento congela lo suyo y el pasado deja de moverse.
--
-- QUÉ SE CONGELA, por evento:
--   caudal_mmh    el caudal vigente el día del riego (mm/h)
--   lamina_mm     la lámina definitiva ya calculada (mm = L/m²)
--   lamina_origen de dónde salió, para saber de qué fiarse
--
-- `lamina_origen` es el campo que evita inventar historia:
--   'duracion_x_caudal'   duración × caudal del momento. El bueno.
--   'cantidad_apuntada'   el agricultor escribió los L/m² a mano.
--   'backfill_caudal_actual'  ← ESTE NO ES UN DATO DE ÉPOCA. Se rellena abajo
--                             con el caudal de HOY porque es lo único que hay
--                             para los riegos anteriores a esta migración. Queda
--                             marcado para que nadie lo confunda con lo congelado
--                             de verdad, y para poder excluirlo de una validación.
--
-- Ejecutar en Supabase → SQL Editor.

alter table acciones add column if not exists caudal_mmh    numeric;
alter table acciones add column if not exists lamina_mm     numeric;
alter table acciones add column if not exists lamina_origen text;

comment on column acciones.caudal_mmh    is 'Caudal (mm/h) vigente el día del riego. Congelado: no se recalcula.';
comment on column acciones.lamina_mm     is 'Lámina definitiva del riego en mm (= L/m²). Congelada.';
comment on column acciones.lamina_origen is 'duracion_x_caudal | cantidad_apuntada | backfill_caudal_actual | desconocida';

-- ── Backfill de lo que ya existe ─────────────────────────────────
-- 1. Los que traen cantidad apuntada a mano: esa ES la lámina, y no depende del
--    caudal. Se congelan tal cual, sin marca de duda.
update acciones a
   set lamina_mm     = a.cantidad_l_m2,
       lamina_origen = 'cantidad_apuntada'
 where a.tipo = 'riego'
   and a.lamina_mm is null
   and a.cantidad_l_m2 is not null
   and (a.duracion_min is null or a.duracion_min <= 0);

-- 2. Los que traen duración: hay que usar el caudal de hoy, que es lo único que
--    hay. SE MARCA como backfill: no es el caudal de aquel día, es una
--    reconstrucción, y hay que poder distinguirla.
update acciones a
   set caudal_mmh    = u.caudal,
       lamina_mm     = round((u.caudal * a.duracion_min / 60.0)::numeric, 1),
       lamina_origen = 'backfill_caudal_actual'
  from usuarios u
 where u.id = a.usuario_id
   and a.tipo = 'riego'
   and a.lamina_mm is null
   and a.duracion_min is not null and a.duracion_min > 0
   and u.caudal is not null and u.caudal > 0;

-- 3. Los que no tienen ni cantidad ni duración utilizable: se sabe que regó y no
--    cuánto. NO se inventa nada; se deja dicho.
update acciones
   set lamina_origen = 'desconocida'
 where tipo = 'riego'
   and lamina_mm is null
   and lamina_origen is null;

-- ── Comprobación ─────────────────────────────────────────────────
select lamina_origen, count(*), round(avg(lamina_mm)::numeric, 1) as lamina_media
  from acciones where tipo = 'riego'
 group by lamina_origen order by count(*) desc;
