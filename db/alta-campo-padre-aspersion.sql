-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Alta del 2º CAMPO DEL PADRE — 500 m² de ASPERSIÓN (Sant Boi)
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. Es idempotente:
-- usuario por ON CONFLICT y riego por WHERE NOT EXISTS; se puede reejecutar.
--
-- Qué es: la parcela "tradicional" del padre (500 m², aspersión) que sirve de
-- contraste contra las 10 lechugas que llevamos con Kylia. La comparación NO es
-- en el mismo bancal (escalas muy distintas), por eso es un campo APARTE y la
-- comparativa de /campo se hace siempre POR m² (L/m²). Ver
-- docs/pilotos/bitacora-campo-padre.md y la memoria de sesión 2026-06-07.
--
--   • Mismo cultivo, suelo, zona y fecha de plantación que las 10 lechugas
--     → la referencia FAO-56 (clima/Kc) es comparable.
--   • Riega por ASPERSIÓN: el motor convierte horas ↔ mm con `caudal` (mm/h).
--     Caudal 10 mm/h es ESTIMADO (default del sistema); afinar con el "truco del
--     vaso" (vasos rectos 1 h → medir mm) y luego: update usuarios set caudal=<real>.
--   • piloto_sombra = false: laboratorio abierto, sin Diario B (la comparativa
--     se calcula en vivo, no necesita congelar decisiones).

-- ── 1) Columnas necesarias (idempotentes; ya creadas por el otro alta) ──
alter table usuarios add column if not exists suelo              text;
alter table usuarios add column if not exists fecha_plantacion   date;
alter table usuarios add column if not exists caudal             numeric;  -- aspersión: mm/h (= L/m²·h)
alter table usuarios add column if not exists area_m2            numeric;
alter table usuarios add column if not exists capacidad_regadera numeric;
alter table usuarios add column if not exists piloto_sombra      boolean not null default false;

-- ── 2) El usuario del 2º campo (500 m² aspersión) ─────────────────
insert into usuarios (
  id, email, nombre, lat, lon, ciudad,
  cultivos, metodo_riego, suelo, fecha_plantacion,
  area_m2, caudal, capacidad_regadera, tarifa_agua, piloto_sombra, origen
) values (
  '23567ff1-7368-4dc9-b777-fdeaab9f8714',
  'campo-padre-aspersion@kylia.local',
  'Campo del padre · 500 m² aspersión',
  41.32339, 2.05936, 'Sant Boi de Llobregat',
  '{lechuga}', 'aspersion', 'franco', '2026-06-05',
  500, 10, null, null,                  -- caudal 10 mm/h ESTIMADO; tarifa null (pozo propio)
  false, 'campo-padre-aspersion'
)
on conflict (id) do update set
  lat = excluded.lat, lon = excluded.lon, ciudad = excluded.ciudad,
  cultivos = excluded.cultivos, metodo_riego = excluded.metodo_riego,
  suelo = excluded.suelo, fecha_plantacion = excluded.fecha_plantacion,
  area_m2 = excluded.area_m2, caudal = excluded.caudal,
  capacidad_regadera = excluded.capacidad_regadera, piloto_sombra = excluded.piloto_sombra;

-- ── 3) El riego de asentamiento del trasplante (2026-06-05) ───────
-- 1,5 h de aspersión × 10 mm/h estimado = 15 L/m² brutos (sobre 500 m² ≈ 7.500 L).
-- cantidad_l_m2 guarda la lámina BRUTA (lo que sale del aspersor) para comparar
-- contra la rama Kylia (también bruta). duracion_min = el dato crudo que dio el padre.
insert into acciones (usuario_id, fecha_local, tipo, cantidad_l_m2, duracion_min, cultivo, notas)
select '23567ff1-7368-4dc9-b777-fdeaab9f8714', '2026-06-05', 'riego', 15, 90, 'lechuga',
       'Riego de asentamiento: 1,5 h de aspersión (≈10 mm/h estimado = 15 L/m²) sobre 500 m².'
where not exists (
  select 1 from acciones
  where usuario_id = '23567ff1-7368-4dc9-b777-fdeaab9f8714'
    and fecha_local = '2026-06-05' and tipo = 'riego'
);

-- ── Comprobar ────────────────────────────────────────────────────
--   select id, ciudad, cultivos, metodo_riego, suelo, area_m2, caudal, piloto_sombra
--     from usuarios where id = '23567ff1-7368-4dc9-b777-fdeaab9f8714';
--   select fecha_local, tipo, cantidad_l_m2, duracion_min, notas
--     from acciones where usuario_id = '23567ff1-7368-4dc9-b777-fdeaab9f8714';
