// Lo que ve un agricultor que se da de alta SOLO.
//   node tests/test-primer-uso.mjs
//
// Los tres arreglos salieron del consejo del 13-ago, y los tres tienen la misma
// forma: el producto funcionaba para quien ya estaba dentro y fallaba justo en
// el primer día de quien llega solo — que es el caso que hay que soportar para
// poder vender.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const GEO = require(join(RAIZ, "assets", "js", "geo-parcela.js"));
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const app = leer("app", "index.html");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

console.log("── el visitante nuevo ve el producto, no una app apagada ──");
// El modo silencioso oculta el cockpit, las recomendaciones, la meteo, la FAQ y
// TAMBIÉN el plan de abonado — o sea, justo la capa determinista por la que se
// cobra. Tenerlo de defecto dejaba el alta autoservicio en una pantalla muerta.
const detectar = app.slice(app.indexOf("function detectarModo()"), app.indexOf("const modo = detectarModo()"));
ok(/return "demo";/.test(detectar), "sin nada guardado, el modo es demo");
ok(!/teniaDatos/.test(detectar),
   "y ya no se deduce de si había datos en el móvil: quien no tenía nada caía en el silencioso");
ok(/if \(forzado === "demo" \|\| forzado === "piloto"\) return forzado;/.test(detectar),
   "el modo forzado sigue mandando por encima de todo");

// Esto es lo que hace que invertir el defecto NO saque a nadie de su ensayo.
const alta = leer("piloto", "alta", "index.html");
ok(/localStorage\.setItem\("kylia_modo", "piloto"\)/.test(alta),
   "el alta de un piloto fija el modo explícitamente, así que no dependía del defecto");
ok(/params\.get\("modo"\) === "piloto"/.test(app),
   "y ?modo=piloto sigue disponible para dar de alta a mano");

const css = app.slice(app.indexOf('html[data-modo-kylia="piloto"] #welcome-banner'), app.indexOf(".piloto-aviso {"));
ok(/#abonado-toggle/.test(css) && /#card-hoy/.test(css),
   "el modo piloto sigue ocultando el producto entero (es su razón de ser), abonado incluido");

console.log("── actualizar la ubicación no borra la parcela ──");
// Pasaba en las dos ramas del GPS, con parcela:null explícito. Se llevaba por
// delante el contorno confirmado, y con él la medida del satélite y la
// superficie oficial de la que salen los kg del abonado.
const gps = app.slice(app.indexOf("navigator.geolocation.getCurrentPosition"), app.indexOf("btnGps.disabled = false;\n            setFeedback"));
ok(!/parcela: null/.test(gps), "ya no se manda parcela:null a ciegas");
ok(/contieneAlPunto\(cfgFinca\.parcela, \[lon, lat\]\)/.test(gps),
   "se decide con la geometría: el contorno se conserva si el GPS cae dentro");
ok((gps.match(/cultivos: cultivosSeleccionados, parcela, metodoRiego/g) || []).length === 2,
   "y en las DOS llamadas a guardar (con y sin nombre de ciudad), que es donde estaba el fallo");
ok(/window\.KyliaGeo\?\./.test(gps), "usa el global que expone geo-parcela.js, no uno inventado");

console.log("── contieneAlPunto ──");
const CUADRADO = { type: "Polygon", coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]] };
ok(GEO.contieneAlPunto(CUADRADO, [0.005, 0.005]) === true, "un punto en el centro está dentro");
ok(GEO.contieneAlPunto(CUADRADO, [0.02, 0.005]) === false, "uno al este, fuera");
ok(GEO.contieneAlPunto(CUADRADO, [-0.001, 0.005]) === false, "uno al oeste, fuera");
ok(GEO.contieneAlPunto(CUADRADO, [0.005, 0.02]) === false, "uno al norte, fuera");
// Una parcela en L: el hueco del codo NO es de la parcela aunque caiga en su caja.
const ELE = { type: "Polygon", coordinates: [[[0, 0], [0.02, 0], [0.02, 0.01], [0.01, 0.01], [0.01, 0.02], [0, 0.02], [0, 0]]] };
ok(GEO.contieneAlPunto(ELE, [0.005, 0.005]) === true, "en un bancal en L, el brazo cuenta como dentro");
ok(GEO.contieneAlPunto(ELE, [0.015, 0.015]) === false, "y el hueco del codo, fuera (no basta la caja envolvente)");
ok(GEO.contieneAlPunto(null, [0, 0]) === false && GEO.contieneAlPunto(CUADRADO, null) === false,
   "sin geometría o sin punto, false — nunca lanza: esto corre dentro del callback del GPS");
ok(GEO.contieneAlPunto(CUADRADO, [NaN, 0]) === false, "y un punto sin número tampoco cuela");
// MultiPolygon: anilloExterior ya resuelve la forma, aquí solo se comprueba que no revienta.
const MULTI = { type: "MultiPolygon", coordinates: [CUADRADO.coordinates] };
ok(GEO.contieneAlPunto(MULTI, [0.005, 0.005]) === true, "acepta MultiPolygon, que es lo que devuelve SIGPAC a veces");

console.log("── el primer día ya hay balance, no un falso 'todo en orden' ──");
// La app exigía un riego apuntado o una imagen de satélite; el servidor no.
// Quien se daba de alta veía "✓ Todo en orden · Sin alertas urgentes" el día 1,
// que no significaba que no tocara regar: significaba que no se calculó nada.
const balance = app.slice(app.indexOf("function calcularBalanceHidrico()"), app.indexOf("// ─── Storage de riegos"));
ok(/const refDate = ultRiego\?\.date \|\| ultimoNDMI\?\.fecha \|\| plant;/.test(balance),
   "la fecha de plantación vale como referencia");
ok(balance.indexOf("const plant") < balance.indexOf("const refDate"),
   "y se declara antes de usarse (si no, ReferenceError en la zona muerta del const)");
ok(/if \(!refDate\) return null;/.test(balance),
   "sin ninguna de las tres se sigue devolviendo null: no se inventa un balance sin ventana");
const campo = leer("api", "campo.js");
ok(/fechaPlantacion: u\.fecha_plantacion/.test(campo),
   "que es lo que ya hacía el servidor — esto los alinea, no los separa");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
