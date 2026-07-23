// Test del motor de cuaderno de fertilización (€ + plan de abonado).
//   node tests/test-cuaderno-fert.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { necesidadNutrientes } = require("../api/_motor-nutricion.js");
const { cuadernoFertilizacion, PRECIO_REF_EUR_KG } = require("../api/_motor-cuaderno-fert.js");

let fallos = 0;
function ok(cond, msg) {
  if (cond) console.log("  ✓", msg);
  else { console.log("  ✗", msg); fallos++; }
}

console.log("1) Cuaderno con precios de referencia (tomate 2 t, sin analítica):");
const nec = necesidadNutrientes("tomate", 2);              // N 6,0 · P2O5 2,6 · K2O 10,4 kg
const cua = cuadernoFertilizacion(nec, { superficie_m2: 1000 });
ok(cua.disponible, "disponible");
ok(cua.precios_referencia === true, "usa precios de referencia");
ok(cua.oferta_conocida === false, "hereda oferta_conocida:false");
ok(cua.lineas.length === 3, "3 líneas (N, P2O5, K2O)");
const lN = cua.lineas.find(l => l.nutriente === "N");
ok(lN.coste_eur === Math.round(lN.necesidad_kg * PRECIO_REF_EUR_KG.N * 100) / 100,
   `coste N = kg × precio (${lN.coste_eur} €)`);
const sumaLineas = Math.round(cua.lineas.reduce((s, l) => s + l.coste_eur, 0) * 100) / 100;
ok(cua.coste_total_eur === sumaLineas, `coste total = suma de líneas (${cua.coste_total_eur} €)`);

console.log("2) Precios propios del agricultor sobrescriben la referencia:");
const cua2 = cuadernoFertilizacion(nec, { precios: { N: 2, P2O5: 2, K2O: 2 } });
ok(cua2.precios_referencia === false, "marca que NO son de referencia");
const lN2 = cua2.lineas.find(l => l.nutriente === "N");
ok(lN2.coste_eur === Math.round(lN2.necesidad_kg * 2 * 100) / 100, "usa el precio propio");

console.log("3) Con analítica, la necesidad neta baja el coste:");
const necSuelo = necesidadNutrientes("tomate", 2, { N: 3, P2O5: 1, K2O: 2 });
const cuaSuelo = cuadernoFertilizacion(necSuelo);
ok(cuaSuelo.oferta_conocida === true, "oferta_conocida:true");
ok(cuaSuelo.coste_total_eur < cua.coste_total_eur, "coste con analítica < sin analítica");

console.log("4) Sin necesidad válida:");
ok(cuadernoFertilizacion(necesidadNutrientes("mango", 1)).disponible === false,
   "cultivo desconocido → disponible:false");
ok(cuadernoFertilizacion(null).disponible === false, "necesidad null → disponible:false");

console.log("5) Fraccionamiento fondo/cobertera (riego tradicional, MAPA):");
// necesidad con área para que haya kg de N > 0 en todos.
const necTrad = necesidadNutrientes("tomate", 2, null, { area_m2: 10000 });
const cuaTrad = cuadernoFertilizacion(necTrad, { metodo_riego: "aspersion" });
ok(cuaTrad.fraccionamiento.modelo === "fondo_cobertera", "aspersión → modelo fondo_cobertera");
const nTrad = cuaTrad.lineas.find(l => l.nutriente === "N");
ok(nTrad.reparto.length === 2, "N se reparte en fondo + cobertera");
ok(nTrad.reparto[0].pct === 30 && nTrad.reparto[1].pct === 70, "N 30% fondo / 70% cobertera");
ok(Math.abs(nTrad.reparto[0].kg + nTrad.reparto[1].kg - nTrad.necesidad_kg) < 0.05,
   "los tramos de N suman la necesidad");
const pTrad = cuaTrad.lineas.find(l => l.nutriente === "P2O5");
ok(pTrad.reparto.length === 1 && pTrad.reparto[0].pct === 100, "P₂O₅ 100% en fondo");

console.log("6) Fraccionamiento en tercios (fertirrigación / goteo, MAPA):");
const cuaGoteo = cuadernoFertilizacion(necTrad, { metodo_riego: "goteo" });
ok(cuaGoteo.fraccionamiento.modelo === "fertirrigacion_tercios", "goteo → modelo tercios");
const nGoteo = cuaGoteo.lineas.find(l => l.nutriente === "N");
ok(nGoteo.reparto.length === 3, "N en 3 tercios del ciclo");
ok(nGoteo.reparto.map(t => t.pct).join("/") === "25/55/20", "tercios 25/55/20");
const kGoteo = cuaGoteo.lineas.find(l => l.nutriente === "K2O");
ok(kGoteo.reparto.length === 3, "en goteo P y K también van fraccionados (no 100% fondo)");

console.log(fallos === 0 ? "\n✅ TODOS LOS TESTS VERDES" : `\n❌ ${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
