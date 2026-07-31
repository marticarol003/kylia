// ─────────────────────────────────────────────────────────────────
// ¿A esta parcela le aplica el satélite? — criterio ÚNICO
// ─────────────────────────────────────────────────────────────────
// Una zona se puede definir a cualquier tamaño: el cuaderno, el cultivo, el
// riego y la PAC funcionan igual con 300 m² que con 3 ha. Lo que NO funciona a
// cualquier tamaño es Sentinel-2, y hasta ahora eso no se decía en ninguna
// parte: se pedía la medida igual y salía un número de píxeles mezclados.
//
// EL PROBLEMA DEL BORDE. Sentinel-2 no corta limpio en el límite de la parcela:
// la señal de un píxel se contamina con la de sus vecinos. Un píxel pegado al
// lindero lleva dentro el camino, el seto o el cultivo de al lado. Lo estándar
// es descartar una franja de 10-20 m hacia dentro y medir solo el interior.
//
// LAS CUENTAS, con buffer de 10 m:
//
//   0,25 ha (50×50 m) → interior 30×30 m →  9 píxeles de 10 m ·  ~2 de 20 m
//   0,50 ha (70×70 m) → interior 50×50 m → 25 píxeles de 10 m ·  ~6 de 20 m
//
// El NDVI va a 10 m (B04/B08), pero el NDMI (B11) y el NDRE/CIre (B05) son
// nativos a 20 m — y el red-edge es justo el del NITRÓGENO, medio motivo de
// mirar el satélite. Con 0,25 ha quedan ~2 píxeles de 20 m, que es exactamente
// MIN_PIXELES_VALIDOS: cero margen, cualquier nube deja la zona sin dato.
// Por eso el corte está en 0,5 ha y no en 0,25.
//
// LA SUPERFICIE NO BASTA. Una hectárea en franja de 10 × 1000 m tiene 1 ha y
// ni un solo píxel interior. Por eso esto es solo un PREFILTRO barato para
// pintar el mapa y avisar al agricultor; el juez final sigue siendo el guard de
// píxeles de sentinel.js, que cuenta lo que de verdad sobrevive a la máscara.
//
// Medido sobre SIGPAC real (Palafolls, 31-jul): de 83 recintos agrícolas en un
// tile, solo 22 llegan a 0,5 ha. O sea que la mayoría de zonas van a ir con
// modelo y sin satélite, y eso hay que decirlo en pantalla, no esconderlo.

const SUP_MIN_SATELITE_M2 = 5000;    // 0,5 ha
const BUFFER_BORDE_M      = 10;      // franja que se descarta en cada lindero

// Superficie utilizable, o null si no la hay. Ojo con el atajo `Number(x)`:
// Number(null) y Number("") valen 0, que es finito, así que "no sé la
// superficie" se colaba como "mide 0 m²" y el aviso salía como
// "Pequeña para el satélite (0 m²)" en vez de decir que falta el dato.
function supValida(superficieM2) {
  if (superficieM2 === null || superficieM2 === undefined || superficieM2 === "") return null;
  const s = Number(superficieM2);
  return Number.isFinite(s) && s >= 0 ? s : null;
}

// Prefiltro por superficie. `true` = merece la pena pedirle imagen; `false` =
// va con modelo. Sin superficie conocida devuelve false: no se promete lo que
// no se puede sostener.
function aplicaSatelite(superficieM2) {
  const s = supValida(superficieM2);
  return s !== null && s >= SUP_MIN_SATELITE_M2;
}

// Motivo legible para enseñárselo al agricultor tal cual. null si sí aplica.
function motivoSinSatelite(superficieM2) {
  const s = supValida(superficieM2);
  if (s === null)               return "Sin superficie conocida: no se puede saber si el satélite la ve.";
  if (s >= SUP_MIN_SATELITE_M2) return null;
  return `Pequeña para el satélite (${Math.round(s)} m²; hacen falta ${SUP_MIN_SATELITE_M2}). `
       + "El riego y el abonado se calculan igual, con el modelo.";
}

module.exports = { SUP_MIN_SATELITE_M2, BUFFER_BORDE_M, aplicaSatelite, motivoSinSatelite };
