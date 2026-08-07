-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Caché de "qué fertilizante comprar" · 2026-08-07
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. Es idempotente.
--
-- QUÉ ES: el motor de nutrición ya dice cuántos GRAMOS de N/P/K hacen falta y
-- cuándo. Lo que faltaba es el salto a la acción: QUÉ producto comprar, a qué
-- precio y cuánto pesar de él. Eso no cabe en una tabla cableada —los precios se
-- mueven, los envases cambian y en ecológico el catálogo es otro—, así que
-- `/api/ia?tipo=producto-fertilizante` lo busca en la web en el momento
-- (Claude + web search) con el contexto agronómico de la parcela delante.
--
-- POR QUÉ SE CACHEA, si la gracia era que fuese en vivo: porque cada consulta
-- CUESTA (web search se factura a $10 / 1.000 búsquedas, más los tokens de lo
-- que se lea) y TARDA (bastante más que los 10 s por defecto de Vercel; por eso
-- vercel.json sube api/ia.js a maxDuration 60). Repetir la misma búsqueda en
-- cada pintado de pantalla sería pagar dos veces por la misma respuesta. La
-- clave de caché incluye la necesidad calculada (nutriente, gramos, momento,
-- cultivo, manejo, método de riego): mientras el plan no cambie, no se vuelve a
-- buscar; en cuanto cambie, se busca solo. "Tiempo real" es que el dato sale de
-- una búsqueda viva, no que se repita la búsqueda por gusto.
--
-- Forma del jsonb guardado:
--   { clave, consultado (fecha), necesidad {…},
--     recomendado { producto, pct_nutriente, envase, precio_eur,
--                   eur_kg_nutriente, producto_necesario_g, certificado_eco,
--                   url, por_que },
--     alternativas[], descartados[], como_aplicarlo, avisos[],
--     fuentes[], citas[], busquedas, modelo }
--
-- ⚠️ Los precios son ORIENTATIVOS y con fecha: el campo `consultado` dice de
--    cuándo son. La app debe enseñar esa fecha junto al precio, y la URL de la
--    ficha, para que el agricultor pueda comprobarlo antes de comprar.

alter table usuarios add column if not exists producto_fert jsonb;

comment on column usuarios.producto_fert is
  'Caché de la recomendación de compra de fertilizante (búsqueda en vivo vía /api/ia?tipo=producto-fertilizante). Incluye `clave` (la necesidad que la generó) y `consultado` (fecha de los precios). Se invalida sola al cambiar el plan.';

-- ── Vaciar la caché (tras cambiar el prompt o el criterio de elección) ──
-- El JSON guardado se generó con las reglas del prompt de ese día; si esas
-- reglas cambian, lo viejo ya no representa lo que Kylia recomendaría hoy.
--   update usuarios set producto_fert = null;

-- ── Comprobar ──
select nombre,
       producto_fert->>'consultado'                    as precios_de,
       producto_fert->'recomendado'->>'producto'       as producto,
       producto_fert->'recomendado'->>'eur_kg_nutriente' as eur_kg_nutriente,
       producto_fert->>'busquedas'                     as busquedas_web
  from usuarios
 where producto_fert is not null
 order by nombre;
