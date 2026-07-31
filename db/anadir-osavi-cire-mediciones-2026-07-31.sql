-- ─────────────────────────────────────────────────────────────────
-- OSAVI y CIre en mediciones (índices corregidos)
-- ─────────────────────────────────────────────────────────────────
-- Dos índices más de las MISMAS bandas que ya se descargan (B04, B05, B08), así
-- que no cuestan ni una petición extra a Copernicus:
--
--   OSAVI = (B08 − B04) / (B08 + B04 + 0,16)     Rondeaux, Steven & Baret (1996)
--     El NDVI de una parcela recién plantada mide sobre todo la TIERRA que se ve
--     entre planta y planta, y lee vigor bajo aunque el cultivo esté perfecto.
--     El término L = 0,16 del denominador cancela buena parte de esa señal del
--     suelo. L está optimizado para cubierta agrícola (mejor que el SAVI clásico
--     de L = 0,5, pensado para vegetación dispersa).
--
--   CIre  = B08 / B05 − 1                        Gitelson et al. (2003)
--     Clorofila en cubierta. Para NITRÓGENO es mejor que el NDRE: es casi lineal
--     con el contenido de clorofila y NO satura en el rango donde el NDVI ya
--     está plano. Acotado a 10 en el evalscript (por encima de ~8 es artefacto
--     de suelo desnudo, donde B05 se acerca a cero y el cociente se dispara).
--
-- OJO con los rangos al consultarlos: ndvi/ndmi/ndre/osavi van en [−1, 1], pero
-- CIre es un COCIENTE SIN ACOTAR (≈0 en suelo desnudo, 3-8 en cubierta densa).
-- No comparte umbrales ni escala de color con los demás.
--
-- De momento SOLO se acumulan: lo que ve el agricultor (`estado`) sigue saliendo
-- del NDVI. OSAVI da sistemáticamente más bajo que el NDVI sobre la misma
-- parcela (el +0,16), así que reutilizar sus cortes (0,6 / 0,35) pintaría de
-- "estrés" cultivos sanos. Primero hace falta serie de los dos a la vez sobre
-- las mismas parcelas para recalibrar; para eso son estas columnas.
--
-- Idempotente. Tras ejecutarlo, el cron sentinel-refresh empieza a escribirlos.

alter table mediciones add column if not exists osavi       numeric;
alter table mediciones add column if not exists osavi_stdev numeric;
alter table mediciones add column if not exists cire        numeric;
alter table mediciones add column if not exists cire_stdev  numeric;

comment on column mediciones.osavi is
  'OSAVI (B08/B04, L=0,16). NDVI corregido por suelo: fiable con poca cubierta, donde el NDVI lee la tierra. Rango [-1, 1].';
comment on column mediciones.osavi_stdev is
  'Desviación típica del OSAVI en la parcela (heterogeneidad de la cubierta).';
comment on column mediciones.cire is
  'CIre (B08/B05 - 1). Clorofila en cubierta, proxy de N que NO satura. COCIENTE SIN ACOTAR: ~0 suelo desnudo, 3-8 cubierta densa (tope 10).';
comment on column mediciones.cire_stdev is
  'Desviación típica del CIre en la parcela (dispersión del estado de nitrógeno).';
