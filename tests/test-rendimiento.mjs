// Test del estimador de rendimiento (pilar fertilizantes).
//   node tests/test-rendimiento.mjs
// Verifica el rinde de referencia escalado por área y el factor de vigor NDVI
// (relativo, acotado, solo con canopy). El onboarding manda fuera de este módulo.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { RINDE_REF_T_HA, rendimientoEsperadoT, factorVigor } = require("../api/_rendimiento.js");

let fallos = 0;
function ok(cond, msg) {
  if (cond) { console.log("  ✓", msg); }
  else { console.log("  ✗", msg); fallos++; }
}
function r3(x) { return Math.round((Number(x) || 0) * 1000) / 1000; }

console.log("1) Rinde de referencia escalado por área (sin NDVI → factor 1):");
const a = rendimientoEsperadoT("tomate", 10000); // 1 ha exacta
ok(a.disponible, "disponible");
ok(a.rendimiento_t === RINDE_REF_T_HA.tomate, `tomate 1 ha = ${RINDE_REF_T_HA.tomate} t (rinde ref)`);
ok(a.vigor_aplicado === false && a.factor_vigor === 1, "sin NDVI → sin ajuste de vigor");

const media = rendimientoEsperadoT("tomate", 5000); // 0,5 ha
ok(media.rendimiento_t === r3(RINDE_REF_T_HA.tomate / 2), `escala con el área (${media.rendimiento_t} t en 0,5 ha)`);

console.log("2) Factor de vigor NDVI (relativo, acotado, ancla 0,80 → 1,0):");
ok(factorVigor(0.80).factor === 1 && factorVigor(0.80).aplicado, "NDVI 0,80 (sano) → factor 1,0");
ok(factorVigor(0.95).factor === 1.15, "NDVI alto se ACOTA a 1,15 (no dispara)");
ok(factorVigor(0.40).factor === 0.6, "NDVI 0,40 (canopy mínimo) → se acota a 0,60");
ok(factorVigor(0.60).factor === 0.75, "NDVI 0,60 → 0,75 (por debajo de sano)");
ok(factorVigor(0.35).aplicado === false && factorVigor(0.35).factor === 1,
   "NDVI < 0,40 (cultivo joven / sin canopy) → NO se ajusta (factor 1)");
ok(factorVigor(null).aplicado === false, "NDVI ausente → no aplicado");

console.log("3) Rendimiento con NDVI aplicado:");
const b = rendimientoEsperadoT("lechuga", 10000, { ndvi: 0.60 }); // factor 0,75
ok(b.vigor_aplicado && b.factor_vigor === 0.75, "vigor aplicado, factor 0,75");
ok(b.rendimiento_t === r3(RINDE_REF_T_HA.lechuga * 0.75), `lechuga 1 ha × 0,75 = ${b.rendimiento_t} t`);
ok(b.base_t === RINDE_REF_T_HA.lechuga, "base_t = rinde de referencia sin vigor (trazabilidad)");

console.log("4) Casos límite:");
ok(rendimientoEsperadoT("mango", 10000).disponible === false, "cultivo sin rinde de referencia → disponible:false");
ok(rendimientoEsperadoT("tomate", 0).disponible === false, "área 0 → disponible:false");
ok(rendimientoEsperadoT("tomate", 2.6, { ndvi: 0.8 }).rendimiento_t > 0,
   "parcela minúscula (2,6 m²) sigue dando rendimiento > 0");

console.log(fallos === 0 ? "\n✅ TODOS LOS TESTS VERDES" : `\n❌ ${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
