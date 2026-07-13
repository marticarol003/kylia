// Test del motor de nutrición (pilar fertilizantes).
//   node tests/test-nutricion.mjs
// Verifica que los coeficientes de extracción caen dentro de los rangos de
// guías españolas (agroes.es, peldaño 2) y que el balance de masa cuadra.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { EXTRACCION, necesidadNutrientes } = require("../api/_motor-nutricion.js");

let fallos = 0;
function ok(cond, msg) {
  if (cond) { console.log("  ✓", msg); }
  else { console.log("  ✗", msg); fallos++; }
}
function dentro(x, min, max) { return x >= min && x <= max; }

// Rangos de extracción por tonelada (agroes.es, absorción por producción).
const RANGOS = {
  tomate:  { N: [2.5, 3.5], P2O5: [1.1, 1.5], K2O: [5.0, 5.5] },
  cebolla: { N: [2.1, 2.5], P2O5: [0.9, 1.5], K2O: [3.0, 3.8] },
  lechuga: { N: [2.2, 2.7], P2O5: [0.8, 1.4], K2O: [4.6, 6.0] },
};

console.log("1) Coeficientes dentro de los rangos oficiales:");
for (const [cultivo, r] of Object.entries(RANGOS)) {
  const e = EXTRACCION[cultivo];
  ok(!!e, `existe extracción para ${cultivo}`);
  for (const n of ["N", "P2O5", "K2O"]) {
    ok(dentro(e[n], r[n][0], r[n][1]),
      `${cultivo} ${n}=${e[n]} en [${r[n][0]}, ${r[n][1]}]`);
  }
}

console.log("2) Balance de masa (necesidad = extracción − aporte):");
// Sin analítica: necesidad = extracción bruta.
const a = necesidadNutrientes("tomate", 2); // 2 t
ok(a.disponible && !a.oferta_conocida, "sin suelo → oferta_conocida:false");
ok(a.nutrientes.K2O.necesidad_kg === Math.round(EXTRACCION.tomate.K2O * 2 * 10) / 10,
   `K2O = extracción×rendimiento (${a.nutrientes.K2O.necesidad_kg} kg)`);

// Con analítica: resta el aporte, nunca negativo.
const b = necesidadNutrientes("lechuga", 1, { N: 100, P2O5: 0.3, K2O: 1.0 });
ok(b.oferta_conocida, "con suelo → oferta_conocida:true");
ok(b.nutrientes.N.necesidad_kg === 0, "aporte N enorme → necesidad neta 0 (no negativa)");
ok(b.nutrientes.K2O.necesidad_kg > 0, "K2O sigue con necesidad tras restar aporte");

console.log("3) Cultivo desconocido:");
ok(necesidadNutrientes("mango", 1).disponible === false, "cultivo sin coeficientes → disponible:false");
ok(necesidadNutrientes("tomate", 0).disponible === false, "rendimiento 0 → disponible:false");

console.log(fallos === 0 ? "\n✅ TODOS LOS TESTS VERDES" : `\n❌ ${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
