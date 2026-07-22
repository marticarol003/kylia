// Test del guard de calidad de Sentinel (pickLatestValid).
//   node tests/test-sentinel-calidad.mjs
// Un paso casi todo tapado por nube deja pocos píxeles válidos → su NDVI es ruido.
// El guard exige un mínimo de píxeles válidos Y una fracción válida alta, y elige
// el paso limpio MÁS RECIENTE (no el último a secas).
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { pickLatestValid, MIN_PIXELES_VALIDOS, MIN_FRACCION_VALIDA } = require("../api/sentinel.js");

let fallos = 0;
function ok(cond, msg) {
  if (cond) { console.log("  ✓", msg); }
  else { console.log("  ✗", msg); fallos++; }
}

// Construye una observación con la forma que devuelve la Statistical API.
function obs(from, ndviMean, sample, nodata) {
  const stats = (mean) => ({ mean, stDev: 0, sampleCount: sample, noDataCount: nodata });
  return {
    interval: { from: `${from}T00:00:00Z` },
    outputs: {
      ndvi: { bands: { B0: { stats: stats(ndviMean) } } },
      ndmi: { bands: { B0: { stats: stats(0.1) } } },
      ndre: { bands: { B0: { stats: stats(0.2) } } },
    },
  };
}

console.log(`Umbrales: ≥${MIN_PIXELES_VALIDOS} píxeles y fracción ≥${MIN_FRACCION_VALIDA}`);

console.log("1) Descarta el paso nublado reciente y coge el limpio anterior:");
const r1 = pickLatestValid({ data: [
  obs("2026-07-20", 0.30, 100, 99),  // reciente pero 1 píxel válido (1%) → RUIDO
  obs("2026-07-15", 0.72,  10,  2),  // 8 válidos (80%) → bueno
] });
ok(r1 && r1.from.startsWith("2026-07-15"), "elige el paso limpio del 15-jul, no el nublado del 20");
ok(r1 && r1.validPixels === 8 && r1.fraccionValida === 0.8, "reporta 8 píxeles válidos, fracción 0,80");

console.log("2) 1 píxel (aunque sea 100% válido) se descarta por el mínimo absoluto:");
ok(pickLatestValid({ data: [obs("2026-07-20", 0.9, 1, 0)] }) === null,
   "sample=1 → por debajo del mínimo de píxeles → null");

console.log("3) Escena entera enmascarada → sin datos (mejor que un número inventado):");
ok(pickLatestValid({ data: [obs("2026-07-20", 0.3, 200, 199), obs("2026-07-14", 0.28, 50, 49)] }) === null,
   "todos los pasos por debajo del umbral → null");

console.log("4) Fracción justo en el límite (0,50) con píxeles suficientes → se acepta:");
const r4 = pickLatestValid({ data: [obs("2026-07-19", 0.5, 4, 2)] }); // valid 2, fracción 0,50
ok(r4 && r4.validPixels === 2 && r4.fraccionValida === 0.5, "valid=2, fracción 0,50 → aceptado");

console.log("5) Sin observaciones → null:");
ok(pickLatestValid({ data: [] }) === null, "data vacío → null");
ok(pickLatestValid({}) === null, "sin data → null");

console.log(fallos === 0 ? "\n✅ TODOS LOS TESTS VERDES" : `\n❌ ${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
