-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Limpieza de filas de PRUEBA (2026-07-08)
-- ─────────────────────────────────────────────────────────────────
-- Pendiente de la sesión del 3-jul: borrar las altas de prueba
-- (solformacion, solfotmacion, verif@kylia.local) y la fila de
-- verificación del fix del 8-jun (origen='verif-fix').
-- Las tablas hijas tienen ON DELETE CASCADE: basta borrar `usuarios`.
--
-- SE QUEDAN (NO tocar):
--   • b1f7c2d9…  → tomate "tomacó" Ferran, Breda (piloto real)
--   • a7f3c9e1…  → cebolla El Tros de l'Uri (piloto real)
--   • 23567ff1…  → campo del padre 440 m² aspersión (piloto real)
--   • 9aaa1b25…  → 10 lechugas del padre (fuera del panel, se queda)
--   • c46e9d6d…  → prueba del usuario (lechuga Barcelona) — dijo DEJARLA

-- ── 1) COMPROBAR qué se va a borrar (ejecuta solo este SELECT) ──
select id, email, nombre, ciudad, origen, piloto_sombra, fecha_alta::date,
       (select count(*) from acciones a where a.usuario_id = u.id) as acciones
  from usuarios u
 where (   email ilike '%solformacion%' or nombre ilike '%solformacion%'
        or email ilike '%solfotmacion%' or nombre ilike '%solfotmacion%'
        or email = 'verif@kylia.local'
        or origen = 'verif-fix')
   and coalesce(piloto_sombra, false) = false
   and left(id::text, 8) not in ('b1f7c2d9','a7f3c9e1','23567ff1','9aaa1b25','c46e9d6d');

-- ── 2) BORRAR (cuando el SELECT muestre SOLO filas de prueba) ──
delete from usuarios u
 where (   email ilike '%solformacion%' or nombre ilike '%solformacion%'
        or email ilike '%solfotmacion%' or nombre ilike '%solfotmacion%'
        or email = 'verif@kylia.local'
        or origen = 'verif-fix')
   and coalesce(piloto_sombra, false) = false
   and left(id::text, 8) not in ('b1f7c2d9','a7f3c9e1','23567ff1','9aaa1b25','c46e9d6d');

-- ── 2b) De paso: la etiqueta del campo del padre decía "500 m²"
--        (el área real ya está en 440 desde el 12-jun) ──
update usuarios
   set nombre = replace(nombre, '500 m²', '440 m²')
 where left(id::text, 8) = '23567ff1' and nombre like '%500 m²%';

-- ── 3) Verificar lo que queda ──
select left(id::text, 8) as id, email, ciudad, cultivos, piloto_sombra, fecha_alta::date
  from usuarios
 order by fecha_alta;
-- Esperado: b1f7c2d9 (tomate), a7f3c9e1 (cebolla), 23567ff1 (padre 440),
--           9aaa1b25 (10 lechugas), c46e9d6d (prueba del usuario). Nada más.
