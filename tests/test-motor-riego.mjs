// Tests del motor de riego FAO-56 (api/_motor-riego.js).
// Correr con: node tests/test-motor-riego.mjs
// Cubre los refinamientos de precisión del 10-jul: Zr/p por cultivo (Tabla 22),
// raíz creciente (§8.3) y lluvia efectiva (<2 mm no infiltra), más los
// invariantes de siempre (fallbacks legacy, reproducibilidad del balance).
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const M = require("../api/_motor-riego.js");

let fallos = 0;
function ok(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); }
  else      { console.error(`  ✗ ${msg}`); fallos++; }
}
const approx = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

// Serie sintética: 40 días de verano seco, ET₀ constante 5 mm, sin lluvia.
const serieSeca = Array.from({ length: 40 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10),
  et0: 5, lluvia: 0,
}));
const PLANT = "2026-06-01";

console.log("── zrDelDia: raíz creciente FAO-56 §8.3 ──");
ok(approx(M.zrDelDia("tomate", 0), 0.20), "tomate día 0 → 0.20 m (zr mín al trasplante)");
ok(approx(M.zrDelDia("tomate", 35), 0.45), "tomate día 35 (mitad de ini+des=70) → 0.45 m");
ok(approx(M.zrDelDia("tomate", 100), 0.70), "tomate día 100 → 0.70 m (zr máx, no sigue creciendo)");
ok(approx(M.zrDelDia("lechuga", 100), 0.30), "lechuga madura → 0.30 m (raíz superficial)");
ok(approx(M.zrDelDia("desconocido", 50), M.ZR_M), "cultivo desconocido → fallback ZR_M");
ok(approx(M.zrDelDia("tomate", null), M.ZR_M), "sin días → fallback ZR_M (legacy)");

console.log("── aguaSuelo: TAW/RAW por cultivo y día ──");
const legacy = M.aguaSuelo("franco");
ok(approx(legacy.taw, 45) && approx(legacy.raw, 20.25), "sin cultivo → 45/20.25 mm (comportamiento anterior)");
const tomMax = M.aguaSuelo("franco", "tomate", 100);
ok(approx(tomMax.taw, 105) && approx(tomMax.raw, 42), "tomate maduro franco → TAW 105, RAW 42 (p=0.40)");
const lech = M.aguaSuelo("franco", "lechuga", 100);
ok(approx(lech.taw, 45) && approx(lech.raw, 13.5), "lechuga madura franco → TAW 45, RAW 13.5 (p=0.30)");

console.log("── lluvia efectiva: <2 mm no infiltra ──");
const conLluviaFina  = M.balanceHidrico(serieSeca.map(d => ({ ...d, lluvia: 1.9 })), [], { suelo: "franco", cultivoId: "lechuga", fechaPlantacion: PLANT });
const sinLluvia      = M.balanceHidrico(serieSeca, [], { suelo: "franco", cultivoId: "lechuga", fechaPlantacion: PLANT });
ok(conLluviaFina.Dr === sinLluvia.Dr, "1.9 mm/día se ignora (mismo Dr que sin lluvia)");
ok(conLluviaFina.lluviaAcum === 0, "lluvia fina no acumula como efectiva");
const conLluviaReal = M.balanceHidrico(serieSeca.map(d => ({ ...d, lluvia: 8 })), [], { suelo: "franco", cultivoId: "lechuga", fechaPlantacion: PLANT });
ok(conLluviaReal.Dr < sinLluvia.Dr, "8 mm/día sí reduce el déficit");

console.log("── simularKylia: contrafactual con los refinamientos ──");
const simTom  = M.simularKylia(serieSeca, { suelo: "franco", cultivoId: "tomate",  metodoRiego: "goteo",     fechaPlantacion: PLANT });
const simLech = M.simularKylia(serieSeca, { suelo: "franco", cultivoId: "lechuga", metodoRiego: "aspersion", fechaPlantacion: PLANT });
const nRiegos = (sim) => {
  let n = 0;
  for (let i = 1; i < sim.puntos.length; i++) if (sim.puntos[i].acum_l_m2 > sim.puntos[i-1].acum_l_m2) n++;
  return n + (sim.puntos[0].acum_l_m2 > 0 ? 1 : 0);
};
ok(nRiegos(simLech) > nRiegos(simTom), `lechuga riega más a menudo que tomate (${nRiegos(simLech)} vs ${nRiegos(simTom)} riegos en 40 días secos)`);
ok(simTom.deficitFinal >= 0, `deficitFinal expuesto para el reveal honesto (${simTom.deficitFinal} L/m² en cola)`);
const acumFinal = simTom.puntos[simTom.puntos.length - 1].acum_l_m2;
ok(approx(acumFinal, simTom.total, 0.11), "total coincide con el último punto acumulado");

console.log("── decisión: regla intacta ──");
const bal = M.balanceHidrico(serieSeca.slice(0, 10), [], { suelo: "franco", cultivoId: "lechuga", metodoRiego: "aspersion", fechaPlantacion: PLANT });
const dec = M.decisionRiego(bal);
ok(["alta", "media", "baja"].includes(dec.nivel), `decisionRiego devuelve nivel válido (${dec.nivel}, Dr=${bal.Dr.toFixed(1)} vs RAW=${bal.raw.toFixed(1)})`);

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\nTodos los tests del motor pasan ✓");
