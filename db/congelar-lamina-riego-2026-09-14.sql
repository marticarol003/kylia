-- ─────────────────────────────────────────────────────────────────
-- Congelar la lámina de cada riego (14-sep-2026)  ·  NO EJECUTADA
-- ─────────────────────────────────────────────────────────────────
-- EL PROBLEMA. `laminaRiego` convierte duración × caudal en mm usando el caudal
-- ACTUAL de la parcela. Eso es deliberado —afinar un caudal tiene que mover las
-- decisiones de hoy— pero REESCRIBE EL PASADO: el riego de 60 min que en julio
-- valía 15 mm pasa a valer 5,4 mm en cuanto se remide el caudal con el vaso, y
-- con él se mueven el balance del ciclo y el reveal del piloto. Pasó de verdad:
-- el caudal del bancal se corrigió de 15 a 5,4 mm/h el 28-jul-2026.
--
-- Un piloto ciego cuyos números cambian cada vez que se afina un dato no se
-- puede validar. El evento congela lo suyo y el pasado deja de moverse.
--
-- QUÉ SE CONGELA, por evento:
--   caudal_mmh    el caudal vigente el día del riego (mm/h)
--   lamina_mm     la lámina definitiva ya calculada (mm = L/m²)
--   lamina_origen de dónde salió, para saber de qué fiarse
--
-- `lamina_origen` es lo que evita inventar historia:
--   'duracion_x_caudal'       duración × caudal del momento. El bueno.
--   'cantidad_apuntada'       el agricultor escribió los L/m² a mano.
--   'backfill_caudal_actual'  ← NO ES UN DATO DE ÉPOCA. Se rellena aquí con el
--                             caudal de HOY porque es lo único que hay para los
--                             riegos anteriores a esta migración. Queda marcado
--                             para poder excluirlo de una validación.
--   'desconocida'             regó y no sabemos cuánto. No se inventa nada.
--
-- IDEMPOTENTE: cada UPDATE lleva `lamina_origen is null` en el WHERE, así que
-- reejecutar no reclasifica ninguna fila ya tratada. Se puede correr dos veces.

-- ═════════════════════════════════════════════════════════════════
-- 1 · PREPARACIÓN (antes de tocar nada)
-- ═════════════════════════════════════════════════════════════════
-- Copia de seguridad de las columnas que se van a derivar. Es la vuelta atrás.
create table if not exists acciones_backup_20260914 as
  select id, usuario_id, fecha_local, tipo, cantidad_l_m2, duracion_min
    from acciones where tipo = 'riego';

-- Foto del estado previo, para comparar después.
select count(*) as riegos_totales,
       count(*) filter (where duracion_min > 0)   as con_duracion,
       count(*) filter (where cantidad_l_m2 is not null) as con_cantidad,
       max(id) as id_maximo
  from acciones where tipo = 'riego';

-- ⚠️ ANOTA EL `id_maximo` QUE DEVUELVE ESTA CONSULTA. El backfill del paso 4 se
-- cierra sobre él: así los riegos que entren MIENTRAS dura el despliegue (que ya
-- vendrán congelados por el código nuevo) no los toca el backfill. Sin ese tope
-- habría carrera entre el código viejo, el nuevo y este UPDATE.

-- ═════════════════════════════════════════════════════════════════
-- 2 · ESQUEMA (compatible con el código viejo: solo añade)
-- ═════════════════════════════════════════════════════════════════
alter table acciones add column if not exists caudal_mmh    numeric;
alter table acciones add column if not exists lamina_mm      numeric;
alter table acciones add column if not exists lamina_origen  text;

comment on column acciones.caudal_mmh    is 'mm/h vigentes el día del riego. Congelado: no se recalcula.';
comment on column acciones.lamina_mm     is 'Lámina definitiva del riego en mm (= L/m²). Congelada.';
comment on column acciones.lamina_origen is 'duracion_x_caudal | cantidad_apuntada | backfill_caudal_actual | desconocida';

-- Restricciones de cordura. NOT VALID: se aplican a lo que entre a partir de
-- ahora sin bloquear la tabla ni fallar por filas viejas; se validan en el paso 5.
alter table acciones drop constraint if exists acciones_lamina_origen_ck;
alter table acciones add  constraint acciones_lamina_origen_ck
  check (lamina_origen is null or lamina_origen in
         ('duracion_x_caudal','cantidad_apuntada','backfill_caudal_actual','desconocida')) not valid;

alter table acciones drop constraint if exists acciones_lamina_mm_ck;
alter table acciones add  constraint acciones_lamina_mm_ck
  -- 150 mm en UN día es el tope de cordura del motor (el suelo que más agua
  -- guarda de toda la tabla son 112 mm). Por encima es un caudal mal metido.
  check (lamina_mm is null or (lamina_mm >= 0 and lamina_mm <= 150)) not valid;

alter table acciones drop constraint if exists acciones_caudal_mmh_ck;
alter table acciones add  constraint acciones_caudal_mmh_ck
  check (caudal_mmh is null or (caudal_mmh > 0 and caudal_mmh <= 200)) not valid;

-- ═════════════════════════════════════════════════════════════════
-- 3 · DESPLIEGUE DEL CÓDIGO  (fuera de este fichero)
-- ═════════════════════════════════════════════════════════════════
-- Se despliega ENTRE el paso 2 y el 4, y en ese orden por un motivo:
--   · el código nuevo LEE columnas que ya existen (paso 2) → no falla;
--   · el código nuevo ESCRIBE las columnas en cada riego nuevo;
--   · laminaDeAccion() cae al recálculo cuando lamina_mm viene null, así que
--     durante la ventana el comportamiento es el de antes: no hay momento en el
--     que nada se rompa.
-- El código VIEJO conviviendo con el esquema nuevo tampoco rompe: ignora las
-- columnas que no conoce. Por eso el orden 2 → 3 → 4 no tiene carrera.

-- ═════════════════════════════════════════════════════════════════
-- 4 · BACKFILL  (después de desplegar; sustituye :id_max por el del paso 1)
-- ═════════════════════════════════════════════════════════════════
-- Conjunto CERRADO por id: solo lo que existía antes del despliegue.

-- 4a. Cantidad apuntada a mano: esa ES la lámina y no depende del caudal.
update acciones
   set lamina_mm     = cantidad_l_m2,
       lamina_origen = 'cantidad_apuntada'
 where tipo = 'riego'
   and id <= :id_max
   and lamina_origen is null                       -- ← idempotencia
   and cantidad_l_m2 is not null
   and (duracion_min is null or duracion_min <= 0);

-- 4b. Con duración: hay que usar el caudal de HOY, que es lo único que hay.
--     SE MARCA: no es el caudal de aquel día, es una reconstrucción.
update acciones a
   set caudal_mmh    = u.caudal,
       lamina_mm     = round((u.caudal * a.duracion_min / 60.0)::numeric, 1),
       lamina_origen = 'backfill_caudal_actual'
  from usuarios u
 where u.id = a.usuario_id
   and a.tipo = 'riego'
   and a.id <= :id_max
   and a.lamina_origen is null                     -- ← idempotencia
   and a.duracion_min is not null and a.duracion_min > 0
   and u.caudal is not null and u.caudal > 0;

-- 4c. Ni cantidad ni duración utilizable: regó y no sabemos cuánto.
update acciones
   set lamina_origen = 'desconocida'
 where tipo = 'riego'
   and id <= :id_max
   and lamina_origen is null;

-- ═════════════════════════════════════════════════════════════════
-- 5 · VERIFICACIÓN
-- ═════════════════════════════════════════════════════════════════
-- 5a. Reparto por procedencia. No debe quedar ningún riego sin clasificar.
select lamina_origen, count(*), round(avg(lamina_mm)::numeric, 1) as lamina_media,
       min(fecha_local) as desde, max(fecha_local) as hasta
  from acciones where tipo = 'riego'
 group by lamina_origen order by count(*) desc;

select count(*) as sin_clasificar
  from acciones where tipo = 'riego' and lamina_origen is null;   -- debe dar 0

-- 5b. Coherencia: la lámina congelada tiene que cuadrar con duración × caudal.
select count(*) as descuadres
  from acciones
 where tipo = 'riego' and lamina_origen in ('duracion_x_caudal','backfill_caudal_actual')
   and abs(lamina_mm - (caudal_mmh * duracion_min / 60.0)) > 0.15;   -- debe dar 0

-- 5c. Ahora sí, validar las restricciones contra lo que ya hay.
alter table acciones validate constraint acciones_lamina_origen_ck;
alter table acciones validate constraint acciones_lamina_mm_ck;
alter table acciones validate constraint acciones_caudal_mmh_ck;

-- 5d. Y comprobar que el reveal de los tres pilotos no se ha movido por esto:
--     comparar con docs/pilotos/reveal-*-2026-09-13.json ANTES de enseñar nada.

-- ═════════════════════════════════════════════════════════════════
-- 6 · REAPERTURA / ROLLBACK
-- ═════════════════════════════════════════════════════════════════
-- No hay escrituras que cerrar: los pasos 2 y 4 no bloquean la tabla (los ALTER
-- son ADD COLUMN sin default, instantáneos en Postgres ≥ 11, y las constraints
-- van NOT VALID). El sistema está operativo todo el rato.
--
-- VUELTA ATRÁS, por orden de gravedad:
--   a) Backfill mal → se rehace sin tocar el esquema:
--        update acciones set lamina_mm = null, caudal_mmh = null, lamina_origen = null
--         where tipo = 'riego' and lamina_origen = 'backfill_caudal_actual';
--      (solo el backfill: lo que haya congelado el código nuevo NO se toca)
--   b) Volver al código viejo → no hace falta deshacer nada: ignora las columnas.
--   c) Revertir del todo:
--        alter table acciones drop constraint if exists acciones_lamina_origen_ck;
--        alter table acciones drop constraint if exists acciones_lamina_mm_ck;
--        alter table acciones drop constraint if exists acciones_caudal_mmh_ck;
--        alter table acciones drop column if exists lamina_origen, drop column if exists lamina_mm,
--                                drop column if exists caudal_mmh;
--      Los datos originales (cantidad_l_m2, duracion_min) no se han tocado en
--      ningún momento, y además están en acciones_backup_20260914.
--
-- La copia se borra cuando el reveal de los tres pilotos se haya verificado:
--        drop table acciones_backup_20260914;
