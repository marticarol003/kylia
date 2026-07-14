-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Cambio de pauta del goteo — tomate de Ferran (Breda) · 2026-07-14
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. Idempotente.
--
-- CAMBIO reportado: el goteo pasó de 40 min DÍA SÍ DÍA NO a 30 min DIARIO,
-- efectivo DESDE AYER (2026-07-13).
--
-- Por qué se mueve el ancla (riego_auto_desde) a 2026-07-13 y NO se deja la
-- vieja (~13-jun): el cron diario-b (materializarGoteoAuto) genera riegos desde
-- el ancla contando de `cada_dias` en `cada_dias`. Si dejáramos el ancla vieja y
-- pusiéramos cada=1, en la próxima corrida RELLENARÍA hacia atrás todos los días
-- pares (2,4,…-jul) que bajo "día sí día no" NO se regaron → inventaría riegos.
-- Con ancla = 2026-07-13, el goteo diario de 30 min se materializa desde ayer
-- hacia delante y el pasado (impares a 40 min) queda intacto.
--
-- Lámina: 30 min × 32 mm/h ÷ 60 = 16 L/m² (antes 40 min = 21,3 L/m²).
--
-- id Ferran (tomate Breda): b1f7c2d9-3a84-4e56-9c10-7d2f8b4a6e31

-- ── 1) La pauta: 30 min, cada día, ancla ayer ──
update usuarios
   set riego_auto_min       = 30,
       riego_auto_cada_dias = 1,
       riego_auto_desde     = '2026-07-13'
 where id = 'b1f7c2d9-3a84-4e56-9c10-7d2f8b4a6e31';

-- ── 2) Corregir el riego del 13-jul ya materializado a 40 min → 30 min ──
-- El cron NO lo pisa (es idempotente: ese día ya tiene fila), así que se ajusta
-- aquí. Los riegos anteriores al 13-jul se dejan a 40 min: son la pauta que de
-- verdad corrió esos días. (Si AYER el goteo aún fue de 40 min y el cambio rige
-- desde HOY, borra este bloque 2 y cambia el ancla de arriba a '2026-07-14'.)
update acciones
   set duracion_min  = 30,
       cantidad_l_m2 = 16.0,
       notas         = 'pauta fija 30 min · 32 mm/h (sintetizado por diario-b; corregido a 30 min diario el 2026-07-14)'
 where usuario_id  = 'b1f7c2d9-3a84-4e56-9c10-7d2f8b4a6e31'
   and tipo        = 'riego'
   and motivo      = 'goteo-auto'
   and fecha_local = '2026-07-13';

-- ── 3) Verificar ──
-- Pauta: debe salir min=30, cada=1, desde=2026-07-13, caudal=32.
select riego_auto_min, riego_auto_cada_dias, riego_auto_desde, caudal
  from usuarios where id = 'b1f7c2d9-3a84-4e56-9c10-7d2f8b4a6e31';
-- Riegos: 13-jul ya a 30 min/16; los previos (impares) a 40 min/21,3;
-- del 14-jul en adelante los irá creando el cron a 30 min diario.
select fecha_local, duracion_min, cantidad_l_m2
  from acciones
 where usuario_id = 'b1f7c2d9-3a84-4e56-9c10-7d2f8b4a6e31' and tipo = 'riego'
 order by fecha_local desc limit 10;
