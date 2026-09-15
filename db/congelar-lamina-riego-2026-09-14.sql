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
-- 1 · BLOQUEAR DE VERDAD EL REGISTRO MANUAL DE RIEGOS
-- ═════════════════════════════════════════════════════════════════
-- Solo hay DOS escritores de acciones de riego (verificado ejecutándolos en
-- tests/test-escritores-riego.mjs, que además cuenta que no aparezca un tercero):
--   · api/log.js       — el riego que apunta el agricultor
--   · api/diario-b.js  — el goteo automático de pauta fija (cron 06:00 UTC)
--
-- "Elegir una franja de poco uso" NO es bloquear: si entra un riego, entra. Se
-- bloquea con un trigger, que es reversible en una línea y no depende de a qué
-- hora se haga la migración.
create or replace function kylia_bloqueo_riegos() returns trigger as $$
begin
  raise exception 'Registro de riegos pausado por migración (congelar-lamina-riego-2026-09-14). Reintenta en unos minutos.'
    using errcode = '55006';
end; $$ language plpgsql;

create trigger trg_bloqueo_riegos_migracion
  before insert or update on acciones
  for each row when (new.tipo = 'riego')
  execute function kylia_bloqueo_riegos();

-- El cliente reintenta y el agricultor ve un error claro, no un riego perdido.
-- Se levanta en el paso 14.

-- ═════════════════════════════════════════════════════════════════
-- 2 · DIARIO_B_LIVE = 0
-- ═════════════════════════════════════════════════════════════════
-- En Vercel. El cron pasa a dry-run: calcula y loguea, no escribe. Es su modo
-- por defecto, así que es volver a lo seguro. Hacerlo DESPUÉS del trigger para
-- que no haya ni un instante sin una de las dos protecciones.

-- ═════════════════════════════════════════════════════════════════
-- 3 · SNAPSHOT NUEVO Y VERIFICABLE
-- ═════════════════════════════════════════════════════════════════
-- ⚠️ NADA DE `create table if not exists`: si ya existe una copia de otro
-- intento, esa línea no falla — no copia nada y te deja creyendo que has hecho
-- backup cuando lo que tienes es la foto de antes de ayer. Con `create table` a
-- secas, si el nombre está cogido, PETA. Que pete es lo que se quiere.
create table acciones_backup_20260914 as
  select * from acciones where tipo = 'riego';

-- Y se verifica que la copia es de AHORA y está completa:
select (select count(*) from acciones_backup_20260914) as filas_copiadas,
       (select count(*) from acciones where tipo = 'riego') as filas_origen,
       (select count(*) from acciones_backup_20260914)
         = (select count(*) from acciones where tipo = 'riego') as cuadra;
-- `cuadra` tiene que ser true. Si no, PARAR.

-- Foto del estado previo, para comparar al final.
select count(*) as riegos_totales,
       count(*) filter (where duracion_min > 0)          as con_duracion,
       count(*) filter (where cantidad_l_m2 is not null) as con_cantidad,
       max(id) as id_maximo_previo
  from acciones where tipo = 'riego';

-- ═════════════════════════════════════════════════════════════════
-- 4 · ESQUEMA (columnas + constraints NOT VALID)
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
-- 5 · DESPLEGAR EL CÓDIGO CORREGIDO  (fuera de este fichero)
-- ═════════════════════════════════════════════════════════════════
-- Ahora, y no antes: el código nuevo LEE columnas que ya existen (paso 3), así
-- que no falla; y a partir de aquí los DOS escritores congelan. El código viejo
-- conviviendo con el esquema nuevo tampoco rompe: ignora las columnas que no
-- conoce. Y laminaDeAccion() cae al recálculo mientras lamina_mm venga null, así
-- que en ningún momento hay nada roto.

-- ═════════════════════════════════════════════════════════════════
-- 6 y 7 · CONFIRMAR LA VERSIÓN DESPLEGADA Y CAPTURAR id_max
-- ═════════════════════════════════════════════════════════════════
-- 6 · Antes de capturar nada: confirmar que TODAS las instancias corren ya el
--     código que congela. En Vercel, que el deployment esté "Ready" y promovido
--     a producción, y comprobarlo desde fuera:
--         curl -s https://kylia.app/api/campo?vista=hoy&usuario_id=<piloto> \
--           | grep -o '"riegos_sin_cantidad"'
--     (ese campo solo existe en el código nuevo). Si hay varias regiones o un
--     deployment a medias, esperar: capturar id_max con una instancia vieja viva
--     es justo la carrera que este orden viene a evitar.

-- 7 · Ahora sí, el tope.
select max(id) as id_max from acciones where tipo = 'riego';
-- ⚠️ ANOTA ESTE `id_max`. Cualquier riego posterior ya vendrá congelado por el
-- código nuevo, así que no necesita backfill.

-- ═════════════════════════════════════════════════════════════════
-- 8 y 9 · REVISAR LÁMINAS ABSURDAS Y BACKFILL EN TRANSACCIÓN
-- ═════════════════════════════════════════════════════════════════
-- 8 · Antes del backfill: ¿hay duraciones que darían láminas absurdas? El tope
--     de cordura del motor son 150 mm en un día (el suelo que más agua guarda de
--     toda la tabla son 112). Por encima es un caudal mal metido o unos minutos
--     de más, y la constraint del paso 4 haría fallar el backfill entero.
select a.id, a.fecha_local, a.duracion_min, u.caudal,
       round((u.caudal * a.duracion_min / 60.0)::numeric, 1) as lamina_estimada
  from acciones a join usuarios u on u.id = a.usuario_id
 where a.tipo = 'riego' and a.lamina_origen is null
   and a.duracion_min > 0 and u.caudal > 0
   and (u.caudal * a.duracion_min / 60.0) > 150
 order by lamina_estimada desc;
-- Si sale alguna fila: decidir UNA a una antes de seguir (corregir la duración,
-- o marcarla 'desconocida' a mano). No se toca la constraint para que pase.

-- 9 · Backfill. Conjunto CERRADO por id, en una transacción: o se clasifican
--     todos los riegos viejos o ninguno.
begin;

-- 9a. Cantidad apuntada a mano: esa ES la lámina y no depende del caudal.
update acciones
   set lamina_mm     = cantidad_l_m2,
       lamina_origen = 'cantidad_apuntada'
 where tipo = 'riego'
   and id <= :id_max
   and lamina_origen is null                       -- ← idempotencia
   and cantidad_l_m2 is not null
   and (duracion_min is null or duracion_min <= 0);

-- 9b. Con duración: hay que usar el caudal de HOY, que es lo único que hay.
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

-- 9c. Ni cantidad ni duración utilizable: regó y no sabemos cuánto.
update acciones
   set lamina_origen = 'desconocida'
 where tipo = 'riego'
   and id <= :id_max
   and lamina_origen is null;

commit;

-- ═════════════════════════════════════════════════════════════════
-- 10 · VERIFICACIÓN
-- ═════════════════════════════════════════════════════════════════
-- 10a. Reparto por procedencia. No debe quedar ningún riego sin clasificar.
select lamina_origen, count(*), round(avg(lamina_mm)::numeric, 1) as lamina_media,
       min(fecha_local) as desde, max(fecha_local) as hasta
  from acciones where tipo = 'riego'
 group by lamina_origen order by count(*) desc;

select count(*) as sin_clasificar
  from acciones where tipo = 'riego' and lamina_origen is null;   -- debe dar 0

-- 10b. Coherencia: la lámina congelada tiene que cuadrar con duración × caudal.
select count(*) as descuadres
  from acciones
 where tipo = 'riego' and lamina_origen in ('duracion_x_caudal','backfill_caudal_actual')
   and abs(lamina_mm - (caudal_mmh * duracion_min / 60.0)) > 0.15;   -- debe dar 0

-- 10c. ¿Ha entrado algún riego durante la ventana? Con el trigger del paso 1
--     puesto, esta consulta tiene que salir VACÍA: nada ha podido escribirse.
--     Si devuelve filas, el bloqueo no estaba activo cuando debía —lo dropeó
--     alguien, o el paso 1 no llegó a ejecutarse— y entonces hay que mirarlas
--     una a una: las que vengan con lamina_origen las congeló el código nuevo y
--     están bien; las que salgan sin lámina son código viejo escribiendo, o sea
--     que el paso 6 dio por bueno un despliegue a medias. En ese caso: volver a
--     poner el trigger, repetir el paso 6 de verdad y rehacer 7-9 con el id_max
--     nuevo.
select id, fecha_local, lamina_origen
  from acciones
 where tipo = 'riego' and id > :id_max
 order by id;

-- ═════════════════════════════════════════════════════════════════
-- 11 · VALIDAR RESTRICCIONES contra lo que ya hay
-- ═════════════════════════════════════════════════════════════════
alter table acciones validate constraint acciones_lamina_origen_ck;
alter table acciones validate constraint acciones_lamina_mm_ck;
alter table acciones validate constraint acciones_caudal_mmh_ck;

-- Y comprobar que el reveal de los tres pilotos no se ha movido por esto:
-- comparar con docs/pilotos/reveal-*-2026-09-13.json ANTES de enseñar nada.

-- ═════════════════════════════════════════════════════════════════
-- 12, 13 y 14 · PROBAR, RECONCILIAR Y REANUDAR
-- ═════════════════════════════════════════════════════════════════
-- 12 · Probar con un piloto REAL antes de reabrir, las cuatro superficies:
--        · /api/campo?vista=hoy      → el déficit no se ha movido
--        · /api/campo?vista=reveal   → comparar con docs/pilotos/reveal-*-2026-09-13.json
--        · /api/campo?vista=perfil   → los riegos traen lamina_origen
--        · /api/diario-b?dry=1       → el goteo automático sigue calculando igual
--      Si el reveal se mueve, PARAR: el backfill ha cambiado el histórico y hay
--      que entender por qué antes de que nadie lo vea.
--
-- 13 · Reconciliar el histórico LOCAL. La migración congela Supabase, pero los
--      riegos que viven en el localStorage del móvil no reciben nada y la app
--      seguiría recalculándolos con el caudal actual. La app lo hace sola al
--      arrancar (reconciliarRiegos, ver app/index.html), casando por fecha +
--      duración + cantidad y solo cuando la correspondencia es inequívoca. Basta
--      con abrir la app en cada dispositivo de piloto y comprobar en la consola:
--          await window.kyliaReconciliarRiegos()
--          → { reconciliados: N, sinCasar: 0 }
--      `sinCasar > 0` no es un fallo: son riegos que no se pueden casar sin
--      riesgo de copiar la lámina del que no es. Se quedan con su fallback
--      declarado.
--
-- 14 · Reanudar escritores:
--        drop trigger if exists trg_bloqueo_riegos_migracion on acciones;
--        drop function if exists kylia_bloqueo_riegos();
--        DIARIO_B_LIVE=1 en Vercel.
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
