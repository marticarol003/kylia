-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Riegos de la cebolleta (El Tros de l'Uri) — reportados 2026-07-12
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. Es idempotente:
-- correrlo dos veces no duplica riegos (guarda NOT EXISTS por fecha) ni deja
-- el caudal a medias.
--
-- Reportado por el usuario el domingo 2026-07-12, riegos de la semana que
-- termina hoy:
--   • LUNES 2026-07-06 → 2 h de aspersión
--   • VIERNES 2026-07-10 → 1 h de aspersión
-- (La semana ANTERIOR —lun 29-jun 1 h y dom 5-jul 2 h— ya está registrada en
--  db/cambios-riegos-2026-07-08.sql; esto es NUEVO, no la pisa.)
--
-- CAUDAL: el usuario pide "el mismo caudal de aspersor que mi padre". El caudal
-- del padre se midió con el truco del vaso el 2026-06-12 = 15 mm/h. Se fija el
-- de la cebolla a 15 (antes 12 provisional). El bloque 3) muestra el caudal del
-- padre para confirmar que coinciden; si el del padre no fuese 15, cambia el
-- 15 de abajo por el valor real y vuelve a correr.
--
-- Nota mm ↔ L/m²: en aspersión 1 mm = 1 L/m², y lámina = caudal(mm/h) × horas.
--   2 h × 15 mm/h = 30 L/m²   ·   1 h × 15 mm/h = 15 L/m²

-- ids
--   cebolla El Tros de l'Uri : a7f3c9e1-2b84-4d56-9f10-6c8e2b4a7d33
--   padre (aspersión)        : 23567ff1-7368-4dc9-b777-fdeaab9f8714

-- ── 1) Caudal de la cebolla = el del padre (15 mm/h medido) ──
update usuarios
   set caudal = 15
 where id = 'a7f3c9e1-2b84-4d56-9f10-6c8e2b4a7d33';

-- ── 2) Riegos nuevos (idempotente: no duplica si ya existen) ──
insert into acciones (usuario_id, fecha_local, tipo, cantidad_l_m2, duracion_min, notas)
select v.usuario_id, v.fecha_local, 'riego', v.cantidad_l_m2, v.duracion_min, v.notas
  from (values
    ('a7f3c9e1-2b84-4d56-9f10-6c8e2b4a7d33'::uuid, '2026-07-06'::date, 30.0, 120, 'aspersión 120 min · 15 mm/h (registrado retroactivamente el 2026-07-12)'),
    ('a7f3c9e1-2b84-4d56-9f10-6c8e2b4a7d33'::uuid, '2026-07-10'::date, 15.0,  60, 'aspersión 60 min · 15 mm/h (registrado retroactivamente el 2026-07-12)')
  ) as v(usuario_id, fecha_local, cantidad_l_m2, duracion_min, notas)
 where not exists (
   select 1 from acciones a
    where a.usuario_id  = v.usuario_id
      and a.fecha_local = v.fecha_local
      and a.tipo        = 'riego'
 );

-- ── 2b) Consistencia: recalcula la lámina de TODOS los riegos de la cebolla
--        con el caudal nuevo (15). Deja el valor guardado = el que muestra el
--        front (que ya recalcula desde duracion_min × caudal). Los riegos de la
--        semana anterior pasan de 12/24 (provisional) a 15/30. ──
update acciones a
   set cantidad_l_m2 = round((u.caudal * a.duracion_min / 60.0)::numeric, 1)
  from usuarios u
 where a.usuario_id     = u.id
   and a.usuario_id     = 'a7f3c9e1-2b84-4d56-9f10-6c8e2b4a7d33'
   and a.tipo           = 'riego'
   and a.duracion_min is not null
   and u.caudal       is not null;

-- ── 3) Verificar ──
-- Caudales: la cebolla debe salir 15; el padre (aspersión) debe salir 15 también.
select 'cebolla' as quien, caudal from usuarios where id = 'a7f3c9e1-2b84-4d56-9f10-6c8e2b4a7d33'
union all
select 'padre',           caudal from usuarios where id = '23567ff1-7368-4dc9-b777-fdeaab9f8714';

-- Riegos de la cebolla: deben aparecer 06-jul (120 min / 30) y 10-jul (60 min / 15),
-- y los previos recalculados a 15 mm/h.
select fecha_local, duracion_min, cantidad_l_m2, notas
  from acciones
 where usuario_id = 'a7f3c9e1-2b84-4d56-9f10-6c8e2b4a7d33' and tipo = 'riego'
 order by fecha_local;
