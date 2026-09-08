-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Cierre del piloto de tomate de Ferran (Breda) · 2026-09-08
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. Es idempotente.
--
-- QUÉ PASA: Ferran cosechó la semana del 1-sep y ya están RETIRANDO el cultivo.
-- Con `fecha_cosecha` a NULL siguen pasando dos cosas, las dos malas:
--
--   1. El cron diario-b sigue materializando el goteo automático (30 min = 16
--      L/m² CADA DÍA) sobre una parcela que ya no tiene planta. Ese riego
--      inventado entra en el reveal como agua aplicada.
--   2. El contrafactual de Kylia sigue calculando ETc de un tomate que ya no
--      está, así que la comparación cuenta días en los que no había nada que
--      regar por ninguna de las dos partes.
--
-- Con fecha_cosecha puesta, materializarGoteoAuto para solo (api/diario-b.js:144)
-- y el reveal corta su ventana ahí. No hace falta tocar `riego_auto`.
--
-- ⚠️ QUÉ DÍA PONER, Y POR QUÉ NO ES EL MISMO CRITERIO QUE LA CEBOLLETA
--
-- En la cebolleta de Oriol se cerró el día que EMPEZÓ la cosecha, porque al
-- arrancar manojos la superficie con cultivo encoge desde el primer día y el
-- motor seguiría calculando ETc de la parcela entera.
--
-- El tomate es el caso CONTRARIO. Coger tomates no quita la planta: la mata
-- sigue ahí, sigue transpirando y sigue necesitando agua hasta que la arrancas.
-- Si cerráramos el día de la primera recolección, estaríamos borrando semanas en
-- las que el cultivo SÍ demandaba agua — y el reveal saldría corto justo en el
-- tramo donde más regó.
--
-- Así que aquí el día bueno es el de la RETIRADA del cultivo (o, si no se sabe,
-- el último día que se regó de verdad). Cambia la fecha de abajo por la real.

-- ── 1) Cerrar el piloto ──────────────────────────────────────────
update usuarios
   set fecha_cosecha = '2026-09-08'          -- ← AJUSTAR al día en que se retiró el cultivo
 where id = 'b1f7c2d9-3a84-4e56-9c10-7d2f8b4a6e31'
   and fecha_cosecha is null;

-- ── 2) Comprobar ─────────────────────────────────────────────────
-- Debe salir: fecha_plantacion 2026-05-30 · fecha_cosecha la que hayas puesto.
select nombre,
       ciudad,
       fecha_plantacion,
       fecha_cosecha,
       fecha_cosecha - fecha_plantacion as dias_de_ciclo,
       area_m2,
       caudal,
       riego_auto
  from usuarios
 where id = 'b1f7c2d9-3a84-4e56-9c10-7d2f8b4a6e31';

-- ── 3) Riegos automáticos posteriores al cierre ──────────────────
-- El cron ya no escribirá más, pero los que hubiera METIDO entre la retirada
-- real del cultivo y el día que ejecutes esto son agua que nadie echó sobre
-- ninguna planta. Míralos antes de decidir si se borran:
select id, fecha_local, cantidad_l_m2, duracion_min, notas
  from acciones
 where usuario_id = 'b1f7c2d9-3a84-4e56-9c10-7d2f8b4a6e31'
   and tipo = 'riego'
   and fecha_local > '2026-09-08'            -- ← la misma fecha de arriba
 order by fecha_local;

-- Si son goteo-auto sintetizado (notas con 'pauta fija') y el cultivo ya no
-- estaba, bórralos: descomenta.
-- delete from acciones
--  where usuario_id = 'b1f7c2d9-3a84-4e56-9c10-7d2f8b4a6e31'
--    and tipo = 'riego'
--    and fecha_local > '2026-09-08'
--    and notas ilike '%pauta fija%';

-- ── 4) ⚠️ ANTES DE ENSEÑARLE EL INFORME A FERRAN ─────────────────
-- El caudal de esta parcela (32 mm/h) está marcado PROVISIONAL desde el alta
-- ("fix caudal 20-jun"), y de él depende TODO el titular del informe: el agua
-- aplicada se calcula como minutos × caudal. A 32 mm/h el ahorro sale del 65%;
-- a 16 mm/h sería del 31%; por debajo de 11,1 mm/h no habría ahorro ninguno.
--
-- Es exactamente la trampa que ya mordió en el campo del padre, donde el caudal
-- pasó de 15 a 5,4 mm/h al medirlo con un cubo. Medir el de Ferran es una hora
-- de reloj y un recipiente, y no se puede publicar el 65% sin eso.
--
-- Cuando esté medido:
-- update usuarios set caudal = <medido> where id = 'b1f7c2d9-3a84-4e56-9c10-7d2f8b4a6e31';
-- (el reveal se recalcula solo: la lámina de cada riego sale del caudal ACTUAL,
--  ver laminaRiego en assets/js/motor-riego.js)
