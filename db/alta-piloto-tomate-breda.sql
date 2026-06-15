-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Piloto SILENCIOSO — Tomate (var. "tomacó") · Breda (La Selva)
-- ─────────────────────────────────────────────────────────────────
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de que el alta del
-- formulario (/piloto/alta) haya creado el usuario. El alta ya graba
-- cultivo, método, suelo, fecha_plantacion y area_m2; este script
-- completa lo que el formulario NO captura:
--   • caudal (mm/h) del goteo  → 6 mm/h (= 6 L/h·m² declarado por el agricultor)
--   • piloto_sombra = true      → Kylia CALLA y el cron congela su decisión cada noche
--   • (opcional) corrige area_m2 a la huella real plantada (~30 m²) si el
--     formulario la rellenó con el recinto SIGPAC entero.
--
-- Datos del campo (visita 2026-06-13):
--   • Cultivo: tomate (variedad "tomacó"), ecológico.
--   • Plantación: ~2026-05-30 (hace 2 semanas).
--   • Geometría: 2 filas × 40 m, 100 plantas/fila (200 plantas). Cada fila con
--     una manguera de goteo a cada lado (25 cm entre el par), 45 cm entre filas.
--     Banda plantada ≈ 0,75 m de ancho → huella 40 × 0,75 ≈ 30 m².
--   • Suelo: franco-arenoso con arcillas → bucket "franco" (AWC 0,15).
--   • Riego: goteo automatizado, cada 2 días, 30 min. Caudal 6 mm/h
--     (DECLARADO; afinar con el "truco del vaso" y luego: update ... caudal=<real>).
--   • Ubicación: 41.7421 N, 2.5747 E (Breda, La Selva).
--   • Hoy 2026-06-13 regaba (1er riego a registrar como baseline en el diario).

-- ▶️ SUSTITUYE el email por el que usaste en el alta:
\set email 'EMAIL_DEL_PILOTO'

update usuarios
   set piloto_sombra = true,
       caudal        = 6,        -- mm/h = L/m²·h (goteo declarado)
       area_m2       = 30        -- huella real plantada (40 m × ~0,75 m banda); quita esta línea si el alta ya la dejó bien
 where email = :'email';

-- Comprobación:
select email, cultivos, metodo_riego, suelo, fecha_plantacion,
       area_m2, caudal, piloto_sombra
  from usuarios
 where email = :'email';
