// El móvil nuevo no puede abrir la app en blanco teniendo el campo guardado.
//   node tests/test-config-sintetizada.mjs
//
// `usuarios.config_app` es un espejo que solo se escribe cuando el agricultor
// CAMBIA algo. Quien configuró su campo antes de que existiera esa columna —o no
// ha vuelto a tocar nada— tiene la fila llena y el espejo vacío: entraba con el
// enlace del correo, el dispositivo adoptaba a su propietario y la app salía
// vacía. Justo lo que el enlace venía a evitar.
//
// Lo que se prueba aquí es la reconstrucción y, sobre todo, sus DOS límites: que
// no invente una finca donde no la hay, y que no se lleve por delante las zonas
// del dispositivo.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { configDesdeFila, COLUMNAS_FINCA } = require(join(RAIZ, "api", "_config-app.js"));
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

// Una fila real de las que hay hoy en producción: parcela dibujada, cultivo,
// superficie y caudal medido, y `config_app` a null porque es anterior al 10-ago.
const FILA = {
  nombre: "Elias", ciudad: "Palafolls", lat: 41.6683, lon: 2.7519,
  cultivos: ["lechuga"], cultivos_secundarios: null,
  parcela: { type: "Polygon", coordinates: [[[2.75, 41.66], [2.76, 41.66], [2.76, 41.67], [2.75, 41.66]]] },
  metodo_riego: "aspersion", manejo: "ecologico", suelo: "franco",
  fecha_plantacion: "2026-07-17", caudal: 5.4, area_m2: 5, capacidad_regadera: 20,
};

console.log("── la finca se reconstruye entera ──");
const c = configDesdeFila(FILA);
ok(c && c.finca, "una fila con contenido devuelve config");
ok(c.finca.parcela === FILA.parcela,
   "el CONTORNO viaja: sin él el satélite mediría un punto y no la parcela");
ok(c.finca.areaParcela === 5 && c.finca.caudal === 5.4,
   "superficie y caudal, que son los que convierten mm en litros y en minutos");
ok(c.finca.fechaPlantacion === "2026-07-17" && c.finca.cultivos[0] === "lechuga",
   "cultivo y fecha de plantación, de los que sale la Kc del día");
ok(c.finca.metodoRiego === "aspersion" && c.finca.suelo === "franco" && c.finca.manejo === "ecologico",
   "método de riego, suelo y manejo");
ok(c.finca.capacidadRegadera === 20 && c.finca.ciudad === "Palafolls" && c.finca.nombre === "Elias",
   "regadera, ciudad y nombre");
ok(c.sintetizada === true, "queda marcada como sintetizada, no como espejo del móvil");

console.log("── las claves son las del panel, no las de la tabla ──");
// loadConfig() hace {...DEFAULTS, ...guardado}: una clave con otro nombre no es
// un campo de más, es un campo que se queda en su valor por defecto para siempre.
const app = leer("app", "index.html");
const defaults = app.slice(app.indexOf("const DEFAULTS = {"), app.indexOf("const NDVI_HISTORY_DAYS"));
const esperadas = [...defaults.matchAll(/^\s{6}(\w+):/gm)].map(m => m[1]);
const desconocidas = Object.keys(c.finca).filter(k => !esperadas.includes(k));
ok(esperadas.length >= 14, `se comparan contra los ${esperadas.length} campos de DEFAULTS`);
ok(desconocidas.length === 0,
   `ninguna clave se sale del panel${desconocidas.length ? ": " + desconocidas.join(", ") : ""}`);

console.log("── no se inventa una finca que no existe ──");
ok(configDesdeFila({ nombre: "Nuevo", email: "a@b.es" }) === null,
   "una fila que solo tiene email y nombre NO es una finca: devuelve null");
ok(configDesdeFila(null) === null && configDesdeFila(undefined) === null,
   "sin fila, null (el canjeo puede no encontrar al propietario)");
ok(configDesdeFila({ cultivos: [] }) === null,
   "una lista de cultivos vacía no cuenta como contenido");
ok(configDesdeFila({ area_m2: 440 })?.finca.areaParcela === 440,
   "pero basta con la superficie: es el criterio de 'vacía' del guardado, no uno nuevo");
const soloParcela = configDesdeFila({ parcela: FILA.parcela });
ok(soloParcela && !("caudal" in soloParcela.finca),
   "lo que la fila no tiene se OMITE, para que al restaurar mande el valor por defecto y no un null");

console.log("── y no se lleva por delante lo que ya hay en el móvil ──");
ok(!("zonas" in c),
   "la config sintetizada NO trae zonas: la app escribe la lista que le llegue y una vacía las borraría");
const iife = app.slice(app.indexOf("function restaurarConfig"), app.indexOf("// Canjear el enlace"));
ok(/if \(Array\.isArray\(config\.zonas\)\)/.test(iife),
   "y del lado de la app, las zonas solo se tocan si vienen de verdad");

console.log("── las zonas no se sintetizan, a propósito ──");
const mod = leer("api", "_config-app.js");
ok(/referencia/.test(mod) && /LAS ZONAS NO SE SINTETIZAN/.test(mod),
   "queda escrito por qué: una zona es un recinto de SIGPAC y la tabla no guarda ni su referencia ni la agrupación");

console.log("── conectado en los dos caminos ──");
const acceso = leer("api", "_acceso.js");
const campo  = leer("api", "campo.js");
ok(/config_app \|\| configDesdeFila\(fila\)/.test(acceso),
   "el canjeo del enlace cae a la finca reconstruida si no hay espejo");
ok(acceso.includes("${COLUMNAS_FINCA}"),
   "y pide las columnas que hacen falta (antes solo traía config_app)");
ok(/if \(!config\) config = configDesdeFila\(u\)/.test(campo),
   "la vista config también, para el arranque en un dispositivo vacío");
ok(COLUMNAS_FINCA.split(",").every(col => mod.includes(`fila.${col}`) || col === "cultivos"),
   "cada columna que se pide se usa: no se traen datos de la persona porque sí");

console.log("── entrar por el enlace del correo ES identificarse ──");
// El gate solo mira kylia_user_email. Sin esto, el agricultor abre el enlace que
// le ha llegado a SU correo y lo primero que ve es "introduce tu email".
const canje = app.slice(app.indexOf("async function canjearAcceso"), app.indexOf("// Arranque en un dispositivo sin datos"));
ok(/localStorage\.setItem\("kylia_user_email", d\.email\)/.test(canje),
   "el email del canjeo se guarda, así que el gate ya no salta");
ok(/nombre: fila\?\.nombre \|\| null/.test(acceso) && /kylia_user_nombre", d\.nombre/.test(canje),
   "y el nombre, para que el móvil nuevo salude igual que el viejo");
const gate = app.slice(app.indexOf("const gate = document.getElementById"), app.indexOf("gate-btn\").addEventListener"));
ok(/has\("acceso"\)/.test(gate) && /!yaIdentificado && !canjeando/.test(gate),
   "y mientras el canjeo está en vuelo el gate no se pinta: si no, pide el correo durante un segundo");
ok((canje.match(/location\.replace\("\/app"\)/g) || []).length === 3,
   "el token sale de la barra en los tres finales (canjeado, no válido y sin red)");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
