-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Campos de onboarding para mostrar el riego en su unidad
-- ─────────────────────────────────────────────────────────────────
-- Ejecutar en el SQL Editor de Supabase. Añade a `usuarios` los datos que
-- permiten convertir la lámina (mm = L/m²) a la unidad del sistema:
--   - caudal              → minutos (goteo/aspersión/manguera)
--   - area_m2 + capacidad → nº de regaderas (regadera)
-- Todos opcionales: si faltan, la app cae a L/m² (o estima el caudal por método).

alter table usuarios add column if not exists caudal             numeric;  -- L/m² por hora
alter table usuarios add column if not exists area_m2            numeric;  -- superficie de la parcela/bancal
alter table usuarios add column if not exists capacidad_regadera numeric;  -- litros por regadera
