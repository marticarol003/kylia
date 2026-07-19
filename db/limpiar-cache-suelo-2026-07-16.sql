-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Limpiar la caché de oferta de suelo tras recalibrar el modelo · 2026-07-16
-- ─────────────────────────────────────────────────────────────────
-- El modelo de mineralización de N de _suelo-oferta.js se recalibró a la Tabla 4.2
-- de MAPA (antes sobreestimaba ×2,4). La oferta de suelo se cachea en
-- usuarios.suelo_oferta; los pilotos que ya la tenían calculada seguirán mostrando
-- el valor VIEJO hasta vaciarla. Esto la borra para que se recalcule (una vez) con
-- el modelo nuevo la próxima vez que se abra su cuaderno.

update usuarios set suelo_oferta = null where piloto_sombra = true;

-- Verificar (todas deben quedar en null → se recalculan al vuelo):
select id, ciudad, cultivos, suelo_oferta from usuarios where piloto_sombra = true;
