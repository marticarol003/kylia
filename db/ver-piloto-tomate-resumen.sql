-- KYLIA · Resumen del piloto de tomate (Breda) en UNA sola tabla.
-- Pega y ejecuta: una sola fila con todo. (El otro script, ver-piloto-tomate.sql,
-- da el detalle riego a riego pero hay que correrlo bloque a bloque en Supabase.)
with p as (
  select id, email from usuarios
   where piloto_sombra = true
     and array_to_string(cultivos, ',') ilike '%tomate%'
   order by fecha_plantacion desc nulls last
   limit 1
)
select
  (select email from p)                                                          as piloto,
  (select count(*) from recomendaciones_log
     where usuario_id = (select id from p) and tipo='riego')                      as dias_congelados,
  (select count(*) from recomendaciones_log
     where usuario_id = (select id from p) and tipo='riego' and nivel='alta')     as dias_kylia_regaria,
  (select round(sum(coalesce(cantidad_l_m2,0))::numeric,1) from recomendaciones_log
     where usuario_id = (select id from p) and tipo='riego')                      as agua_kylia_l_m2,
  (select count(*) from acciones
     where usuario_id = (select id from p) and tipo='riego')                      as n_riegos_reales,
  (select round(sum(coalesce(cantidad_l_m2,0))::numeric,1) from acciones
     where usuario_id = (select id from p) and tipo='riego')                      as agua_real_l_m2;
