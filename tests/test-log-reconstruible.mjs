// ¿Se puede reconstruir, dentro de un año, qué sabía Kylia y qué recomendó?
//   node tests/test-log-reconstruible.mjs
//
// Es la condición para que un piloto CIEGO sirva de algo: si el log no guarda
// con qué se decidió, la validación se hace con lo que sabemos HOY y eso no es
// una validación, es un recuerdo reescrito.
//
// Auditoría del 14-sep-2026. Faltaban seis cosas y las seis hacían falta.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const M = require(join(RAIZ, "assets", "js", "motor-riego.js"));
const diarioB = readFileSync(join(RAIZ, "api", "diario-b.js"), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

console.log("── lo que el Diario B congela cada mañana ──");
// La lista es la del encargo: inputs meteorológicos, lluvia, ET0, estado
// hídrico, Kc, cultivo/fase, recomendación, cantidad, motivo.
const ctx = diarioB.split("contexto: {")[1].split("},")[0];
const CAMPOS = {
  "et0":                 "la ET₀ del día",
  "lluvia":              "la lluvia del día",
  "clima_fecha":         "de qué día es ese clima",
  "clima_fuente":        "y de qué fuente salió (archivo o pronóstico)",
  "clima_cobertura":     "con cuánto clima se calculó el balance",
  "cultivo":             "el cultivo",
  "fase":                "la fase fenológica",
  "dias_fenologicos":    "los días fenológicos acumulados",
  "gdd_acum":            "el calor acumulado",
  "modo_fenologia":      "y si el reloj fue térmico o de calendario",
  "kc":                  "el Kc aplicado",
  "Dr":                  "el déficit",
  "RAW":                 "el umbral",
  "TAW":                 "la capacidad del suelo",
  "caudal_mmh":          "el CAUDAL vigente ese día",
  "area_m2":             "y la superficie de entonces",
  "suelo":               "la clase de suelo",
  "metodo_riego":        "el método de riego",
  "riegos_sin_cantidad": "cuántos riegos entraron sin cifra (el supuesto de recarga completa)",
  "motivo":              "y el motivo de la decisión, en código",
  "motor_version":       "la versión del motor con la que se decidió",
  "motor_reglas":        "y qué reglas llevaba activas",
  "lluvia_conocida":     "si se sabía o no si llovió ese día",
  "dias_sin_lluvia_conocida": "y sobre cuántos días del balance se supuso que no",
};
for (const [campo, desc] of Object.entries(CAMPOS))
  ok(new RegExp(`\\b${campo}:`).test(ctx), `guarda ${desc} (${campo})`);

console.log("\n── el caudal, que es el que reescribía la historia ──");
// laminaRiego usa el caudal ACTUAL del usuario para convertir duración en mm.
// Es deliberado —afinar un caudal tiene que mover las decisiones— pero significa
// que el reveal de hace dos meses CAMBIA si hoy remides el caudal con el vaso.
// Guardando el caudal del día, al menos se puede saber con cuál se decidió.
ok(/caudal_mmh:\s+u\.caudal/.test(ctx), "se congela el caudal del usuario ese día");
ok(M.laminaRiego(null, 60, 15) === 15 && M.laminaRiego(null, 60, 5.4) === 5.4,
   "y con el caudal de entonces la lámina se puede recalcular igual");

console.log("\n── el motivo es un código estable, no la frase ──");
// El `texto` se reescribe cada vez que se mejora la redacción. Un motivo en
// código se puede contar, filtrar y comparar dentro de un año.
const casos = [
  [{ Dr: 30, raw: 20, taw: 50, efic: 0.9 }, {}, "deficit_supera_umbral"],
  [{ Dr: 30, raw: 20, taw: 50, efic: 0.9 }, { lluviaPrevista: [{ lluvia: 35 }] }, "lluvia_cubre_deficit"],
  [{ Dr: 16, raw: 20, taw: 50, efic: 0.9 }, {}, "cerca_del_umbral"],
  [{ Dr: 5,  raw: 20, taw: 50, efic: 0.9 }, {}, "deficit_bajo_umbral"],
  [{ Dr: NaN, raw: 20, taw: 50, efic: 0.9 }, {}, "sin_balance"],
];
for (const [bal, opt, esperado] of casos) {
  const d = M.decisionRiego(bal, opt);
  ok(d.motivo === esperado, `${esperado} (nivel ${d.nivel})`);
}
const motivos = new Set(casos.map(c => M.decisionRiego(c[0], c[1]).motivo));
ok(motivos.size === casos.length, "cada rama tiene su propio motivo: ninguno se solapa");

console.log("\n── y lo que el agricultor hizo ──");
// Los riegos reales viven en `acciones` con fecha, duración y cantidad. Lo que
// NO se guarda ahí es el caudal del momento: por eso va en el log de la decisión.
ok(/duracion_min/.test(diarioB), "el Diario B lee la duración de los riegos reales");
ok(/laminaDeAccion\(f, u\.caudal\)/.test(diarioB),
   "y pasa por laminaDeAccion, que prefiere la lámina CONGELADA del evento");
ok(/lamina_mm,lamina_origen,caudal_mmh/.test(diarioB),
   "trayéndose del select las columnas congeladas (ver test-historico-congelado.mjs)");

console.log("\n── la versión del motor identifica el código, no el fichero ──");
// Un hash del fichero cambiaría con cada comentario y no significaría nada. Se
// sube a mano cuando cambia algo que mueve un número.
ok(/^\d{4}-\d{2}-\d{2}$/.test(M.MOTOR_VERSION), `MOTOR_VERSION es una fecha (${M.MOTOR_VERSION})`);
ok(/fao56-kc-unico/.test(M.MOTOR_REGLAS), "y MOTOR_REGLAS dice que sigue siendo Kc único");
ok(/riego-sin-cantidad-recarga-completa/.test(M.MOTOR_REGLAS),
   "y declara la hipótesis del riego sin cantidad, que es la que está pendiente de decidir");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
