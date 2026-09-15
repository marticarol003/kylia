-- ─────────────────────────────────────────────────────────────────
-- Congelar la lámina de cada riego (14-sep-2026)
-- ✅ EJECUTADA EL 15-sep-2026. id_max = 275. Backfill: 218 backfill_caudal_actual
--    + 19 cantidad_apuntada + 1 desconocida = 238 riegos. 0 sin clasificar, 0
--    discrepancias contra laminaRiego, 0 filas alteradas o perdidas respecto al
--    snapshot. Constraints validados. Los tres pilotos publicados NO se movieron:
--    Ferran 412,3/500,7 · Oriol 360/348,2 · padre 440 m² 410/347,7, idénticos
--    antes y después. Snapshot en kylia_migracion.acciones_backup_20260915.
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
-- ⚠️ EL TRIGGER BLOQUEARÍA TAMBIÉN EL BACKFILL, y eso no estaba previsto en
-- ninguna versión anterior de este fichero. En un UPDATE de una fila de riego
-- `new.tipo` sigue valiendo 'riego', así que la condición del WHEN se cumple y
-- el paso 8 —que es justo un `update ... where tipo = 'riego'`— habría fallado
-- entero. Lo cazó Martí leyendo el bloque antes de ejecutarlo.
--
-- NO se resuelve desactivando el trigger: eso lo abriría para todos. Se le da
-- una puerta de SESIÓN. Solo pasa quien se haya marcado con
--     set local kylia.migracion = '1'
-- que es lo que hace la transacción del paso 8. `set local` vive dentro de esa
-- transacción y desaparece al cerrarla, pase lo que pase — así que no hay forma
-- de dejarlo puesto por olvido, y la app y el cron siguen bloqueados en todo
-- momento.
create or replace function kylia_bloqueo_riegos() returns trigger as $$
begin
  if coalesce(current_setting('kylia.migracion', true), '') = '1' then
    return new;
  end if;
  raise exception 'Registro de riegos pausado por migración (congelar-lamina-riego-2026-09-14). Reintenta en unos minutos.'
    using errcode = '55006';
end; $$ language plpgsql;

drop trigger if exists trg_bloqueo_riegos_migracion on acciones;
create trigger trg_bloqueo_riegos_migracion
  before insert or update on acciones
  for each row when (new.tipo = 'riego')
  execute function kylia_bloqueo_riegos();

-- ⚠️ ESTA FRASE ESTABA MAL Y LA CAZÓ CODEX. Decía "el cliente reintenta y el
-- agricultor ve un error claro, no un riego perdido". Las dos mitades son falsas,
-- comprobado en el fuente: `post()` (app/index.html:105) es
--     fetch(...).catch(() => null)
-- —ni mira `res.ok` ni reintenta nunca— y `addRiego` lo envuelve además en un
-- try/catch vacío. O sea que durante la ventana un riego apuntado a mano:
--   · SÍ queda en el localStorage del móvil (saveRiegos va primero);
--   · el POST se rechaza con 500 y se tira SIN AVISO NI REINTENTO;
--   · y `reconciliarRiegos()` copia servidor → local, nunca al revés, así que
--     ese riego NO llega a Supabase por sí solo. Nunca.
--
-- Consecuencia operativa, y por eso la ventana tiene que ser de verdad:
--   · avisar de que no se apunte ningún riego mientras dure;
--   · elegir una franja en la que nadie riegue (de noche, no a media mañana);
--   · ANTES de reabrir (paso 13), mirar en cada dispositivo de piloto si hay
--     riegos locales que no estén en el servidor:
--         JSON.parse(localStorage.getItem(riegosKey())).map(r => r.date)
--     y contrastarlos con /api/campo?vista=perfil&limite=100. Lo que falte se
--     vuelve a apuntar A MANO en la app una vez levantado el trigger.
-- Se levanta en el paso 12.

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
-- Se copia la tabla ENTERA, no solo los riegos. El backfill solo toca
-- tipo='riego', así que con esos bastaría — pero la copia completa cuesta lo
-- mismo (la tabla son cientos de filas, no millones) y quita de encima toda una
-- clase de duda si algo sale raro. El nombre lleva el día en que se toma.
--
-- ⚠️ Y NO VA EN `public`. Supabase sirve por la Data API los esquemas que estén
-- en Settings → API → Exposed schemas, y ahí está `public`. Una copia de
-- `acciones` en public es una segunda superficie de los mismos datos, con el
-- agujero de RLS que ya tiene la tabla original — duplicarlo por comodidad de
-- una migración no tiene defensa. En un esquema no expuesto, PostgREST ni
-- siquiera enruta. Lo pidió Martí antes de ejecutar el bloque.
create schema if not exists kylia_migracion;
revoke all on schema kylia_migracion from public, anon, authenticated;

create table kylia_migracion.acciones_backup_20260915 as select * from acciones;

revoke all on kylia_migracion.acciones_backup_20260915 from public, anon, authenticated;
alter table kylia_migracion.acciones_backup_20260915 enable row level security;

-- Y se verifica que la copia es de AHORA y está completa:
select (select count(*) from kylia_migracion.acciones_backup_20260915) as filas_copiadas,
       (select count(*) from acciones)                 as filas_origen,
       (select count(*) from kylia_migracion.acciones_backup_20260915)
         = (select count(*) from acciones)             as cuadra;
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

-- ⚠️ El comentario NO dice "el caudal de aquel día": para las filas que va a
-- rellenar el backfill eso es falso — se usa el de HOY porque es lo único que
-- hay. La columna describe QUÉ caudal se usó; de dónde sale lo dice
-- lamina_origen, y solo él. Lo pidió Martí antes de ejecutar el bloque.
comment on column acciones.caudal_mmh    is 'Caudal (mm/h) con el que se calculó la lámina congelada. Su procedencia la declara lamina_origen: dato de época en duracion_x_caudal, caudal actual en backfill_caudal_actual.';
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
-- 5 · QUE POSTGREST Y LAS INSTANCIAS RECONOZCAN LAS COLUMNAS  ⚠️ TTL
-- ═════════════════════════════════════════════════════════════════
-- EL RIESGO, señalado por Codex sobre 61ed4aa. El helper de api/_supabase.js
-- recuerda durante TTL_SIN_COLUMNAS_MS = 60 s que las tres columnas no existen,
-- y mientras dura ese recuerdo las QUITA de la consulta y de los INSERT. O sea
-- que justo después de crearlas puede haber instancias tibias que sigan
-- escribiendo riegos SIN congelar, y filas nuevas con lamina_origen a null por
-- encima de id_max. Es un agujero de un minuto, pero cae exactamente en el
-- minuto de la migración.
--
-- Hay dos cachés distintos y hay que limpiar los dos:
--   · el del helper, en memoria de cada instancia de Vercel → 60 s o reciclado;
--   · el SCHEMA CACHE de PostgREST, que es de Supabase y no caduca solo.
--
-- 5a. Refrescar el schema cache de PostgREST (si no, sigue diciendo PGRST204
--     aunque la columna ya exista):
notify pgrst, 'reload schema';

-- 5b. Comprobar desde FUERA que PostgREST ya las sirve. Tiene que devolver 200
--     y las tres claves, no un 42703:
--       curl -s "$SUPABASE_URL/rest/v1/acciones?limit=1&select=id,lamina_mm,lamina_origen,caudal_mmh" \
--         -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
--
-- 5c. Esperar MÁS DE 60 s desde la última respuesta que dio el esquema viejo.
--     Mejor que esperar: forzar un redeploy en Vercel (Deployments → Redeploy)
--     para que ninguna instancia conserve el estado en memoria. Con los
--     escritores aún cerrados.
--
-- 5d. Volver a comprobarlo, ahora a través de la app, que es la que importa:
--       curl -s "https://kylia.app/api/campo?vista=perfil&usuario_id=<piloto>" | grep lamina_origen
--     Las tres tienen que venir con valor o a null, pero NUNCA puede aparecer
--     un error 42703. Si aparece, NO seguir: alguna instancia sigue tibia.
--
-- ⚠️ NO REABRIR NINGÚN ESCRITOR hasta que 5b y 5d hayan pasado.
--
-- (El paso que aquí decía "desplegar el código corregido" ya está hecho: main
--  está en 61ed4aa y producción lo corre. Lo de abajo cuenta por qué ese orden
--  se saltó y qué costó.)
-- Ahora: a partir de aquí los DOS escritores congelan. El código viejo
-- conviviendo con el esquema nuevo no rompe (ignora las columnas que no conoce)
-- y laminaDeAccion() cae al recálculo mientras lamina_mm venga null, así que en
-- ningún momento hay nada roto.
--
-- ⚠️ ESTE PASO YA SE SALTÓ, Y SE NOTÓ. La versión anterior decía "el código
-- nuevo LEE columnas que ya existen (paso 3), así que no falla". Eso describe el
-- orden PREVISTO, no el que ocurrió: el código salió a producción el 14-sep al
-- pushear a main —Vercel despliega solo— con la migración sin ejecutar, y
-- PostgREST no perdona una columna inexistente: tumba el SELECT entero con
-- 42703. Medido contra la API real el 15-sep:
--
--     GET /api/campo?vista=hoy&usuario_id=9aaa1b25-…  → ok:false
--     GET /api/campo?vista=perfil&usuario_id=…        → ok:false
--     GET /api/campo?vista=reveal&usuario_id=…        → ok:false  (los 3 pilotos)
--
-- O sea: la pantalla de hoy de la única parcela viva y el reveal de los tres
-- pilotos, caídos. Y api/log.js insertaba lamina_mm, así que apuntar un riego
-- tampoco podía funcionar.
--
-- Corregido en api/_supabase.js: si falta una de las tres columnas, se quita de
-- la consulta y se repite UNA vez (y en los INSERT se caen los tres campos, para
-- que un riego no se pierda). No se inventa nada — sin lámina congelada el motor
-- recalcula con el caudal actual y lo declara `recalculada_caudal_actual`, que
-- es lo que hacía antes de la migración. Comprobado ejecutándolo contra un
-- PostgREST sin esas columnas en tests/test-columnas-congeladas.mjs.
--
-- Con eso el orden deja de ser una condición de vida o muerte en los DOS
-- sentidos: antes de migrar funciona, y el rollback (c) de abajo —que dropea las
-- columnas— tampoco deja producción caída. El orden de este fichero SIGUE siendo
-- el correcto; lo que ya no es, es el único que no rompe.

-- ═════════════════════════════════════════════════════════════════
-- 6 · CAPTURAR id_max  (escritores cerrados, esquema reconocido)
-- ═════════════════════════════════════════════════════════════════
-- Antes de capturar nada: confirmar que TODAS las instancias corren ya el
--     código que congela. En Vercel, que el deployment esté "Ready" y promovido
--     a producción, y comprobarlo desde fuera:
--         curl -s https://kylia.app/api/campo?vista=hoy&usuario_id=<piloto> \
--           | grep -o '"riegos_sin_cantidad"'
--     (ese campo solo existe en el código nuevo). Si hay varias regiones o un
--     deployment a medias, esperar: capturar id_max con una instancia vieja viva
--     es justo la carrera que este orden viene a evitar.

-- Ahora sí, el tope.
select max(id) as id_max from acciones where tipo = 'riego';
-- ⚠️ ANOTA ESTE `id_max`. Cualquier riego posterior ya vendrá congelado por el
-- código nuevo, así que no necesita backfill.

-- ═════════════════════════════════════════════════════════════════
-- 7 y 8 · REVISAR LÁMINAS ABSURDAS Y BACKFILL EN TRANSACCIÓN
-- ═════════════════════════════════════════════════════════════════
-- 7 · Antes del backfill: ¿hay duraciones que darían láminas absurdas? El tope
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

-- 8 · Backfill. Conjunto CERRADO por id, en una transacción: o se clasifican
--     todos los riegos viejos o ninguno.
begin;

-- La puerta del trigger del paso 1, solo para esta transacción. Sin esto el
-- backfill falla con 'Registro de riegos pausado por migración'.
set local kylia.migracion = '1';

-- GUARDA DE ENTRADA. Es el único paso irreversible de la migración, así que no
-- se apoya en que alguien haya mirado bien el paso 5: si el conjunto no es
-- EXACTAMENTE el que se midió, la transacción se aborta sola y no escribe nada.
-- Sustituir los tres números por los del paso 5 (medidos el 15-sep-2026).
do $$
declare tope bigint; total int; ya int;
begin
  select max(id), count(*), count(*) filter (where lamina_origen is not null)
    into tope, total, ya
    from acciones where tipo = 'riego';
  if tope  <> 275 then raise exception 'El tope se ha movido: max(id)=% (se esperaba 275)', tope;  end if;
  if total <> 238 then raise exception 'Hay % riegos y se esperaban 238', total;                    end if;
  if ya    <> 0   then raise exception 'Ya hay % filas congeladas: esto no es una primera pasada', ya; end if;
end $$;

-- ⚠️ EL ORDEN DE ESTAS TRES ES laminaRiego(), TRANSCRITA. No es una preferencia:
-- assets/js/motor-riego.js:1029 mira PRIMERO `min > 0 && caudal > 0` y devuelve
-- duración × caudal sin llegar a leer la cantidad; solo si esa puerta no se abre
-- cae a `cantidadGuardada`. Congelar en otro orden cambiaría la lámina de todos
-- los riegos que traen los DOS campos, y eso mueve los pilotos en el instante de
-- congelar — justo lo que esta migración existe para impedir.
--
-- La versión anterior ponía la cantidad primero y mandaba a 'desconocida' las
-- filas con cantidad + duración + parcela SIN caudal. Mal: ahí laminaRiego sí
-- devuelve la cantidad. Lo encontró Martí ejecutando la comprobación 2f — una
-- fila real, id 270, cantidad 5 L/m², duración 30 min, caudal NULL. Con el orden
-- de abajo cae sola en su sitio y no hace falta ningún caso especial.

-- 8a. Con duración Y caudal: es la primera puerta de laminaRiego. Hay que usar
--     el caudal de HOY, que es lo único que hay, y SE MARCA: no es el caudal de
--     aquel día, es una reconstrucción.
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

-- 8b. Lo que quede con cantidad apuntada: esa ES la lámina y no depende del
--     caudal. Entran aquí tanto los riegos sin duración (el cubo de 20 L) como
--     los que la traen pero cuya parcela no tiene caudal usable.
update acciones
   set lamina_mm     = cantidad_l_m2,
       lamina_origen = 'cantidad_apuntada'
 where tipo = 'riego'
   and id <= :id_max
   and lamina_origen is null                       -- ← idempotencia
   and cantidad_l_m2 is not null;

-- 8c. Ni cantidad ni duración utilizable: regó y no sabemos cuánto.
update acciones
   set lamina_origen = 'desconocida'
 where tipo = 'riego'
   and id <= :id_max
   and lamina_origen is null;

-- GUARDA DE SALIDA. El reparto tiene que ser EXACTAMENTE el que predijo el paso
-- 5. Si no lo es, se levanta la excepción, la transacción se deshace entera y no
-- queda nada a medio congelar.
do $$
declare a int; b int; c int; sin int;
begin
  select count(*) filter (where lamina_origen = 'backfill_caudal_actual'),
         count(*) filter (where lamina_origen = 'cantidad_apuntada'),
         count(*) filter (where lamina_origen = 'desconocida'),
         count(*) filter (where lamina_origen is null)
    into a, b, c, sin
    from acciones where tipo = 'riego' and id <= 275;
  if sin <> 0 then raise exception 'Quedan % filas sin clasificar', sin; end if;
  if (a, b, c) <> (218, 19, 1) then
    raise exception 'Reparto inesperado: backfill=% cantidad=% desconocida=% (se esperaba 218/19/1)', a, b, c;
  end if;
end $$;

commit;

-- ═════════════════════════════════════════════════════════════════
-- 9 · VERIFICACIÓN
-- ═════════════════════════════════════════════════════════════════
-- 9a. Reparto por procedencia. No debe quedar ningún riego sin clasificar.
select lamina_origen, count(*), round(avg(lamina_mm)::numeric, 1) as lamina_media,
       min(fecha_local) as desde, max(fecha_local) as hasta
  from acciones where tipo = 'riego'
 group by lamina_origen order by count(*) desc;

select count(*) as sin_clasificar
  from acciones where tipo = 'riego' and lamina_origen is null;   -- debe dar 0

-- 9b. Coherencia: la lámina congelada tiene que cuadrar con duración × caudal.
select count(*) as descuadres
  from acciones
 where tipo = 'riego' and lamina_origen in ('duracion_x_caudal','backfill_caudal_actual')
   and abs(lamina_mm - (caudal_mmh * duracion_min / 60.0)) > 0.15;   -- debe dar 0

-- 9c. ¿Ha entrado algún riego durante la ventana? Con el trigger del paso 1
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
-- 10 · VALIDAR RESTRICCIONES contra lo que ya hay
-- ═════════════════════════════════════════════════════════════════
alter table acciones validate constraint acciones_lamina_origen_ck;
alter table acciones validate constraint acciones_lamina_mm_ck;
alter table acciones validate constraint acciones_caudal_mmh_ck;

-- Y comprobar que el reveal de los tres pilotos no se ha movido por esto:
-- comparar con docs/pilotos/reveal-*-2026-09-13.json ANTES de enseñar nada.

-- ═════════════════════════════════════════════════════════════════
-- 11, 12 y 13 · PROBAR, REABRIR Y VERIFICAR LO NUEVO
-- ═════════════════════════════════════════════════════════════════
-- 11 · Probar con un piloto REAL antes de reabrir, las cuatro superficies.
--      NADA de meter riegos falsos en un piloto: todo esto son lecturas.
--        · /api/campo?vista=hoy      → el déficit no se ha movido
--        · /api/campo?vista=reveal   → comparar con docs/pilotos/reveal-*-2026-09-13.json
--        · /api/campo?vista=perfil   → los riegos traen lamina_origen
--        · /api/diario-b?dry=1       → el goteo automático sigue calculando igual
--      Si el reveal se mueve, PARAR: el backfill ha cambiado el histórico y hay
--      que entender por qué antes de que nadie lo vea.
--
-- 12 · Reabrir, en este orden y comprobando entre medias.
--
--      12a. ANTES de levantar nada: ¿quedó algún riego apuntado durante la
--           ventana que viva solo en el móvil? El cliente no reintenta (ver el
--           paso 1), así que esto hay que mirarlo a mano en cada dispositivo:
--             JSON.parse(localStorage.getItem(riegosKey()))
--           contra /api/campo?vista=perfil&limite=100. Lo que falte, reapuntarlo
--           en la app DESPUÉS de 12b.
--
--      12b. Levantar el registro manual:
--             drop trigger if exists trg_bloqueo_riegos_migracion on acciones;
--             drop function if exists kylia_bloqueo_riegos();
--
--      12c. Reconciliar el histórico LOCAL. La migración congela Supabase, pero los
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
--      12d. DIARIO_B_LIVE=1 en Vercel. El cron son las 06:00 UTC; si se quiere
--           comprobar el mismo día, /api/diario-b?dry=1 dice cuántas filas
--           materializaría sin escribirlas (`goteo_auto: N`).
--
-- 13 · VERIFICAR LO QUE ENTRE DESPUÉS. Es el paso que cierra el agujero del TTL:
--      si alguna instancia se quedó tibia, se ve aquí y en ningún otro sitio.
--      Toda fila cuantificable por encima del tope tiene que venir congelada.
select id, fecha_local, motivo, duracion_min, cantidad_l_m2,
       caudal_mmh, lamina_mm, lamina_origen
  from acciones
 where tipo = 'riego' and id > :id_max
 order by id;

select count(*) as nuevas_sin_congelar
  from acciones
 where tipo = 'riego' and id > :id_max
   and lamina_origen is null
   and (cantidad_l_m2 is not null or duracion_min > 0);   -- debe dar 0
-- Si da > 0: una instancia escribió con el recuerdo de "no hay columnas".
--   1) volver a poner el trigger del paso 1,
--   2) forzar redeploy en Vercel,
--   3) congelar esas filas a mano con el mismo criterio del paso 8,
--   4) repetir esta consulta hasta que dé 0.
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
--      Dropear las columnas con el código nuevo delante NO tumba producción: el
--      helper las quita de la consulta y sigue (ver paso 5). Antes del 15-sep
--      este rollback dejaba la app caída.
--      Los datos originales (cantidad_l_m2, duracion_min) no se han tocado en
--      ningún momento, y además están en kylia_migracion.acciones_backup_20260915.
--
-- La copia se borra SOLO cuando el reveal de los tres pilotos se haya verificado:
--        drop table kylia_migracion.acciones_backup_20260915;
