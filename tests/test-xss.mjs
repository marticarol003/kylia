// Un payload de XSS no se ejecuta en ninguna pantalla.
//   node tests/test-xss.mjs
//
// DE DÓNDE VIENE ESTO. La auditoría señaló que la app inserta mucho HTML
// dinámico. Al ir a mirar sitio por sitio aparecieron tres cosas distintas:
//
//  1. El historial de aplicaciones de /app metía en innerHTML el nombre de
//     producto, la dosis y las NOTAS tal cual — y eso es texto libre que teclea
//     el agricultor cuando aplica algo que no está en el catálogo.
//  2. campo/, piloto/diario/ y piloto/informe/ no tenían NINGUNA función de
//     escape, e interpolaban `ciudad`, `cultivo` y el nombre del producto, que
//     salen de la tabla `usuarios` / `acciones`.
//  3. Las URLs de las fuentes que devuelve la búsqueda de producto las escribe
//     la IA, e iban a un href pasando solo por esc(). esc() impide romper el
//     atributo pero NO impide `javascript:…`, que se ejecuta al tocar el enlace.
//
// El 1 y el 2 no se quedan en el móvil de quien escribe: `producto_nombre` y
// `ciudad` se suben vía /api/log, que hoy acepta escrituras por UUID sin sesión.
// O sea que la cadena la acaba pintando la pantalla de otra persona.
//
// Se prueba en DOS capas: las funciones reales extraídas del propio HTML (sin
// copiarlas, para que el test no se quede probando una versión vieja), y —si
// puppeteer está instalado— la ejecución de verdad en un navegador. La CI corre
// sin dependencias, así que la segunda capa se omite allí y lo dice.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import vm from "vm";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

// Los payloads clásicos, más los que suelen colarse por escapes a medias.
const PAYLOADS = [
  `<img src=x onerror="window.__xss=1">`,
  `<script>window.__xss=1</script>`,
  `"><svg onload=window.__xss=1>`,
  `'><img src=x onerror=window.__xss=1>`,
  `<iframe srcdoc="&lt;script&gt;parent.__xss=1&lt;/script&gt;">`,
];
const URLS_MALAS = [
  "javascript:window.__xss=1",
  "JaVaScRiPt:window.__xss=1",
  "java\nscript:window.__xss=1",
  "\tjavascript:window.__xss=1",
  "data:text/html,<script>window.__xss=1</script>",
  "vbscript:msgbox(1)",
];

// Saca una función del HTML TAL CUAL está escrita y la ejecuta de verdad. Se
// cuentan las llaves en vez de usar una expresión regular porque urlSegura lleva
// un try/catch dentro y cualquier regex perezosa se corta en la llave de enmedio.
// Importa que sea el código real: un test contra una copia acaba probando una
// versión vieja el día que alguien toque el original.
function extraer(html, nombre, fuente) {
  const flecha = html.indexOf(`const ${nombre} = `);
  const clásica = html.indexOf(`function ${nombre}(`);
  let código;
  if (clásica >= 0 && (flecha < 0 || clásica < flecha)) {
    const abre = html.indexOf("{", clásica);
    let n = 0, i = abre;
    for (; i < html.length; i++) {
      if (html[i] === "{") n++;
      else if (html[i] === "}" && --n === 0) break;
    }
    código = html.slice(clásica, i + 1);
  } else if (flecha >= 0) {
    // No vale buscar el primer ";": las entidades del propio escape ("&amp;")
    // llevan uno dentro. Se corta en la siguiente declaración de nivel superior.
    const resto = html.slice(flecha);
    const sig = resto.search(/\n\s*(?:const|function|let|var)\s/);
    código = (sig > 0 ? resto.slice(0, sig) : resto).trimEnd();
  } else {
    throw new Error(`no se encuentra ${nombre} en ${fuente}`);
  }
  // Guardia: si la extracción se queda a medias, el test estaría probando medio
  // código y pasando en verde. Mejor romper.
  const fin = código.trimEnd().slice(-1);
  if (código.length < 40 || (fin !== ";" && fin !== "}")) {
    throw new Error(`extracción incompleta de ${nombre} en ${fuente}: ${JSON.stringify(código.slice(-40))}`);
  }
  const ctx = { location: { origin: "https://kylia.app" }, URL, String, Number };
  vm.createContext(ctx);
  vm.runInContext(`${código}\nglobalThis.__f = ${nombre};`, ctx);
  return ctx.__f;
}

console.log("── el escape de /app neutraliza los payloads ──");
const app = leer("app", "index.html");
const escApp = extraer(app, "esc", "app/index.html");
for (const p of PAYLOADS) {
  const salida = escApp(p);
  ok(!/[<>]/.test(salida), `sin ángulos vivos: ${p.slice(0, 34)}…`);
}
ok(escApp(`"><b>`) === "&quot;&gt;&lt;b&gt;", "escapa comillas dobles: si no, se rompe el atributo");
ok(escApp(`'><b>`) === "&#39;&gt;&lt;b&gt;", "y comillas simples, que es por donde se cuelan los atributos sin comillar");
ok(escApp("&lt;b&gt;") === "&amp;lt;b&amp;gt;", "el & se escapa primero, o el doble escape se puede deshacer");
ok(escApp(null) === "" && escApp(undefined) === "", "null y undefined no acaban en la pantalla como texto");

console.log("\n── el mismo escape existe en las pantallas que no lo tenían ──");
for (const [f, ruta] of [["campo", ["campo", "index.html"]],
                         ["piloto/diario", ["piloto", "diario", "index.html"]],
                         ["piloto/informe", ["piloto", "informe", "index.html"]]]) {
  const html = leer(...ruta);
  const e = extraer(html, "esc", f);
  ok(PAYLOADS.every(p => !/[<>]/.test(e(p))), `${f}/ escapa los ${PAYLOADS.length} payloads`);
}

console.log("\n── las URLs que trae la IA: solo http y https ──");
const urlSegura = extraer(app, "urlSegura", "app/index.html");
for (const u of URLS_MALAS) {
  ok(urlSegura(u) === null, `rechazada: ${JSON.stringify(u.slice(0, 40))}`);
}
ok(urlSegura("https://fitosanitarios.mapa.gob.es/x") === "https://fitosanitarios.mapa.gob.es/x",
   "una fuente https de verdad sigue pasando");
ok(urlSegura("http://ejemplo.es/ficha") === "http://ejemplo.es/ficha", "y http también");
ok(urlSegura(null) === null && urlSegura("") === null && urlSegura("no es una url") === null,
   "vacío o basura no da un href a medias");
ok(urlSegura("//evil.com/x") === null,
   "una URL sin esquema tampoco: heredaría el nuestro y parecería de casa");
ok(urlSegura("/ruta/relativa") === null,
   "y una relativa: estas fuentes son externas, una relativa solo puede ser basura");

console.log("\n── y los sitios donde entraban esos datos ya pasan por ahí ──");
ok(/const notas     = a\.notas \? `<div class="apl-detalle">\$\{esc\(a\.notas\)\}<\/div>`/.test(app),
   "las notas del agricultor van escapadas");
ok(/<div class="apl-nombre">\$\{esc\(a\.productoNombre\)\}/.test(app),
   "el nombre de producto que teclea a mano, también");
ok(/data-nombre="\$\{esc\(a\.productoNombre\)\}"/.test(app),
   "y en el atributo del botón de borrar, donde antes solo se cambiaban las comillas dobles");
ok(/\$\{esc\(a\.sustanciaActiva\)\}/.test(app) && /\$\{esc\(a\.dosis\)\}/.test(app) && /\$\{esc\(a\.cultivo\)\}/.test(app),
   "sustancia, dosis y cultivo igual");
ok(/<p class="ia-texto">\$\{esc\(textoIA\)\}<\/p>/.test(app),
   "el análisis que escribe Gemini se escapa: es prosa, no marcado");
ok(!/href="\$\{esc\(f\.url\)\}"/.test(app) && !/href="\$\{esc\(a\.url\)\}"/.test(app),
   "ya no queda ningún href montado solo con esc() sobre una URL de la IA");
ok(/function enlaceFuente/.test(app) && /urlSegura\(f && f\.url\)/.test(app),
   "las fuentes pasan por enlaceFuente, que valida el esquema antes de enlazar");
ok(/const destino = d\?\.ok && d\.url \? urlSegura\(d\.url\) : null;/.test(app),
   "y el salto a Stripe valida el esquema: location.href = 'javascript:…' también ejecuta");

const campo = leer("campo", "index.html");
ok(/\$\{esc\(u\.ciudad \|\| ""\)\}/.test(campo) && /\$\{esc\(u0\.ciudad \|\| ""\)\}/.test(campo),
   "campo/ escapa la ciudad en las dos pantallas donde la pinta");
ok(!/\$\{e\.message\}/.test(campo), "y los mensajes de error de campo/ también");
const diario = leer("piloto", "diario", "index.html");
ok(/\$\{esc\(\[u\.ciudad, u\.cultivo\]/.test(diario), "piloto/diario escapa ciudad y cultivo");
ok(/\$\{esc\(a\.producto \|\|/.test(diario), "y el nombre del producto apuntado");
const informe = leer("piloto", "informe", "index.html");
ok(/\$\{esc\(\[u\.ciudad, u\.cultivo, u\.metodo_riego\]/.test(informe), "piloto/informe escapa la cabecera");

console.log("\n── mdAHtml de /pilotos escapa ANTES de añadir marcado ──");
const pilotos = leer("pilotos", "index.html");
ok(/const bloques = esc\(md\)\.split/.test(pilotos),
   "el informe en markdown que escribe la IA se escapa antes de convertirlo, no después");

// ── Capa 2: ejecución real en navegador ───────────────────────────
console.log("\n── prueba en navegador de verdad ──");
let puppeteer = null;
try { puppeteer = (await import(join(RAIZ, "node_modules", "puppeteer", "lib", "esm", "puppeteer", "puppeteer.js"))).default; }
catch (_) { /* la CI corre sin dependencias */ }

if (!puppeteer) {
  console.log("  ⏭  omitida: puppeteer no está instalado (la CI corre sin dependencias).");
  console.log("     Las funciones de arriba sí se han ejecutado de verdad, extraídas del HTML.");
} else {
  const { createServer } = await import("http");
  const { existsSync, statSync } = await import("fs");
  const srv = createServer((req, res) => {
    let ruta = decodeURIComponent(req.url.split("?")[0]);
    if (ruta.endsWith("/")) ruta += "index.html";
    const f = join(RAIZ, ruta);
    if (!f.startsWith(RAIZ) || !existsSync(f) || !statSync(f).isFile()) { res.statusCode = 404; return res.end(); }
    res.setHeader("Content-Type", f.endsWith(".html") ? "text/html" : "application/javascript");
    res.end(readFileSync(f));
  });
  await new Promise(r => srv.listen(0, r));
  const base = `http://localhost:${srv.address().port}`;
  const nav = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });

  const VENENO = `<img src=x onerror="window.__xss=1">`;
  const stub = (o) => ({ status: 200, contentType: "application/json",
                         headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(o) });

  // (a) /campo con la ciudad envenenada desde la API
  const p1 = await nav.newPage();
  await p1.setRequestInterception(true);
  p1.on("request", r => {
    const u = r.url();
    if (u.includes("vista=hoy")) return r.respond(stub({
      ok: true, vista: "hoy",
      usuario: { ciudad: VENENO, cultivo: VENENO, area_m2: 5, metodo_riego: "aspersion" },
      hoy: { fecha: "2026-09-09", nivel: "baja", regar: false, texto: "ok",
             deficit_mm: 1, umbral_mm: 2, et0: 1, lluvia: 0 },
      desglose: {}, proximo: null, riegos_recientes: [], madurez: null,
    }));
    if (u.includes("/api/") || u.includes("open-meteo") || u.includes("unpkg")) return r.respond(stub({ ok: false }));
    r.continue();
  });
  await p1.goto(`${base}/campo/`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise(r => setTimeout(r, 500));
  const r1 = await p1.evaluate(() => ({ xss: window.__xss, txt: document.body.innerText }));
  ok(r1.xss === undefined, "/campo: la ciudad envenenada NO ejecuta nada");
  ok(r1.txt.includes("<img src=x"), "y se ve como texto literal, que es la prueba de que se escapó");

  // (b) /app con una aplicación envenenada en localStorage
  const p2 = await nav.newPage();
  await p2.setRequestInterception(true);
  p2.on("request", r => {
    const u = r.url();
    if (u.includes("/api/") || u.includes("open-meteo") || u.includes("unpkg")) return r.respond(stub({ ok: false }));
    r.continue();
  });
  await p2.goto(`${base}/app/`, { waitUntil: "networkidle2", timeout: 30000 });
  const r2 = await p2.evaluate((veneno) => {
    const li = document.createElement("li");
    // Se reproduce EXACTAMENTE el patrón del historial de aplicaciones.
    const a = { productoNombre: veneno, notas: veneno, dosis: veneno,
                sustanciaActiva: veneno, cultivo: veneno, date: "2026-09-09" };
    li.innerHTML = `<div class="apl-nombre">${esc(a.productoNombre)}</div>`
                 + `<div class="apl-detalle">${esc(a.notas)}</div>`
                 + `<button data-nombre="${esc(a.productoNombre)}"></button>`;
    document.body.appendChild(li);
    return { xss: window.__xss, imgs: li.querySelectorAll("img").length, txt: li.innerText };
  }, VENENO);
  ok(r2.xss === undefined && r2.imgs === 0,
     "/app: el nombre de producto y las notas del agricultor no crean ningún elemento");
  ok(r2.txt.includes("<img src=x"), "se pintan como texto");

  // CONTROL NEGATIVO. Sin esto, el test de arriba pasaría igual aunque el
  // payload fuese inofensivo o el navegador no ejecutara nada, y estaríamos
  // celebrando un verde vacío. Aquí se reproduce el patrón EXACTO que había
  // antes del arreglo —interpolación sin escapar— y tiene que fallar.
  const control = await p2.evaluate((veneno) => {
    const li = document.createElement("li");
    li.innerHTML = `<div class="apl-nombre">${veneno}</div>`;   // ← como estaba antes
    document.body.appendChild(li);
    return { imgs: li.querySelectorAll("img").length };
  }, VENENO);
  ok(control.imgs === 1,
     "control: el patrón de antes SÍ crea el <img> — o sea que este test detecta el fallo que arregla");

  // (c) las URLs de la IA, en el DOM real
  const r3 = await p2.evaluate((malas) => malas.map(u => urlSegura(u)), URLS_MALAS);
  ok(r3.every(x => x === null), "ninguna de las URLs maliciosas sobrevive a urlSegura en el navegador");

  await nav.close();
  srv.close();
}

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
