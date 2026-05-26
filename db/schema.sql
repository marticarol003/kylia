-- ─────────────────────────────────────────────────────────────────
-- KYLIA · esquema piloto silencioso 2026 (7 tablas)
-- ─────────────────────────────────────────────────────────────────
-- Aplicar en el SQL Editor de Supabase (o con psql -f db/schema.sql).
-- Reset destructivo: tira las tablas existentes y las vuelve a crear.
--
-- Cada tabla corresponde a un `recurso` enrutado por /api/log.js.
-- Si se añade un campo aquí, hay que reflejarlo también en el handler.

drop table if exists eventos             cascade;
drop table if exists mediciones          cascade;
drop table if exists observaciones       cascade;
drop table if exists acciones            cascade;
drop table if exists recomendaciones_log cascade;
drop table if exists jornadas            cascade;
drop table if exists usuarios            cascade;

-- 1) Ficha del piloto
create table usuarios (
  id            uuid        primary key,
  email         text,
  nombre        text,
  telefono      text,
  lat           numeric,
  lon           numeric,
  ciudad        text,
  cultivos      text[]      default '{}',
  parcela       jsonb,
  tarifa_agua   numeric,
  origen        text,
  preferencias  jsonb       default '{}'::jsonb,
  ua            text,
  fecha_alta    timestamptz default now()
);

-- 2) Lo que Kylia habría recomendado (nunca visible al agricultor)
create table recomendaciones_log (
  id                 bigserial primary key,
  usuario_id         uuid references usuarios(id) on delete cascade,
  fecha              timestamptz default now(),
  tipo               text,
  texto              text,
  cantidad_l_m2      numeric,
  producto_id        text,
  producto_nombre    text,
  dosis              text,
  nivel              text,
  coste_estimado_eur numeric,
  contexto           jsonb
);

-- 3) Diario diario (uno por usuario/día)
create table jornadas (
  id              bigserial primary key,
  usuario_id      uuid references usuarios(id) on delete cascade,
  fecha           date not null,
  completada_en   timestamptz default now(),
  fuente_decision text[],
  comentario      text,
  unique (usuario_id, fecha)
);

-- 4) Acciones reales del agricultor (riegos + aplicaciones)
create table acciones (
  id                   bigserial primary key,
  usuario_id           uuid references usuarios(id) on delete cascade,
  jornada_id           bigint references jornadas(id) on delete set null,
  fecha                timestamptz default now(),
  fecha_local          date,
  tipo                 text,
  cantidad_l_m2        numeric,
  producto_id          text,
  producto_nombre      text,
  sustancia_activa     text,
  dosis                text,
  cultivo              text,
  plazo_seguridad_dias int,
  fue_otro             boolean default false,
  motivo               text,
  coste_estimado_eur   numeric,
  notas                text
);

-- 5) Observaciones del agricultor (plaga / enfermedad / estrés / otro)
create table observaciones (
  id          bigserial primary key,
  usuario_id  uuid references usuarios(id) on delete cascade,
  jornada_id  bigint references jornadas(id) on delete set null,
  fecha       timestamptz default now(),
  fecha_local date,
  tipo        text,
  descripcion text,
  severidad   int,
  cultivo     text,
  notas       text
);

-- 6) Histórico de mediciones satélite / suelo
create table mediciones (
  id           bigserial primary key,
  usuario_id   uuid references usuarios(id) on delete cascade,
  fecha        date,
  ndvi         numeric,
  ndmi         numeric,
  ndmi_stdev   numeric,
  suelo_0_7    numeric,
  suelo_7_28   numeric,
  suelo_28_100 numeric,
  fuente       text default 'sentinel-2',
  unique (usuario_id, fecha, fuente)
);

-- 7) Eventos de uso (tracking ligero, sustituye a Plausible)
create table eventos (
  id         bigserial primary key,
  usuario_id uuid references usuarios(id) on delete set null,
  fecha      timestamptz default now(),
  nombre     text,
  props      jsonb,
  url        text,
  ua         text
);

-- ─────────────────────────────────────────────────────────────────
-- Índices para consultas habituales
-- ─────────────────────────────────────────────────────────────────
create index on recomendaciones_log (usuario_id, fecha desc);
create index on acciones            (usuario_id, fecha desc);
create index on observaciones       (usuario_id, fecha desc);
create index on jornadas            (usuario_id, fecha desc);
create index on mediciones          (usuario_id, fecha desc);
create index on eventos             (usuario_id, fecha desc);
create index on usuarios            (fecha_alta desc);
