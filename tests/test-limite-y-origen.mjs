// Quién puede llamar a la API y cuántas veces.
//   node tests/test-limite-y-origen.mjs
//
// Los endpoints de IA y de satélite eran públicos, con CORS abierto y sin
// contador: un bucle de peticiones quemaba cuota de Gemini, crédito de Anthropic
// (producto-fertilizante sale a buscar al mercado en vivo) y tiempo de función
// en Vercel, y no había forma de enterarse hasta ver la factura.
//
// Son DOS defensas distintas y ninguna sustituye a la otra:
//   · _origen.js  → CORS acotado. Lo aplica el NAVEGADOR, así que frena a una
//                   web ajena que use el navegador de sus visitantes. A un
//                   script con curl le da exactamente igual.
//   · _limite.js  → contador persistente. Cuenta peticiones vengan de donde
//                   vengan, y vive en la base de datos porque en Vercel cada
//                   petición puede caer en una instancia distinta: un contador
//                   en memoria contaría por instancia y parecería protección
//                   sin serlo.
import { readFileSync, readdirSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const O = require(join(RAIZ, "api", "_origen.js"));
const L = require(join(RAIZ, "api", "_limite.js"));
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

// res de mentira: solo apunta las cabeceras que le ponen.
const fakeRes = () => { const h = {}; return { h, setHeader: (k, v) => { h[k] = v; },
  status() { return this; }, json() { return this; }, end() { return this; } }; };
const reqCon = (origen, extra = {}) => ({ headers: { ...(origen ? { origin: origen } : {}), ...extra } });

console.log("── de qué sitios se acepta una llamada del navegador ──");
for (const o of ["https://kylia.app", "https://www.kylia.app", "https://kylia-git-abc.vercel.app",
                 "http://localhost:8899", "http://127.0.0.1:3000"]) {
  ok(O.permitido(o) === true, `pasa: ${o}`);
}
for (const o of ["https://evil.com", "https://kylia.app.evil.com", "http://kylia.app",
                 "https://notkylia.app", "https://evil.com/kylia.app", ""]) {
  ok(O.permitido(o) === false, `no pasa: ${o || "(sin origen)"}`);
}

console.log("\n── y la cabecera solo se pone cuando toca ──");
let r = fakeRes();
O.cabecerasCors(reqCon("https://kylia.app"), r, "POST, OPTIONS");
ok(r.h["Access-Control-Allow-Origin"] === "https://kylia.app",
   "a un origen permitido se le devuelve SU origen, no un asterisco");
r = fakeRes();
O.cabecerasCors(reqCon("https://evil.com"), r);
ok(!("Access-Control-Allow-Origin" in r.h),
   "a uno que no está en la lista no se le devuelve cabecera: el navegador lo corta");
ok(r.h["Vary"] === "Origin",
   "y siempre va Vary: Origin, o una CDN serviría la respuesta de un origen a otro");
r = fakeRes();
const sinOrigen = O.cabecerasCors(reqCon(null), r);
ok(sinOrigen === true && !("Access-Control-Allow-Origin" in r.h),
   "una petición sin Origin (cron, servidor a servidor) sigue pasando: ahí CORS no pinta nada");

console.log("\n── de quién se cuenta ──");
ok(O.ipDe(reqCon(null, { "x-forwarded-for": "9.9.9.9, 10.0.0.1, 10.0.0.2" })) === "9.9.9.9",
   "de x-forwarded-for se coge la primera, que es el cliente (el resto son proxies)");
ok(O.ipDe(reqCon(null, { "x-real-ip": "8.8.8.8" })) === "8.8.8.8", "y si no, x-real-ip");
ok(O.ipDe(reqCon(null)) === "desconocida", "sin ninguna de las dos no revienta");

console.log("\n── la IP no se guarda en claro ──");
const ip = "88.12.34.56";
const clave = L.clavear(ip);
ok(!clave.includes(ip) && !clave.includes("88.12"),
   "la clave no contiene la IP: es un dato personal y la política de privacidad no declara guardarlas");
ok(/^[0-9a-f]{32}$/.test(clave), "es un hash hexadecimal de longitud fija");
ok(L.clavear(ip) === clave, "la misma IP da la misma clave (si no, no se podría contar)");
ok(L.clavear("88.12.34.57") !== clave, "y dos IPs distintas dan claves distintas");
const antes = process.env.LIMITE_SALT;
process.env.LIMITE_SALT = "otra-sal-distinta";
ok(L.clavear(ip) !== clave, "cambiar LIMITE_SALT cambia el hash: la sal sirve de algo");
if (antes === undefined) delete process.env.LIMITE_SALT; else process.env.LIMITE_SALT = antes;

console.log("\n── falla ABIERTO, y eso es una decisión, no un descuido ──");
const sinBackend = await L.consumir("ia:recomendacion", "1.2.3.4");
ok(sinBackend.permitido === true && sinBackend.motivo === "sin_backend",
   "sin Supabase configurado se deja pasar: un guardia de coste no puede tumbarle el producto a un agricultor");
ok(/FALLA ABIERTO A PROPÓSITO/.test(leer("api", "_limite.js")),
   "y queda escrito por qué, con los dos precedentes que lo justifican");

console.log("\n── cada endpoint que gasta dinero tiene su cupo ──");
const ia = leer("api", "ia.js");
const handlers = [...ia.matchAll(/^\s+"([a-z-]+)":\s+require/gm)].map(m => m[1]);
ok(handlers.length >= 4, `se encontraron los ${handlers.length} tipos de /api/ia`);
for (const h of handlers) {
  ok(!!L.LIMITES[`ia:${h}`], `ia:${h} tiene límite declarado (si se añade uno nuevo sin cupo, este test lo caza)`);
}
ok(L.LIMITES["ia:producto-fertilizante"].dia < L.LIMITES["ia:recomendacion"].dia,
   "y el que sale a buscar al mercado con Claude tiene el cupo más corto: es el que cuesta dinero de verdad");
ok(/guardia\(req, res, `ia:\$\{tipo\}`/.test(ia),
   "/api/ia aplica el contador en el router, que es por donde pasan los cuatro");
const sen = leer("api", "sentinel.js");
ok(/guardia\(req, res, "sentinel:punto"/.test(sen),
   "y el modo punto de sentinel también: cada llamada es una consulta a Copernicus");
ok(sen.indexOf('guardia(req, res, "sentinel:punto"') > sen.indexOf("refrescarMediciones(req, res)"),
   "pero el modo lote NO lleva contador: lo llama el cron sin Origin y frenarlo sería frenar al único que debe pasar");

console.log("\n── no queda ningún asterisco suelto ──");
const apis = readdirSync(join(RAIZ, "api")).filter(f => f.endsWith(".js"));
const conAsterisco = apis.filter(f => /Access-Control-Allow-Origin["'\s,]+["']\*["']/.test(leer("api", f)));
ok(conAsterisco.length === 0,
   conAsterisco.length ? `todavía con CORS abierto: ${conAsterisco.join(", ")}` : `los ${apis.length} ficheros de api/ pasan por la lista de orígenes`);

console.log("\n── la migración existe y se puede repetir ──");
const sql = leer("db", "limite-uso-2026-09-09.sql");
ok(/create table if not exists limite_uso/.test(sql), "crea la tabla y es idempotente");
ok(/create index if not exists/.test(sql), "con índice para la consulta del guardia");
ok(/NUNCA la IP en claro/.test(sql), "y deja escrito en la propia base de datos que ahí no van IPs");
ok(/MIENTRAS ESTO NO SE EJECUTE, NO HAY PROTECCIÓN/.test(sql),
   "y avisa de que hasta ejecutarlo el agujero sigue abierto");

console.log("\n── Leaflet ya no se ejecuta a ciegas ──");
const app = leer("app", "index.html");
ok(/css\.integrity = SRI_CSS/.test(app) && /js\.integrity = SRI_JS/.test(app),
   "/app comprueba el hash de Leaflet antes de ejecutarlo");
ok(/css\.crossOrigin = "anonymous"/.test(app) && /js\.crossOrigin = "anonymous"/.test(app),
   "con crossOrigin, sin el cual un recurso de otro dominio no se puede verificar y la carga falla");
const alta = leer("piloto", "alta", "index.html");
for (const hash of ["sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=",
                    "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="]) {
  ok(app.includes(hash) && alta.includes(hash),
     "el hash es el mismo en /app y en /piloto/alta (los publicados por Leaflet)");
}

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
