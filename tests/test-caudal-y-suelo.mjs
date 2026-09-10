// Los dos números que el agricultor NO puede contestar de memoria, y de dónde
// salen ahora sin preguntárselos.
//   node tests/test-caudal-y-suelo.mjs
//
// El principio: no se pregunta ningún número que haya que SABER. O se deduce de
// algo que ya nos ha dado (las coordenadas), o se pregunta algo que se ve
// estando de pie en el bancal, y la aritmética la hacemos nosotros.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const app = leer("app", "index.html");
const campo = leer("api", "campo.js");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };
const cerca = (a, b, tol = 0.15) => Math.abs(a - b) < tol;

console.log("── el suelo se deduce del punto, no se pregunta ──");
// Estaba cableado a "franco" sin ningún dato, y no es un detalle: el umbral de
// una lechuga es 13,8 mm en franco y 7,4 en arenoso. Eso mueve el riego entre
// uno y tres días. SoilGrids ya se consultaba para el abonado y clasifica en
// las mismas tres clases que usa el balance.
ok(/if \(vista === "textura"\)/.test(campo), "hay una vista que traduce lat/lon a textura");
ok(campo.indexOf('vista === "textura"') < campo.indexOf("ES_UUID.test(usuarioId)"),
   "y va ANTES del check de usuario: en el alta todavía no hay usuario");
ok(/Math\.abs\(lat\) > 90 \|\| Math\.abs\(lon\) > 180/.test(campo),
   "valida las coordenadas antes de salir a la red");
ok(/textura: t,/.test(campo) && /motivo: t \? null : /.test(campo),
   "sin dato devuelve null y el motivo, no un 'franco' disfrazado de medida");
ok(/vista=textura&lat=/.test(app), "el alta la pide en cuanto tiene el punto");
ok(/if \(sueloPedido === clave\) return;/.test(app),
   "y no la repite si el punto no ha cambiado");
ok(/suelo: A\.suelo \|\| cfg\.suelo \|\| "franco"/.test(app),
   "'franco' pasa a ser el último recurso, no la única opción");

console.log("\n── el vaso NO vale en goteo, y era lo que se enseñaba ──");
// Un vaso bajo un gotero recoge TODO lo de ese gotero en sus ~38 cm², cuando el
// gotero moja el marco entero. Con la geometría de Ferran son 10,9 mm/h reales
// contra 312 de lectura. Es la misma trampa que dio 15 mm/h en el campo del
// padre donde el cubo midió 5,4.
ok(!/Truco del vaso/.test(app), "ya no se llama 'truco del vaso' ni se ofrece para las dos");
ok(/hint\.innerHTML  = metodo === "aspersion" \? /.test(app),
   "el consejo depende del método de riego");
ok(/en medio de la zona mojada/.test(app),
   "en aspersión sí se usa el vaso, y colocado donde es (es un pluviómetro)");
ok(/Pulsa <strong>Calcularlo<\/strong>/.test(app),
   "en goteo se manda al cálculo por geometría, no a una medida que engaña");

console.log("\n── el cálculo solo pregunta lo que se ve ──");
for (const [id, q] of [["cc-sep", "cada cuánto hay un gotero"],
                       ["cc-lineas", "cuántas mangueras"],
                       ["cc-ancho", "qué ancho tiene el bancal"],
                       ["cc-q", "qué pone en la manguera"]])
  ok(new RegExp(`id="${id}"`).test(app), `pregunta ${q}`);
ok(/Un palmo · 20 cm/.test(app) && /Dos palmos · 40 cm/.test(app),
   "con referencias físicas: un palmo, dos palmos — nadie tiene que medir con cinta");
ok(/id="cc-no-pone"/.test(app) && /id="cc-botella"/.test(app),
   "y 'no pone nada' NO es un callejón sin salida: lleva a medirlo con una botella");
ok(/Diez minutos y queda hecho para siempre/.test(app),
   "se dice lo que cuesta medirlo, que es lo único que no se puede mirar");

console.log("\n── la aritmética, contra casos con respuesta conocida ──");
// mm/h = L/h de un gotero ÷ (separación goteros × separación mangueras).
// Se extrae la función DEL HTML: si alguien la toca, esto se entera.
const i = app.indexOf("function caudalGoteo()"), j = app.indexOf("const caudalAspersion");
ok(i > 0 && j > i, "caudalGoteo se puede extraer del fichero");
const C = {};
const caudalGoteo = new Function("C", app.slice(i, j) + "; return caudalGoteo;")(C);
const caso = (nombre, resp, esperado) => {
  for (const k of Object.keys(C)) delete C[k];
  Object.assign(C, resp);
  const r = caudalGoteo();
  ok(cerca(r, esperado), `${nombre} → ${r?.toFixed(1)} mm/h (esperado ${esperado})`);
};
// EL caso de referencia: la geometría que Ferran describió mirando su bancal.
// El 10,9 es el valor que acabó en la base de datos por otra vía.
caso("Ferran, 6 L/m·h, 2 mangueras, bancal 1,1 m", { sep: 0.20, lineas: 2, ancho: 1.1, qm: 6 }, 10.9);
caso("el mismo campo dicho por gotero (1,2 L/h)",  { sep: 0.20, lineas: 2, ancho: 1.1, q: 1.2 }, 10.9);
caso("y el mismo medido con botella (0,2 L/10 min)", { sep: 0.20, lineas: 2, ancho: 1.1, bot: 0.2 }, 10.9);
caso("huerto típico (1 manguera, 2 L/h cada 30 cm)", { sep: 0.30, lineas: 1, ancho: 1, q: 2 }, 6.7);
caso("goteo denso (2 mangueras, 2 L/h cada 20 cm)",  { sep: 0.20, lineas: 2, ancho: 1, q: 2 }, 20);
caso("marco ancho (1 manguera, 4 L/h cada 50 cm)",   { sep: 0.50, lineas: 1, ancho: 2, q: 4 }, 4);
// Las tres vías de declarar el mismo caudal tienen que coincidir: si no,
// el agricultor obtiene un número distinto según cómo mire la manguera.
for (const k of Object.keys(C)) delete C[k];
Object.assign(C, { sep: 0.20, lineas: 2, ancho: 1.1, qm: 6 });
const porMetro = caudalGoteo();
for (const k of Object.keys(C)) delete C[k];
Object.assign(C, { sep: 0.20, lineas: 2, ancho: 1.1, bot: 0.2 });
ok(cerca(porMetro, caudalGoteo(), 0.05),
   "declarar por metro, por gotero o medir con botella dan el MISMO número");

for (const k of Object.keys(C)) delete C[k];
Object.assign(C, { sep: 0.20, lineas: 2 });
ok(caudalGoteo() === null, "sin todas las respuestas no se inventa un caudal");

console.log("\n── un caudal increíble no se ofrece ──");
// Peor que el defecto sería escribir un disparate: los pilotos reales van de
// 5,4 a 15 mm/h en goteo.
ok(/if \(!\(mmh > 0\.5 && mmh < 80\)\)/.test(app), "fuera de 0,5-80 mm/h se rechaza");
ok(/que no es creíble\. Repasa las respuestas/.test(app),
   "y se dice, en vez de guardarlo callando");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
