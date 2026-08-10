-- ─────────────────────────────────────────────────────────────────
-- KYLIA · El Labinor de fondo del bancal, apuntado de verdad · 2026-08-10
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. Es idempotente.
--
-- REQUIERE haber ejecutado antes `abonado-descuenta-2026-08-10.sql`, que es el
-- que crea la columna `acciones.nutrientes`.
--
-- QUÉ ES: la aplicación real que destapó todo el asunto. Al bancal de las 33
-- lechugas (zona A, Sant Boi, 5 m²) se le echaron 200 g de Labinor N 10-2-2
-- ANTES de trasplantar. Eso es el abonado de FONDO, ya hecho, y hasta ahora no
-- estaba en ninguna parte: el plan seguía pidiendo los 58 g de N enteros.
--
-- LA ARITMÉTICA, que es todo lo que importa aquí. Labinor N 10-2-2 = 10 % N,
-- 2 % P2O5, 2 % K2O sobre producto:
--     N     = 0,200 kg × 0,10 = 0,020 kg  (20 g)
--     P2O5  = 0,200 kg × 0,02 = 0,004 kg  ( 4 g)
--     K2O   = 0,200 kg × 0,02 = 0,004 kg  ( 4 g)
-- En 5 m² eso son 400 kg/ha de producto = 40 kg N/ha. Del plan (58 g N) quedan
-- 38 g pendientes, y como el FONDO ya no se puede volver a ofrecer —el cultivo
-- está en el suelo—, esos 38 g se renormalizan sobre la cobertera.
--
-- LA FECHA: 2026-07-17, el día antes del trasplante (2026-07-18). Si fue otro
-- día, cámbiala; lo único que exige el motor es que caiga dentro de la ventana
-- del ciclo, que arranca 45 días antes de plantar = 2026-06-03.
--
-- ⚠️ `nutrientes` va en KILOS de nutriente, no en gramos y no en kg de producto.
--    Es la unidad del balance. Un número mal puesto aquí sale del plan como
--    abono de menos, que es peor que no descontar nada.

insert into acciones (
  usuario_id, fecha_local, tipo, motivo,
  producto_nombre, dosis, cultivo, nutrientes, notas
)
select
  'd5475c3d-365b-47ff-b31e-fa659a8362fb',
  '2026-07-17',
  'aplicacion',
  'abonado',
  'Labinor N 10-2-2',
  '200 g en 5 m² (400 kg/ha)',
  'lechuga',
  '{"N": 0.020, "P2O5": 0.004, "K2O": 0.004}'::jsonb,
  'Abonado de FONDO, echado antes de trasplantar las 33 lechugas. Granulado ecológico 10-2-2: 20 g de N, 4 de P2O5 y 4 de K2O. Es el que destapó que el plan no descontaba lo ya aplicado.'
where not exists (
  select 1 from acciones
   where usuario_id = 'd5475c3d-365b-47ff-b31e-fa659a8362fb'
     and tipo = 'aplicacion' and motivo = 'abonado'
     and producto_nombre = 'Labinor N 10-2-2'
     and fecha_local = '2026-07-17'
);

-- ── Comprobar ──
-- Debe salir una sola fila, con nutrientes = {"N":0.020,"P2O5":0.004,"K2O":0.004}.
select fecha_local, producto_nombre, dosis, nutrientes, notas
  from acciones
 where usuario_id = 'd5475c3d-365b-47ff-b31e-fa659a8362fb'
   and tipo = 'aplicacion' and motivo = 'abonado'
 order by fecha_local asc;
