-- ─────────────────────────────────────────────────────────────────
-- Caché de la oferta de suelo (pilar fertilizantes) — persist-once
-- ─────────────────────────────────────────────────────────────────
-- El suelo no cambia entre riegos: en vez de consultar SoilGrids en cada carga
-- del cuaderno (llamada de red de varios segundos), se calcula UNA vez y se
-- guarda aquí. api/campo.js lo lee si existe y solo llama a SoilGrids cuando
-- está vacío. Ver api/_suelo-oferta.js.
--
-- Contenido (jsonb): la salida de ofertaSuelo(lat, lon, area) — incluye
-- { disponible, N, P2O5, K2O, observado, modelo_n, fuente, nota }. Se cachea
-- también el caso "no disponible" (píxel enmascarado) para no reintentar en
-- balde; borra la fila (set null) si quieres recalcular tras mejorar el modelo.

alter table usuarios add column if not exists suelo_oferta jsonb;

comment on column usuarios.suelo_oferta is
  'Caché de la oferta de nutrientes del suelo (SoilGrids). Salida de api/_suelo-oferta.js. NULL = aún no calculada.';
