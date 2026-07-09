-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Cambios de riego reportados por los pilotos (2026-07-08)
-- ─────────────────────────────────────────────────────────────────
-- ⚠️ YA APLICADO el 2026-07-09 vía API de producción (recurso
--    pauta-goteo + borrar-accion/acciones). NO hace falta ejecutarlo.
--    Se conserva como registro del cambio. (Es idempotente: correrlo
--    no duplicaría nada, solo pisaría las notas.)
-- ─────────────────────────────────────────────────────────────────
-- 1) TOMATE FERRAN (Breda): la pauta del goteo pasó de 30 a 40 min
--    (sigue día sí día no) hace una semana (~1-jul).
--    a) usuarios.riego_auto_min 30 → 40 (los riegos futuros que
--       sintetiza diario-b saldrán a 40 min = 21,3 L/m² con caudal 32).
--    b) las filas ya sintetizadas desde el 1-jul (1, 3, 5 y 7-jul con
--       ancla 13-jun) están a 30 min → corregir a 40.
--    El ancla riego_auto_desde NO se toca (mantiene la paridad).
--
-- 2) CEBOLLA EL TROS DE L'URI ("Palafolls"): la semana pasada regó
--    lunes 29-jun 1 h y domingo 5-jul 2 h. Aspersión, caudal 12 mm/h
--    provisional → 12 y 24 L/m² (el front recalcula desde duracion_min
--    si el caudal se afina después).

-- ── 1a) Pauta del tomate a 40 min ──
update usuarios
   set riego_auto_min = 40
 where id = 'b1f7c2d9-3a84-4e56-9c10-7d2f8b4a6e31';

-- ── 1b) Corregir las filas ya sintetizadas desde el 1-jul ──
-- (mismo redondeo que materializarGoteoAuto: 40/60 × 32 = 21,3 L/m²)
update acciones
   set duracion_min  = 40,
       cantidad_l_m2 = 21.3,
       notas         = 'pauta fija 40 min · 32 mm/h (sintetizado por diario-b; corregido a 40 min el 2026-07-08)'
 where usuario_id  = 'b1f7c2d9-3a84-4e56-9c10-7d2f8b4a6e31'
   and tipo        = 'riego'
   and motivo      = 'goteo-auto'
   and fecha_local >= '2026-07-01';

-- ── 2) Riegos de la cebolla (idempotente: no duplica si ya existen) ──
insert into acciones (usuario_id, fecha_local, tipo, cantidad_l_m2, duracion_min, notas)
select v.usuario_id, v.fecha_local, 'riego', v.cantidad_l_m2, v.duracion_min, v.notas
  from (values
    ('a7f3c9e1-2b84-4d56-9f10-6c8e2b4a7d33'::uuid, '2026-06-29'::date,  12.0,  60, 'aspersión 60 min · 12 mm/h provisional (registrado retroactivamente el 2026-07-08)'),
    ('a7f3c9e1-2b84-4d56-9f10-6c8e2b4a7d33'::uuid, '2026-07-05'::date,  24.0, 120, 'aspersión 120 min · 12 mm/h provisional (registrado retroactivamente el 2026-07-08)')
  ) as v(usuario_id, fecha_local, cantidad_l_m2, duracion_min, notas)
 where not exists (
   select 1 from acciones a
    where a.usuario_id = v.usuario_id
      and a.fecha_local = v.fecha_local
      and a.tipo = 'riego'
 );

-- ── 3) Verificar ──
-- Tomate: pauta y últimos riegos (los ≥1-jul deben salir a 40 min / 21,3)
select riego_auto_min, riego_auto_cada_dias, riego_auto_desde, caudal
  from usuarios where id = 'b1f7c2d9-3a84-4e56-9c10-7d2f8b4a6e31';
select fecha_local, duracion_min, cantidad_l_m2, motivo
  from acciones
 where usuario_id = 'b1f7c2d9-3a84-4e56-9c10-7d2f8b4a6e31' and tipo = 'riego'
 order by fecha_local desc limit 8;
-- Cebolla: deben aparecer 29-jun (60 min / 12) y 5-jul (120 min / 24)
select fecha_local, duracion_min, cantidad_l_m2
  from acciones
 where usuario_id = 'a7f3c9e1-2b84-4d56-9f10-6c8e2b4a7d33' and tipo = 'riego'
 order by fecha_local;
