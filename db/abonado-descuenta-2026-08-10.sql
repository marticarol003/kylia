-- ─────────────────────────────────────────────────────────────────
-- KYLIA · El plan descuenta lo que ya se ha echado · 2026-08-10
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. Es idempotente.
--
-- EL AGUJERO: los abonados se apuntan en `acciones` (tipo=aplicacion,
-- motivo=abonado) y salen en el cuaderno del RD 1051/2022 — pero el PLAN no los
-- mira. Kylia sigue pidiendo los 58 g de nitrógeno enteros aunque ya haya abono
-- en la tierra. Salió a la luz cuando el usuario avisó de que al campo se le
-- aplicó Labinor ANTES de plantar las 33 lechugas: eso es el abonado de fondo,
-- ya hecho, y el plan no se había enterado.
--
-- En un bancal de 5 m² es un despiste. En hectáreas es sobrefertilizar por
-- diseño: pagar de más, lixiviar nitratos y, en zona vulnerable, pasarse del
-- techo legal.
--
-- POR QUÉ UNA COLUMNA NUEVA Y NO PARSEAR `dosis`: hoy la dosis es texto libre
-- ("137 g", "2 sacos", "un puñado"). Deducir kilos de nutriente de ahí es
-- adivinar, y este número entra en un balance. `nutrientes` guarda lo que de
-- verdad se aportó, en KILOS DE NUTRIENTE, que es la unidad del balance:
--     {"N": 0.041, "P2O5": 0, "K2O": 0}
-- Si no se sabe, se deja NULL y el plan NO descuenta nada — mejor pedir de más
-- que descontar un número inventado.

alter table acciones add column if not exists nutrientes jsonb;

comment on column acciones.nutrientes is
  'Nutriente realmente aportado por esta aplicación, en KILOS de nutriente: {"N":..,"P2O5":..,"K2O":..}. NULL = no se sabe, y entonces el plan no descuenta.';

-- ── Comprobar ──
select fecha_local, producto_nombre, dosis, nutrientes
  from acciones
 where tipo = 'aplicacion' and motivo = 'abonado'
 order by fecha_local desc
 limit 10;
