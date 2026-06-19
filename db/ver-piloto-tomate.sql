-- ─────────────────────────────────────────────────────────────────
-- KYLIA · "¿Cómo va el piloto silencioso de tomate (Breda)?"
-- ─────────────────────────────────────────────────────────────────
-- Pega este script ENTERO en el SQL Editor de Supabase y ejecútalo.
-- Devuelve 4 bloques. No hace falta saber el UUID: localiza el piloto
-- por el tomate (piloto_sombra=true). Si tuvieras más de un piloto de
-- tomate, cambia las 3 condiciones del WHERE por:  where email = 'xxx'.
--
-- Lectura rápida:
--   • Bloque 1: la ficha del piloto (área 30, caudal 6, piloto_sombra=true).
--   • Bloque 2: cuántos DÍAS ha congelado Kylia su decisión (diario-b).
--               Si sale 0 → el cron no está escribiendo (¿falta DIARIO_B_LIVE=1?).
--   • Bloque 3: los riegos REALES del goteo que has apuntado en /piloto/diario.
--   • Bloque 4: el balance — agua que pediría Kylia vs agua real (el reveal en bruto).
--
-- NOTA: en Postgres un WITH solo vale para UNA consulta, por eso el
--       localizador del piloto se repite en cada bloque.
-- ─────────────────────────────────────────────────────────────────

-- ── BLOQUE 1 · Ficha del piloto ───────────────────────────────────
with p as (
  select * from usuarios
   where piloto_sombra = true
     and array_to_string(cultivos, ',') ilike '%tomate%'
   order by fecha_plantacion desc nulls last
   limit 1
)
select '1·ficha' as bloque, id::text as detalle, email,
       array_to_string(cultivos, ', ') as cultivos, metodo_riego, suelo,
       fecha_plantacion::text as plantado,
       area_m2::text as area_m2, caudal::text as caudal_mmh,
       ciudad
  from p;

-- ── BLOQUE 2 · Decisiones congeladas por Kylia (diario-b) ─────────
-- 1 fila ≈ 1 día. "regaria" = días que Kylia habría regado.
with p as (
  select id from usuarios
   where piloto_sombra = true
     and array_to_string(cultivos, ',') ilike '%tomate%'
   order by fecha_plantacion desc nulls last
   limit 1
)
select '2·kylia-congelado' as bloque,
       count(*)                                   as dias_congelados,
       count(*) filter (where nivel = 'alta')     as dias_regaria,
       round(sum(coalesce(cantidad_l_m2,0))::numeric, 1) as agua_kylia_l_m2,
       min(fecha)::date::text                     as desde,
       max(fecha)::date::text                     as hasta
  from recomendaciones_log
 where usuario_id = (select id from p)
   and tipo = 'riego';

-- ── BLOQUE 3 · Riegos REALES del goteo (lo que apuntas en el diario) ──
with p as (
  select id from usuarios
   where piloto_sombra = true
     and array_to_string(cultivos, ',') ilike '%tomate%'
   order by fecha_plantacion desc nulls last
   limit 1
)
select '3·riego-real' as bloque,
       fecha_local::text as fecha,
       duracion_min,
       round(coalesce(cantidad_l_m2,0)::numeric, 1) as l_m2
  from acciones
 where usuario_id = (select id from p)
   and tipo = 'riego'
 order by fecha_local;

-- ── BLOQUE 4 · Balance agua: Kylia vs real (el reveal en bruto) ───
with p as (
  select id from usuarios
   where piloto_sombra = true
     and array_to_string(cultivos, ',') ilike '%tomate%'
   order by fecha_plantacion desc nulls last
   limit 1
)
select '4·balance' as bloque,
       round((select sum(coalesce(cantidad_l_m2,0))
                from recomendaciones_log
               where usuario_id = (select id from p) and tipo='riego')::numeric, 1) as agua_kylia_l_m2,
       round((select sum(coalesce(cantidad_l_m2,0))
                from acciones
               where usuario_id = (select id from p) and tipo='riego')::numeric, 1) as agua_real_l_m2;
