-- ─────────────────────────────────────────────────────────────────
-- KYLIA · esquema piloto silencioso 2026 (7 tablas) — CONSOLIDADO
-- ─────────────────────────────────────────────────────────────────
-- Aplicar en el SQL Editor de Supabase (o con psql -f db/schema.sql).
-- Reset destructivo: tira las tablas existentes y las vuelve a crear.
--
-- ESTE FICHERO ES LA FUENTE DE VERDAD DEL ESQUEMA. Incluye TODAS las columnas
-- que el código usa de verdad (base + las que antes se añadían por ALTERs
-- sueltos en los db/alta-*.sql y db/fix-usuarios-columnas.sql). Reconstruir la
-- BD desde aquí deja el sistema funcional. Los db/alta-*.sql siguen siendo
-- idempotentes y compatibles (sus ALTER ... IF NOT EXISTS no rompen nada).
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

-- 1) Ficha del piloto / parcela
create table usuarios (
  id            uuid        primary key,
  email         text,
  nombre        text,
  telefono      text,
  lat           numeric,
  lon           numeric,
  ciudad        text,
  cultivos              text[]      default '{}',
  cultivos_secundarios  text,                                  -- texto libre opcional
  parcela               jsonb,
  tarifa_agua           numeric,
  metodo_riego          text,                                  -- 'goteo','aspersion','surco','manguera','regadera'
  manejo                text,                                  -- 'convencional','ecologico'
  suelo                 text,                                  -- 'arenoso','franco','arcilloso' → AWC FAO-56
  fecha_plantacion      date,                                  -- día 0 de la fenología (Kc, raíz)
  piloto_inicio         date,                                  -- arranque limpio del contrafactual del reveal
  caudal                numeric,                               -- pluviometría del emisor (mm/h = L/m²·h)
  area_m2               numeric,                               -- superficie: escala mm↔litros y regaderas
  capacidad_regadera    numeric,                               -- litros por regadera (riego manual)
  riego_auto            boolean     default false,             -- goteo de pauta fija (lo sintetiza diario-b)
  riego_auto_min        int,                                   -- minutos por riego automático
  riego_auto_cada_dias  int,                                   -- cada cuántos días riega el automático
  riego_auto_desde      date,                                  -- fecha ancla de la pauta
  piloto_sombra         boolean     not null default false,    -- true → Kylia calla, diario-b congela
  suelo_oferta          jsonb,                                 -- caché de ofertaSuelo() (SoilGrids); NULL = sin calcular
  origen                text,
  preferencias          jsonb       default '{}'::jsonb,
  ua                    text,
  fecha_alta            timestamptz default now()
);

-- 2) Lo que Kylia habría recomendado (nunca visible al agricultor) — append-only
create table recomendaciones_log (
  id                 bigserial primary key,
  usuario_id         uuid references usuarios(id) on delete cascade,
  fecha              timestamptz default now(),                -- = fecha de la DECISIÓN, no del insert
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
  tipo                 text,                            -- 'riego' | 'aplicacion'
  cantidad_l_m2        numeric,
  franja_horaria       text,                            -- 'manana','mediodia','tarde','noche'
  duracion_min         int,                             -- duración del riego en minutos (opcional)
  producto_id          text,
  producto_nombre      text,
  sustancia_activa     text,
  dosis                text,
  cultivo              text,
  plazo_seguridad_dias int,
  fue_otro             boolean default false,
  motivo               text,                            -- 'abonado','goteo-auto', o NULL (riego manual)
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
  ndre         numeric,     -- red-edge (B08/B05): proxy de estado de nitrógeno foliar
  ndre_stdev   numeric,
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

-- ─────────────────────────────────────────────────────────────────
-- recomendaciones_log: SELLADA append-only (registro inalterable del reveal)
-- El reveal es creíble porque nadie puede "ajustar el pasado". Para limpiezas
-- puntuales, desactivar/reactivar el trigger (ver db/limpiar-filas-prueba-*.sql).
-- ─────────────────────────────────────────────────────────────────
create or replace function reclog_no_modif()
  returns trigger language plpgsql as $$
begin
  raise exception 'recomendaciones_log es append-only: % no permitido', tg_op;
end $$;

drop trigger if exists trg_reclog_append_only on recomendaciones_log;
create trigger trg_reclog_append_only
  before update or delete on recomendaciones_log
  for each row execute function reclog_no_modif();
