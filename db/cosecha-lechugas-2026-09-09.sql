-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Cierre de los pilotos de lechuga · cosecha del 9-sep-2026
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. Es idempotente.
--
-- QUÉ PASA: las lechugas se cosecharon el 9-sep y las parcelas siguen abiertas.
-- Mientras `fecha_cosecha` esté a NULL:
--   · el cron diario-b sigue materializando riegos sobre tierra sin cultivo,
--   · el balance FAO-56 sigue acumulando déficit y la orden de riego crece sola,
--   · y el reveal cuenta días en los que no había nada que regar.
--
-- CRITERIO DE LA FECHA: la lechuga se corta y la planta se va, así que aquí
-- `fecha_cosecha` SÍ marca madurez — al revés que el tomate de Ferran, donde
-- coger fruta no quita la mata y se cierra el día de la RETIRADA. Ver el
-- comentario de la columna en db/schema.sql.
--
-- ESTO CIERRA EL ENSAYO Kylia vs padre: la zona A (33 lechugas, donde Kylia
-- decide) y la zona B (218 m², manejo del padre) se plantaron el mismo día,
-- 18-jul, y se han cosechado el mismo día. Es la primera comparación con las dos
-- ramas cerradas a la vez.

-- ── 1) Las dos zonas del ensayo ──────────────────────────────────
update usuarios
   set fecha_cosecha = '2026-09-09'
 where id in (
     'd5475c3d-365b-47ff-b31e-fa659a8362fb',   -- zona A · 33 lechugas · Kylia decide
     'b8e1f2a4-6c3d-4e59-9a7b-2f4c8d1e0a33'    -- zona B · 218 m² · manejo del padre
   )
   and fecha_cosecha is null;

-- ── 2) ⚠️ Las 10 del experimento: MIRAR ANTES DE EJECUTAR ────────
-- 9aaa1b25… sigue abierta y se plantó el 5-jun. Si también se cosechó ayer,
-- serían 96 días de ciclo para una lechuga de verano, que es mucho: lo normal
-- es que se cortara hace semanas y nadie lo apuntara. Comprueba la fecha real
-- antes de descomentar, o el reveal contará dos meses de riegos fantasma.
--
-- update usuarios set fecha_cosecha = '2026-09-09'
--  where id = '9aaa1b25-6fad-4213-9eda-e135af71b2c3' and fecha_cosecha is null;

-- ── 3) Comprobar ─────────────────────────────────────────────────
select nombre, ciudad, area_m2,
       fecha_plantacion, fecha_cosecha,
       fecha_cosecha - fecha_plantacion as dias_de_ciclo
  from usuarios
 where 'lechuga' = any(cultivos)
 order by fecha_plantacion;
-- Zona A y zona B deben salir con 53 días de ciclo (18-jul → 9-sep).

-- ── 4) Riegos posteriores al cierre, por si el cron metió alguno ──
select usuario_id, fecha_local, cantidad_l_m2, duracion_min, notas
  from acciones
 where usuario_id in ('d5475c3d-365b-47ff-b31e-fa659a8362fb',
                      'b8e1f2a4-6c3d-4e59-9a7b-2f4c8d1e0a33')
   and tipo = 'riego' and fecha_local > '2026-09-09'
 order by fecha_local;
