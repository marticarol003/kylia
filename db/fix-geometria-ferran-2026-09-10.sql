-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Geometría real del piloto de tomate de Ferran · 2026-09-10
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. Es idempotente.
--
-- POR QUÉ. El informe de cierre decía que Ferran había regado un 68% de más.
-- Ferran no se lo creyó, y tenía razón: el error estaba en `area_m2`.
--
-- LA GEOMETRÍA DE VERDAD, según él (10-sep-2026):
--   · 2 bancales de 40 m, separados 1 m
--   · 2 mangueras por bancal, separadas 15-20 cm
--   · goteros cada 20 cm, 6 L/h por metro de manguera
--   · el tomate va EN MEDIO de las dos mangueras de cada bancal, cada 40 cm
--   · 100 tomateras por fila × 2 filas = 200 plantas
--
-- De ahí:
--   manguera total = 2 bancales × 2 mangueras × 40 m = 160 m
--   caudal del sistema = 160 m × 6 L/h·m = 960 L/h
--   superficie = 2 hileras × 40 m × ~1,1 m de separación ≈ 88 m²
--   caudal = 960 L/h ÷ 88 m² = 10,9 mm/h    (NO 32)
--
-- EL 32 SALÍA DE DIVIDIR BIEN POR UN ÁREA MAL: 960 L/h ÷ 30 m². Los 160 m de
-- manguera eran correctos; lo que no puede ser es que 160 m de gotero y 200
-- tomateras quepan en 30 m². Eso son 6,7 plantas/m², el triple de lo normal.
--
-- QUÉ CAMBIA EN EL INFORME: de "regó un 68% de más" a "regó prácticamente lo
-- justo" (+2% con 1,1 m de separación; la banda va de +13% a -6% según lo que
-- midan los bancales). El agua aplicada NO cambia —siguen siendo 35 m³, que son
-- caudal × minutos × riegos— lo que cambia es sobre cuánta superficie se reparte.

-- ── 1) Superficie y caudal ───────────────────────────────────────
update usuarios
   set area_m2 = 88,          -- ← AJUSTAR si mides el ancho real de los bancales
       caudal  = 10.9         --    (caudal = 960 ÷ area_m2; van SIEMPRE juntos)
 where id = 'b1f7c2d9-3a84-4e56-9c10-7d2f8b4a6e31';

-- ── 2) Comprobar ─────────────────────────────────────────────────
-- La lámina de cada riego la recalcula sola `laminaRiego` a partir del caudal
-- ACTUAL (assets/js/motor-riego.js), así que no hay que tocar `acciones`: los
-- 30 min por riego pasan de 16 L/m² a 5,5 sin editar una sola fila.
select nombre, area_m2, caudal,
       round((caudal * 30 / 60.0)::numeric, 1) as lamina_por_riego_l_m2,
       round((caudal * area_m2)::numeric, 0)   as caudal_sistema_l_h
  from usuarios
 where id = 'b1f7c2d9-3a84-4e56-9c10-7d2f8b4a6e31';
-- Debe salir: area 88 · caudal 10,9 · 5,5 L/m² por riego · ~959 L/h de sistema.

-- ── 3) ⚠️ LO QUE ESTE SQL **NO** ARREGLA ─────────────────────────
-- El suelo. En la ficha figura 'franco' y Ferran dice FRANCO ARENOSO CON
-- ARCILLA. Importa: el motor usa la textura para saber cuánta agua retiene el
-- suelo (franco 0,15 · arenoso 0,08 mm/mm, FAO-56 Tabla 19). Un franco arenoso
-- está por el medio, o sea MENOS reserva, o sea que el cultivo pide agua más a
-- menudo — y eso empuja el resultado otra vez hacia "no sobraba".
--
-- No se toca aquí porque el motor solo conoce tres texturas y 'franco arenoso'
-- no es una de ellas. Añadirla es tocar SUELO_AWC y el selector de /app, y eso
-- es una decisión, no una corrección de datos.
