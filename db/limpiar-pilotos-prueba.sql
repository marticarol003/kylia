-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Limpieza de pilotos de PRUEBA (2026-06-15)
-- ─────────────────────────────────────────────────────────────────
-- Quita los pilotos silenciosos que eran pruebas y deja SOLO los reales.
-- Todas las tablas hijas (recomendaciones_log, jornadas, acciones,
-- observaciones, mediciones) tienen ON DELETE CASCADE y eventos tiene
-- ON DELETE SET NULL, así que basta con borrar la fila de `usuarios`:
-- el resto se limpia en cascada.
--
-- SE QUEDAN (NO tocar):
--   • 9aaa1b25-6fad-4213-9eda-e135af71b2c3  → 10 lechugas del padre (regadera, 0,7 m², Sant Boi)
--   • c46e9d6d-577f-47ab-8a67-eebadcec7109  → tomate de Breda (goteo, piloto silencioso nuevo)
--   • 23567ff1-7368-4dc9-b777-fdeaab9f8714  → campo del padre aspersión 440 m² (comparativa, piloto_sombra=false)
--
-- SE BORRAN (pruebas):
--   • a1b2c3d4-0000-4000-8000-000000000099  → lechuga goteo 1200 m² (Sant Boi, sin riegos) — prueba
--   • 72dcc8bb-4183-49b2-a7f5-ed71a4a94710  → lechuga aspersión 10.441 m² (3 riegos de prueba) — prueba
--   • 02cc960c-0953-4fbc-a3fb-59ed6c1c7193  → lechuga aspersión 6.624 m² (sin riegos) — prueba

-- ── 1) COMPROBAR primero qué se va a borrar (ejecuta solo este SELECT) ──
select id, ciudad, cultivos, metodo_riego, area_m2, piloto_sombra,
       (select count(*) from acciones a where a.usuario_id = u.id)            as riegos,
       (select count(*) from recomendaciones_log r where r.usuario_id = u.id) as decisiones
  from usuarios u
 where id in (
   'a1b2c3d4-0000-4000-8000-000000000099',
   '72dcc8bb-4183-49b2-a7f5-ed71a4a94710',
   '02cc960c-0953-4fbc-a3fb-59ed6c1c7193'
 );

-- ── 2) BORRAR (cuando el SELECT de arriba muestre SOLO las 3 pruebas) ──
delete from usuarios
 where id in (
   'a1b2c3d4-0000-4000-8000-000000000099',
   '72dcc8bb-4183-49b2-a7f5-ed71a4a94710',
   '02cc960c-0953-4fbc-a3fb-59ed6c1c7193'
 );

-- ── 3) Verificar que solo quedan los pilotos silenciosos reales ──
select id, ciudad, cultivos, metodo_riego, area_m2
  from usuarios
 where piloto_sombra = true
 order by ciudad;
-- Esperado: 9aaa1b25 (10 lechugas) + c46e9d6d (tomate). Nada más.
