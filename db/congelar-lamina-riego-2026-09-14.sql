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

-- ⚠️ EL ORDEN IMPORTA, y la primera versión de este fichero lo tenía mal.
-- Capturaba `id_max` ANTES de desplegar, con el código viejo aún escribiendo: los
-- riegos que entraran entre la captura y el despliegue quedaban por encima del
-- tope (fuera del backfill) pero los escribía código que todavía no congelaba, o
-- sea que se quedaban sin lámina y sin que nadie los volviera a mirar. Lo cazó
-- Codex. El tope se captura DESPUÉS de desplegar, cuando ya no hay ningún
-- escritor sin congelar, y con las escrituras pausadas un momento.

-- ═════════════════════════════════════════════════════════════════
-- 1 · PAUSAR ESCRITURAS DE RIEGO  (son segundos, no minutos)
-- ═════════════════════════════════════════════════════════════════
-- Solo hay DOS escritores de acciones de riego (verificado en
-- tests/test-escritores-riego.mjs):
--   · api/log.js            — el riego que apunta el agricultor
--   · api/diario-b.js       — el goteo automático de pauta fija (cron 06:00 UTC)
--
-- Se pausan así, y en este orden:
--   a) DIARIO_B_LIVE=0 en Vercel  → el cron calcula pero no escribe (dry-run).
--      Es su modo por defecto, así que es volver a lo seguro.
--   b) La ventana se elige FUERA de las 06:00 UTC, que es cuando corre el cron.
--   c) El riego manual no se pausa con una bandera: se hace en una franja de
--      poco uso (la app registra riegos por la mañana temprano y a mediodía).
--      Si entrara alguno, el paso 7 lo detecta — no se pierde, se ve.
--
-- No se bloquea la tabla: un LOCK dejaría la app dando errores al agricultor, y
-- el coste de que entre un riego suelto es que salga en la verificación.

-- ═════════════════════════════════════════════════════════════════
-- 2 · SNAPSHOT / BACKUP
-- ═════════════════════════════════════════════════════════════════
create table if not exists acciones_backup_20260914 as
  select id, usuario_id, fecha_local, tipo, cantidad_l_m2, duracion_min
    from acciones where tipo = 'riego';

-- Foto del estado previo, para comparar al final.
select count(*) as riegos_totales,
       count(*) filter (where duracion_min > 0)          as con_duracion,
       count(*) filter (where cantidad_l_m2 is not null) as con_cantidad,
       max(id) as id_maximo_previo
  from acciones where tipo = 'riego';

-- ═════════════════════════════════════════════════════════════════
-- 3 · ESQUEMA (compatible con el código viejo: solo añade)
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
-- 4 · DESPLEGAR EL CÓDIGO  (fuera de este fichero)
-- ═════════════════════════════════════════════════════════════════
-- Ahora, y no antes: el código nuevo LEE columnas que ya existen (paso 3), así
-- que no falla; y a partir de aquí los DOS escritores congelan. El código viejo
-- conviviendo con el esquema nuevo tampoco rompe: ignora las columnas que no
-- conoce. Y laminaDeAccion() cae al recálculo mientras lamina_mm venga null, así
-- que en ningún momento hay nada roto.

-- ═════════════════════════════════════════════════════════════════
-- 5 · CAPTURAR EL TOPE, YA CON TODOS LOS ESCRITORES CONGELANDO
-- ═════════════════════════════════════════════════════════════════
select max(id) as id_max from acciones where tipo = 'riego';
-- ⚠️ ANOTA ESTE `id_max` y úsalo en el paso 6. Cualquier riego que entre a
-- partir de ahora ya viene congelado por el código nuevo, así que no necesita
-- backfill: por eso el tope se captura AQUÍ y no al principio.

-- ═════════════════════════════════════════════════════════════════
-- 6 · BACKFILL, EN UNA TRANSACCIÓN  (sustituye :id_max por el del paso 5)
-- ═════════════════════════════════════════════════════════════════
-- Conjunto CERRADO por id. En una transacción: o se clasifican todos los riegos
-- viejos o ninguno, sin dejar la tabla a medias si algo falla por el camino.
begin;

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

commit;

-- ═════════════════════════════════════════════════════════════════
-- 7 · VERIFICACIÓN
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

-- 7c. ¿Ha entrado algún riego manual durante la ventana? No es un error —no se
--     bloqueó la tabla a propósito— pero tiene que verse, y tiene que venir ya
--     congelado por el código nuevo. Si alguno sale sin lámina, es que el
--     despliegue del paso 4 no había llegado todavía: repetir el paso 6 con el
--     id_max nuevo.
select id, fecha_local, lamina_origen
  from acciones
 where tipo = 'riego' and id > :id_max
 order by id;

-- ═════════════════════════════════════════════════════════════════
-- 8 · VALIDAR RESTRICCIONES contra lo que ya hay
-- ═════════════════════════════════════════════════════════════════
alter table acciones validate constraint acciones_lamina_origen_ck;
alter table acciones validate constraint acciones_lamina_mm_ck;
alter table acciones validate constraint acciones_caudal_mmh_ck;

-- Y comprobar que el reveal de los tres pilotos no se ha movido por esto:
-- comparar con docs/pilotos/reveal-*-2026-09-13.json ANTES de enseñar nada.

-- ═════════════════════════════════════════════════════════════════
-- 9 · REANUDAR ESCRITURAS
-- ═════════════════════════════════════════════════════════════════
-- DIARIO_B_LIVE=1 en Vercel. El riego manual nunca llegó a bloquearse.
--
-- ── ROLLBACK ─────────────────────────────────────────────────────
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
