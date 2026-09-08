-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Cerrar el piloto de cebolleta de El Tros de l'Uri (Oriol)
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. Es idempotente.
--
-- QUÉ PASA (2026-08-27): Oriol lleva ~15 días cosechando la cebolleta y el
-- piloto sigue abierto en la base de datos. Con `fecha_cosecha` a NULL:
--   • `api/diario-b.js` congela CADA MAÑANA una decisión de riego para una
--     parcela que se está arrancando, y `recomendaciones_log` es append-only:
--     limpiar después obliga a desactivar el trigger;
--   • la ventana del reveal (`api/campo.js:451`) se cierra en "el último día con
--     decisión", o sea hoy, así que el informe cuenta el periodo de cosecha como
--     si fuese campaña. Es el mismo agujero que ya nos comimos con el campo de
--     440 m² del padre (ver db/anadir-fecha-cosecha-2026-08-01.sql).
--
-- QUÉ FECHA SE PONE, Y POR QUÉ EL PRIMER DÍA Y NO EL ÚLTIMO
-- La cebolleta no se cosecha de golpe: se arranca a manojos durante semanas, y
-- Oriol SIGUE REGANDO lo que queda en pie (confirmado por él el 27-ago). O sea
-- que el campo no está vacío y los riegos que ha escrito la pauta automática son
-- reales — no hay nada que borrar.
--
-- Pero `fecha_cosecha` es UNA fecha, y hay que elegir. Se cierra el 12-ago, el
-- día que EMPEZÓ a cosechar:
--   • a partir de ahí la superficie con cultivo encoge cada día y el motor no lo
--     sabe: sigue calculando ETc para 380 m² de cebolleta entera. El
--     contrafactual de Kylia se infla sobre un campo que ya no existe, y el
--     ahorro publicado deja de ser defendible;
--   • cerrando al principio, la ventana es un ciclo limpio de plantación
--     (24-jun) a primera cosecha (12-ago) = 49 días, con el Kc de cebolla
--     recorrido de verdad (curva L = 15+25+20+10; el día 49 cae en media
--     estación, que es exactamente donde se arranca la cebolla TIERNA).
--
-- Los riegos que la pauta ya escribió del 13-ago en adelante se quedan donde
-- están: son reales y, al caer fuera de la ventana, el reveal no los mira.
--
-- ⚠️ SI NO EMPEZÓ EL 12: cambia la fecha en los DOS sitios de abajo. Sale de
--    "lleva 15 días" contados desde hoy 27-ago; si te dice otro día, manda él.

-- ── 1) Cerrar el piloto ──────────────────────────────────────────
update usuarios
   set fecha_cosecha = '2026-08-12'
 where id = 'a7f3c9e1-2b84-4d56-9f10-6c8e2b4a7d33'
   and fecha_cosecha is null;

-- ── 2) Verificar que quedó cerrado ───────────────────────────────
-- Debe salir: fecha_plantacion 2026-06-24 · fecha_cosecha 2026-08-12 · 49 días
select nombre,
       fecha_plantacion,
       fecha_cosecha,
       fecha_cosecha - fecha_plantacion as dias_de_ciclo,
       area_m2, caudal, riego_auto
  from usuarios
 where id = 'a7f3c9e1-2b84-4d56-9f10-6c8e2b4a7d33';

-- ── 3) Qué entra en el reveal, para poder mirarlo antes de publicarlo ──
-- Riegos REALES dentro de la ventana del piloto, separando los que apuntó una
-- persona de los que sintetizó la pauta automática (motivo = 'goteo-auto').
-- Si aquí aparece un lunes o un jueves en que NO se regó, esa fila hay que
-- borrarla a mano: el reveal la cuenta como agua aplicada.
select fecha_local,
       coalesce(motivo, 'apuntado a mano') as origen,
       duracion_min,
       cantidad_l_m2
  from acciones
 where usuario_id = 'a7f3c9e1-2b84-4d56-9f10-6c8e2b4a7d33'
   and tipo = 'riego'
   and fecha_local between '2026-06-24' and '2026-08-12'
 order by fecha_local;

-- ── 4) Y los riegos que quedan FUERA (cola de cosecha) ────────────
-- No se borran: son reales. Solo se listan para que se vea que el corte del
-- 12-ago los deja fuera del informe a propósito, no por un fallo.
select count(*) as riegos_despues_de_cerrar,
       min(fecha_local) as primero,
       max(fecha_local) as ultimo
  from acciones
 where usuario_id = 'a7f3c9e1-2b84-4d56-9f10-6c8e2b4a7d33'
   and tipo = 'riego'
   and fecha_local > '2026-08-12';

-- ── 5) Cobertura del registro: cuántos días del ciclo tienen decisión ──
-- El reveal avisa solo si baja del 90% (api/_reveal.js). Mejor saberlo ANTES de
-- enseñarle el informe a nadie.
select count(distinct date(fecha)) as dias_con_decision,
       date '2026-08-12' - date '2026-06-24' + 1 as dias_de_ciclo
  from recomendaciones_log
 where usuario_id = 'a7f3c9e1-2b84-4d56-9f10-6c8e2b4a7d33'
   and tipo = 'riego'
   and fecha between '2026-06-24T00:00:00Z' and '2026-08-12T23:59:59Z';

-- ── 6) DESPUÉS de ejecutar esto ──────────────────────────────────
-- El reveal ya se puede generar y sale marcado `cerrado: true` (ciclo completo,
-- que es lo que lo hace defendible frente a una foto a media campaña):
--   https://kylia.app/api/campo?vista=reveal&usuario_id=a7f3c9e1-2b84-4d56-9f10-6c8e2b4a7d33
-- Es la SEGUNDA cosecha completa de un piloto y la primera de un agricultor que
-- no es de la familia. Con Lanzadera el 7-sep, es el activo con el que se llega.
