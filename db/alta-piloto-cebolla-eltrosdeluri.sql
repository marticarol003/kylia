-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Piloto SILENCIOSO — Cebolla tierna (eco) · El Tros de l'Uri
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. Es AUTÓNOMO e
-- idempotente: crea (o actualiza) el usuario por ON CONFLICT (id) y no
-- depende de que el formulario /piloto/alta haya corrido antes. Se puede
-- reejecutar sin duplicar.
--
-- Si YA diste de alta este campo por /piloto/alta (con onboarding + SIGPAC),
-- usa esa fila en lugar de esta: ejecuta solo el bloque UPDATE-by-email del
-- final y borra el INSERT (evita dos usuarios para el mismo agricultor).
--
-- Qué deja montado:
--   1) las columnas agronómicas (si aún no existían),
--   2) el usuario del piloto con sus datos reales,
--   3) piloto_sombra=true → Kylia CALLA y el Diario B congela su decisión cada
--      noche para el reveal (requiere DIARIO_B_LIVE=1 en Vercel; ya activo).
--   4) piloto_inicio = fecha de plantación → el contrafactual FAO-56 del reveal
--      arranca limpio desde el día 0, sin baseline sucio que descontar.
--
-- Datos del campo (alta 2026-06-29):
--   • Cultivo: cebolla tierna / cebolleta (FAO-56: kc med 1,00, fin 1,00,
--     raíz superficial; clave 'cebolla' en api/_motor-riego.js → FAO_KC).
--   • Manejo: ECOLÓGICO.
--   • Plantación: 2026-06-24.
--   • Geometría: 5 filas de aspersión, cada fila con 3 líneas de cebolla
--     separadas 10-15 cm; plantas a 20-30 cm dentro de la línea.
--     20 aspersores de ~1,25 m de radio. Superficie útil ≈ 380 m².
--   • Suelo: franco-arenoso → bucket "franco" (AWC 0,15; mismo criterio que
--     el piloto de tomate de Breda).
--   • Riego: ASPERSIÓN. El motor convierte horas ↔ mm con `caudal` (mm/h).
--   • Ubicación: 41.674023 N, 2.766436 E (La Selva, Girona; vecina de Breda).
--
-- ▶️ CAUDAL: medido con el "truco del vaso" el 2026-07-01 (1 h de riego, cubo a
--    medio camino entre 2 aspersores). Lámina fina, no medible con precisión desde
--    foto → PROVISIONAL 12 mm/h (banda 10-15, en línea con el campo del padre =15).
--    Ya va en el INSERT de abajo. Al afinar con medición precisa (volcar el agua en
--    botella con marcas → mL) actualiza:
--        update usuarios set caudal = <mm/h real>
--         where email = 'eltrosdeluri@gmail.com';

-- ── 1) Columnas necesarias (idempotentes) ────────────────────────
alter table usuarios add column if not exists suelo            text;
alter table usuarios add column if not exists fecha_plantacion date;
alter table usuarios add column if not exists caudal           numeric;  -- aspersión: mm/h (= L/m²·h)
alter table usuarios add column if not exists area_m2          numeric;
alter table usuarios add column if not exists piloto_sombra    boolean not null default false;
alter table usuarios add column if not exists piloto_inicio    date;

-- ── 2) El usuario del piloto de cebolla ──────────────────────────
insert into usuarios (
  id, email, nombre, lat, lon, ciudad,
  cultivos, metodo_riego, manejo, suelo, fecha_plantacion,
  area_m2, caudal, piloto_inicio, tarifa_agua, piloto_sombra, origen
) values (
  'a7f3c9e1-2b84-4d56-9f10-6c8e2b4a7d33',
  'eltrosdeluri@gmail.com',
  'Piloto cebolla · El Tros de l''Uri',
  41.674023, 2.766436, 'La Selva (Girona)',
  '{cebolla}', 'aspersion', 'ecologico', 'franco', '2026-06-24',
  380, 12, '2026-06-24', null,          -- caudal 12 mm/h PROVISIONAL (truco del vaso 1-jul; banda 10-15)
  true, 'piloto-cebolla'
)
on conflict (id) do update set
  email = excluded.email, lat = excluded.lat, lon = excluded.lon,
  ciudad = excluded.ciudad, cultivos = excluded.cultivos,
  metodo_riego = excluded.metodo_riego, manejo = excluded.manejo,
  suelo = excluded.suelo, fecha_plantacion = excluded.fecha_plantacion,
  area_m2 = excluded.area_m2, piloto_inicio = excluded.piloto_inicio,
  piloto_sombra = excluded.piloto_sombra;
  -- OJO: no piso `caudal` en el update para no borrar el valor real cuando
  -- reejecutes tras medirlo. Cámbialo solo con el UPDATE explícito de arriba.

-- ── (alternativa) si el formulario /piloto/alta ya creó la fila ───
-- Borra el INSERT de arriba y deja solo esto, sustituyendo nada (el email ya
-- es el correcto):
--   update usuarios
--      set piloto_sombra = true,
--          piloto_inicio = '2026-06-24',
--          area_m2       = 380
--    where email = 'eltrosdeluri@gmail.com';

-- ── Comprobar ────────────────────────────────────────────────────
--   select id, ciudad, cultivos, metodo_riego, manejo, suelo,
--          fecha_plantacion, area_m2, caudal, piloto_inicio, piloto_sombra
--     from usuarios where email = 'eltrosdeluri@gmail.com';
