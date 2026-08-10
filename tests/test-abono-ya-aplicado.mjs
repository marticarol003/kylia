// El plan descuenta lo que ya se ha echado.
//   node tests/test-abono-ya-aplicado.mjs
//
// Los abonados se apuntaban en el cuaderno pero el PLAN no los miraba: Kylia
// seguía pidiendo la necesidad entera aunque el abonado de fondo ya estuviera
// hecho. Salió cuando el usuario avisó de que al bancal se le aplicó Labinor
// ANTES de plantar las 33 lechugas.
//
// En 5 m² es un despiste. En hectáreas es sobrefertilizar por diseño: pagar de
// más, lixiviar nitratos y, en zona vulnerable, pasarse del techo legal.
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const F = require("../api/_motor-cuaderno-fert.js");
const N = require("../api/_motor-nutricion.js");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };
const g = kg => Math.round(kg * 1000);

// El bancal real: lechuga, 18 kg de cosecha esperada, 5 m², aspersión, ecológico.
const nec = N.necesidadNutrientes("lechuga", 0.018, { N: 0.01 }, { area_m2: 5 });
const plan = (ya) => F.cuadernoFertilizacion(nec,
  { superficie_m2: 5, metodo_riego: "aspersion", manejo: "ecologico", ya_aplicado: ya });
const lineaN = (ya) => plan(ya).lineas.find(l => l.nutriente === "N");

console.log("── sin nada echado, nada cambia ──");
const cero = lineaN({});
ok(g(cero.necesidad_kg) === 58 && g(cero.pendiente_kg) === 58,
   `necesita 58 g y quedan 58 g por echar`);
ok(cero.reparto.length === 2, "y se reparte en fondo + cobertera, como siempre");
ok(plan({}).hay_aplicado === false, "la pantalla puede saber que no se ha descontado nada");

console.log("── con abono ya echado, el plan baja ──");
const conAlgo = lineaN({ N: 0.020 });
ok(g(conAlgo.necesidad_kg) === 58, "la necesidad total no cambia: es del cultivo, no del calendario");
ok(g(conAlgo.ya_aplicado_kg) === 20, "se registra lo ya puesto");
ok(g(conAlgo.pendiente_kg) === 38, `y quedan ${g(conAlgo.pendiente_kg)} g, no los 58`);
ok(plan({ N: 0.020 }).hay_aplicado === true,
   "y se declara, para que la pantalla distinga 'baja porque ya abonaste' de 'pide poco'");

console.log("── el fondo no se puede volver a echar ──");
// El abonado de fondo va ANTES de plantar. Si ya se hizo, ofrecerlo otra vez
// sería doblarlo: con el cultivo en el suelo ese momento ya no existe.
ok(conAlgo.reparto.length === 1 && /cobertera/i.test(conAlgo.reparto[0].momento),
   "lo pendiente va entero a cobertera, no se reparte otra vez entre fondo y cobertera");
ok(g(conAlgo.reparto[0].kg) === 38, "y son los 38 g pendientes, no una fracción de ellos");

console.log("── pasarse no puede dar una dosis negativa ──");
const pasado = lineaN({ N: 0.080 });
ok(g(pasado.pendiente_kg) === 0, "si se echó de más, queda 0 por echar (nunca negativo)");
ok(g(pasado.exceso_kg) === 22, `y el exceso se declara aparte: ${g(pasado.exceso_kg)} g de más`);
ok(pasado.reparto.length === 0, "sin nada pendiente no hay reparto que ofrecer");
ok(plan({ N: 0.080 }).hay_exceso === true, "y la pantalla puede avisarlo");

console.log("── el coste es el de lo que FALTA ──");
ok(conAlgo.coste_eur < cero.coste_eur,
   `lo ya echado ya está pagado: ${conAlgo.coste_eur} € contra ${cero.coste_eur} €`);
ok(Math.abs(conAlgo.coste_eur - 0.038 * conAlgo.precio_eur_kg) < 0.01,
   "el coste sale de los kg pendientes, no de la necesidad total");

console.log("── un abonado sin cifra no descuenta nada ──");
// La `dosis` es texto libre ("2 sacos", "un puñado"). Deducir kilos de ahí sería
// adivinar un número que entra en un balance; pedir de más es recuperable,
// descontar de menos no.
const campo = leer("api", "campo.js");
ok(/if \(!a\.nutrientes \|\| typeof a\.nutrientes !== "object"\) continue;/.test(campo),
   "solo cuenta el abonado que trae los kg de nutriente explícitos");
const log = leer("api", "log.js");
ok(/function nutrientesOrNull/.test(log) && /Number\.isFinite\(x\) && x >= 0/.test(log),
   "y al guardarlo solo se acepta un número válido por nutriente");

console.log("── la ventana incluye el abonado de FONDO ──");
ok(/45 \* 86400000/.test(campo),
   "arranca 45 días antes de plantar: el fondo se echa antes, y una ventana desde el día 0 lo dejaría fuera");
ok(/Labinor/.test(campo), "queda escrito el caso real que lo destapó");

const sql = leer("db", "abonado-descuenta-2026-08-10.sql");
ok(/nutrientes jsonb/.test(sql), "la migración crea la columna");
ok(/NULL y el plan NO descuenta/.test(sql) || /se deja NULL/.test(sql),
   "y deja escrito qué significa no saberlo");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
