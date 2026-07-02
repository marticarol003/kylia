-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Piloto SILENCIOSO — Tomate (var. "tomacó") eco · Breda · Ferran
-- ─────────────────────────────────────────────────────────────────
-- RECREACIÓN LIMPIA (2026-07-02). La fila original de este piloto (creada por
-- formulario, sin UUID fijo) FUE SOBRESCRITA por una prueba de lechuga con otro
-- email → el piloto se perdió. Este script lo recrea AUTÓNOMO e idempotente, con
-- UUID FIJO PROPIO, para que ninguna sesión de la app lo pueda volver a pisar.
--
-- ▶️ ANTES DE EJECUTAR: corre el SELECT de diagnóstico (todos los usuarios) y
--    confirma que NO existe ya una fila de Ferran / tomate bajo otro UUID. Si
--    existe, avísame y la actualizamos en vez de crear un duplicado.
--
-- ▶️ CONFIRMA 2 datos antes de correr (ajústalos si me equivoco):
--    • email: 'ferran@mascancadell.cat'
--    • fecha de plantación: '2026-05-30'
--
-- Datos del campo (visita 2026-06-13 + fix caudal 20-jun):
--   • Cultivo: tomate "tomacó", ECOLÓGICO. Plantación ~2026-05-30.
--   • Geometría: 2 filas × 40 m (200 plantas), banda ≈0,75 m → huella ≈ 30 m².
--   • Suelo: franco-arenoso → bucket "franco" (AWC 0,15).
--   • Riego: GOTEO automático, cada 2 días, 30 min. Caudal 32 mm/h
--     (= 6 L/h·m × 160 m de goteo ÷ 30 m²; provisional, afinar con truco del vaso).
--   • Ubicación: 41.7421 N, 2.5747 E (Breda, La Selva).

-- ── 1) Columnas necesarias (idempotentes) ────────────────────────
alter table usuarios add column if not exists suelo               text;
alter table usuarios add column if not exists fecha_plantacion    date;
alter table usuarios add column if not exists caudal              numeric;  -- goteo: mm/h (= L/m²·h)
alter table usuarios add column if not exists area_m2             numeric;
alter table usuarios add column if not exists piloto_sombra       boolean not null default false;
alter table usuarios add column if not exists piloto_inicio       date;
alter table usuarios add column if not exists riego_auto          boolean default false;
alter table usuarios add column if not exists riego_auto_desde    date;
alter table usuarios add column if not exists riego_auto_cada_dias int;
alter table usuarios add column if not exists riego_auto_min      int;

-- ── 2) El usuario del piloto de tomate (UUID FIJO propio) ─────────
insert into usuarios (
  id, email, nombre, lat, lon, ciudad,
  cultivos, metodo_riego, manejo, suelo, fecha_plantacion,
  area_m2, caudal, piloto_inicio, tarifa_agua, piloto_sombra, origen,
  riego_auto, riego_auto_desde, riego_auto_cada_dias, riego_auto_min
) values (
  'b1f7c2d9-3a84-4e56-9c10-7d2f8b4a6e31',
  'ferran@mascancadell.cat',
  'Piloto tomate · Mas Cancadell (Ferran)',
  41.7421, 2.5747, 'Breda (La Selva)',
  '{tomate}', 'goteo', 'ecologico', 'franco', '2026-05-30',
  30, 32, '2026-06-13', null, true, 'piloto-tomate',
  true, '2026-06-13', 2, 30
)
on conflict (id) do update set
  email = excluded.email, lat = excluded.lat, lon = excluded.lon,
  ciudad = excluded.ciudad, cultivos = excluded.cultivos,
  metodo_riego = excluded.metodo_riego, manejo = excluded.manejo,
  suelo = excluded.suelo, fecha_plantacion = excluded.fecha_plantacion,
  area_m2 = excluded.area_m2, piloto_inicio = excluded.piloto_inicio,
  piloto_sombra = excluded.piloto_sombra,
  riego_auto = excluded.riego_auto, riego_auto_desde = excluded.riego_auto_desde,
  riego_auto_cada_dias = excluded.riego_auto_cada_dias, riego_auto_min = excluded.riego_auto_min;
  -- OJO: no piso `caudal` en el update, para no borrar el valor real si lo afinas.

-- ── 3) Baseline del goteo automático (16 L/m² día sí día no, 13-jun → hoy) ──
-- Reconstruye la pauta FIJA del goteo (determinista, no observaciones perdidas):
-- 30 min ÷ 60 × 32 mm/h = 16 L/m². Idempotente (NOT EXISTS). El cron diario-b
-- (materializarGoteoAuto) mantiene esto al día en adelante.
insert into acciones (usuario_id, fecha_local, tipo, cantidad_l_m2, duracion_min, franja_horaria, motivo, notas)
select 'b1f7c2d9-3a84-4e56-9c10-7d2f8b4a6e31', d::date, 'riego',
       round((30.0/60.0 * 32.0)::numeric, 1), 30, 'manana', 'goteo-auto',
       'pauta fija 30 min · 32 mm/h (provisional)'
  from generate_series('2026-06-13'::date, current_date, interval '2 days') as d
 where not exists (
   select 1 from acciones a
    where a.usuario_id = 'b1f7c2d9-3a84-4e56-9c10-7d2f8b4a6e31'
      and a.tipo = 'riego' and a.fecha_local = d::date
 );

-- ── Comprobar ────────────────────────────────────────────────────
--   select email, cultivos, metodo_riego, suelo, fecha_plantacion, area_m2,
--          caudal, piloto_inicio, piloto_sombra, riego_auto
--     from usuarios where id = 'b1f7c2d9-3a84-4e56-9c10-7d2f8b4a6e31';
--   select count(*) from acciones
--     where usuario_id = 'b1f7c2d9-3a84-4e56-9c10-7d2f8b4a6e31' and tipo='riego';
