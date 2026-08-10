-- ─────────────────────────────────────────────────────────────────
-- KYLIA · El ensayo del bancal es A vs B, no una partición · 2026-08-10
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. Es idempotente.
--
-- CORRIGE una versión anterior de este mismo fichero que declaraba un ensayo
-- PARTIDO (15 tratadas + 3 de separación + 15 control sin nitrógeno). Ese diseño
-- estaba mal por dos motivos:
--
--   1. Contradice la decisión del consejo del 2026-07-24, unánime: comparar el
--      MANEJO COMPLETO (riego + abonado juntos) contra la zona B del padre, sin
--      aislar el fertilizante. En lechuga el N y el agua van físicamente de la
--      mano, y 33 plantas contiguas son UNA unidad experimental, no dos.
--   2. No aguanta su propia aritmética: la definición del bancal manda descartar
--      las ~2 primeras y ~2 últimas de cada fila (≈8 de las 33) porque reciben
--      media ración de agua. Partiendo en dos quedarían ~11-12 plantas por brazo,
--      no 15.
--
-- QUÉ QUEDA DECLARADO: el ensayo real. Las 33 llevan la dosis de Kylia y se
-- comparan con la zona B (218,4 m², ~3.100 lechugas, misma variedad, mismo suelo
-- y misma fecha de trasplante), que el padre lleva a su manera.
--
-- ⚠️ ESTO NO VALIDA EL MOTOR DE FERTILIZANTES, y no debe presentarse así. Sin un
--    control sin nitrógeno no hay forma de saber cuánto puso el suelo, y la zona
--    B no sirve de control porque el padre le echa NPK y difiere en todo lo demás.
--    Es un VISTAZO DE CAMPO lado a lado del manejo completo. La palabra
--    "validado" se reserva para el agua y FAO-56.
--
-- ⚠️ Y RECUERDA que el agua de A y B salió LA MISMA (38,9 vs 41,0 mm) al corregir
--    el caudal: lo que se compara aquí es sobre todo el abonado y el criterio,
--    no el ahorro de agua.

update usuarios
   set preferencias = coalesce(preferencias, '{}'::jsonb) || jsonb_build_object(
     'ensayo', jsonb_build_object(
       'tipo',            'manejo-completo',
       'comparacion',     'zona B del padre (218,4 m², misma variedad, mismo suelo, mismo trasplante)',
       'plantas_total',   33,
       'plantas_borde',   8,
       'aplicaciones',    2,
       'litros_agua',     16.5,
       'desde',           '2026-08-10',
       'nota',            'Las 33 llevan la dosis de Kylia. Lo que se compara es el manejo completo contra las lechugas que tu padre lleva a su manera.',
       'apuntar',         'Al cortar: kg totales y nº de piezas, peso por pieza, y foto fechada de las hojas (clorosis = falta de N; borde quemado = riego irregular). Descarta las ~2 primeras y ~2 últimas de cada fila: reciben media ración de agua. El mismo criterio hay que aplicarlo en la zona B.'
     ))
 where id = 'd5475c3d-365b-47ff-b31e-fa659a8362fb';

-- ── Comprobar ──
select nombre, preferencias->'ensayo' as ensayo
  from usuarios where id = 'd5475c3d-365b-47ff-b31e-fa659a8362fb';
