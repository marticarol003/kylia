// El alta se abre. Comprobado EJECUTÁNDOLA en un navegador de verdad.
//   node tests/test-alta-navegador.mjs
//
// POR QUÉ EXISTE, y es la razón más cara de toda la suite. El 16-sep se
// comprobó que `window.abrirAlta` NO EXISTÍA EN PRODUCCIÓN: el alta de primer
// uso llevaba sin abrirse desde `93efc3e`, que borró `cargarRecintos` y dejó
// viva su única llamada dentro de `initMapaParcela`. Como el alta se registra
// DENTRO de esa función, el ReferenceError la mataba antes de llegar a ella.
//
// Había 69 ficheros de test verdes y ninguno lo vio, porque todos leen el
// fuente: el markup del alta estaba, sus manejadores estaban, su copia estaba.
// Lo único que faltaba era que ALGUIEN LO EJECUTARA. Este test lo ejecuta.
import { readFileSync, existsSync } from "fs";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join, extname } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

let puppeteer = null;
try { puppeteer = (await import(join(RAIZ, "node_modules", "puppeteer", "lib", "esm", "puppeteer", "puppeteer.js"))).default; }
catch (_) { /* la CI corre sin dependencias */ }

if (!puppeteer) {
  console.log("  ⏭  omitida: puppeteer no está instalado (la CI corre sin dependencias).");
  process.exit(0);
}

// Servidor estático mínimo. Las llamadas a /api dan 404 a propósito: el alta
// tiene que funcionar sin backend — es lo primero que ve alguien con mala
// cobertura en mitad de un campo.
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const srv = createServer((req, res) => {
  const u = req.url.split("?")[0];
  const f = (u === "/app" || u === "/") ? join(RAIZ, "app", "index.html") : join(RAIZ, u);
  if (!f.startsWith(RAIZ) || !existsSync(f) || f.endsWith("/")) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": MIME[extname(f)] || "text/plain" });
  res.end(readFileSync(f));
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;

const nav = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
const pag = await nav.newPage();
const errores = [];
pag.on("pageerror", e => errores.push(e.message));

try {
  // El gate del correo tapa el alta; se identifica primero, como cualquiera que
  // ya haya entrado una vez.
  await pag.goto(`http://127.0.0.1:${port}/app`, { waitUntil: "domcontentloaded" });
  await pag.evaluate(() => localStorage.setItem("kylia_user_email", "prueba@kylia.app"));
  await pag.goto(`http://127.0.0.1:${port}/app?alta=1`, { waitUntil: "networkidle2", timeout: 30000 });

  const r = await pag.evaluate(() => ({
    abrirAlta: typeof window.abrirAlta,
    registrada: !!window.__A,
    visible:    document.getElementById("alta")?.hidden === false,
    pasoActivo: document.querySelector("#alta .alta-paso.activo")?.dataset?.paso ?? null,
    // La función que se cayó. Si vuelve a desaparecer, esto lo dice por su
    // nombre en vez de dejar un ReferenceError suelto.
    cargarRecintos: typeof cargarRecintos !== "undefined" ? "definida" : "AUSENTE",
  }));

  console.log("── el alta existe y se abre ──");
  ok(r.abrirAlta === "function",
     "window.abrirAlta EXISTE (es lo que faltaba en producción el 16-sep)");
  ok(r.registrada === true, "el alta se ha registrado");
  ok(r.visible === true, "y ?alta=1 la abre de verdad");
  ok(r.pasoActivo === "0", `arranca en el primer paso (${r.pasoActivo})`);

  console.log("\n── sin errores de JavaScript ──");
  // La causa raíz, nombrada. `cargarRecintos` es la única llamada de
  // initMapaParcela que no tenía definición, y todo el alta vive dentro.
  ok(!errores.some(e => /cargarRecintos/.test(e)),
     "ningún 'cargarRecintos is not defined'");
  ok(errores.length === 0,
     `0 errores de página con /api caído (${errores.length ? errores.join(" · ") : "0"})`);
} finally {
  await nav.close();
  srv.close();
}

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
