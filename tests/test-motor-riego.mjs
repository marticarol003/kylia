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

console.log("── laminaRiego: la duración manda sobre la lámina congelada ──");
ok(M.laminaRiego(45, 180, 5.4) === 16.2, "180 min a 5,4 mm/h → 16,2 L/m² (ignora el 45 guardado con el caudal viejo)");
ok(M.laminaRiego(45, 180, 15) === 45,    "el mismo riego a 15 mm/h → 45 L/m² (así se guardó en su día)");
ok(M.laminaRiego(20, null, 5.4) === 20,  "sin duración (cubos/regadera) → la lámina guardada tal cual");
ok(M.laminaRiego(20, 60, null) === 20,   "sin caudal → la lámina guardada tal cual");
ok(M.laminaRiego(20, 60, 0) === 20,      "caudal 0 no divide ni multiplica por cero: lámina guardada");
ok(M.laminaRiego(null, null, 5.4) === null, "sin nada que aplicar → null (el balance lo lee como recarga completa)");
ok(M.laminaRiego(45, 180, "5.4") === 16.2, "caudal como texto (PostgREST numeric) también cuenta");
// El bug de 28-jul: cambiar el caudal del piloto tiene que mover el BALANCE, no
// solo la lista de riegos. Con la lámina congelada el déficit no se enteraba.
// (ventana corta a propósito: en una serie larga los dos déficits saturan en TAW
// y la diferencia se perdería)
const riegosDur = [["2026-06-05", 180], ["2026-06-07", 60]];
const balPorCaudal = (caudal) => M.balanceHidrico(
  serieSeca.slice(0, 10),
  riegosDur.map(([date, min]) => ({ date, litros: M.laminaRiego(999, min, caudal) })),
  { suelo: "franco", cultivoId: "lechuga", metodoRiego: "aspersion", fechaPlantacion: PLANT },
).Dr;
ok(balPorCaudal(5.4) > balPorCaudal(15), `afinar el caudal a la baja sube el déficit (${balPorCaudal(5.4).toFixed(1)} vs ${balPorCaudal(15).toFixed(1)} mm)`);

console.log("── p ajustada por demanda evaporativa (nota Tabla 22 FAO-56) ──");
// Fórmula: p_adj = p_tabla + 0,04 × (5 − ETc), acotada a [0,1 ; 0,8].
// Es la misma que aplica pyfao56 por defecto (model.py).
const pDe = (etc) => M.aguaSuelo("franco", "lechuga", 100, etc).p;
ok(approx(pDe(5), 0.30, 1e-9), "a ETc = 5 mm/día devuelve el valor de tabla intacto (lechuga 0,30)");
ok(approx(pDe(3), 0.38, 1e-9), "a ETc = 3 (poca demanda) sube a 0,38 → aguanta más seco");
ok(approx(pDe(8), 0.18, 1e-9), "a ETc = 8 (mucha demanda) baja a 0,18 → sufre antes");
ok(pDe(30) === 0.1, "ETc absurdamente alta se acota en 0,1");
ok(pDe(-30) === 0.8, "ETc absurdamente baja se acota en 0,8");
ok(M.aguaSuelo("franco", "lechuga", 100).p === 0.30, "sin ETc → valor de tabla (compatible hacia atrás)");
ok(approx(M.aguaSuelo("franco", "lechuga", 100, 3).raw / M.aguaSuelo("franco", "lechuga", 100).raw, 0.38 / 0.30, 0.01),
   "el RAW escala con la p ajustada, el TAW no se toca");
ok(M.aguaSuelo("franco", "lechuga", 100, 3).taw === M.aguaSuelo("franco", "lechuga", 100).taw,
   "el TAW es idéntico con y sin ajuste (la p no toca el depósito, solo el umbral)");
// End-to-end: con MUCHA demanda el umbral baja → se dispara el riego antes.
const serieCalor = serieSeca.map(d => ({ ...d, et0: 9 }));
const balCalor = M.balanceHidrico(serieCalor.slice(0, 3), [], { suelo: "franco", cultivoId: "lechuga", metodoRiego: "aspersion", fechaPlantacion: PLANT });
const balSuave = M.balanceHidrico(serieSeca.slice(0, 3),  [], { suelo: "franco", cultivoId: "lechuga", metodoRiego: "aspersion", fechaPlantacion: PLANT });
ok(balCalor.raw < balSuave.raw, `con ola de calor el umbral baja (${balCalor.raw.toFixed(1)} vs ${balSuave.raw.toFixed(1)} mm) → riega antes`);
ok(approx(balCalor.taw, balSuave.taw, 0.01), "y el depósito (TAW) no cambia por el calor");

console.log("── riegos del mismo día: el null no depende del orden ──");
const optsDia = { suelo: "franco", cultivoId: "lechuga", metodoRiego: "aspersion", fechaPlantacion: PLANT };
const serie3 = serieSeca.slice(0, 3);
const drCon = (riegos) => M.balanceHidrico(serie3, riegos, optsDia).Dr;
const d1 = "2026-06-02";
ok(drCon([{ date: d1, litros: 20 }, { date: d1, litros: null }]) ===
   drCon([{ date: d1, litros: null }, { date: d1, litros: 20 }]),
   "mismo Dr leyendo el array en un orden o en el otro");
ok(drCon([{ date: d1, litros: null }, { date: d1, litros: 20 }]) === drCon([{ date: d1, litros: null }]),
   "el null (regó y no sabemos cuánto) manda: recarga completa");
ok(drCon([{ date: d1, litros: 10 }, { date: d1, litros: 10 }]) === drCon([{ date: d1, litros: 20 }]),
   "dos riegos cuantificados el mismo día siguen sumando");

console.log("── presentarRiego: sesiones largas se parten en tandas ──");
const corto = M.presentarRiego(9, { metodoRiego: "aspersion", caudalMmh: 15 });
ok(corto.fraccionar === undefined && corto.texto === "36 min", `36 min no se fracciona (${corto.texto})`);
const largo = M.presentarRiego(29.8, { metodoRiego: "aspersion", caudalMmh: 5.4 });
ok(largo.valor === 331, `el caso real del bancal: 29,8 mm a 5,4 mm/h → 331 min (${largo.valor})`);
ok(largo.fraccionar.sesiones === 3 && largo.fraccionar.min_por_sesion === 110,
   `se parte en 3 tandas de 110 min (${JSON.stringify(largo.fraccionar)})`);
ok(approx(largo.fraccionar.sesiones * largo.fraccionar.min_por_sesion, largo.valor, 3),
   "las tandas suman los mismos minutos (misma agua, no menos)");
ok(largo.mm === 29.8, "los mm de la decisión no cambian al fraccionar");

console.log("── decisión: regla intacta ──");
const bal = M.balanceHidrico(serieSeca.slice(0, 10), [], { suelo: "franco", cultivoId: "lechuga", metodoRiego: "aspersion", fechaPlantacion: PLANT });
const dec = M.decisionRiego(bal);
ok(["alta", "media", "baja"].includes(dec.nivel), `decisionRiego devuelve nivel válido (${dec.nivel}, Dr=${bal.Dr.toFixed(1)} vs RAW=${bal.raw.toFixed(1)})`);

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\nTodos los tests del motor pasan ✓");
