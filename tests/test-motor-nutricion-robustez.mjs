// El plan de abonado tampoco puede decidir mal con datos rotos.
//   node tests/test-motor-nutricion-robustez.mjs
//
// Ciclo 2 de la auditoría del 11-sep-2026. Igual que en el motor de riego, cada
// bloque reproduce un fallo real ejecutado primero contra el código viejo.
//
// Aquí el riesgo es distinto y más caro: el rendimiento MULTIPLICA todo el
// balance, así que un error del 40% en él son un 40% más o menos de nitrógeno
// en el campo de alguien.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const N = require(join(RAIZ, "api", "_motor-nutricion.js"));
const RE = require(join(RAIZ, "api", "_rendimiento.js"));
const C = require(join(RAIZ, "api", "_motor-cuaderno-fert.js"));
const M = require(join(RAIZ, "assets", "js", "motor-riego.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

console.log("── MEDIO · lo desconocido no se declara como cero ──");
// ofertaSuelo() devuelve SIEMPRE P₂O₅ y K₂O a null y lo dice: "desconocidos
// declarados, no cero disfrazado". El plan los convertía en 0 e informaba
// "aporte del suelo: 0 kg". La necesidad no cambia; la AFIRMACIÓN sí.
const r = N.necesidadNutrientes("tomate", 2, { N: 30, P2O5: null, K2O: null }, { area_m2: 440 });
ok(r.nutrientes.N.aporte_suelo_kg === 30, "el N medido se declara");
ok(r.nutrientes.P2O5.aporte_suelo_kg === null, "el P₂O₅ desconocido va como null, no como 0");
ok(r.nutrientes.K2O.aporte_suelo_kg === null, "y el K₂O igual");
ok(r.nutrientes.P2O5.necesidad_kg > 0, "y la necesidad sigue siendo la extracción bruta");

console.log("\n── el rendimiento no acepta lo imposible ──");
for (const v of [0, -5, NaN, null, "mucho", Infinity])
  ok(N.necesidadNutrientes("tomate", v, null, { area_m2: 440 }).disponible === false,
     `rendimiento ${JSON.stringify(v)} → sin plan`);
ok(N.necesidadNutrientes("tomate", 2, null, { area_m2: 440 }).disponible === true,
   "y uno normal sí da plan");

console.log("\n── ALTO · el factor de vigor es monótono y sin escalones ──");
// Antes: NDVI 0,39 → 2,64 t y NDVI 0,50 → 1,66 t. Un cultivo MÁS verde rendía
// MENOS. Y de 0,39 a 0,40 el rendimiento caía un 40% de golpe.
let prev = -1, monotona = true, salto = 0;
for (let i = 0; i <= 100; i++) {
  const t = RE.rendimientoEsperadoT("tomate", 440, { ndvi: i / 100, fase: "media" }).rendimiento_t;
  if (t < prev - 1e-9) monotona = false;
  if (prev >= 0) salto = Math.max(salto, Math.abs(t - prev) / Math.max(prev, 1e-9));
  prev = t;
}
ok(monotona, "más NDVI nunca da menos rendimiento");
ok(salto < 0.05, `sin escalones: el mayor salto entre centésimas es ${(salto * 100).toFixed(1)}%`);
ok(RE.rendimientoEsperadoT("tomate", 440, { ndvi: 0.2, fase: "inicial" }).vigor_aplicado === false,
   "y en fase inicial no se ajusta: el NDVI mide tamaño, no rinde");

console.log("\n── la superficie tampoco ──");
// El rendimiento multiplica todo; una unidad equivocada multiplica todo.
ok(RE.rendimientoEsperadoT("tomate", 1.1e6).disponible === false, "110 ha → sin plan, revisa la unidad");
for (const a of [-440, 0, NaN, Infinity, null])
  ok(RE.rendimientoEsperadoT("tomate", a).disponible === false, `área ${JSON.stringify(a)} → sin plan`);

console.log("\n── el crédito de residuos no puede dar dosis negativas ──");
const gigante = N.necesidadNutrientes("tomate", 2, null, { area_m2: 440, credito_residuos_n_kg_ha: 100000 });
ok(gigante.nutrientes.N.necesidad_kg === 0, "un crédito enorme deja la necesidad en 0, nunca negativa");
ok(gigante.nutrientes.K2O.necesidad_kg > 0, "y no toca al K₂O: el crédito es de nitrógeno");
ok(N.creditoResiduosN("pimiento", true) > 0, "pimiento con restos enterrados da crédito");
ok(N.creditoResiduosN("pimiento", false) === 0, "retirados, no");
ok(N.creditoResiduosN("marciano", true) === 0, "y un cultivo que no está en la tabla tampoco inventa");

console.log("\n── el reparto suma 100 % siempre ──");
const nec = N.necesidadNutrientes("tomate", 2, null, { area_m2: 440 });
for (const met of ["goteo", "aspersion", "surco", "manguera", "regadera", null, "marciano"]) {
  for (const ya of [null, { N: 1 }]) {
    const cu = C.cuadernoFertilizacion(nec, { superficie_m2: 440, metodo_riego: met, ya_aplicado: ya });
    for (const l of cu.lineas || []) {
      const suma = (l.reparto || []).reduce((t, x) => t + x.pct, 0);
      ok(Math.abs(suma - 100) <= 1,
         `${l.nutriente} · método=${met} · fondo ${ya ? "hecho" : "pendiente"} → ${suma} %`);
    }
  }
}

console.log("\n── cobertura: qué cultivos tienen plan y cuáles no ──");
// El alta ofrece ocho cultivos y el motor de riego los conoce todos, pero la
// tabla de extracción solo tiene tres. Los otros cinco NO tienen plan de
// abonado, y eso tiene que degradar diciéndolo, no calculando algo raro.
const riego = Object.keys(M.FAO_KC);
const conPlan = Object.keys(N.EXTRACCION);
for (const c of riego) {
  const x = N.necesidadNutrientes(c, 2, null, { area_m2: 440 });
  if (conPlan.includes(c)) ok(x.disponible === true, `${c}: tiene plan`);
  else ok(x.disponible === false && /extracción/i.test(x.motivo),
          `${c}: sin plan, y se dice por qué`);
}
ok(Object.keys(N.N_RESIDUOS_KG_HA).length === riego.length,
   "el crédito de residuos SÍ cubre los ocho: sirve como cultivo anterior aunque no tenga plan propio");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
