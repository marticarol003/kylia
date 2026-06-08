-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Alinear la tabla `usuarios` con el esquema que escribe el backend
-- ─────────────────────────────────────────────────────────────────
-- La tabla de producción es más antigua que db/schema.sql y le faltan
-- columnas (la primera que petó: `cultivos_secundarios`). El handler
-- registro-usuario (api/log.js) escribe SIEMPRE todas estas columnas, así
-- que si falta una, PostgREST devuelve PGRST204 y CUALQUIER alta falla
-- (incluida la del app principal, cuyo error se tragaba en silencio).
--
-- Idempotente: `add column if not exists` no toca las que ya existan.
-- Ejecutar entero en el SQL Editor de Supabase.

alter table usuarios add column if not exists email                text;
alter table usuarios add column if not exists nombre               text;
alter table usuarios add column if not exists telefono             text;
alter table usuarios add column if not exists lat                  numeric;
alter table usuarios add column if not exists lon                  numeric;
alter table usuarios add column if not exists ciudad               text;
alter table usuarios add column if not exists cultivos             text[]      default '{}';
alter table usuarios add column if not exists cultivos_secundarios text;
alter table usuarios add column if not exists parcela              jsonb;
alter table usuarios add column if not exists tarifa_agua          numeric;
alter table usuarios add column if not exists metodo_riego         text;
alter table usuarios add column if not exists manejo               text;
alter table usuarios add column if not exists origen               text;
alter table usuarios add column if not exists preferencias         jsonb       default '{}'::jsonb;
alter table usuarios add column if not exists ua                   text;
alter table usuarios add column if not exists fecha_alta           timestamptz default now();
alter table usuarios add column if not exists suelo                text;
alter table usuarios add column if not exists fecha_plantacion     date;
alter table usuarios add column if not exists caudal               numeric;
alter table usuarios add column if not exists area_m2              numeric;
alter table usuarios add column if not exists capacidad_regadera   numeric;
alter table usuarios add column if not exists piloto_sombra        boolean     not null default false;

-- Forzar recarga del caché de esquema de PostgREST (por si la DDL no la dispara sola).
notify pgrst, 'reload schema';
