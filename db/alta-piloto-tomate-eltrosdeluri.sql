-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Piloto SILENCIOSO — Tomate (eco, invernadero) · El Tros de l'Uri
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. AUTÓNOMO e idempotente.
-- Segundo cultivo de El Tros de l'Uri (La Selva), en la MISMA ubicación que la
-- cebolleta pero es su propio piloto (otro cultivo → su propia fila y reveal).
--
-- Datos del campo (foto túnel nº 12, reportado 2026-07-14):
--   • Cultivo: tomate. 9 mesas: 5 ensalada + 3 cherry + 1 "Rosa Ple".
--   • Invernadero túnel. Manejo ECOLÓGICO. Plantación 2026-06-24 (= la cebolleta).
--   • Riego: GOTEO. 1 manguera por mesa (9 mangueras), goteros cada 20 cm,
--     mangueras separadas ~1 m. Cada mesa con 2 líneas de tomate, plantas cada 40 cm.
--   • Caudal del gotero: 1,14 L/h a 0,7 bar.
--       caudal (mm/h) = (1,14 ÷ 0,20 m) ÷ 1 m entre mangueras = 5,7 mm/h  (= L/m²·h)
--   • Superficie ≈ 9 mesas × ~60 m (filas 57-62 m) × ~1 m = ~540 m².
--   • Suelo: franco (misma ubicación que la cebolleta).
--
-- ▶️ CAUDAL 5,7 y ÁREA 540 salen de medidas "a ojo" (separación ~1 m, largo ~60 m).
--    Cuadran con la práctica (60 min/día × 5,7 = 5,7 L/m²/día ≈ ETc tomate verano).
--    Afinables con el truco del vaso (1 gotero, 1 min, medir).
--
-- ▶️ INVERNADERO: el ET₀ de Open-Meteo es de exterior y sobreestima algo la demanda
--    bajo plástico. Para el reveal (contrafactual) no es grave: ambos brazos usan el
--    mismo ET₀ y el ahorro relativo se mantiene. Anotado.

-- ── 1) Columnas necesarias (idempotentes) ────────────────────────
alter table usuarios add column if not exists suelo                text;
alter table usuarios add column if not exists fecha_plantacion     date;
alter table usuarios add column if not exists area_m2              numeric;
alter table usuarios add column if not exists caudal               numeric;   -- goteo: mm/h = L/m²·h
alter table usuarios add column if not exists piloto_inicio        date;
alter table usuarios add column if not exists piloto_sombra        boolean not null default false;
alter table usuarios add column if not exists riego_auto           boolean default false;
alter table usuarios add column if not exists riego_auto_min       int;
alter table usuarios add column if not exists riego_auto_cada_dias int;
alter table usuarios add column if not exists riego_auto_desde     date;

-- ── 2) El usuario del piloto de tomate ────────────────────────────
insert into usuarios (
  id, email, nombre, lat, lon, ciudad,
  cultivos, cultivos_secundarios, metodo_riego, manejo, suelo, fecha_plantacion,
  area_m2, caudal, piloto_inicio, tarifa_agua, piloto_sombra, origen,
  riego_auto, riego_auto_min, riego_auto_cada_dias, riego_auto_desde
) values (
  'f1954cd1-6635-4bad-be48-c08f51e0dfbd',
  'eltrosdeluri@gmail.com',
  'Piloto tomate · El Tros de l''Uri',
  41.674023, 2.766436, 'La Selva (Girona)',
  '{tomate}', '5 ensalada · 3 cherry · 1 Rosa Ple (invernadero túnel 12)',
  'goteo', 'ecologico', 'franco', '2026-06-24',
  540, 5.7, '2026-06-24', null,
  true, 'piloto-tomate-laselva',
  true, 60, 1, '2026-06-24'      -- goteo diario 60 min (30 mañana + 30 mediodía) desde plantación
)
on conflict (id) do update set
  email = excluded.email, nombre = excluded.nombre,
  lat = excluded.lat, lon = excluded.lon, ciudad = excluded.ciudad,
  cultivos = excluded.cultivos, cultivos_secundarios = excluded.cultivos_secundarios,
  metodo_riego = excluded.metodo_riego, manejo = excluded.manejo, suelo = excluded.suelo,
  fecha_plantacion = excluded.fecha_plantacion, area_m2 = excluded.area_m2,
  piloto_inicio = excluded.piloto_inicio, piloto_sombra = excluded.piloto_sombra,
  origen = excluded.origen
  -- OJO: no se pisan caudal ni riego_auto_* en el update, para no borrar un caudal
  -- medido con el vaso o una pauta afinada después. Para cambiarlos, hazlo explícito.
;

-- ── 3) Verificar ──
select id, ciudad, cultivos, metodo_riego, suelo, fecha_plantacion,
       area_m2, caudal, piloto_inicio, piloto_sombra,
       riego_auto, riego_auto_min, riego_auto_cada_dias, riego_auto_desde
  from usuarios where id = 'f1954cd1-6635-4bad-be48-c08f51e0dfbd';
