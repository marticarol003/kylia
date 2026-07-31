// Criterio de "¿a esta zona le aplica el satélite?" (api/_satelite.js).
//   node tests/test-satelite-umbral.mjs
//
// Una zona se define a cualquier tamaño (el cuaderno, el riego y el abonado
// funcionan igual con 300 m² que con 3 ha). Sentinel-2 no. El corte está en
// 0,5 ha y no en 0,25 por el buffer de borde: descartando 10 m en cada lindero,
// 0,25 ha deja ~2 píxeles de 20 m — exactamente MIN_PIXELES_VALIDOS, sin margen
// para una nube. Y 20 m es la resolución nativa de B05 (red-edge), el del
// NITRÓGENO. Ver el razonamiento completo en api/_satelite.js.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { SUP_MIN_SATELITE_M2, BUFFER_BORDE_M, aplicaSatelite, motivoSinSatelite } = require("../api/_satelite.js");
const { MIN_PIXELES_VALIDOS } = require("../api/sentinel.js");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

console.log(`Umbral: ${SUP_MIN_SATELITE_M2} m² (0,5 ha) · buffer de borde ${BUFFER_BORDE_M} m`);

console.log("── el corte ──");
ok(aplicaSatelite(5000)  === true,  "5.000 m² justo en el umbral → sí aplica");
ok(aplicaSatelite(4999)  === false, "4.999 m² → no aplica");
ok(aplicaSatelite(20000) === true,  "2 ha → sí aplica");
ok(aplicaSatelite(440)   === false, "el campo del padre (440 m²) → no aplica");
ok(aplicaSatelite(5)     === false, "el bancal de las 33 (5 m²) → no aplica");

console.log("── sin dato no se promete nada ──");
ok(aplicaSatelite(null)      === false, "superficie null → no aplica");
ok(aplicaSatelite(undefined) === false, "sin superficie → no aplica");
ok(aplicaSatelite("hola")    === false, "basura → no aplica");
ok(aplicaSatelite(NaN)       === false, "NaN → no aplica");

console.log("── el motivo se le puede enseñar tal cual al agricultor ──");
ok(motivoSinSatelite(20000) === null, "si aplica, no hay motivo que dar");
const m = motivoSinSatelite(440);
ok(typeof m === "string" && m.includes("440"),  "el motivo dice la superficie real");
ok(m.includes(String(SUP_MIN_SATELITE_M2)),     "y cuánta hace falta");
ok(/riego y el abonado se calculan igual/.test(m),
   "y deja claro que NO se queda sin riego ni sin abonado");
ok(/Sin superficie conocida/.test(motivoSinSatelite(null)), "null → motivo propio, NO 'mide 0 m²'");
ok(/Sin superficie conocida/.test(motivoSinSatelite("")),   "cadena vacía → lo mismo (Number('') es 0, ojo)");
ok(/Sin superficie conocida/.test(motivoSinSatelite(undefined)), "undefined → lo mismo");

console.log("── coherencia con el guard de píxeles ──");
// Con buffer de 10 m por lindero, el lado útil de una parcela cuadrada es
// (lado − 2×buffer). Píxeles de 20 m que caben en ese interior.
const pixeles20 = (supM2) => {
  const lado = Math.sqrt(supM2);
  const util = lado - 2 * BUFFER_BORDE_M;
  return util > 0 ? Math.floor((util / 20) ** 2) : 0;
};
// ESTA es la razón de que el corte esté en 0,5 ha y no en 0,25: media hectárea
// deja margen sobre el guard, un cuarto se queda JUSTO en el mínimo — y ahí una
// sola nube sobre un píxel tira la observación entera.
ok(pixeles20(2500) === MIN_PIXELES_VALIDOS,
   `0,25 ha (50×50) → ${pixeles20(2500)} píxeles de 20 m = el mínimo exacto, sin margen`);
ok(pixeles20(SUP_MIN_SATELITE_M2) > MIN_PIXELES_VALIDOS,
   `0,5 ha → ${pixeles20(SUP_MIN_SATELITE_M2)} píxeles de 20 m, holgado sobre el mínimo de ${MIN_PIXELES_VALIDOS}`);
ok(pixeles20(10000) > pixeles20(SUP_MIN_SATELITE_M2), "1 ha da más margen todavía");

console.log("── la superficie es solo un PREFILTRO, no el juez ──");
// Una hectárea en franja no tiene interior: el guard de píxeles de sentinel.js
// sigue siendo el que manda cuando llega la imagen de verdad.
const franja = { largo: 1000, ancho: 10 };
ok(aplicaSatelite(franja.largo * franja.ancho) === true,
   "una franja de 10×1000 m PASA el prefiltro (tiene 1 ha)...");
ok(franja.ancho - 2 * BUFFER_BORDE_M <= 0,
   "...pero con 10 m de buffer por lado no le queda ni un metro de interior → lo caza el guard de píxeles, no esto");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
