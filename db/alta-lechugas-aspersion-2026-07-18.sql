-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Alta del bancal de 33 LECHUGAS a ASPERSIÓN (Sant Boi)
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. Es idempotente:
-- usuario por ON CONFLICT y riego por WHERE NOT EXISTS; se puede reejecutar.
--
-- Qué es: el primer campo donde las decisiones de Kylia SE EJECUTAN de verdad
-- (ya no es piloto silencioso ni contrafactual): Kylia decide, el padre riega.
--   • 33 lechugas en 2 filas (20 cm entre plantas, 40 cm entre filas)
--     → bancal ≈ 3,4 × 0,8 m ≈ 2,6 m². Mismo terreno que las 10 lechugas
--     a regadera (mismas coordenadas y suelo franco de Sant Boi).
--   • 2 aspersores EXCLUSIVOS del bancal (llave propia), caudal 15 mm/h
--     (el medido en el campo con el truco del vaso; misma instalación).
--   • Riego habitual por la mañana (8-9 h) → el Diario B (cron 6:00 UTC =
--     8:00 local) congela la decisión de cada día ANTES o justo al regar:
--     piloto_sombra=true aquí no significa "silencioso", significa "congela
--     la decisión para el registro" (igual que el campo-padre original).
--   • El contrafactual ("qué habría hecho el padre") se apunta a diario desde
--     /campo como observación tipo 'otro' con notas='contrafactual-padre';
--     NO toca acciones para no contaminar el balance hídrico real.

-- ── 1) Columnas necesarias (idempotentes; ya creadas por altas previas) ──
alter table usuarios add column if not exists suelo              text;
alter table usuarios add column if not exists fecha_plantacion   date;
alter table usuarios add column if not exists caudal             numeric;  -- aspersión: mm/h (= L/m²·h)
alter table usuarios add column if not exists area_m2            numeric;
alter table usuarios add column if not exists capacidad_regadera numeric;
alter table usuarios add column if not exists piloto_sombra      boolean not null default false;

-- ── 2) El usuario del bancal de 33 lechugas ──────────────────────
insert into usuarios (
  id, email, nombre, lat, lon, ciudad,
  cultivos, metodo_riego, suelo, fecha_plantacion,
  area_m2, caudal, capacidad_regadera, tarifa_agua, piloto_sombra, origen
) values (
  'd5475c3d-365b-47ff-b31e-fa659a8362fb',
  'lechugas-33-aspersion@kylia.local',
  '33 lechugas · aspersión — Sant Boi',
  41.32339, 2.05936, 'Sant Boi de Llobregat',
  '{lechuga}', 'aspersion', 'franco', '2026-07-18',
  2.6, 15, null, null,                  -- caudal 15 mm/h MEDIDO; tarifa null (pozo propio)
  true, 'lechugas-33-aspersion'
)
on conflict (id) do update set
  lat = excluded.lat, lon = excluded.lon, ciudad = excluded.ciudad,
  cultivos = excluded.cultivos, metodo_riego = excluded.metodo_riego,
  suelo = excluded.suelo, fecha_plantacion = excluded.fecha_plantacion,
  area_m2 = excluded.area_m2, caudal = excluded.caudal,
  capacidad_regadera = excluded.capacidad_regadera, piloto_sombra = excluded.piloto_sombra;

-- ── 3) El riego de asentamiento del trasplante (2026-07-18) ──────
-- 3 h de aspersión (7:30-10:30) × 15 mm/h = 45 L/m² brutos. Decisión del padre
-- (riego de trasplante); a partir de aquí decide Kylia. Como en los demás campos,
-- el asentamiento SÍ entra al balance hídrico (deja el suelo lleno) pero no
-- cuenta como "riego de manejo" en ninguna comparativa.
insert into acciones (usuario_id, fecha_local, tipo, cantidad_l_m2, duracion_min, franja_horaria, cultivo, notas)
select 'd5475c3d-365b-47ff-b31e-fa659a8362fb', '2026-07-18', 'riego', 45, 180, 'manana', 'lechuga',
       'Riego de asentamiento del trasplante: 3 h de aspersión (7:30-10:30, 15 mm/h = 45 L/m²). 33 lechugas en 2 filas.'
where not exists (
  select 1 from acciones
  where usuario_id = 'd5475c3d-365b-47ff-b31e-fa659a8362fb'
    and fecha_local = '2026-07-18' and tipo = 'riego'
);

-- ── Comprobar ────────────────────────────────────────────────────
--   select id, ciudad, cultivos, metodo_riego, suelo, area_m2, caudal, piloto_sombra
--     from usuarios where id = 'd5475c3d-365b-47ff-b31e-fa659a8362fb';
--   select fecha_local, tipo, cantidad_l_m2, duracion_min, notas
--     from acciones where usuario_id = 'd5475c3d-365b-47ff-b31e-fa659a8362fb';
