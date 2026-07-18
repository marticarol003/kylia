-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Suscripciones de push web (avisos en el móvil sin terceros)
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo en el SQL Editor de Supabase. Idempotente.
--
-- Cada fila = un navegador/móvil suscrito a los avisos de un campo.
-- Se da de alta desde /campo (botón "Activar avisos" → POST /api/log
-- recurso push-sub) y se envía desde /api/aviso-lechugas con la librería
-- web-push (claves VAPID en Vercel: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY /
-- VAPID_SUBJECT). Las suscripciones muertas (410 al enviar) se borran solas.

create table if not exists push_subs (
  id         bigserial primary key,
  usuario_id uuid references usuarios(id) on delete cascade,
  endpoint   text unique not null,   -- URL del servicio push del navegador
  p256dh     text not null,          -- clave pública del navegador (cifrado del payload)
  auth       text not null,          -- secreto de autenticación del navegador
  etiqueta   text,                   -- descripción del dispositivo ("móvil papá")
  creado     timestamptz default now()
);

-- ── Comprobar ────────────────────────────────────────────────────
--   select id, usuario_id, etiqueta, creado, left(endpoint, 60) from push_subs;
