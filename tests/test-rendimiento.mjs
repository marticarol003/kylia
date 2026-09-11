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
// LA PUERTA LA ABRE LA FENOLOGÍA, no un umbral de NDVI. Hasta el 11-sep-2026 la
// regla era "por debajo de NDVI 0,40 no se ajusta", y eso producía un ESCALÓN
// del 40% entre 0,39 y 0,40 y, peor, una función NO MONÓTONA: un tomate con
// NDVI 0,39 rendía 2,64 t y uno con 0,50 rendía 1,66. Como el rendimiento
// multiplica todo el plan de abonado, ese salto movía los kilos de nitrógeno.
// La pregunta "¿tiene canopy?" no la contesta el índice, la contesta la fase.
ok(factorVigor(0.80, "media").factor === 1 && factorVigor(0.80, "media").aplicado,
   "NDVI 0,80 (sano) en fase media → factor 1,0");
ok(factorVigor(0.95, "final").factor === 1.15, "NDVI alto se ACOTA a 1,15 (no dispara)");
ok(factorVigor(0.40, "media").factor === 0.6, "NDVI 0,40 → se acota a 0,60");
ok(factorVigor(0.60, "media").factor === 0.75, "NDVI 0,60 → 0,75 (por debajo de sano)");
ok(factorVigor(0.80, "inicial").aplicado === false,
   "en fase INICIAL no se ajusta: ahí el NDVI mide tamaño, no rinde");
ok(factorVigor(0.80, "desarrollo").aplicado === false, "ni en desarrollo");
ok(factorVigor(0.80).aplicado === false, "y sin fase conocida tampoco: no se penaliza a ciegas");
ok(factorVigor(null, "media").aplicado === false, "NDVI ausente → no aplicado");
for (const malo of [5, -2, "verde", NaN, "", 1.5])
  ok(factorVigor(malo, "media").aplicado === false,
     `NDVI ${JSON.stringify(malo)} es imposible → no se aplica`);

console.log("   invariante: monótona y sin escalones");
// El fallo original se ve en una línea: si la función no crece con el NDVI, hay
// un cultivo más verde rindiendo menos que uno menos verde.
let prev = -1, monotona = true, saltoMax = 0;
for (let i = 0; i <= 100; i++) {
  const t = rendimientoEsperadoT("tomate", 440, { ndvi: i / 100, fase: "media" }).rendimiento_t;
  if (t < prev - 1e-9) monotona = false;
  if (prev >= 0) saltoMax = Math.max(saltoMax, Math.abs(t - prev) / Math.max(prev, 1e-9));
  prev = t;
}
ok(monotona, "más NDVI nunca da menos rendimiento");
ok(saltoMax < 0.05, `y no hay escalones: el mayor salto entre centésimas es ${(saltoMax * 100).toFixed(1)}%`);

console.log("3) Rendimiento con NDVI aplicado:");
const b = rendimientoEsperadoT("lechuga", 10000, { ndvi: 0.60, fase: "media" }); // factor 0,75
ok(b.vigor_aplicado && b.factor_vigor === 0.75, "vigor aplicado, factor 0,75");
ok(b.rendimiento_t === r3(RINDE_REF_T_HA.lechuga * 0.75), `lechuga 1 ha × 0,75 = ${b.rendimiento_t} t`);
ok(b.base_t === RINDE_REF_T_HA.lechuga, "base_t = rinde de referencia sin vigor (trazabilidad)");

console.log("4) Casos límite:");
ok(rendimientoEsperadoT("mango", 10000).disponible === false, "cultivo sin rinde de referencia → disponible:false");
ok(rendimientoEsperadoT("tomate", 0).disponible === false, "área 0 → disponible:false");
ok(rendimientoEsperadoT("tomate", 2.6, { ndvi: 0.8, fase: "media" }).rendimiento_t > 0,
   "parcela minúscula (2,6 m²) sigue dando rendimiento > 0");
// El rendimiento multiplica TODO el plan de abonado: cien hectáreas en una app
// de huerta son un error de unidad, no una finca.
ok(rendimientoEsperadoT("tomate", 1.1e6).disponible === false,
   "110 ha → no se da plan: revisa la unidad");
ok(rendimientoEsperadoT("tomate", 1e6).disponible === true, "y 100 ha justas sí pasan");
for (const a of [-440, NaN, Infinity, null, "mucho"])
  ok(rendimientoEsperadoT("tomate", a).disponible === false, `área ${JSON.stringify(a)} → sin plan`);

console.log(fallos === 0 ? "\n✅ TODOS LOS TESTS VERDES" : `\n❌ ${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
