-- Esquema Postgres para Kylia
-- Compatible con Supabase (asume las extensiones uuid-ossp, postgis, citext disponibles).
-- Aplicar con: psql -f db/schema.sql
--
-- Convenciones:
--   · UUID para PKs (compatibilidad con Supabase auth.users)
--   · timestamps en UTC con timezone explícito
--   · borrado lógico (deleted_at) en lugar de hard delete
--   · todos los textos en castellano salvo claves técnicas

create extension if not exists "uuid-ossp";
create extension if not exists "citext";
create extension if not exists "postgis";

-- ──────────────────────────────────────────────────────────────────────
-- USUARIOS
-- ──────────────────────────────────────────────────────────────────────
-- En Supabase, auth.users ya existe. La tabla public.users es nuestro
-- "perfil" extendido y se enlaza por id.

create table if not exists public.users (
  id              uuid          primary key references auth.users(id) on delete cascade,
  email           citext        not null unique,
  nombre          text,
  telefono        text,
  rol             text          not null default 'agricultor'
                                check (rol in ('agricultor','tecnico_coop','admin_coop','operador_kylia')),
  cooperativa_id  uuid          references public.cooperativas(id) on delete set null,
  plan            text          not null default 'free'
                                check (plan in ('free','pro_100','pro_500','enterprise')),
  ha_contratadas  numeric(10,2) not null default 20.00,
  acepta_marketing boolean      not null default false,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now(),
  deleted_at      timestamptz
);

create index if not exists users_cooperativa_idx on public.users (cooperativa_id) where deleted_at is null;
create index if not exists users_plan_idx        on public.users (plan)            where deleted_at is null;

-- ──────────────────────────────────────────────────────────────────────
-- COOPERATIVAS / EMPRESAS
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.cooperativas (
  id                uuid          primary key default uuid_generate_v4(),
  nombre            text          not null,
  cif               text          unique,
  provincia         text,
  num_socios        integer,
  contacto_principal_id uuid      references public.users(id) on delete set null,
  plan              text          not null default 'cooperativa'
                                  check (plan in ('cooperativa','enterprise')),
  precio_anual_eur  numeric(10,2),
  fecha_alta        date          not null default current_date,
  created_at        timestamptz   not null default now(),
  deleted_at        timestamptz
);

-- ──────────────────────────────────────────────────────────────────────
-- PARCELAS (referencia SIGPAC + geometría)
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.parcelas (
  id                uuid          primary key default uuid_generate_v4(),
  user_id           uuid          not null references public.users(id) on delete cascade,
  alias             text,                              -- "El olivar de la abuela"
  sigpac_provincia  smallint,
  sigpac_municipio  smallint,
  sigpac_agregado   smallint,
  sigpac_zona       smallint,
  sigpac_poligono   smallint,
  sigpac_parcela    smallint,
  sigpac_recinto    smallint,
  cultivo           text,                              -- 'olivar', 'cereal', 'vid'…
  area_ha           numeric(10,4) not null,
  geometria         geometry(MultiPolygon, 4326) not null,
  centroide         geometry(Point, 4326)
                    generated always as (st_centroid(geometria)) stored,
  created_at        timestamptz   not null default now(),
  deleted_at        timestamptz
);

create index if not exists parcelas_user_idx     on public.parcelas (user_id) where deleted_at is null;
create index if not exists parcelas_geom_gix     on public.parcelas using gist (geometria);
create index if not exists parcelas_centroide_gix on public.parcelas using gist (centroide);
create index if not exists parcelas_sigpac_idx
  on public.parcelas (sigpac_provincia, sigpac_municipio, sigpac_poligono, sigpac_parcela, sigpac_recinto);

-- ──────────────────────────────────────────────────────────────────────
-- OBSERVACIONES (un registro por parcela y pasada Sentinel)
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.observaciones (
  id                  bigserial     primary key,
  parcela_id          uuid          not null references public.parcelas(id) on delete cascade,
  fecha_pasada        date          not null,
  fuente              text          not null default 'sentinel-2'
                                    check (fuente in ('sentinel-2','sentinel-1','dwd-icon')),
  ndvi                real,
  ndmi                real,
  ndre                real,                            -- opcional, requiere bandas red-edge
  cobertura_nubes_pct real,
  n_pixeles_validos   integer,
  raw_payload         jsonb,                           -- guardamos respuesta cruda para auditoría
  created_at          timestamptz   not null default now(),
  unique (parcela_id, fecha_pasada, fuente)
);

create index if not exists obs_parcela_fecha_idx on public.observaciones (parcela_id, fecha_pasada desc);

-- ──────────────────────────────────────────────────────────────────────
-- ALERTAS (señales accionables que mandamos por email/Telegram)
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.alertas (
  id          uuid          primary key default uuid_generate_v4(),
  parcela_id  uuid          not null references public.parcelas(id) on delete cascade,
  tipo        text          not null check (tipo in (
                'estres_hidrico_temprano','estres_hidrico_severo',
                'caida_vigor','recuperacion','riesgo_helada','recomendacion_riego'
              )),
  severidad   text          not null default 'info' check (severidad in ('info','aviso','urgente')),
  mensaje     text          not null,
  payload     jsonb,
  estado      text          not null default 'abierta' check (estado in ('abierta','vista','cerrada')),
  created_at  timestamptz   not null default now(),
  resuelta_at timestamptz
);

create index if not exists alertas_parcela_idx on public.alertas (parcela_id, created_at desc);
create index if not exists alertas_estado_idx  on public.alertas (estado) where estado != 'cerrada';

-- ──────────────────────────────────────────────────────────────────────
-- SUSCRIPCIONES (Stripe)
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.suscripciones (
  id                       uuid        primary key default uuid_generate_v4(),
  user_id                  uuid        references public.users(id) on delete cascade,
  cooperativa_id           uuid        references public.cooperativas(id) on delete cascade,
  stripe_customer_id       text,
  stripe_subscription_id   text        unique,
  plan                     text        not null,
  estado                   text        not null default 'activa' check (estado in ('activa','periodo_gracia','cancelada','suspendida')),
  precio_mensual_eur       numeric(10,2),
  periodo_actual_inicio    timestamptz,
  periodo_actual_fin       timestamptz,
  created_at               timestamptz not null default now(),
  cancelled_at             timestamptz,
  check (user_id is not null or cooperativa_id is not null)
);

create index if not exists subs_user_idx on public.suscripciones (user_id) where estado = 'activa';
create index if not exists subs_coop_idx on public.suscripciones (cooperativa_id) where estado = 'activa';

-- ──────────────────────────────────────────────────────────────────────
-- WAITLIST (captación previa al producto)
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.waitlist (
  id          bigserial   primary key,
  email       citext      not null unique,
  origen      text,                                    -- 'landing-hero','blog-post-1'...
  metadata    jsonb,
  ip_hash     text,                                    -- sha256 ip + sal, no IP cruda
  user_agent  text,
  created_at  timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────────
-- TRIGGERS
-- ──────────────────────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_users_updated on public.users;
create trigger trg_users_updated
  before update on public.users
  for each row execute function set_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ──────────────────────────────────────────────────────────────────────
alter table public.users         enable row level security;
alter table public.parcelas      enable row level security;
alter table public.observaciones enable row level security;
alter table public.alertas       enable row level security;
alter table public.suscripciones enable row level security;

-- Cada usuario solo ve sus propias parcelas
create policy "parcelas_owner_read"   on public.parcelas
  for select using (user_id = auth.uid() and deleted_at is null);
create policy "parcelas_owner_write"  on public.parcelas
  for all    using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Observaciones por parcela
create policy "obs_owner_read" on public.observaciones
  for select using (
    exists (select 1 from public.parcelas p where p.id = observaciones.parcela_id and p.user_id = auth.uid())
  );

-- Técnicos de cooperativa ven todas las parcelas de socios de su cooperativa
create policy "parcelas_coop_tecnico_read" on public.parcelas
  for select using (
    exists (
      select 1 from public.users me
      join   public.users propietario on propietario.cooperativa_id = me.cooperativa_id
      where  me.id = auth.uid()
        and  me.rol in ('tecnico_coop','admin_coop')
        and  propietario.id = parcelas.user_id
    )
  );

-- Su propio perfil
create policy "users_self_read"   on public.users for select using (id = auth.uid());
create policy "users_self_update" on public.users for update using (id = auth.uid());
