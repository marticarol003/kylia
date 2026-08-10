-- ─────────────────────────────────────────────────────────────────
-- KYLIA · La configuración deja de vivir solo en el móvil · 2026-08-10
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. Es idempotente.
--
-- EL PROBLEMA: `db/acceso-por-email-2026-08-07.sql` montó el enlace por correo
-- para que la parcela sea de la PERSONA y no del dispositivo. Pero el enlace, por
-- sí solo, no sirve de nada: aunque el móvil nuevo adopte el `propietario_id`, la
-- configuración —dónde está la finca, qué suelo, qué caudal, qué zonas de cultivo
-- hay y qué se sembró en cada una— sigue viviendo en el `localStorage` del móvil
-- viejo. El agricultor entra y ve la app en blanco.
--
-- LA SOLUCIÓN: una foto de esa configuración en la fila del propietario. La app
-- la sube cuando el agricultor cambia algo, y se la baja cuando arranca en un
-- dispositivo que no tiene nada. Con eso, el enlace por correo entrega lo que
-- promete: abres Kylia en otro sitio y está tu campo.
--
-- POR QUÉ UN JSONB Y NO TABLAS NORMALIZADAS: la app agrupa las siembras en
-- recintos (una zona puede tener varias siembras, y una siembra puede tener su
-- propio contorno si el recinto se partió). El servidor guarda UNA FILA POR
-- SIEMBRA, que es lo que necesita para los riegos y el plan de abonado, pero esa
-- estructura pierde el agrupamiento. Traducir de ida y vuelta entre las dos
-- formas es donde se pierden datos en silencio. Guardar la foto tal cual la app
-- la entiende no pierde nada, y las filas por siembra siguen siendo la verdad
-- para todo lo que calcula. Mismo criterio que `parcela` y `preferencias`, que ya
-- son jsonb.
--
-- ⚠️ ESTO NO ES UNA COPIA DE SEGURIDAD y no debe usarse como tal. Es un espejo
--    del último dispositivo que guardó. Los datos que importan de verdad —riegos,
--    observaciones, mediciones— viven en sus tablas, no aquí.

alter table usuarios add column if not exists config_app jsonb;

comment on column usuarios.config_app is
  'Foto de la configuración de /app (finca + zonas + zona activa) del PROPIETARIO, para poder restaurarla en otro dispositivo. Espejo, no copia de seguridad: la verdad de riegos y mediciones está en sus tablas.';

-- ── Comprobar ──
-- `guardado` dice de cuándo es la foto y `zonas` cuántas zonas de cultivo lleva.
select nombre,
       config_app->>'guardado'                        as guardado,
       jsonb_array_length(coalesce(config_app->'zonas', '[]'::jsonb)) as zonas,
       config_app->'finca'->>'ciudad'                 as ciudad
  from usuarios
 where config_app is not null
 order by guardado desc nulls last;
