-- ─────────────────────────────────────────────────────────────────
-- fecha_cosecha en usuarios — cerrar el piloto el día que se cosecha
-- ─────────────────────────────────────────────────────────────────
-- El piloto tenía principio (`piloto_inicio`) pero no FINAL. Consecuencia real,
-- comprobada: el campo de 440 m² del padre se cosechó el 30-jul-2026 y el cron
-- del Diario B ha seguido congelando cada mañana una decisión de riego para una
-- parcela VACÍA. Cada día, una fila más en `recomendaciones_log` diciendo que
-- había que regar una tierra donde ya no hay nada.
--
-- Y esa tabla es de donde lee el REVEAL. O sea que el informe que compara "lo
-- que Kylia habría hecho" contra "lo que hizo el agricultor" se ensucia un poco
-- más cada día que pasa. Además `recomendaciones_log` es append-only por diseño
-- (trigger reclog_no_modif), así que esas filas NO se pueden borrar sin
-- desactivar el trigger: cuanto antes se corte, menos hay que limpiar.
--
-- Segundo efecto: el reveal cerraba su ventana en el ÚLTIMO día con decisión
-- congelada, o sea "hoy". Contando días de más después de la cosecha —días en
-- los que Kylia "recomendaba regar" y el agricultor obviamente no regaba— el
-- ahorro sale diluido: publicaba ~20% cuando el rango honesto es 20-30%.
--
-- Con esta columna:
--   • diario-b deja de congelar en cuanto la fecha pasa (y de sintetizar riegos
--     de goteo automático, que también seguía inventando).
--   • el reveal corta su ventana ahí, no en "hoy".
--
-- Idempotente.

alter table usuarios add column if not exists fecha_cosecha date;

comment on column usuarios.fecha_cosecha is
  'Día en que se cosechó esta parcela. Cierra el piloto: diario-b deja de congelar decisiones y el reveal corta su ventana aquí en vez de en "hoy". NULL = piloto en marcha.';

-- ── Cerrar el campo de 440 m² del padre, cosechado el 30-jul-2026 ──
-- (Ver memoria: project_primer_reveal_440m2. Es el primer piloto cosechado.)
update usuarios
   set fecha_cosecha = '2026-07-30'
 where id = '23567ff1-7368-4dc9-b777-fdeaab9f8714'
   and fecha_cosecha is null;

-- ── Comprobación: qué pilotos siguen abiertos y cuáles cerrados ──
--   select nombre, ciudad, fecha_plantacion, fecha_cosecha, piloto_sombra
--     from usuarios where piloto_sombra order by fecha_plantacion;
--
-- ── Limpieza de las filas basura ya escritas (OPCIONAL, destructivo) ──
-- recomendaciones_log es append-only a propósito: el reveal es creíble porque
-- nadie puede ajustar el pasado. Con el corte de arriba el reveal YA las ignora
-- (filtra por fecha_cosecha), así que borrarlas no es necesario. Si aun así se
-- quieren fuera, hay que desactivar el trigger y volver a activarlo:
--
--   alter table recomendaciones_log disable trigger trg_reclog_append_only;
--   delete from recomendaciones_log
--    where usuario_id = '23567ff1-7368-4dc9-b777-fdeaab9f8714'
--      and fecha > '2026-07-30T23:59:59Z';
--   alter table recomendaciones_log enable trigger trg_reclog_append_only;
