-- ─────────────────────────────────────────────────────────────────
-- KYLIA · Alta de la ZONA DE CONTROL: lechugas del padre "a su manera" (Sant Boi)
-- ─────────────────────────────────────────────────────────────────
-- Pega este archivo entero en el SQL Editor de Supabase. Es idempotente
-- (usuario por ON CONFLICT); se puede reejecutar sin duplicar.
--
-- QUÉ ES: el grupo de CONTROL del ensayo de lechugas. Plantado a la vez que el
-- bancal de 33 (zona A, Kylia decide) pero lo lleva el PADRE a su manera. Es la
-- otra mitad de la comparación "manejo Kylia vs manejo del agricultor".
-- Ver memoria: project_ensayo_lechugas_kylia_vs_padre.
--
-- GEOMETRÍA (dato del padre, 24-jul-2026):
--   • 7 filas × 78 m de largo, 40 cm entre filas, planta cada 15-20 cm.
--   • Superficie ≈ 7 × 0,40 m × 78 m = 218,4 m² (banda de 2,8 m de ancho).
--   • Nº de lechugas ≈ 2.700–3.600 (~3.100 al centro del rango de marco).
--
-- RIEGO (datos del padre + su técnico, 27/28-jul-2026):
--   • La lechuga NO es una banda aislada con dos líneas en los bordes: está
--     dentro de una MALLA de aspersión que riega toda la pieza. Sección
--     transversal real (cada fila = 40 cm, medida desde el caminito):
--
--       0,4 - 0,8   2 filas de hinojo
--       1,2         ← LÍNEA DE ASPERSORES A (12 aspersores)
--       1,6 - 2,0   2 filas de hinojo
--       2,4 - 4,0   5 filas vacías
--       4,4         ← LÍNEA DE ASPERSORES B (12 aspersores)
--       4,8 - 7,2   LAS 7 FILAS DE LECHUGA  ← zona B del ensayo
--       7,6 - 8,4   3 filas vacías
--       8,8         ← LÍNEA DE ASPERSORES C (12 aspersores)
--
--     → separación entre líneas: A-B = 3,2 m, B-C = 4,4 m (catálogo pide 4 m)
--     → separación dentro de la línea: 78 / 12 = 6,5 m (catálogo pide 5,5 m)
--     → la lechuga cae en la franja B-C, pegada a B (0,4 m) y lejos de C (1,6 m)
--     → microaspersores de CÍRCULO COMPLETO (confirmado por el técnico), o sea
--       cada línea reparte la mitad de su agua a cada lado: la lechuga recibe
--       media línea B + media línea C.
--   • FICHA DEL FABRICANTE: son los MISMOS microaspersores que el campo de
--     440 m² del padre y que el bancal de las 33 → 180 L/h cada uno, montados a
--     1,25 m de altura, área de operación (marco recomendado) 5,5 × 4 m = 22 m².
--     FUENTE: el TÉCNICO de riego del padre (28-jul-2026), no una estimación
--     nuestra. Es un dato de tercero cualificado → citable en el informe.
--   • CAUDAL por la FÓRMULA ESTÁNDAR DE ASPERSIÓN (lámina = caudal del emisor
--     dividido por el marco que le toca cubrir: separación a lo largo de la
--     línea × separación entre líneas):
--
--       lechuga (franja B-C):  180 / (6,5 × 4,4) = 180 / 28,6 = 6,3 mm/h ← BD
--       franja A-B (hinojo):   180 / (6,5 × 3,2) = 8,7 mm/h
--       diseño del fabricante: 180 / (5,5 × 4,0) = 8,2 mm/h
--
--     La franja de la lechuga está un 30% por debajo del diseño porque las
--     líneas están más separadas de lo que pide el catálogo (6,5 vs 5,5 y
--     4,4 vs 4,0). No es un fallo grave: significa que el padre necesita
--     regar MÁS RATO para dar los mismos mm.
--
--   ✔ ESTA FÓRMULA ESTÁ VALIDADA CONTRA MEDICIÓN REAL: aplicada al campo de
--     440 m² del padre (35 aspersores, 12,6 m² por aspersor) da 14,3 mm/h,
--     frente a los 15 mm/h MEDIDOS allí con el truco del vaso (12-jun-2026).
--     Desviación 4,5%. Es el mejor respaldo que tenemos y de paso valida el
--     caudal 15 de la zona A.
--
--   • `caudal` alimenta laminaMostrada → balanceHidrico (FAO-56), que necesita
--     el agua que ENTRA en la zona radicular. Ojo: el motor ya aplica su
--     propia eficiencia (EFIC_RIEGO.aspersion=0,75 en _motor-riego.js) sobre
--     este valor; no descontar dos veces.
--
--   ⚠ HALLAZGO PARA EL REVEAL: la franja B-C mide 4,4 m de ancho pero solo
--     2,8 m son lechuga; los otros 1,6 m son filas VACÍAS. O sea el 36% del
--     agua que cae en esa franja va a tierra desnuda. Más las 5 filas vacías
--     de la franja A-B. Es ineficiencia REAL del manejo del padre y es
--     legítimo contarla, pero hay que decir de dónde sale: no es que riegue
--     mal, es que la malla de aspersión es fija y el cultivo no la llena.
--
--   ✔ CONFIRMADO (28-jul, el padre): las líneas riegan A LA VEZ, no por
--     sectores. Es la condición que necesita la fórmula del marco → los
--     6,3 mm/h se sostienen y cada riego apuntado por duración es directo
--     (no hay que anotar qué línea corrió).
--
--   ⚠ El 6,3 es cálculo, no medida. Confirmarlo con el vaso antes de la
--     cosecha: 3 vasos cruzando las 7 filas (junto a la línea B, en medio, y
--     en la fila 7 que es la más lejos de todo), 1 h, media de los tres. Los
--     riegos de B se apuntan por DURACIÓN → el día que se mida, todas las
--     láminas históricas se recalculan solas (laminaMostrada, api/campo.js).
--
--   ✔ RESPALDADO POR LA MEDIDA DE LA ZONA A (28-jul): el cubo puesto entre los
--     dos aspersores del bancal de las 33 —misma malla, mismos aspersores— dio
--     5,4 mm/h medidos. El 6,3 calculado aquí queda justo por encima y dentro
--     del margen de esa medición (4,6-6,3), así que las dos vías se sostienen.
--     Ver db/caudal-bancal-33-lechugas-2026-07-28.sql.
--
--   ⚠ HISTORIAL DE ESTE NÚMERO (para que nadie lo lea a medias): pasó por
--     15 → 10,4 → 9,9 → 6,3 mm/h. Cada cambio vino de un dato NUEVO del campo
--     (misma ficha de aspersor → 12 por línea y no 12 en total → la malla real
--     de 3 líneas con hinojo y filas vacías), no de cambiar de criterio.
--     El 6,3 es el primero que sale de la fórmula estándar con la geometría
--     real, y el único contrastado contra una medición.
--   • Misma VARIEDAD, mismo terreno (franco, Sant Boi) y misma fecha de
--     trasplante (2026-07-18) que las 33 → comparación pareada en el tiempo.
--
-- REGLAS DEL CONTROL (importante, no romper):
--   • piloto_sombra=false y id PROPIO → Kylia NO decide, NO congela y NO avisa
--     sobre esta zona (el cron aviso-lechugas.js apunta solo al id de las 33).
--     Si Kylia aconsejara aquí, dejaría de ser control (contaminación).
--   • Riego: el padre riega "igual" (aspersión). Caudal 6,3 mm/h = 180 L/h por
--     aspersor sobre el marco real de 6,5 × 4,4 m de la franja de la lechuga
--     (ver bloque RIEGO arriba). Sus riegos se apuntan por DURACIÓN, así la
--     lámina sigue al caudal actual y se recalcula sola si se afina con el
--     vaso (laminaMostrada en api/campo.js).
--   • Abonado: el padre echa NPK pero AÚN NO ha abonado (24-jul). Se registrará
--     cuando lo haga (el usuario avisará), como aplicación motivo='abonado'.
--   • Cosecha: al final se muestrea un TRAMO representativo (no las ~3.100),
--     descartando filas de borde, y se compara por planta / por m² con la zona A.

-- ── 1) Columnas necesarias (idempotentes; ya creadas por altas previas) ──
alter table usuarios add column if not exists suelo            text;
alter table usuarios add column if not exists fecha_plantacion date;
alter table usuarios add column if not exists caudal           numeric;   -- aspersión: mm/h (= L/m²·h)
alter table usuarios add column if not exists area_m2          numeric;
alter table usuarios add column if not exists piloto_sombra    boolean not null default false;

-- ── 2) La parcela de control del padre ───────────────────────────
insert into usuarios (
  id, email, nombre, lat, lon, ciudad,
  cultivos, metodo_riego, suelo, fecha_plantacion,
  area_m2, caudal, tarifa_agua, piloto_sombra, origen
) values (
  'b8e1f2a4-6c3d-4e59-9a7b-2f4c8d1e0a33',
  'lechugas-control-padre@kylia.local',
  'Lechugas control (padre) · aspersión — Sant Boi',
  41.32339, 2.05936, 'Sant Boi de Llobregat',
  '{lechuga}', 'aspersion', 'franco', '2026-07-18',
  218.4, 6.3, null,                     -- 6,3 mm/h = 180 L/h / marco 6,5×4,4 m; pozo propio
  false, 'lechugas-control-padre'
)
on conflict (id) do update set
  lat = excluded.lat, lon = excluded.lon, ciudad = excluded.ciudad,
  cultivos = excluded.cultivos, metodo_riego = excluded.metodo_riego,
  suelo = excluded.suelo, fecha_plantacion = excluded.fecha_plantacion,
  area_m2 = excluded.area_m2, caudal = excluded.caudal,
  piloto_sombra = excluded.piloto_sombra;

-- ── Comprobar ────────────────────────────────────────────────────
--   select id, nombre, ciudad, cultivos, metodo_riego, suelo, area_m2,
--          caudal, piloto_sombra, origen
--     from usuarios where id = 'b8e1f2a4-6c3d-4e59-9a7b-2f4c8d1e0a33';
