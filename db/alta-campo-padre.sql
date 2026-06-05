-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Alta del CAMPO DEL PADRE (laboratorio abierto · Sant Boi)
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. Es idempotente:
-- se puede ejecutar más de una vez sin duplicar (usuario por ON CONFLICT,
-- riego por WHERE NOT EXISTS) y asegura primero las columnas que necesita.
--
-- Qué deja montado:
--   1) las columnas agronómicas/unidad de riego (si aún no existían),
--   2) el usuario del campo del padre con sus datos reales,
--   3) el riego de asentamiento de hoy (36 L = 1,8 cubos sobre 0,70 m²),
--   4) marcado piloto_sombra=true → el Diario B congelará su decisión cada
--      noche para el reveal (requiere DIARIO_B_LIVE=1 en Vercel; ver runbook).
--
-- Campo del padre = "Kylia HABLA": aquí seguimos la recomendación y calibramos
-- (a diferencia de los pilotos silenciosos). Ver docs/tecnico/runbook-piloto-silencioso.md §B.

-- ── 1) Columnas necesarias (idempotentes) ────────────────────────
alter table usuarios add column if not exists suelo              text;
alter table usuarios add column if not exists fecha_plantacion   date;
alter table usuarios add column if not exists caudal             numeric;  -- L/m²·h (riego en min); regadera no aplica
alter table usuarios add column if not exists area_m2            numeric;  -- superficie del bancal
alter table usuarios add column if not exists capacidad_regadera numeric;  -- litros por cubo/regadera
alter table usuarios add column if not exists piloto_sombra      boolean not null default false;

-- ── 2) El usuario del campo del padre ────────────────────────────
insert into usuarios (
  id, email, nombre, lat, lon, ciudad,
  cultivos, metodo_riego, suelo, fecha_plantacion,
  area_m2, capacidad_regadera, tarifa_agua, piloto_sombra, origen
) values (
  '9aaa1b25-6fad-4213-9eda-e135af71b2c3',
  'campo-padre@kylia.local',
  'Campo del padre — Sant Boi',
  41.32339, 2.05936, 'Sant Boi de Llobregat',
  '{lechuga}', 'regadera', 'franco', '2026-06-05',
  0.70, 20, null,                       -- tarifa_agua null: agua de pozo propio (coste ~0)
  true, 'campo-padre'
)
on conflict (id) do update set
  lat = excluded.lat, lon = excluded.lon, ciudad = excluded.ciudad,
  cultivos = excluded.cultivos, metodo_riego = excluded.metodo_riego,
  suelo = excluded.suelo, fecha_plantacion = excluded.fecha_plantacion,
  area_m2 = excluded.area_m2, capacidad_regadera = excluded.capacidad_regadera,
  piloto_sombra = excluded.piloto_sombra;

-- ── 3) El riego de asentamiento de hoy ───────────────────────────
-- 36 L sobre 0,70 m² = 51,4 L/m² de lámina bruta (encharcó: riego de trasplante).
-- Se guarda en L/m² porque el motor FAO-56 razona en lámina (= mm).
insert into acciones (usuario_id, fecha_local, tipo, cantidad_l_m2, cultivo, notas)
select '9aaa1b25-6fad-4213-9eda-e135af71b2c3', '2026-06-05', 'riego', 51.4, 'lechuga',
       'Riego de asentamiento del trasplante: 36 L (1,8 cubos de 20 L) sobre 0,70 m². 10 lechugas Maravilla.'
where not exists (
  select 1 from acciones
  where usuario_id = '9aaa1b25-6fad-4213-9eda-e135af71b2c3'
    and fecha_local = '2026-06-05' and tipo = 'riego'
);

-- ── Comprobar ────────────────────────────────────────────────────
--   select id, ciudad, cultivos, suelo, area_m2, capacidad_regadera, piloto_sombra
--     from usuarios where id = '9aaa1b25-6fad-4213-9eda-e135af71b2c3';
--   select fecha_local, tipo, cantidad_l_m2, notas
--     from acciones where usuario_id = '9aaa1b25-6fad-4213-9eda-e135af71b2c3';
