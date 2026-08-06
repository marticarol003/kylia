-- ─────────────────────────────────────────────────────────────────
-- KYLIA · La cebolleta se riega sola en el cuaderno: lunes y jueves, 2 h
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. Es idempotente.
--
-- QUÉ PASA HOY (2026-08-06): el piloto de cebolleta (aspersión, la abre una
-- persona) se riega SIEMPRE lunes y jueves 2 h, pero nadie lo apunta. Entre el
-- 23-jul y el 6-ago se acumularon 4 riegos sin registrar y el balance FAO-56
-- creyó el suelo AGOTADO (Dr 45 mm = el TAW entero) pidiendo 60 L/m², cuando en
-- realidad iba por 5 mm. Un piloto silencioso sin riegos apuntados no es un
-- piloto: son datos falsos.
--
-- QUÉ MONTA ESTO: la pauta se declara en la fila del usuario y el cron nocturno
-- `api/diario-b.js` (materializarGoteoAuto) materializa cada lunes y jueves la
-- fila de `acciones` que falte, hasta hoy. Ya lo hacía para el goteo automático
-- "cada N días"; lo nuevo es la pauta POR DÍA DE SEMANA, porque lunes+jueves es
-- 3-4-3-4 días y con `cada_dias = 3` el patrón se desfasa solo (a la cuarta
-- semana riega en martes). Ver tests/test-pauta-semanal.mjs.
--
-- ⚠️ LO QUE ESTO SIGNIFICA, DICHO CLARO: a partir de ahora la base de datos dará
--    por regados todos los lunes y jueves AUNQUE NO SE HAYA REGADO. Si tu padre
--    se salta una semana (lluvia, avería, viaje) hay que borrar esas filas a
--    mano, porque el reveal las cuenta como agua realmente aplicada y el ahorro
--    saldría falseado. Decisión tomada por el usuario el 2026-08-06.
--    Borrar un riego inventado:
--        delete from acciones
--         where usuario_id = 'a7f3c9e1-2b84-4d56-9f10-6c8e2b4a7d33'
--           and fecha_local = 'YYYY-MM-DD' and motivo = 'goteo-auto';
--
-- Lámina: 120 min × 15 mm/h ÷ 60 = 30 L/m² por riego (mismo cálculo que el
-- cuaderno). El caudal 15 mm/h sigue siendo PROVISIONAL (heredado del campo del
-- padre, truco del vaso 12-jun); si se mide bien, cambia `caudal` y las láminas
-- se recalculan solas — el motor las deriva de duracion_min × caudal.

-- ── 1) La columna de la pauta semanal (ISO: 1=lunes … 7=domingo) ──
alter table usuarios add column if not exists riego_auto_dias_semana smallint[];

comment on column usuarios.riego_auto_dias_semana is
  'Días fijos de la semana en que riega la pauta (ISO 1=lun … 7=dom). Si viene, manda sobre riego_auto_cada_dias.';

-- ── 2) La pauta de la cebolleta: lunes y jueves, 120 min ──
-- El ancla es HOY (6-ago, jueves, ya registrado a mano): del 13-jul al 6-ago los
-- riegos ya están todos apuntados uno a uno, así que el automatismo solo mira
-- hacia delante y el primero que creará será el lunes 10-ago. Dejar el ancla
-- fija (no moverla) es lo que lo hace autocurativo: si una noche se cae el cron,
-- la siguiente corrida rellena los días que falten desde aquí.
update usuarios
   set riego_auto             = true,
       riego_auto_dias_semana = '{1,4}',   -- lunes y jueves
       riego_auto_min         = 120,       -- 2 h
       riego_auto_cada_dias   = null,      -- la semanal manda; se deja limpio para no confundir
       riego_auto_desde       = '2026-08-06'
 where id = 'a7f3c9e1-2b84-4d56-9f10-6c8e2b4a7d33';

-- ── 3) Verificar ──
-- Debe salir: riego_auto=true · {1,4} · 120 min · desde 2026-08-06 · caudal 15
select nombre, riego_auto, riego_auto_dias_semana, riego_auto_min,
       riego_auto_cada_dias, riego_auto_desde, caudal
  from usuarios
 where id = 'a7f3c9e1-2b84-4d56-9f10-6c8e2b4a7d33';

-- Y que NADIE más ha cambiado de pauta (el tomate de goteo sigue con cada_dias):
select nombre, riego_auto_dias_semana, riego_auto_cada_dias, riego_auto_min
  from usuarios
 where riego_auto is true
 order by nombre;

-- Los riegos de la cebolleta: lunes y jueves desde el 13-jul, sin huecos.
-- Los apuntados a mano llevan motivo NULL; los que cree el cron, 'goteo-auto'.
select fecha_local, to_char(fecha_local, 'Dy') as dia, duracion_min,
       cantidad_l_m2, coalesce(motivo, 'confirmado') as origen
  from acciones
 where usuario_id = 'a7f3c9e1-2b84-4d56-9f10-6c8e2b4a7d33' and tipo = 'riego'
 order by fecha_local;
