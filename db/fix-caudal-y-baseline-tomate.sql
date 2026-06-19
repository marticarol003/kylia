-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Piloto tomate (Breda) — caudal corregido + baseline del goteo
-- ─────────────────────────────────────────────────────────────────
-- SIN tocar recomendaciones_log (es append-only por diseño; bien). Esto
-- solo arregla los datos de ENTRADA, que es lo que estaba mal:
--   • caudal real ≈ 32 mm/h  (6 L/h·m × 160 m de goteo ÷ 30 m²), no 6.
--   • baseline del goteo: 16 L/m² por riego (30 min ÷ 60 × 32), día sí día no.
-- A partir de aquí, las decisiones que congele diario-b ya serán realistas.
-- Provisional hasta medir con el truco del vaso.
-- ─────────────────────────────────────────────────────────────────

-- ── campo nuevo: inicio efectivo del piloto (deja fuera el arranque sucio) ──
-- recomendaciones_log es append-only: no borramos las 6 decisiones envenenadas
-- (13→19 jun, calculadas sin riego real). En su lugar, el reveal solo cuenta
-- desde piloto_inicio. 20-jun = primer día con caudal+baseline correctos.
alter table usuarios add column if not exists piloto_inicio date;

-- ── caudal del piloto: 6 → 32 mm/h  +  inicio del reveal ─────────────
update usuarios
   set caudal        = 32,
       piloto_inicio = '2026-06-20'
 where piloto_sombra = true
   and array_to_string(cultivos, ',') ilike '%tomate%';

-- ── baseline del goteo (16 L/m² día sí día no, 13-jun → hoy) ─────────
with p as (
  select id from usuarios
   where piloto_sombra = true
     and array_to_string(cultivos, ',') ilike '%tomate%'
   order by fecha_plantacion desc nulls last
   limit 1
),
dias as (
  select d::date as fecha
    from generate_series('2026-06-13'::date, current_date, interval '2 days') as d
)
insert into acciones (usuario_id, fecha_local, tipo, cantidad_l_m2, duracion_min, franja_horaria, motivo, notas)
select p.id, dias.fecha, 'riego',
       round((30.0/60.0 * 32.0)::numeric, 1),   -- 16,0 L/m²
       30, 'manana', 'goteo-auto',
       'pauta fija 30 min · 32 mm/h (6 L/h·m × 160 m ÷ 30 m²; provisional)'
  from p cross join dias
 where not exists (
   select 1 from acciones a
    where a.usuario_id = p.id and a.tipo = 'riego' and a.fecha_local = dias.fecha
 );

-- ── Comprobación ─────────────────────────────────────────────────────
select 'caudal (mm/h)' as dato,
       (select caudal::text from usuarios
         where piloto_sombra=true and array_to_string(cultivos,',') ilike '%tomate%'
         order by fecha_plantacion desc nulls last limit 1) as valor
union all
select 'inicio del reveal',
       (select piloto_inicio::text from usuarios
         where piloto_sombra=true and array_to_string(cultivos,',') ilike '%tomate%'
         order by fecha_plantacion desc nulls last limit 1)
union all
select 'riegos reales cargados',
       (select count(*)::text from acciones
         where tipo='riego' and motivo='goteo-auto'
           and usuario_id=(select id from usuarios
                            where piloto_sombra=true and array_to_string(cultivos,',') ilike '%tomate%'
                            order by fecha_plantacion desc nulls last limit 1));
