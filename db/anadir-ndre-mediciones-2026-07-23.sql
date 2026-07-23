-- ─────────────────────────────────────────────────────────────────
-- NDRE en mediciones (pilar fertilizantes · señal de nitrógeno)
-- ─────────────────────────────────────────────────────────────────
-- sentinel.js YA calcula el NDRE (red-edge B08/B05) en cada paso, pero el refresco
-- por lotes solo persistía ndvi/ndmi porque la tabla no tenía columna. El NDRE es
-- un proxy del estado de NITRÓGENO foliar (la clorofila absorbe en el red-edge),
-- así que interesa guardarlo para cruzarlo con el plan de abonado más adelante.
--
-- Idempotente. Tras ejecutarlo, el cron sentinel-refresh empieza a escribir ndre.
-- B05 es nativo a 20 m → en parcelas pequeñas es menos fiable que el NDVI (10 m);
-- se guarda con su stdev para poder juzgar la dispersión.

alter table mediciones add column if not exists ndre       numeric;
alter table mediciones add column if not exists ndre_stdev numeric;

comment on column mediciones.ndre is
  'NDRE (B08/B05), red-edge. Proxy del estado de nitrógeno foliar. Nativo a 20 m.';
comment on column mediciones.ndre_stdev is
  'Desviación típica del NDRE en la parcela (dispersión del vigor de N).';
