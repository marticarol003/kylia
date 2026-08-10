-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Declarar el ensayo de fertilizantes del bancal · 2026-08-10
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. Es idempotente.
--
-- QUÉ HACE: le dice a /campo que las 33 lechugas llevan un ensayo, para que la
-- tarjeta de abonado reparta la dosis SOLO entre las plantas tratadas y recuerde
-- qué hay que apuntar al cortar. Sin esto, /campo daría la dosis del bancal
-- entero y el "control" acabaría recibiendo media dosis — con lo que el ensayo
-- dejaría de medir nada.
--
-- EL DISEÑO, y por qué es así:
--   · 15 tratadas + 3 de separación + 15 control. La separación no se pesa: a 25
--     cm y con aspersión el nitrógeno migra al vecino, y sin ese colchón los dos
--     brazos se contaminan.
--   · Dos brazos y no tres. Con 33 plantas, tres brazos de 11 solo detectarían
--     diferencias del 35-40%, y la respuesta de la lechuga al N por encima de lo
--     suficiente es plana: saldría "sin diferencia" y no se habría aprendido nada.
--     Con 15 contra 15 se detecta del orden del 20-25%.
--
-- QUÉ VALIDA DE VERDAD, que es más estrecho de lo que parece: el término de
-- OFERTA DEL SUELO, que es el único del motor que sale de un prior de satélite y
-- no de un coeficiente publicado. Las plantas sin abonar solo pueden haber sacado
-- el nitrógeno del suelo, así que su peso lo mide:
--     N que aportó el suelo ≈ kg de lechuga del control × 2,5 kg N/t
-- (2,5 es el coeficiente de extracción de la lechuga, ya validado contra MAPA).
-- Hoy Kylia estima 20 kg N/ha para este bancal; el control dirá si se queda corto.
--
-- ⚠️ ES UNA COTA INFERIOR, no una medida: la planta coge lo que necesita hasta
--    donde haya. Por eso hay que apuntar TAMBIÉN si el control se ve más pequeño
--    o más pálido — es lo único que distingue "al suelo le faltaba" de "le
--    sobraba". Sin ese dato, los pesos solos no lo dicen.
--
-- NO valida la dosis (haría falta un tercer brazo), ni las pérdidas, ni el P y el
-- K. Suelo limpio se toma como supuesto declarado: sin cultivo anterior y sin
-- restos incorporados, que es además lo que el motor asume por defecto.

update usuarios
   set preferencias = coalesce(preferencias, '{}'::jsonb) || jsonb_build_object(
     'ensayo', jsonb_build_object(
       'tipo',             'fertilizante-N',
       'plantas_total',    33,
       'plantas_tratadas', 15,
       'plantas_control',  15,
       'plantas_buffer',   3,
       'aplicaciones',     2,
       'litros_agua',      7.5,
       'desde',            '2026-08-10',
       'nota',             'Solo las 15 marcadas llevan abono. Las 3 del medio no se pesan: hacen de separación para que el nitrógeno no pase de un lado al otro.'
     ))
 where id = 'd5475c3d-365b-47ff-b31e-fa659a8362fb';

-- ── Comprobar ──
select nombre, preferencias->'ensayo' as ensayo
  from usuarios where id = 'd5475c3d-365b-47ff-b31e-fa659a8362fb';
