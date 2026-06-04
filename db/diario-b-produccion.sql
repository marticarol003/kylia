-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Puesta en producción del Diario B (registro silencioso fiable)
-- ─────────────────────────────────────────────────────────────────
-- Ejecutar en el SQL Editor de Supabase ANTES de poner DIARIO_B_LIVE=1.
-- Convierte `recomendaciones_log` en un registro sellado y delimita qué
-- usuarios procesa el cron /api/diario-b.
--
-- ⚠️ ORDEN IMPORTANTE:
--   1. Limpia primero los datos de prueba/demo (el seed) si los cargaste,
--      PORQUE el bloque 2 deja la tabla append-only (ya no se podrá borrar).
--         delete from recomendaciones_log where usuario_id =
--           '7c1e9a04-2b6f-4d8a-9f10-3a5e7c0b1d22';
--   2. Luego ejecuta este archivo entero.

-- ── 1) Flag de piloto silencioso ─────────────────────────────────
-- El cron solo congela la decisión de los usuarios marcados aquí, no de
-- todo el que tenga coordenadas (evita procesar demos/tests).
alter table usuarios
  add column if not exists piloto_sombra boolean not null default false;

create index if not exists idx_usuarios_piloto_sombra
  on usuarios (piloto_sombra) where piloto_sombra;

-- Marcar un piloto (ejemplo). Repetir por cada piloto real:
--   update usuarios set piloto_sombra = true where email = 'agricultor@ejemplo.com';

-- ── 2) Append-only: registro sellado e inalterable ───────────────
-- Bloquea UPDATE y DELETE sobre recomendaciones_log a nivel de BD, para
-- cualquier rol (incluida la service_role del backend). Es lo que hace
-- creíble el reveal ante un evaluador: la historia no se puede reescribir.
create or replace function kylia_bloquea_modificacion()
  returns trigger language plpgsql as $$
begin
  raise exception 'recomendaciones_log es append-only: % no permitido', tg_op
    using hint = 'El registro silencioso no se modifica ni se borra.';
end;
$$;

drop trigger if exists trg_reclog_append_only on recomendaciones_log;
create trigger trg_reclog_append_only
  before update or delete on recomendaciones_log
  for each row execute function kylia_bloquea_modificacion();

-- ── 3) (Opcional) Dedupe atómico por día ─────────────────────────
-- El cron ya deduplica en servidor (yaCongelado), y la fecha de la decisión
-- es fija (06:00Z) por día. Este índice único lo hace atómico además.
-- Descomentar SOLO si no hay duplicados previos (usuario_id, fecha, tipo):
--   create unique index if not exists uq_reclog_dia
--     on recomendaciones_log (usuario_id, fecha, tipo);

-- ── Para revertir el sellado (p. ej. durante pruebas) ────────────
--   drop trigger if exists trg_reclog_append_only on recomendaciones_log;
