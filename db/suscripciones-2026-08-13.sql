-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Suscripciones (esqueleto de cobro) · 2026-08-13
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. Es idempotente.
--
-- QUÉ HACE: añade a `usuarios` lo mínimo para saber quién paga, quién no y quién
-- no debe pagar nunca. No cobra nada por sí solo: el cobro vive en /api/pago y
-- está apagado mientras no exista STRIPE_SECRET_KEY.
--
-- ⚠️ LO MÁS IMPORTANTE DE ESTE ARCHIVO ES `gratuito_de_por_vida`, y conviene
-- ejecutarlo ANTES de que exista cualquier pasarela. /precios prometió
-- públicamente "gratis durante el piloto" y "app completa gratis de por vida al
-- cerrar". Los pilotos de 2026 tienen esa gratuidad GANADA: es palabra dada. Una
-- bandera explícita en la fila es la forma de que no se pierda en un cambio de
-- criterio dentro de dos años — deducirla de una fecha de alta sería frágil.

alter table usuarios add column if not exists gratuito_de_por_vida  boolean not null default false;
alter table usuarios add column if not exists suscripcion_estado    text;      -- activa | impago | cancelada | null
alter table usuarios add column if not exists stripe_customer_id    text;
alter table usuarios add column if not exists suscripcion_actualizada timestamptz;

comment on column usuarios.gratuito_de_por_vida is
  'Gratuidad ganada por los pilotos de 2026 (promesa pública de /precios). No caduca.';
comment on column usuarios.suscripcion_estado is
  'Lo escribe SOLO el webhook de Stripe con firma verificada (api/pago.js). Volver a /app?pago=ok no prueba nada.';

-- El webhook actualiza por propietario_id, así que ese filtro tiene que ir rápido.
create index if not exists idx_usuarios_propietario_susc on usuarios (propietario_id, suscripcion_estado);

-- ── Los pilotos actuales, marcados ─────────────────────────────────
-- Criterio: quien ya estaba dentro antes de que existiera el cobro. Se marca por
-- piloto_sombra y por los ids conocidos de los campos que llevan Martí y su
-- padre, porque el bancal de las 33 NO es piloto_sombra (ahí Kylia decide) y aun
-- así tiene la gratuidad ganada igual que los demás.
update usuarios set gratuito_de_por_vida = true
where piloto_sombra = true
   or id in (
     'd5475c3d-365b-47ff-b31e-fa659a8362fb',   -- 33 lechugas · aspersión (bancal, zona A)
     '23567ff1-7368-4dc9-b777-fdeaab9f8714',   -- campo del padre · 440 m²
     '9aaa1b25-6fad-4213-9eda-e135af71b2c3'    -- las 10 lechugas del experimento
   );

-- Comprobación: quién ha quedado marcado.
select id, nombre, ciudad, piloto_sombra, gratuito_de_por_vida
from usuarios
where gratuito_de_por_vida = true
order by ciudad nulls last;
