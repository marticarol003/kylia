-- ─────────────────────────────────────────────────────────────────
-- propietario_id en usuarios — separar la PERSONA de la PARCELA
-- ─────────────────────────────────────────────────────────────────
-- Hasta ahora una fila de `usuarios` era las dos cosas a la vez: la identidad
-- del agricultor Y su única parcela. Con eso no se pueden tener zonas de
-- cultivo, y de hecho ya se estaba trabajando alrededor: el campo del padre son
-- TRES filas de usuarios con sus UUID escritos a mano dentro de campo/index.html
-- (CAMPOS.nuevas / lechugas / padre). O sea que N parcelas por persona ya existe
-- en la práctica; lo que no había era forma de saber que son del mismo.
--
-- EL CRITERIO: `usuarios` SIGUE SIENDO LA PARCELA. Nada de lo que consulta hoy
-- por usuario_id cambia — campo.js, diario-b.js, el refresco de Sentinel, el
-- reveal, el cuaderno y /app siguen funcionando igual, fila a fila. Lo único que
-- se añade es a quién pertenece cada fila.
--
-- Se eligió esto en vez de una tabla `zonas` con FK precisamente por eso: la
-- tabla nueva obligaría a que TODO lo que consulta por usuario_id aprendiera qué
-- es una zona, y eso es el refactor grande. Aquí la migración es aditiva.
--
-- Y no es solo para las zonas: el sistema de cuentas necesita exactamente esta
-- misma separación (una persona que entra con email y contraseña, y sus N
-- parcelas colgando). Haciéndolo ahora se paga una vez en lugar de dos.
--
-- BACKFILL: cada fila existente se apunta a SÍ MISMA. Un agricultor con una sola
-- parcela sigue siendo su propio propietario y no cambia nada de nada. Cuando
-- añada una segunda zona, la nueva fila llevará el propietario_id de la primera.
--
-- Idempotente: se puede ejecutar dos veces sin efecto.

alter table usuarios add column if not exists propietario_id uuid;

-- Cada parcela existente es de sí misma (comportamiento actual, intacto).
update usuarios set propietario_id = id where propietario_id is null;

-- Se consulta "dame las parcelas de esta persona" en cada carga de la app.
create index if not exists idx_usuarios_propietario on usuarios (propietario_id);

comment on column usuarios.propietario_id is
  'Persona dueña de esta parcela. Varias filas con el mismo propietario_id = las zonas de cultivo de un mismo agricultor. Una parcela sola se apunta a sí misma.';
