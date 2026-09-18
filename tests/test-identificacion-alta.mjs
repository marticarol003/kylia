// La identificación del alta, ejecutada en Chrome con el transporte controlado.
//   node tests/test-identificacion-alta.mjs
//
// POR QUÉ EXISTE. La primera versión del paso de identificación daba por
// identificado a quien ESCRIBÍA un correo: `!!localStorage.kylia_user_email`.
// Eso es falso y además peligroso — cualquiera teclea el correo de otro— y la
// tarjeta llegaba a decir "guardado en tu cuenta" sin que nadie hubiera
// acreditado nada.
//
// El único mecanismo que acredita identidad en Kylia es el ENLACE DE UN SOLO
// USO de api/_acceso.js: se pide por correo, se canjea, y el canje es donde
// nace la sesión firmada (api/_sesion.js). Este test recorre eso de verdad.
//
// Se simula el TRANSPORTE (la red). No se simulan ni el flujo, ni la
// persistencia, ni la decisión de si alguien está identificado.
import { readFileSync, existsSync } from "fs";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join, extname } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

// ══════════════════════════════════════════════════════════════════════
// El bucle de recargas, fijado SIN navegador para que corra también en la CI
// ══════════════════════════════════════════════════════════════════════
// Se ejecuta la función REAL recortada del fuente, no una copia.
{
  const FUENTE = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
  const recorta = (marca) => {
    const i = FUENTE.indexOf(marca);
    if (i < 0) throw new Error("no encuentro " + marca);
    let k = FUENTE.indexOf("{", FUENTE.indexOf("(", i)), prof = 0;
    for (let j = k; j < FUENTE.length; j++) {
      if (FUENTE[j] === "{") prof++;
      else if (FUENTE[j] === "}" && --prof === 0) return FUENTE.slice(i, j + 1);
    }
    throw new Error("sin cerrar");
  };
  const almacen = (init = {}) => { const m = new Map(Object.entries(init)); return {
    getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k) }; };
  const tiene = (ls) => new Function("localStorage",
    recorta("function tieneConfigLocal(") + "\n return tieneConfigLocal;")(ls)();

  console.log("── el bucle de recargas: tener parcelas ES tener configuración ──");
  // La foto EXACTA que deja el alta de parcela → cultivos: la finca solo lleva
  // sitio y suelo, y los cultivos viven en las zonas.
  const FINCA = { lat: 41.3255, lon: 2.062, suelo: "franco", cultivos: [] };
  const ZONA  = { referencia: "R1", superficie_m2: 5000,
    geometria: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] },
    siembras: [{ id: "s1", cultivo: "lechuga", area_m2: 1500, variedad: "Romana" }] };

  ok(tiene(almacen({ kylia_config: JSON.stringify(FINCA), kylia_zonas: JSON.stringify([ZONA]) })) === true,
     "con un cultivo en las zonas, SÍ hay configuración local");
  ok(tiene(almacen({ kylia_config: JSON.stringify(FINCA), kylia_zonas: "[]" })) === false,
     "sin cultivos, no: un dispositivo vacío sigue pudiendo restaurar del servidor");
  ok(tiene(almacen({ kylia_config: JSON.stringify({ ...FINCA, cultivos: ["lechuga"] }), kylia_zonas: "[]" })) === true,
     "y la finca a la antigua, con `cultivos`, sigue contando igual que siempre");
  ok(tiene(almacen({ kylia_zonas: "esto no es json", kylia_config: JSON.stringify(FINCA) })) === false,
     "unas zonas ilegibles no revientan nada: se decide con la finca");
  ok(tiene(almacen({ kylia_zonas: JSON.stringify([{ referencia: "R1" }]) })) === false,
     "una zona SIN siembras no es configuración: es un recinto mirado y nada más");

  // Y la restauración no puede repetirse dentro de la misma carga.
  const restaurar = FUENTE.slice(FUENTE.indexOf("async function restaurarSiVacio("));
  ok(/sessionStorage/.test(restaurar.slice(0, 1800)),
     "la restauración se marca por pestaña, para que no pueda encadenar recargas");
}

let puppeteer = null;
try { puppeteer = (await import(join(RAIZ, "node_modules", "puppeteer", "lib", "esm", "puppeteer", "puppeteer.js"))).default; }
catch (_) { /* la CI corre sin dependencias */ }
if (!puppeteer) {
  console.log("  ⏭  omitida: puppeteer no está instalado (la CI corre sin dependencias).");
  process.exit(0);
}

const LAT0 = 41.324, LON0 = 2.060, mLat = m => m / 111320, mLon = m => m / 83600;
const cuad = (x0, y0, l) => [[
  [LON0 + mLon(x0), LAT0 + mLat(y0)], [LON0 + mLon(x0 + l), LAT0 + mLat(y0)],
  [LON0 + mLon(x0 + l), LAT0 + mLat(y0 + l)], [LON0 + mLon(x0), LAT0 + mLat(y0 + l)],
  [LON0 + mLon(x0), LAT0 + mLat(y0)]]];
const RECINTOS = { recintos: [{ referencia: "R1", superficie_m2: 5000, uso: "TA", satelite: true,
  geometria: { type: "Polygon", coordinates: cuad(0, 0, 70.7) } }], umbral_satelite_m2: 5000 };

// ── El servidor de mentira, que cuenta lo que le piden ──────────────────
const AJENO = "11111111-2222-3333-4444-555555555555";
let pedidas = [];           // {recurso, accion, email, ...}
let canjeVale = true;       // C: enlace inválido/caducado
let envioFalla = false;     // C: el envío del enlace falla
let subidas = [];           // config-app que llegan al servidor

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const srv = createServer((q, r) => {
  const u = q.url.split("?")[0];
  if (u.startsWith("/api/sigpac")) { r.writeHead(200, { "Content-Type": "application/json" }); return r.end(JSON.stringify(RECINTOS)); }
  if (u === "/api/log") {
    let cuerpo = "";
    q.on("data", c => cuerpo += c);
    q.on("end", () => {
      let b = {}; try { b = JSON.parse(cuerpo || "{}"); } catch (_) {}
      pedidas.push(b);
      // La cabecera se escribe UNA vez: el envío que falla responde 500 y los
      // demás 200, pero nunca las dos cosas.
      if (b.recurso === "acceso" && b.accion === "pedir") {
        if (envioFalla) { r.writeHead(500, { "Content-Type": "application/json" }); return r.end('{"ok":false}'); }
        r.writeHead(200, { "Content-Type": "application/json" });
        // El servidor real responde IGUAL exista o no el correo.
        return r.end(JSON.stringify({ ok: true, enviado: true }));
      }
      r.writeHead(200, { "Content-Type": "application/json" });
      if (b.recurso === "acceso" && b.accion === "canjear") {
        if (!canjeVale) return r.end(JSON.stringify({ ok: false, error: "enlace no válido o caducado" }));
        return r.end(JSON.stringify({ ok: true, propietario_id: AJENO, email: "dueño@ejemplo.es",
          nombre: "Dueño", config: { finca: { lat: 41.3255, lon: 2.062, suelo: "franco" }, zonas: [], zonaActiva: null },
          zonas: [] }));
      }
      if (b.recurso === "config-app") { subidas.push(b); return r.end(JSON.stringify({ ok: true, persisted: true, config_version: 1 })); }
      return r.end(JSON.stringify({ ok: true }));
    });
    return;
  }
  if (u.startsWith("/api/campo")) {
    // ⚠️ COMO PRODUCCIÓN: un usuario que no existe da 404. Si esto devolviera
    // configuración para CUALQUIER uuid, todo dispositivo nuevo "adoptaría" esa
    // cuenta al arrancar y el test estaría midiendo su propio arnés.
    const id = /usuario_id=([^&]+)/.exec(q.url)?.[1];
    if (id !== AJENO) { r.writeHead(404, { "Content-Type": "application/json" }); return r.end('{"error":"no existe"}'); }
    r.writeHead(200, { "Content-Type": "application/json" });
    // La tupla que exige `adoptarDelPropietario`: owner + config + versión, de
    // la MISMA fila.
    return r.end(JSON.stringify({ ok: true, propietario: { id: AJENO,
      config: { finca: { lat: 41.3255, lon: 2.062, suelo: "franco" }, zonas: [], zonaActiva: null },
      config_version: 3 } }));
  }
  if (u.startsWith("/api/")) { r.writeHead(404); return r.end("{}"); }
  const f = (u === "/app" || u === "/") ? join(RAIZ, "app", "index.html") : join(RAIZ, u);
  if (!f.startsWith(RAIZ) || !existsSync(f) || f.endsWith("/")) { r.writeHead(404); return r.end("no"); }
  r.writeHead(200, { "Content-Type": MIME[extname(f)] || "text/plain" });
  r.end(readFileSync(f));
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;
const nav = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
const errores = [];
const esperar = ms => new Promise(r => setTimeout(r, ms));
const contextos = [];

// ⚠️ UN DISPOSITIVO LIMPIO POR ESCENARIO. Sin esto las páginas comparten el
// mismo localStorage del navegador y los cultivos de un caso se cuelan en el
// siguiente: el recuento deja de medir lo que cree medir.
async function nuevaPagina(sembrar) {
  const ctx = await nav.createBrowserContext();
  contextos.push(ctx);
  const pag = await ctx.newPage();
  await pag.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  pag.on("pageerror", e => errores.push(e.message));
  await pag.goto(`http://127.0.0.1:${port}/app`, { waitUntil: "domcontentloaded" });
  await esperar(1200);
  if (sembrar) { for (let i = 0; i < 8; i++) { try { await pag.evaluate(sembrar); break; } catch (_) { await esperar(400); } } }
  await pag.goto(`http://127.0.0.1:${port}/app`, { waitUntil: "domcontentloaded" });
  // Esperar a que el alta esté REGISTRADA, no a que pase un tiempo: con la
  // adopción de config en vuelo, la página tarda distinto en cada corrida.
  await pag.waitForFunction("typeof window.kyliaParcelaNueva === 'function'", { timeout: 20000 });
  await esperar(600);
  return pag;
}

// Recorre el alta hasta la pantalla de identificación, con el flujo REAL.
const HASTA_IDENT = async () => {
  const $ = id => document.getElementById(id), sleep = ms => new Promise(r => setTimeout(r, ms));
  const clic = s => { const e = document.querySelector(s); if (!e || e.disabled) return false; e.click(); return true; };
  const hasta = async (cond, ms = 12000) => { const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (cond()) return true; await sleep(60); } return false; };
  window.kyliaParcelaNueva({ lat: 41.3255, lon: 2.062 });
  await hasta(() => document.querySelectorAll("#pc-mapa path").length > 0);
  document.querySelectorAll("#pc-mapa path")[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await sleep(250); clic("#pc-confirmar"); await sleep(300);
  clic("#pc-habituales [data-cid='lechuga']"); await sleep(120);
  clic("#pc-b-cultivo"); await sleep(200);
  clic("#pc-variedad-nose"); await sleep(120);
  clic("#pc-b-variedad"); await sleep(400);
  if (!$("pc-sup-elegir").hidden) clic("#pc-parte");
  await hasta(() => !!window.__PCF()?.borrador?.geometria);
  clic("#pc-b-sup"); await sleep(300);
  $("pc-fecha").value = "2026-09-10"; $("pc-fecha").dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(150); clic("#pc-b-fecha"); await sleep(300);
  clic("#pc-riego-luego"); await sleep(150);
  clic("#pc-b-riego"); await sleep(300);
  clic("#pc-b-revisar"); await sleep(500);
  return document.querySelector("#pc .alta-paso.activo")?.dataset?.pc;
};
// ⚠️ Una función no viaja por `page.evaluate`: se serializa y llega inservible.
// Se manda su TEXTO y se reconstruye dentro de la página.
const FUENTE_PASO = HASTA_IDENT.toString();

// ══════════════════════════════════════════════════════════════════════
// A · escribir un correo SIN verificarlo
// ══════════════════════════════════════════════════════════════════════
console.log("── A · un correo escrito no es una identidad ──");
{
  pedidas = []; subidas = [];
  const pag = await nuevaPagina();
  const r = await pag.evaluate(async (fuentePaso) => {
    const $ = id => document.getElementById(id), sleep = ms => new Promise(r => setTimeout(r, ms));
    const clic = s => { const e = document.querySelector(s); if (!e || e.disabled) return false; e.click(); return true; };
    const paso_ = eval("(" + fuentePaso + ")");
    const o = { paso: await paso_() };
    o.boton = $("pc-b-ident").textContent.trim();
    o.aviso = $("pc-ident-aviso").textContent;
    $("pc-ident-email").value = "dueño@ejemplo.es";
    clic("#pc-b-ident"); await sleep(2500);
    o.estado = $("pc-ident-estado").textContent;
    o.tarjeta = $("pc-t-donde")?.textContent || "";
    o.verificado = localStorage.getItem("kylia_acceso_verificado");
    o.userId = localStorage.getItem("kylia_user_id");
    o.siembras = JSON.parse(localStorage.getItem("kylia_zonas") || "[]")
      .reduce((n, z) => n + (z.siembras || []).length, 0);
    await sleep(3000);                      // por si la subida fuera con retardo
    o.tarjetaFinal = $("pc-t-donde")?.textContent || "";
    return o;
  }, FUENTE_PASO);
  await pag.close();

  ok(r.paso === "identificacion", "el alta llega a la pantalla de identificación");
  ok(/enlace/i.test(r.boton) && !/cuenta/i.test(r.boton),
     `el botón ofrece el ENLACE, no "guardar en mi cuenta": "${r.boton}"`);
  ok(/enlace/i.test(r.estado) && /Caduca/.test(r.estado),
     `y lo que se dice es que va un enlace: "${r.estado}"`);
  ok(r.verificado === null, "escribir el correo NO deja marca de acceso acreditado");
  ok(r.userId !== AJENO, `ni atribuye el dispositivo a esa cuenta (${r.userId?.slice(0, 8)}… ≠ ${AJENO.slice(0, 8)}…)`);
  ok(r.siembras === 1, "el cultivo se guarda en este dispositivo");
  ok(!/Guardado en tu cuenta/.test(r.tarjetaFinal),
     `y NO se presenta como guardado en ninguna cuenta: "${r.tarjetaFinal}"`);
  ok(/este dispositivo/.test(r.tarjetaFinal) && /enlace/.test(r.tarjetaFinal),
     "se dice dónde está y qué falta para que esté en una cuenta");
  const pedir = pedidas.filter(p => p.recurso === "acceso" && p.accion === "pedir");
  ok(pedir.length === 1 && pedir[0].email === "dueño@ejemplo.es",
     "se pidió el enlace por el mecanismo real (recurso acceso/pedir)");
  ok(!pedidas.some(p => p.recurso === "registro-usuario"),
     "y NO se escribió ese correo en ninguna fila: eso rompería el acceso de su dueño");
  ok(subidas.length === 0, "sin acceso acreditado no se sube nada al servidor");
}

// ══════════════════════════════════════════════════════════════════════
// B · escribir el correo de una cuenta que existe
// ══════════════════════════════════════════════════════════════════════
console.log("\n── B · el correo de otro no abre su configuración ──");
{
  pedidas = []; subidas = [];
  const pag = await nuevaPagina();
  const r = await pag.evaluate(async (fuentePaso, ajeno) => {
    const $ = id => document.getElementById(id), sleep = ms => new Promise(r => setTimeout(r, ms));
    const clic = s => { const e = document.querySelector(s); if (!e || e.disabled) return false; e.click(); return true; };
    const paso_ = eval("(" + fuentePaso + ")");
    const o = { paso: await paso_() };
    o.idAntes = localStorage.getItem("kylia_user_id");
    $("pc-ident-email").value = "dueño@ejemplo.es";     // el correo del OTRO
    clic("#pc-b-ident"); await sleep(3500);
    o.idDespues = localStorage.getItem("kylia_user_id");
    o.base = localStorage.getItem("kylia_config_base");
    o.zonasLocales = JSON.parse(localStorage.getItem("kylia_zonas") || "[]").length;
    o.verificado = localStorage.getItem("kylia_acceso_verificado");
    // ¿Se habría adoptado su configuración? El indicador es el propietario.
    o.adoptoAlOtro = o.idDespues === ajeno;
    return o;
  }, FUENTE_PASO, AJENO);
  await pag.close();

  ok(r.idDespues === r.idAntes, "el dispositivo sigue siendo el mismo: no adopta al otro propietario");
  ok(r.adoptoAlOtro === false, "escribir su correo NO da acceso a su configuración");
  ok(r.verificado === null, "ni deja marca de acceso acreditado");
  ok(subidas.length === 0, "y no se escribe nada en su cuenta");
  ok(!pedidas.some(p => p.recurso === "registro-usuario" && p.email === "dueño@ejemplo.es"),
     "tampoco se cuela su correo en la fila de este dispositivo");
}

// ══════════════════════════════════════════════════════════════════════
// C · el envío falla / el enlace no vale
// ══════════════════════════════════════════════════════════════════════
console.log("\n── C · el enlace falla y el borrador aguanta ──");
{
  pedidas = []; subidas = []; envioFalla = true;
  const pag = await nuevaPagina();
  const r = await pag.evaluate(async (fuentePaso) => {
    const $ = id => document.getElementById(id), sleep = ms => new Promise(r => setTimeout(r, ms));
    const clic = s => { const e = document.querySelector(s); if (!e || e.disabled) return false; e.click(); return true; };
    const paso_ = eval("(" + fuentePaso + ")");
    const o = { paso: await paso_() };
    $("pc-ident-email").value = "yo@ejemplo.es";
    clic("#pc-b-ident"); await sleep(3500);
    o.estado = $("pc-ident-estado").textContent;
    o.tarjeta = $("pc-t-donde")?.textContent || "";
    o.siembras = JSON.parse(localStorage.getItem("kylia_zonas") || "[]")
      .reduce((n, z) => n + (z.siembras || []).length, 0);
    o.verificado = localStorage.getItem("kylia_acceso_verificado");
    o.base = localStorage.getItem("kylia_config_base");
    return o;
  }, FUENTE_PASO);
  await pag.close();
  envioFalla = false;

  ok(/No hemos podido enviarlo/.test(r.estado), `se dice que el envío falló: "${r.estado}"`);
  ok(r.siembras === 1, `el cultivo NO se pierde (${r.siembras})`);
  ok(!/Guardado en tu cuenta/.test(r.tarjeta), "y no hay falso éxito remoto");
  ok(r.verificado === null && r.base === null,
     "sin owner adoptado ni base: no se asocia nada que no se haya acreditado");
  ok(subidas.length === 0, "y no llega ninguna escritura al servidor");
}

// ══════════════════════════════════════════════════════════════════════
// C bis · el enlace se canjea y NO vale
// ══════════════════════════════════════════════════════════════════════
console.log("\n── C bis · enlace inválido o caducado ──");
{
  canjeVale = false;
  const ctx = await nav.createBrowserContext(); contextos.push(ctx);
  const pag = await ctx.newPage();
  pag.on("dialog", async d => { await d.dismiss(); });
  pag.on("pageerror", e => errores.push(e.message));
  await pag.goto(`http://127.0.0.1:${port}/app`, { waitUntil: "domcontentloaded" });
  await esperar(1500);
  for (let i = 0; i < 8; i++) { try { await pag.evaluate(() => {
    localStorage.setItem("kylia_zonas", JSON.stringify([{ referencia: "R1", superficie_m2: 5000,
      geometria: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] },
      siembras: [{ id: "s1", cultivo: "lechuga", area_m2: 1500, variedad: "Romana",
                   sync: { nueva: true, vista: null, confirmada: null, token: "t1" } }] }]));
  }); break; } catch (_) { await esperar(400); } }
  const idAntes = await pag.evaluate(() => localStorage.getItem("kylia_user_id"));
  try { await pag.goto(`http://127.0.0.1:${port}/app?acceso=TOKEN-MALO`, { waitUntil: "domcontentloaded" }); }
  catch (_) { /* la página redirige sola */ }
  await esperar(3500);
  let d = null;
  for (let i = 0; i < 8; i++) { try { d = await pag.evaluate(() => ({
    siembras: JSON.parse(localStorage.getItem("kylia_zonas") || "[]").reduce((n, z) => n + (z.siembras || []).length, 0),
    userId: localStorage.getItem("kylia_user_id"),
    verificado: localStorage.getItem("kylia_acceso_verificado"),
  })); break; } catch (_) { await esperar(500); } }
  await pag.close();
  canjeVale = true;

  ok(d && d.siembras === 1, `un enlace que no vale NO toca lo guardado (${d?.siembras})`);
  ok(d && d.userId === idAntes, "ni cambia de propietario");
  ok(d && d.verificado === null, "ni deja marca de acceso");
}

// ══════════════════════════════════════════════════════════════════════
// D · verificación correcta  ·  E · otra pestaña  ·  F · ya verificado
// ══════════════════════════════════════════════════════════════════════
console.log("\n── D · canje correcto: propietario, base y sin duplicar ──");
{
  pedidas = []; subidas = [];
  const ctx = await nav.createBrowserContext(); contextos.push(ctx);
  const pag = await ctx.newPage();
  pag.on("dialog", async d => { await d.dismiss(); });
  pag.on("pageerror", e => errores.push(e.message));
  await pag.goto(`http://127.0.0.1:${port}/app`, { waitUntil: "domcontentloaded" });
  await esperar(1500);
  try { await pag.goto(`http://127.0.0.1:${port}/app?acceso=TOKEN-BUENO`, { waitUntil: "domcontentloaded" }); }
  catch (_) {}
  await esperar(3500);
  let d = null;
  for (let i = 0; i < 8; i++) { try { d = await pag.evaluate(() => ({
    userId: localStorage.getItem("kylia_user_id"),
    verificado: JSON.parse(localStorage.getItem("kylia_acceso_verificado") || "null"),
    base: JSON.parse(localStorage.getItem("kylia_config_base") || "null"),
    email: localStorage.getItem("kylia_user_email"),
  })); break; } catch (_) { await esperar(500); } }

  ok(d && d.userId === AJENO, "el dispositivo pasa a ser del propietario del enlace");
  ok(d && d.verificado && d.verificado.propietario_id === AJENO,
     "y queda la marca de acceso acreditado, ligada a ESE propietario");
  ok(d && d.base && d.base.owner_id === AJENO,
     `con la base del CAS de ese mismo propietario (v${d?.base?.base_version})`);

  // F · ya verificado: el alta NO vuelve a pedir identificación.
  console.log("\n── F · quien ya canjeó no vuelve a identificarse ──");
  const r = await pag.evaluate(async (fuentePaso) => {
    const paso_ = eval("(" + fuentePaso + ")");
    const o = { paso: await paso_() };
    o.siembras = JSON.parse(localStorage.getItem("kylia_zonas") || "[]")
      .reduce((n, z) => n + (z.siembras || []).length, 0);
    o.tarjeta = document.getElementById("pc-t-donde")?.textContent || "";
    return o;
  }, FUENTE_PASO);
  ok(r.paso === "guardado", `se guarda sin pasar por la pantalla del correo (paso: ${r.paso})`);
  ok(r.siembras === 1, `con su cultivo, una sola vez (${r.siembras})`);
  await esperar(3500);
  const tarjeta = await pag.evaluate(() => document.getElementById("pc-t-donde")?.textContent || "");
  ok(/Guardado en tu cuenta/.test(tarjeta),
     `y AHORA sí se puede decir "guardado en tu cuenta": "${tarjeta}"`);
  ok(subidas.length >= 1 && subidas[0].propietario_id === AJENO,
     `la subida va al propietario correcto (${subidas[0]?.propietario_id?.slice(0, 8)}…)`);
  await pag.close();
}

// ══════════════════════════════════════════════════════════════════════
// E · el enlace se abre en OTRO navegador
// ══════════════════════════════════════════════════════════════════════
console.log("\n── E · el enlace se abre en otro navegador ──");
{
  // Navegador 1: tiene el borrador a medias. Nunca canjea.
  const uno = await nav.createBrowserContext();
  const p1 = await uno.newPage();
  await p1.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await p1.goto(`http://127.0.0.1:${port}/app`, { waitUntil: "domcontentloaded" });
  await p1.waitForFunction("typeof window.kyliaParcelaNueva === 'function'", { timeout: 20000 });
  await esperar(600);
  await p1.evaluate(async (fuentePaso) => { await eval("(" + fuentePaso + ")")(); }, FUENTE_PASO);
  const antes1 = await p1.evaluate(() => ({
    borrador: !!localStorage.getItem("kylia_alta_borrador"),
    cultivo: JSON.parse(localStorage.getItem("kylia_alta_borrador") || "{}")?.flujo?.borrador?.cultivoId ?? null,
  }));

  // Navegador 2 (contexto aparte: otro localStorage). Abre el enlace.
  const dos = await nav.createBrowserContext();
  const p2 = await dos.newPage();
  p2.on("dialog", async d => { await d.dismiss(); });
  try { await p2.goto(`http://127.0.0.1:${port}/app?acceso=TOKEN-BUENO`, { waitUntil: "domcontentloaded" }); }
  catch (_) {}
  await esperar(3000);
  let d2 = null;
  for (let i = 0; i < 8; i++) { try { d2 = await p2.evaluate(() => ({
    userId: localStorage.getItem("kylia_user_id"),
    borrador: !!localStorage.getItem("kylia_alta_borrador"),
  })); break; } catch (_) { await esperar(500); } }

  // Navegador 1, después: su borrador sigue ahí y NO se ha asociado a nadie.
  const despues1 = await p1.evaluate(() => ({
    borrador: !!localStorage.getItem("kylia_alta_borrador"),
    cultivo: JSON.parse(localStorage.getItem("kylia_alta_borrador") || "{}")?.flujo?.borrador?.cultivoId ?? null,
    userId: localStorage.getItem("kylia_user_id"),
    verificado: localStorage.getItem("kylia_acceso_verificado"),
  }));
  await p1.close(); await p2.close(); await uno.close(); await dos.close();

  ok(antes1.borrador === true, "el navegador que estaba dando de alta tiene su borrador");
  ok(despues1.borrador === true && despues1.cultivo === antes1.cultivo,
     `y lo conserva después de que el enlace se abra en otro sitio (${despues1.cultivo})`);
  ok(despues1.verificado === null && despues1.userId !== AJENO,
     "no se le asocia el propietario del otro navegador: no comparten almacenamiento");
  ok(d2 && d2.userId === AJENO, "y el navegador que abrió el enlace sí adopta al propietario");
  ok(d2 && d2.borrador === false, "sin heredar el borrador del primero: son orígenes distintos");
}

await nav.close();
srv.close();

console.log("\n── sin errores de JavaScript ──");
ok(errores.length === 0, `0 errores de página (${errores.length})${errores.length ? ": " + errores.slice(0, 3).join(" | ") : ""}`);

console.log(fallos ? `\n${fallos} test(s) FALLARON` : "\n✅ TODOS LOS TESTS VERDES");
process.exit(fallos ? 1 : 0);
