-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Identidad: entrar desde cualquier dispositivo · 2026-08-07
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. Es idempotente.
--
-- EL PROBLEMA: hoy el "usuario" de /app es un UUID que se genera en el
-- localStorage del móvil (app/index.html:53) y la configuración vive ahí. Eso
-- significa que la parcela pertenece al DISPOSITIVO, no a la persona: cambia de
-- móvil, o abre en la tablet, y su campo no existe. Para un piloto que llevas tú
-- de la mano da igual; para un usuario que se da de alta solo, es el final del
-- recorrido. Es uno de los bloqueos apuntados para poder vender.
--
-- LA SOLUCIÓN, sin montar un sistema de cuentas: enlace por correo. El usuario
-- pide entrar con su email, le llega un enlace de un solo uso, y al abrirlo el
-- dispositivo adopta su `propietario_id` — con lo que ve TODAS sus zonas de
-- cultivo, que ya se modelan como filas de `usuarios` con el mismo propietario
-- (ver db/anadir-propietario-usuarios-2026-07-31.sql). Sin contraseñas que
-- guardar, sin proveedor de identidad, sobre el Resend que ya está configurado.
--
-- DECISIONES DE SEGURIDAD (y por qué):
--   · El token NO se guarda: se guarda su SHA-256. Si alguien se lleva la tabla,
--     no se lleva ninguna llave utilizable.
--   · Un solo uso (`usado_en`) y 15 minutos de vida. Un enlace reenviado por
--     WhatsApp o que queda en el historial del correo deja de servir.
--   · Se responde SIEMPRE lo mismo, exista o no el email. Si no, cualquiera
--     podría preguntar a la API quién es cliente de Kylia y quién no.
--   · Se limita el número de peticiones por email y hora, para que la bandeja de
--     entrada de alguien no se pueda usar como buzón de spam.

create table if not exists accesos (
  id             bigserial   primary key,
  email          text        not null,
  token_hash     text        not null unique,   -- sha256 del token; el token en claro solo viaja en el correo
  propietario_id uuid        not null,
  creado         timestamptz not null default now(),
  expira         timestamptz not null,
  usado_en       timestamptz,                   -- NULL = sin canjear; se marca al primer uso
  ip             text
);

create index if not exists idx_accesos_email  on accesos (email, creado desc);
create index if not exists idx_accesos_expira on accesos (expira);

comment on table accesos is
  'Enlaces de un solo uso para que una persona recupere sus parcelas en otro dispositivo. Se guarda el sha256 del token, nunca el token.';

-- ── Higiene: los caducados no sirven para nada y no deben acumularse ──
-- Ejecútalo de vez en cuando (o cuélgalo de un cron si la tabla crece):
--   delete from accesos where expira < now() - interval '7 days';

-- ── Comprobar ──
select count(*) filter (where usado_en is null and expira > now()) as vivos,
       count(*) filter (where usado_en is not null)                as canjeados,
       count(*) filter (where usado_en is null and expira <= now()) as caducados
  from accesos;
