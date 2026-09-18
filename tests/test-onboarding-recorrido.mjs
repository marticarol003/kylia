// El recorrido NUEVO del alta, ejecutado en Chrome de verdad.
//   node tests/test-onboarding-recorrido.mjs
//
// tests/test-alta-cultivo.mjs es la regresión de lo que ya funcionaba. Esto
// prueba lo que se pidió en la mejora del onboarding y antes no existía:
//
//   · la variedad se contesta SIEMPRE (o se escribe, o se declara desconocida)
//   · el buscador no confirma un cultivo a medio teclear
//   · la fecha se escribe; "hoy" no se rellena solo
//   · el riego va pregunta a pregunta, y cada instalación tiene la SUYA
//   · a unos aspersores que se mueven no se les aplica la fórmula de la malla
//   · "no lo sé" lleva a ayuda de verdad, no a un callejón
//   · el repaso es editable y no dice "todo listo"
//   · identificarse va al final, y fallar ahí NO cuesta el borrador
//   · móvil 390 px y escritorio 1366 px: mismo recorrido, sin scroll lateral
//
// Se simula el TRANSPORTE (SIGPAC y la red), nunca la lógica.
import { readFileSync, existsSync, mkdirSync } from "fs";
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

const LAT0 = 41.324, LON0 = 2.060, mLat = (m) => m / 111320, mLon = (m) => m / 83600;
const cuad = (x0, y0, l) => [[
  [LON0 + mLon(x0), LAT0 + mLat(y0)], [LON0 + mLon(x0 + l), LAT0 + mLat(y0)],
  [LON0 + mLon(x0 + l), LAT0 + mLat(y0 + l)], [LON0 + mLon(x0), LAT0 + mLat(y0 + l)],
  [LON0 + mLon(x0), LAT0 + mLat(y0)]]];
// 5.000 m² justos, para el caso B del encargo (1.500 registrados, 3.500 fuera).
const RECINTOS = { recintos: [
  { referencia: "R1", superficie_m2: 5000, uso: "TA", satelite: true,
    geometria: { type: "Polygon", coordinates: cuad(0, 0, 70.7) } },
], umbral_satelite_m2: 5000 };

// El registro de usuario se puede hacer FALLAR a voluntad: es lo que prueba que
// el borrador sobrevive a una identificación que no sale bien.
let registroFalla = false;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const srv = createServer((q, r) => {
  const u = q.url.split("?")[0];
  if (u.startsWith("/api/sigpac")) { r.writeHead(200, { "Content-Type": "application/json" }); return r.end(JSON.stringify(RECINTOS)); }
  if (u.startsWith("/api/registro-usuario") && registroFalla) { r.writeHead(500); return r.end('{"ok":false}'); }
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

async function abrirApp({ ancho, alto, movil, conCorreo }) {
  const pag = await nav.newPage();
  await pag.setViewport({ width: ancho, height: alto, isMobile: !!movil, hasTouch: !!movil });
  pag.on("pageerror", e => errores.push(`${ancho}px · ${e.message}`));
  await pag.goto(`http://127.0.0.1:${port}/app`, { waitUntil: "domcontentloaded" });
  await pag.evaluate((con) => {
    localStorage.clear();
    if (con) {
      // `conCorreo` significa, de verdad, ACCESO ACREDITADO: un dispositivo que
      // canjeó su enlace. Un correo suelto no acredita nada y por eso no basta.
      const PROP = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      localStorage.setItem("kylia_user_id", PROP);
      localStorage.setItem("kylia_acceso_verificado",
        JSON.stringify({ propietario_id: PROP, en: new Date().toISOString() }));
      localStorage.setItem("kylia_user_email", "prueba@kylia.app");
    }
    localStorage.setItem("kylia_config", JSON.stringify({ lat: 41.3255, lon: 2.062, suelo: "franco",
      cultivos: [], metodoRiego: "aspersion", caudal: 11.2 }));
  }, !!conCorreo);
  await pag.goto(`http://127.0.0.1:${port}/app`, { waitUntil: "networkidle2", timeout: 30000 });
  return pag;
}

// ══════════════════════════════════════════════════════════════════════
// MÓVIL · el recorrido entero
// ══════════════════════════════════════════════════════════════════════
const pag = await abrirApp({ ancho: 390, alto: 844, movil: true, conCorreo: false });

const R = await pag.evaluate(async () => {
  const o = {}, $ = id => document.getElementById(id), sleep = ms => new Promise(r => setTimeout(r, ms));
  const clic = s => { const e = document.querySelector(s); if (!e || e.disabled) return false; e.click(); return true; };
  const hasta = async (cond, ms = 12000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (cond()) return true; await sleep(60); }
    return false;
  };
  const recintosListos = () => hasta(() => document.querySelectorAll("#pc-mapa path").length > 0);
  const contornoListo  = () => hasta(() => !!window.__PCF()?.borrador?.geometria);

  const paso = () => document.querySelector("#pc .alta-paso.activo")?.dataset?.pc;
  const preg = () => [...document.querySelectorAll("#pc [data-preg]")].find(x => !x.hidden)?.dataset?.preg || null;
  const escribir = (id, v) => { $(id).value = v; $(id).dispatchEvent(new Event("input", { bubbles: true })); };
  const zonas = () => JSON.parse(localStorage.getItem("kylia_zonas") || "[]");
  try {

  // ── elegir terreno ───────────────────────────────────────────────────
  window.kyliaParcelaNueva({ lat: 41.3255, lon: 2.062 });
  await sleep(1600);
  document.querySelectorAll("#pc-mapa path")[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await sleep(250);
  clic("#pc-confirmar"); await sleep(250);
  o.paso_tras_terreno = paso();
  // §1 · no se promete un número fijo de pantallas.
  o.avance = $("pc-avance").textContent;

  // ── §4 · el buscador es la entrada principal ─────────────────────────
  const orden = [...document.querySelector("[data-pc='cultivo']").children].map(e => e.id);
  o.buscadorAntesQueParrilla =
    orden.indexOf("pc-cultivo-txt") > -1 && orden.indexOf("pc-habituales") > -1
    && orden.indexOf("pc-cultivo-txt") < orden.indexOf("pc-habituales");
  o.atajoTit = document.getElementById("pc-habituales-tit").textContent;
  o.placeholder = $("pc-cultivo-txt").placeholder;
  // teclear a medias no elige
  escribir("pc-cultivo-txt", "lechu"); await sleep(150);
  o.aMedias_id = window.__PCF()?.borrador?.cultivoId;
  o.aMedias_boton = $("pc-b-cultivo").disabled;
  // teclado: flecha abajo + Enter
  $("pc-cultivo-txt").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await sleep(80);
  o.tecladoMarca = document.querySelector("#pc-sug button[aria-selected='true']")?.textContent?.trim();
  $("pc-cultivo-txt").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await sleep(150);
  o.trasTeclado = window.__PCF()?.borrador?.cultivoId;
  o.elegidoVisible = $("pc-elegido").hidden === false;
  // editar el texto NO borra la elección
  escribir("pc-cultivo-txt", "otra cosa"); await sleep(150);
  o.elegidoSigue = window.__PCF()?.borrador?.cultivoId;
  o.elegidoSigueVisible = $("pc-elegido").hidden === false;
  escribir("pc-cultivo-txt", ""); await sleep(100);
  clic("#pc-b-cultivo"); await sleep(250);

  // ── §5 · variedad ────────────────────────────────────────────────────
  o.paso_variedad = paso();
  o.variedadPreg = $("pc-variedad-preg").textContent;
  o.variedadBotonAlEntrar = $("pc-b-variedad").disabled;      // no se puede omitir
  o.variedadPreseleccion = $("pc-variedad-txt").value;        // nada preseleccionado
  escribir("pc-variedad-txt", "Romana"); await sleep(120);
  o.variedadTrasEscribir = $("pc-b-variedad").disabled;
  clic("#pc-b-variedad"); await sleep(900);

  // ── §3 · zona que ocupa ──────────────────────────────────────────────
  o.paso_superficie = paso();
  o.supPreg = $("pc-sup-preg").textContent;
  o.supIntro = $("pc-sup-intro").textContent;
  o.opcionTodo = $("pc-todo").querySelector(".pc-btn-tit")?.textContent?.trim();
  o.opcionParte = $("pc-parte").querySelector(".pc-btn-tit")?.textContent?.trim();
  clic("#pc-parte"); await contornoListo();
  o.supNota = $("pc-sup-nota").textContent;
  o.supArea = Math.round(window.__PCF()?.borrador?.area_m2 || 0);
  clic("#pc-b-sup"); await sleep(300);

  // ── §7 · fecha ───────────────────────────────────────────────────────
  o.paso_fecha = paso();
  o.fechaCampoExiste = !!$("pc-fecha") && $("pc-fecha").type === "date";
  o.fechaPrecargada = $("pc-fecha").value;                    // vacío: no se rellena "hoy"
  o.fechaBoton = $("pc-b-fecha").disabled;
  o.fechaSalida = $("pc-sin-fecha").textContent.trim();
  // escribir la fecha (entrada principal)
  $("pc-fecha").value = "2026-09-12";
  $("pc-fecha").dispatchEvent(new Event("change", { bubbles: true })); await sleep(150);
  o.fechaNota = $("pc-fecha-nota").textContent;
  o.fechaPrecision = window.__PCF()?.borrador?.fechaPrecision;
  clic("#pc-b-fecha"); await sleep(300);

  // ── §8A · goteo, una pregunta cada vez ───────────────────────────────
  o.paso_riego = paso();
  o.riegoCtx = $("pc-riego-ctx").textContent;                 // de qué cultivo hablamos
  o.pregInicial = preg();
  clic("#pc-metodo [data-metodo='goteo']"); await sleep(150);
  o.pregTrasMetodo = preg();
  clic("#pc-inst-ahora"); await sleep(150);
  // el supuesto de la fórmula, preguntado ANTES de aplicarla
  o.pregRegular = preg();
  o.textoRegular = document.querySelector("[data-preg='g-regular'] .alta-preg").textContent;
  clic("#pc-g-regular [data-reg='regular']"); await sleep(150);
  o.pregCaudal = preg();
  // solo UNA pregunta visible a la vez
  o.visiblesALaVez = [...document.querySelectorAll("#pc [data-preg]")].filter(x => !x.hidden).length;
  o.unidadCaudal = document.querySelector("[data-preg='g-q'] .pc-unidad").textContent;
  // Un solo botón principal a la vista: el de la pregunta. El del paso, oculto.
  o.botonesVisibles = [...document.querySelectorAll("[data-pc='riego'] .alta-btn")]
    .filter(b => b.offsetParent).map(b => b.textContent.trim());
  o.hayNoLoSe = !!document.querySelector("[data-preg='g-q'] [data-nose]");
  // COMA DECIMAL
  escribir("pc-gq-txt", "1,6"); await sleep(100);
  clic("#pc-b-gq"); await sleep(150);
  o.pregSepGoteros = preg();
  o.textoSepGoteros = document.querySelector("[data-preg='g-sep'] .alta-preg").textContent;
  o.notaSepGoteros = document.querySelector("[data-preg='g-sep'] .alta-nota").textContent;
  o.dibujoSepGoteros = !!document.querySelector("[data-preg='g-sep'] svg[aria-label]");
  o.unidadSepGoteros = document.querySelector("[data-preg='g-sep'] .pc-unidad").textContent;
  escribir("pc-gsep-txt", "30"); await sleep(100);            // en cm
  clic("#pc-b-gsep"); await sleep(150);
  o.pregSepLineas = preg();
  o.textoSepLineas = document.querySelector("[data-preg='g-lin'] .alta-preg").textContent;
  o.notaSepLineas = document.querySelector("[data-preg='g-lin'] .alta-nota").textContent;
  o.dibujoSepLineas = !!document.querySelector("[data-preg='g-lin'] svg[aria-label]");
  // ATRÁS dentro del riego retrocede UNA pregunta y conserva lo escrito
  clic("#pc-atras"); await sleep(150);
  o.atrasEnRiego = preg();
  o.atrasConserva = $("pc-gsep-txt").value;
  clic("#pc-b-gsep"); await sleep(150);
  escribir("pc-glin-txt", "1"); await sleep(100);
  clic("#pc-b-glin"); await sleep(250);
  o.riegoRes = $("pc-riego-res").textContent;
  o.tecnico = $("pc-tecnico-txt").textContent;
  o.caudalDerivado = window.KyliaRiego.derivar("goteo",
    { disposicion: "regular", l_h_gotero: 1.6, sep_goteros_m: 0.3, sep_lineas_m: 1 }).valor;
  clic("#pc-b-riego"); await sleep(300);

  // ── §9 · repaso editable ─────────────────────────────────────────────
  o.paso_revisar = paso();
  o.revision = [...document.querySelectorAll("#pc-revision .pc-rev-fila")]
    .map(b => b.textContent.replace(/\s+/g, " ").trim());
  o.revisarPend = $("pc-revisar-pend").textContent;
  o.sinTodoListo = !/todo listo/i.test(document.querySelector("[data-pc='revisar']").textContent);
  // corregir la variedad desde el repaso y volver AL repaso
  const filaVar = [...document.querySelectorAll("#pc-revision .pc-rev-fila")]
    .find(b => b.dataset.ir === "variedad");
  filaVar.click(); await sleep(250);
  o.tocarLlevaA = paso();
  escribir("pc-variedad-txt", "Trocadero"); await sleep(120);
  clic("#pc-b-variedad"); await sleep(300);
  o.vuelveAlRepaso = paso();
  o.variedadCorregida = /Trocadero/.test($("pc-revision").textContent);

  // ── §2 · identificarse, al final y sin perder nada ───────────────────
  clic("#pc-b-revisar"); await sleep(300);
  o.paso_identificacion = paso();
  o.identTexto = document.querySelector("[data-pc='identificacion'] .alta-preg").textContent;
  o.borradorAntesDeIdentificar = window.kyliaHayAltaPendiente();
  o.siembrasAntesDeIdentificar = zonas().reduce((n, z) => n + (z.siembras || []).length, 0);
  // correo mal escrito: NO guarda, NO pierde el borrador
  escribir("pc-ident-email", "esto-no-es-un-correo");
  clic("#pc-b-ident"); await sleep(300);
  o.identError = $("pc-ident-estado").textContent;
  o.trasErrorSigueElBorrador = window.kyliaHayAltaPendiente();
  o.trasErrorSiembras = zonas().reduce((n, z) => n + (z.siembras || []).length, 0);
  o.trasErrorPaso = paso();
  // cerrar la pantalla en plena identificación
  clic("#pc-cerrar"); await sleep(250);
  o.trasCerrarHayBorrador = window.kyliaHayAltaPendiente();
  o.trasCerrarSiembras = zonas().reduce((n, z) => n + (z.siembras || []).length, 0);
  // retomar: sigue todo
  o.retoma = window.kyliaAltaPendiente(); await sleep(350);
  o.retomaVariedad = window.__PCF()?.borrador?.variedad;
  o.retomaCultivo = window.__PCF()?.borrador?.cultivoId;
  o.retomaFecha = window.__PCF()?.borrador?.fechaPlantacion;
  o.retomaCaudal = window.__PCF()?.borrador?.caudal;

  } catch (e) { o.__error = e.message + " @ " + String(e.stack || "").split("\n")[1]; }
  return o;
});

if (R.__error) { console.log("  ✗ el recorrido se rompió:", R.__error); fallos++; }

console.log("── §1 · el recorrido ──");
ok(R.paso_tras_terreno === "cultivo", "elegir terreno lleva al cultivo");
ok(!/de \d/.test(R.avance || ""),
   `no se promete un número fijo de pantallas: "${R.avance}"`);

console.log("\n── §4 · buscador en vez de parrilla ──");
ok(R.buscadorAntesQueParrilla === true, "el buscador va ANTES que la parrilla de habituales");
ok(/O elige/.test(R.atajoTit || ""), `y la parrilla se presenta como atajo: "${R.atajoTit}"`);
ok(/Escribe un cultivo/.test(R.placeholder || ""), `y dice qué hacer: "${R.placeholder}"`);
ok(R.aMedias_id == null && R.aMedias_boton === true,
   "escribir \"lechu\" NO elige nada ni enciende Seguir (antes creaba un otro: sin Kc)");
ok(/Lechuga/.test(R.tecladoMarca || ""), `se navega con teclado: "${R.tecladoMarca}"`);
ok(R.trasTeclado === "lechuga", "y Enter confirma el cultivo canónico");
ok(R.elegidoVisible === true, "el cultivo confirmado se ve");
ok(R.elegidoSigue === "lechuga" && R.elegidoSigueVisible === true,
   "editar el texto NO oculta ni borra la selección anterior");

console.log("\n── §5 · variedad ──");
ok(R.paso_variedad === "variedad", "se pregunta siempre, justo después del cultivo");
ok(/variedad/i.test(R.variedadPreg || ""), `con su pregunta: "${R.variedadPreg}"`);
ok(R.variedadBotonAlEntrar === true, "no se puede omitir en silencio: Seguir nace apagado");
ok(R.variedadPreseleccion === "", "y no hay ninguna variedad preseleccionada");
ok(R.variedadTrasEscribir === false, "escribirla deja seguir");

console.log("\n── §3 · zona que ocupa ──");
ok(/lechuga/.test(R.supPreg || ""), `la pregunta nombra el cultivo: "${R.supPreg}"`);
ok(/Registra solo lo que quieras gestionar con Kylia/.test(R.supIntro || ""),
   `y el mensaje es el acordado: "${R.supIntro}"`);
ok(!/No necesitas registrar/.test(R.supIntro || ""), "sin la frase vieja");
ok(R.opcionTodo === "Todo este terreno"
   && R.opcionParte === "Solo una zona: la marcaré en el mapa",
   `las dos opciones, con el texto acordado: "${R.opcionTodo}" / "${R.opcionParte}"`);
ok(/^Vas a registrar [\d.]+ m² de lechuga\./.test((R.supNota || "").trim())
   && /Los otros [\d.]+ m² quedan sin configurar en Kylia/.test(R.supNota || ""),
   `el resumen da los dos números, concretos: "${R.supNota}"`);
ok(/sin configurar no es sin cultivar/i.test(R.supNota || ""),
   "y aclara que sin configurar no significa sin cultivar");

console.log("\n── §7 · fecha ──");
ok(R.fechaCampoExiste === true, "la entrada principal es un campo de fecha con calendario");
ok(R.fechaPrecargada === "", "que NO viene relleno con hoy");
ok(R.fechaBoton === true, "y sin contestar no se puede seguir");
ok(/No recuerdo la fecha/.test(R.fechaSalida || ""), `con su salida: "${R.fechaSalida}"`);
ok(R.fechaPrecision === "exacta", "una fecha escrita se guarda como exacta");

console.log("\n── §8A · goteo, pregunta a pregunta ──");
ok(R.riegoCtx && /lechuga/.test(R.riegoCtx), `se dice de qué cultivo hablamos: "${R.riegoCtx}"`);
ok(R.visiblesALaVez === 1, `solo UNA pregunta visible a la vez (${R.visiblesALaVez})`);
ok(R.pregRegular === "g-regular" && /iguales/.test(R.textoRegular || ""),
   "antes de aplicar la fórmula se comprueba que la instalación es regular");
ok(/L\/h por gotero/.test(R.unidadCaudal || ""), `la unidad va junto al campo: "${R.unidadCaudal}"`);
ok(R.hayNoLoSe === true, "y el caudal admite \"No lo sé\"");
ok(R.botonesVisibles.length === 1,
   `un solo botón principal a la vista, no dos iguales: ${JSON.stringify(R.botonesVisibles)}`);
ok(R.pregSepGoteros === "g-sep" && R.pregSepLineas === "g-lin",
   "después van, por orden, la separación de goteros y la de líneas");
ok(/goteros/.test(R.textoSepGoteros || "") && /No es la distancia entre plantas/.test(R.notaSepGoteros || ""),
   "los goteros se distinguen de las plantas EXPLÍCITAMENTE");
ok(/líneas de goteo/.test(R.textoSepLineas || "") && /filas de plantas/.test(R.notaSepLineas || ""),
   "y las líneas de riego de las filas de cultivo");
ok(R.dibujoSepGoteros === true && R.dibujoSepLineas === true,
   "cada distancia lleva su dibujo, con descripción para quien no lo ve");
ok(/cm/.test(R.unidadSepGoteros || ""), `en centímetros, dicho junto al campo: "${R.unidadSepGoteros}"`);
ok(R.atrasEnRiego === "g-sep" && R.atrasConserva === "30",
   "Atrás retrocede UNA pregunta y conserva lo escrito");
// 1,6 L/h ÷ (0,30 m × 1 m) = 5,3 mm/h. Si la coma no se aceptara, no habría número.
ok(R.caudalDerivado === 5.3 && new RegExp(String(R.caudalDerivado).replace(".", "\\.")).test(R.tecnico || ""),
   `la coma decimal se acepta y se convierte una vez: ${R.caudalDerivado} mm/h`);

console.log("\n── §9 · repaso ──");
ok(R.paso_revisar === "revisar", "antes de guardar se repasa");
ok(R.revision.length >= 6, `con todas las líneas (${R.revision.length})`);
ok(/Variedad/.test(R.revision.join(" ")) && /Romana/.test(R.revision.join(" ")),
   "incluida la variedad contestada");
ok(R.sinTodoListo === true, "y NO dice \"todo listo\"");
ok(R.tocarLlevaA === "variedad", "tocar una línea abre la pantalla que la contestó");
ok(R.vuelveAlRepaso === "revisar" && R.variedadCorregida === true,
   "y al confirmar se vuelve al repaso con el cambio hecho");

console.log("\n── §2 · identificarse: el borrador aguanta ──");
ok(R.paso_identificacion === "identificacion", "solo al final se pide el correo");
ok(/Guarda tu parcela para no perderla/.test(R.identTexto || ""),
   `con el texto acordado: "${R.identTexto}"`);
ok(R.borradorAntesDeIdentificar === true,
   "y lo contestado YA está en el borrador antes de pedir nada");
ok(R.siembrasAntesDeIdentificar === 0, "sin haber creado todavía ningún cultivo");
ok(/correo válido/.test(R.identError || ""), `un correo mal escrito se explica: "${R.identError}"`);
ok(R.trasErrorSigueElBorrador === true && R.trasErrorSiembras === 0,
   "fallar la identificación NO pierde el borrador ni crea cultivos");
ok(R.trasCerrarHayBorrador === true && R.trasCerrarSiembras === 0,
   "cerrar la pantalla en plena identificación, tampoco");
ok(R.retoma === true, "y se puede retomar");
ok(R.retomaCultivo === "lechuga" && R.retomaVariedad === "Trocadero"
   && R.retomaFecha === "2026-09-12" && R.retomaCaudal === 5.3,
   `con TODO lo contestado: ${R.retomaCultivo} / ${R.retomaVariedad} / ${R.retomaFecha} / ${R.retomaCaudal} mm/h`);

// ══════════════════════════════════════════════════════════════════════
// §8B/§8C · las variantes de riego, y §12·D · los desconocidos
// ══════════════════════════════════════════════════════════════════════
const pag2 = await abrirApp({ ancho: 390, alto: 844, movil: true, conCorreo: true });
const V = await pag2.evaluate(async () => {
  const o = {}, $ = id => document.getElementById(id), sleep = ms => new Promise(r => setTimeout(r, ms));
  const clic = s => { const e = document.querySelector(s); if (!e || e.disabled) return false; e.click(); return true; };
  const hasta = async (cond, ms = 12000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (cond()) return true; await sleep(60); }
    return false;
  };
  const recintosListos = () => hasta(() => document.querySelectorAll("#pc-mapa path").length > 0);
  const contornoListo  = () => hasta(() => !!window.__PCF()?.borrador?.geometria);

  const preg = () => [...document.querySelectorAll("#pc [data-preg]")].find(x => !x.hidden)?.dataset?.preg || null;
  const escribir = (id, v) => { $(id).value = v; $(id).dispatchEvent(new Event("input", { bubbles: true })); };
  const zonas = () => JSON.parse(localStorage.getItem("kylia_zonas") || "[]");
  const ultima = () => zonas()[0]?.siembras?.slice(-1)[0];
  // Lleva un cultivo hasta el paso de riego. Todo lo anterior por el camino real.
  async function hastaRiego(cid, { sinFecha = false } = {}) {
    if (zonas().length) window.kyliaCultivoNuevo("R1"); else window.kyliaParcelaNueva({ lat: 41.3255, lon: 2.062 });
    await sleep(zonas().length ? 500 : 1700);
    if (!zonas().length) {
      document.querySelectorAll("#pc-mapa path")[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await sleep(250); clic("#pc-confirmar"); await sleep(250);
    }
    clic(`#pc-habituales [data-cid='${cid}']`); await sleep(120);
    clic("#pc-b-cultivo"); await sleep(200);
    clic("#pc-variedad-nose"); await sleep(120);
    clic("#pc-b-variedad"); await sleep(400);
    // Con el terreno vacío hay que elegir "todo" o "una zona"; con cultivos
    // dentro, la pantalla entra ya dibujando el contorno.
    if (!$("pc-sup-elegir").hidden) { clic("#pc-parte"); await sleep(1500); }
    else await sleep(1200);
    clic("#pc-b-sup"); await sleep(300);
    if (sinFecha) clic("#pc-sin-fecha"); else {
      $("pc-fecha").value = "2026-09-01";
      $("pc-fecha").dispatchEvent(new Event("change", { bubbles: true }));
    }
    await sleep(150); clic("#pc-b-fecha"); await sleep(300);
  }
  const cerrar = async () => { clic("#pc-b-riego"); await sleep(300); clic("#pc-b-revisar"); await sleep(900);
                               clic("#pc-listo"); await sleep(250); };
  try {

  // ── ASPERSIÓN MÓVIL · la malla NO se le aplica ───────────────────────
  await hastaRiego("tomate");
  clic("#pc-metodo [data-metodo='aspersion']"); await sleep(150);
  clic("#pc-inst-ahora"); await sleep(150);
  o.asp_primera = preg();
  o.asp_opciones = [...document.querySelectorAll("#pc-a-fijos .pc-opcion")].map(x => x.textContent.trim());
  o.asp_sinNoLoSe = !/no lo s/i.test(document.querySelector("[data-preg='a-fijos']").textContent);
  clic("#pc-a-fijos [data-fijos='0']"); await sleep(200);        // los voy moviendo
  o.movil_va_a = preg();
  o.movil_texto = $("pc-riego-res").textContent;
  o.movil_nRecipientes = document.querySelectorAll("[data-preg='vasos'] .pc-vaso-in").length;
  // Con UNO solo no deja seguir: un punto no describe la parcela.
  escribir("pc-vaso-1", "1,2"); await sleep(120);
  o.movil_unoNoBasta = $("pc-b-vasos").disabled;
  escribir("pc-vaso-2", "0,9"); escribir("pc-vaso-3", "0,6"); await sleep(150);
  o.movil_tresSi = $("pc-b-vasos").disabled === false;
  clic("#pc-b-vasos"); await sleep(300);
  o.movil_tecnico = $("pc-tecnico-txt").textContent;
  await cerrar();
  const sMovil = ultima();
  o.movil_fuente = sMovil?.riego?.fuente;
  o.movil_clase = window.KyliaRiego.evaluarCapacidadRiego(sMovil?.riego, sMovil?.metodoRiego).clase;

  // ── ASPERSIÓN FIJA E IRREGULAR · tampoco ─────────────────────────────
  await hastaRiego("pimiento");
  clic("#pc-metodo [data-metodo='aspersion']"); await sleep(150);
  clic("#pc-inst-ahora"); await sleep(150);
  clic("#pc-a-fijos [data-fijos='1']"); await sleep(150);
  o.fija_segunda = preg();
  clic("#pc-a-regular [data-reg='irregular']"); await sleep(200);
  o.irregular_va_a = preg();
  o.irregular_texto = $("pc-riego-res").textContent;
  clic("[data-preg='vasos'] [data-nose]"); await sleep(200);     // "ahora no puedo medirlo"
  o.irregular_nose = preg();
  clic("#pc-nose-luego"); await sleep(200);
  o.irregular_pendiente_txt = $("pc-riego-res").textContent;
  await cerrar();
  const sIrr = ultima();
  o.irregular_caudal = sIrr?.caudal;
  o.irregular_fuente = sIrr?.riego?.fuente;
  o.irregular_clase = window.KyliaRiego.evaluarCapacidadRiego(sIrr?.riego, sIrr?.metodoRiego).clase;

  // ── §8C · "no lo sé" en el caudal del goteo ──────────────────────────
  await hastaRiego("cebolla");
  clic("#pc-metodo [data-metodo='goteo']"); await sleep(150);
  clic("#pc-inst-ahora"); await sleep(150);
  clic("#pc-g-regular [data-reg='regular']"); await sleep(150);
  clic("[data-preg='g-q'] [data-nose]"); await sleep(200);
  o.nose_preg = preg();
  o.nose_titulo = document.querySelector("[data-preg='nose'] .alta-preg").textContent;
  o.nose_opciones = [...document.querySelectorAll("[data-preg='nose'] .pc-opcion")].map(x => x.textContent.trim());
  // "Buscarlo en la etiqueta": dice DÓNDE, sin fingir que lo lee
  clic("#pc-nose-etiqueta"); await sleep(200);
  o.etiqueta_preg = preg();
  o.etiqueta_txt = $("pc-etiqueta-txt").textContent;
  clic("#pc-etiqueta-volver"); await sleep(200);
  o.etiqueta_vuelve_a = preg();
  // "Medirlo con ayuda" para goteo NO es el vaso: es la botella bajo un gotero
  clic("[data-preg='g-q'] [data-nose]"); await sleep(200);
  clic("#pc-nose-medir"); await sleep(200);
  o.medir_goteo_va_a = preg();
  escribir("pc-botella-txt", "0,33"); await sleep(120);
  clic("#pc-b-botella"); await sleep(200);
  o.tras_botella = preg();
  escribir("pc-gsep-txt", "30"); await sleep(100); clic("#pc-b-gsep"); await sleep(150);
  escribir("pc-glin-txt", "1"); await sleep(100); clic("#pc-b-glin"); await sleep(300);
  o.botella_tecnico = $("pc-tecnico-txt").textContent;
  await cerrar();
  const sBot = ultima();
  o.botella_fuente = sBot?.riego?.fuente;
  o.botella_confianza = sBot?.riego?.confianza;

  // ── REGADERA · elegir litros deja avanzar ────────────────────────────
  // Sin cerrar la pregunta, el botón del paso se queda oculto y el alta se
  // atasca ahí sin que nada lo diga.
  await hastaRiego("brassica");
  clic("#pc-metodo [data-metodo='regadera']"); await sleep(200);
  o.reg_preg = preg();
  clic("#pc-regl [data-reg='10']"); await sleep(250);
  o.reg_botonVisible = $("pc-b-riego").hidden === false && $("pc-b-riego").disabled === false;
  await cerrar();
  o.reg_litros = ultima()?.capacidadRegadera;

  // ── §12·D · todo lo que se puede desconocer, desconocido ─────────────
  await hastaRiego("calabacin", { sinFecha: true });
  clic("#pc-metodo [data-metodo='goteo']"); await sleep(150);
  clic("#pc-inst-luego"); await sleep(200);                       // "hacerlo más tarde"
  clic("#pc-b-riego"); await sleep(300);
  o.D_repaso = [...document.querySelectorAll("#pc-revision .pc-rev-fila")]
    .map(b => b.textContent.replace(/\s+/g, " ").trim());
  o.D_pendientes = $("pc-revisar-pend").textContent;
  clic("#pc-b-revisar"); await sleep(900);
  o.D_tarjeta = $("pc-tarjeta").textContent.replace(/\s+/g, " ").trim();
  const sD = ultima();
  o.D_guardado = { variedad: sD?.variedad, variedadDesconocida: sD?.variedadDesconocida,
                   fecha: sD?.fechaPlantacion, precision: sD?.fechaPrecision,
                   caudal: sD?.caudal, metodo: sD?.metodoRiego, fuente: sD?.riego?.fuente };
  o.D_clase = window.KyliaRiego.evaluarCapacidadRiego(sD?.riego, sD?.metodoRiego).clase;
  o.D_minutos = window.KyliaRiego.puedeDarMinutos(sD, JSON.parse(localStorage.getItem("kylia_config")));
  clic("#pc-listo"); await sleep(250);

  // ── §11 · la variedad NO entra en la huella de sincronización ────────
  // Si entrara, desplegar resincronizaría el histórico entero por un campo que
  // el servidor ni mira.
  o.hayVariedadGuardada = zonas()[0].siembras.some(x => x.variedad || x.variedadDesconocida);

  } catch (e) { o.__error = e.message + " @ " + String(e.stack || "").split("\n")[1]; }
  return o;
});
await pag2.close();

if (V.__error) { console.log("  ✗ las variantes de riego se rompieron:", V.__error); fallos++; }

console.log("\n── §8B · aspersión ──");
ok(V.asp_primera === "a-fijos", "lo primero que se pregunta es si están fijos o se mueven");
ok(V.asp_opciones.length === 2 && V.asp_opciones[0] === "Están fijos"
   && V.asp_opciones[1] === "Los voy moviendo",
   `SOLO esas dos opciones: ${JSON.stringify(V.asp_opciones)}`);
ok(V.asp_sinNoLoSe === true, "y ningún \"no lo sé\": eso sí lo sabe, los mueve él");
ok(V.movil_va_a === "vasos", "a unos aspersores que se mueven no se les pide la malla: se mide");
ok(V.movil_nRecipientes >= 3, `con varios recipientes repartidos (${V.movil_nRecipientes})`);
ok(V.movil_unoNoBasta === true,
   "un solo recipiente NO basta como prueba de toda la superficie");
ok(V.movil_tresSi === true, "con tres, sí");
ok(V.movil_fuente === "medido_vasos" && V.movil_clase === "fiable",
   `y esa medición sí habilita minutos (${V.movil_fuente} · ${V.movil_clase})`);
ok(/recipiente que menos/.test(V.movil_tecnico || ""),
   `la dispersión entre recipientes se guarda y se dice: "${V.movil_tecnico}"`);
ok(V.fija_segunda === "a-regular", "a los fijos se les pregunta si están en cuadrícula");
ok(V.irregular_va_a === "vasos", "y si están puestos a ojo, tampoco se aplica la fórmula");
ok(V.irregular_caudal === null && V.irregular_clase === "no_ejecutable",
   `sin medición no sale un caudal con pinta de fiable (caudal ${V.irregular_caudal}, ${V.irregular_clase})`);
ok(V.irregular_fuente === "no_lo_se",
   `y la procedencia lo dice: "${V.irregular_fuente}"`);

console.log("\n── §8C · \"no lo sé\" ──");
ok(V.nose_preg === "nose", "\"No lo sé\" abre su propia pantalla");
ok(/No pasa nada\. Podemos ayudarte a averiguarlo/.test(V.nose_titulo || ""),
   `con el texto acordado: "${V.nose_titulo}"`);
ok(V.nose_opciones.length === 3 && /Medirlo con ayuda/.test(V.nose_opciones[0])
   && /etiqueta/.test(V.nose_opciones[1]) && /más tarde/.test(V.nose_opciones[2]),
   `y las tres salidas: ${JSON.stringify(V.nose_opciones)}`);
ok(V.etiqueta_preg === "etiqueta" && /impreso|ficha/.test(V.etiqueta_txt || ""),
   "\"buscarlo en la etiqueta\" dice DÓNDE mirar");
ok(!/foto|hemos le[ií]do|detectado/i.test(V.etiqueta_txt || ""),
   "sin fingir que interpretamos una foto o una ficha que no leemos");
ok(V.etiqueta_vuelve_a === "g-q", "y se vuelve a la pregunta que dejó a medias");
ok(V.medir_goteo_va_a === "g-botella",
   "\"medirlo con ayuda\" en goteo es la botella bajo un gotero, NO el vaso en el suelo");
ok(V.botella_fuente === "derivado_goteo" && V.botella_confianza === "media",
   `y se guarda con su procedencia y una confianza menor (${V.botella_fuente} · ${V.botella_confianza})`);

console.log("\n── regadera ──");
ok(V.reg_preg === "reg", "a la regadera se le pregunta cuántos litros caben");
ok(V.reg_botonVisible === true, "y al contestarlo se puede avanzar: el botón del paso vuelve");
ok(V.reg_litros === 10, `con sus litros guardados (${V.reg_litros})`);

console.log("\n── §12·D · desconocidos ──");
ok(V.D_guardado.variedadDesconocida === true && V.D_guardado.variedad === null,
   "la variedad queda declarada desconocida, no inventada");
ok(V.D_guardado.fecha === null && V.D_guardado.precision === null,
   "la fecha queda pendiente y no se fabrica un día");
ok(V.D_guardado.caudal === null && V.D_guardado.metodo === "goteo",
   "el método se guarda y el caudal se queda a null, sin heredar el 11,2 de la finca");
ok(V.D_clase === "no_ejecutable" && V.D_minutos === false,
   `y NO se habilitan minutos fiables (${V.D_clase})`);
ok(/falta/i.test(V.D_pendientes || "") && /pendiente/i.test(V.D_pendientes || ""),
   `el repaso avisa de lo que quedará pendiente: "${V.D_pendientes}"`);
ok(/falta/i.test(V.D_tarjeta || ""), "y la tarjeta final lo repite como acción concreta");
ok(!/todo listo/i.test(V.D_tarjeta || ""), "nunca un \"todo listo\" genérico");

console.log("\n── §11 · invariantes de sincronización ──");
ok(V.hayVariedadGuardada === true,
   "la variedad se persiste con la siembra (que NO entre en la huella lo prueba test-sincronizar-zonas)");

// ══════════════════════════════════════════════════════════════════════
// §4 · el texto del agricultor se escapa, en el buscador y en el repaso
// ══════════════════════════════════════════════════════════════════════
const pagX = await abrirApp({ ancho: 390, alto: 844, movil: true, conCorreo: true });
const X = await pagX.evaluate(async () => {
  const o = {}, $ = id => document.getElementById(id), sleep = ms => new Promise(r => setTimeout(r, ms));
  const clic = s => { const e = document.querySelector(s); if (!e || e.disabled) return false; e.click(); return true; };
  const hasta = async (cond, ms = 12000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (cond()) return true; await sleep(60); }
    return false;
  };
  const recintosListos = () => hasta(() => document.querySelectorAll("#pc-mapa path").length > 0);
  const contornoListo  = () => hasta(() => !!window.__PCF()?.borrador?.geometria);

  const VENENO = '<img src=x onerror="window.__COLADO=1">';
  try {
  window.__COLADO = 0;
  window.kyliaParcelaNueva({ lat: 41.3255, lon: 2.062 }); await recintosListos();
  document.querySelectorAll("#pc-mapa path")[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await sleep(250); clic("#pc-confirmar"); await sleep(300);
  // cultivo escrito por él, con HTML dentro
  $("pc-cultivo-txt").value = VENENO;
  $("pc-cultivo-txt").dispatchEvent(new Event("input", { bubbles: true })); await sleep(200);
  o.sugerenciaImgs = document.querySelectorAll("#pc-sug img").length;
  o.sugerenciaTexto = document.querySelector("#pc-sug button[data-libre]")?.textContent || "";
  clic("#pc-sug button[data-libre]"); await sleep(150);
  o.elegidoImgs = document.querySelectorAll("#pc-elegido img").length;
  clic("#pc-b-cultivo"); await sleep(200);
  // variedad escrita por él, también con HTML
  $("pc-variedad-txt").value = VENENO;
  $("pc-variedad-txt").dispatchEvent(new Event("input", { bubbles: true })); await sleep(150);
  clic("#pc-b-variedad"); await sleep(500);
  if (!$("pc-sup-elegir").hidden) clic("#pc-parte");
  await contornoListo();
  o.notaSupImgs = document.querySelectorAll("#pc-sup-nota img").length;
  clic("#pc-b-sup"); await sleep(300);
  clic("#pc-sin-fecha"); await sleep(150); clic("#pc-b-fecha"); await sleep(300);
  clic("#pc-riego-luego"); await sleep(150); clic("#pc-b-riego"); await sleep(400);
  o.repasoImgs = document.querySelectorAll("#pc-revision img").length;
  o.repasoTexto = $("pc-revision").textContent;
  clic("#pc-b-revisar"); await sleep(900);
  o.tarjetaImgs = document.querySelectorAll("#pc-tarjeta img").length;
  o.colado = window.__COLADO;
  } catch (e) { o.__error = e.message + " @ " + String(e.stack || "").split("\n")[1]; }
  return o;
});
await pagX.close();

if (X.__error) { console.log("  ✗ el caso de escapado se rompió:", X.__error); fallos++; }

console.log("\n── §4 · texto del agricultor, escapado ──");
ok(X.colado === 0, "el HTML que escribe el agricultor NO se ejecuta en ningún punto del alta");
ok(X.sugerenciaImgs === 0 && X.elegidoImgs === 0,
   "ni en las sugerencias ni en el cultivo elegido");
ok(/<img/.test(X.sugerenciaTexto || ""),
   "se enseña como TEXTO, tal cual lo escribió, sin tragárselo");
ok(X.notaSupImgs === 0 && X.repasoImgs === 0 && X.tarjetaImgs === 0,
   "ni en el resumen de superficie, ni en el repaso, ni en la tarjeta final");
ok(/<img/.test(X.repasoTexto || ""), "y el repaso lo muestra literal");

// ══════════════════════════════════════════════════════════════════════
// §12·F · un error de red NO se anuncia como "guardado en tu cuenta"
// ══════════════════════════════════════════════════════════════════════
const pag3 = await abrirApp({ ancho: 390, alto: 844, movil: true, conCorreo: true });
const N = await pag3.evaluate(async () => {
  const o = {}, $ = id => document.getElementById(id), sleep = ms => new Promise(r => setTimeout(r, ms));
  const clic = s => { const e = document.querySelector(s); if (!e || e.disabled) return false; e.click(); return true; };
  const hasta = async (cond, ms = 12000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (cond()) return true; await sleep(60); }
    return false;
  };
  const recintosListos = () => hasta(() => document.querySelectorAll("#pc-mapa path").length > 0);
  const contornoListo  = () => hasta(() => !!window.__PCF()?.borrador?.geometria);

  const zonas = () => JSON.parse(localStorage.getItem("kylia_zonas") || "[]");
  try {
  // Se controla el TRANSPORTE, no la lógica: la subida real falla, y todo lo
  // demás —flujo, persistencia local, presentación— es el de producción.
  const original = window.kyliaSync.guardarConfigServidor;
  window.kyliaSync.guardarConfigServidor = async () => ({ ok: false, error: "red" });

  window.kyliaParcelaNueva({ lat: 41.3255, lon: 2.062 }); await recintosListos();
  document.querySelectorAll("#pc-mapa path")[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await sleep(250); clic("#pc-confirmar"); await sleep(300);
  clic("#pc-habituales [data-cid='lechuga']"); await sleep(120);
  clic("#pc-b-cultivo"); await sleep(200);
  clic("#pc-variedad-nose"); await sleep(120);
  clic("#pc-b-variedad"); await sleep(400);
  if (!$("pc-sup-elegir").hidden) clic("#pc-parte");
  await contornoListo();
  clic("#pc-b-sup"); await sleep(300);
  $("pc-fecha").value = "2026-09-10"; $("pc-fecha").dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(150); clic("#pc-b-fecha"); await sleep(300);
  clic("#pc-riego-luego"); await sleep(150);
  clic("#pc-b-riego"); await sleep(300);
  clic("#pc-b-revisar"); await sleep(600);
  // Nada más guardar: está en el dispositivo, la subida va en camino.
  o.textoInmediato = $("pc-t-donde")?.textContent || "";
  o.guardadoLocal = zonas().reduce((n, z) => n + (z.siembras || []).length, 0);
  // La subida va con 1,5 s de retardo: se espera a que falle de verdad.
  await sleep(3000);
  o.textoTrasFallo = $("pc-t-donde")?.textContent || "";
  o.sigueGuardadoLocal = zonas().reduce((n, z) => n + (z.siembras || []).length, 0);
  window.kyliaSync.guardarConfigServidor = original;
  } catch (e) { o.__error = e.message + " @ " + String(e.stack || "").split("\n")[1]; }
  return o;
});
await pag3.close();

if (N.__error) { console.log("  ✗ el caso de red se rompió:", N.__error); fallos++; }

console.log("\n── §12·F · error de red al guardar ──");
ok(N.guardadoLocal === 1, "el cultivo se guarda en el dispositivo pase lo que pase");
ok(/dispositivo/.test(N.textoInmediato) && !/Guardado en tu cuenta/.test(N.textoInmediato),
   `y lo que se dice mientras sube es lo que hay: "${N.textoInmediato}"`);
ok(!/Guardado en tu cuenta/.test(N.textoTrasFallo),
   `si la subida falla NO se anuncia persistencia remota: "${N.textoTrasFallo}"`);
ok(/No hemos podido guardarlo en tu cuenta/.test(N.textoTrasFallo),
   "se dice que falló, en vez de dejar puesto un \"guardado\" que no es verdad");
// Y no se promete un reintento automático que no existe: la config se vuelve a
// subir cuando algo la dispara, no sola en segundo plano.
ok(!/reintentaremos/.test(N.textoTrasFallo) && /próxima vez que guardes/.test(N.textoTrasFallo),
   "sin prometer un reintento automático que no existe");
ok(N.sigueGuardadoLocal === 1, "y el cultivo sigue ahí: el fallo remoto no lo borra");

// ══════════════════════════════════════════════════════════════════════
// §10 / §12·J · móvil y escritorio: MISMO recorrido, distinta caja
// ══════════════════════════════════════════════════════════════════════
const DIR_CAP = join(RAIZ, "docs", "capturas", "onboarding");
mkdirSync(DIR_CAP, { recursive: true });

async function medir(etiqueta, { ancho, alto, movil }) {
  const pg = await abrirApp({ ancho, alto, movil, conCorreo: true });
  const m = await pg.evaluate(async () => {
    const $ = id => document.getElementById(id), sleep = ms => new Promise(r => setTimeout(r, ms));
    const clic = s => { const e = document.querySelector(s); if (!e || e.disabled) return false; e.click(); return true; };
  const hasta = async (cond, ms = 12000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (cond()) return true; await sleep(60); }
    return false;
  };
  const recintosListos = () => hasta(() => document.querySelectorAll("#pc-mapa path").length > 0);
  const contornoListo  = () => hasta(() => !!window.__PCF()?.borrador?.geometria);

    window.kyliaParcelaNueva({ lat: 41.3255, lon: 2.062 }); await recintosListos();
    document.querySelectorAll("#pc-mapa path")[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await sleep(250); clic("#pc-confirmar"); await sleep(300);
    const d = {};
    d.paso = document.querySelector("#pc .alta-paso.activo")?.dataset?.pc;
    // Sin scroll lateral, en ninguna de las dos.
    d.scrollLateral = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    const caja = document.querySelector("#pc .alta-caja").getBoundingClientRect();
    d.cajaAncho = Math.round(caja.width);
    d.margenIzq = Math.round(caja.left);
    d.margenDer = Math.round(innerWidth - caja.right);
    // Los campos no se estiran de extremo a extremo en pantalla grande.
    const inp = $("pc-cultivo-txt").getBoundingClientRect();
    d.campoAncho = Math.round(inp.width);
    d.campoFraccion = Math.round((inp.width / innerWidth) * 100);
    // Todo lo que se toca, cómodo.
    d.pequenos = [...document.querySelectorAll("#pc button:not([hidden]), #pc input")]
      .filter(e => e.offsetParent && e.getBoundingClientRect().height > 0)
      .filter(e => e.getBoundingClientRect().height < 44)
      .map(e => (e.id || e.className) + ":" + Math.round(e.getBoundingClientRect().height));
    // El mapa tiene sitio.
    clic("#pc-habituales [data-cid='lechuga']"); await sleep(120);
    clic("#pc-b-cultivo"); await sleep(200);
    clic("#pc-variedad-nose"); await sleep(120);
    clic("#pc-b-variedad"); await sleep(400);
    if (!$("pc-sup-elegir").hidden) clic("#pc-parte");
  await contornoListo();
    const mp = $("pc-mapa2").getBoundingClientRect();
    d.mapaAlto = Math.round(mp.height);
    d.mapaAncho = Math.round(mp.width);
    d.scrollLateralMapa = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    // Mismo recorrido: las mismas pantallas existen en las dos anchuras.
    d.pantallas = [...document.querySelectorAll("#pc [data-pc]")].map(x => x.dataset.pc);
    return d;
  });
  await pg.screenshot({ path: join(DIR_CAP, `${etiqueta}.png`), fullPage: false });
  // Y una del riego, que es la pantalla que más cambió.
  await pg.evaluate(async () => {
    const $ = id => document.getElementById(id), sleep = ms => new Promise(r => setTimeout(r, ms));
    const clic = s => { const e = document.querySelector(s); if (!e || e.disabled) return false; e.click(); return true; };
  const hasta = async (cond, ms = 12000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (cond()) return true; await sleep(60); }
    return false;
  };
  const recintosListos = () => hasta(() => document.querySelectorAll("#pc-mapa path").length > 0);
  const contornoListo  = () => hasta(() => !!window.__PCF()?.borrador?.geometria);

    clic("#pc-b-sup"); await sleep(300);
    $("pc-fecha").value = "2026-09-12"; $("pc-fecha").dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(150); clic("#pc-b-fecha"); await sleep(300);
    clic("#pc-metodo [data-metodo='goteo']"); await sleep(150);
    clic("#pc-inst-ahora"); await sleep(150);
    clic("#pc-g-regular [data-reg='regular']"); await sleep(150);
    $("pc-gq-txt").value = "2"; $("pc-gq-txt").dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(100); clic("#pc-b-gq"); await sleep(250);
  });
  await pg.screenshot({ path: join(DIR_CAP, `${etiqueta}-riego.png`), fullPage: false });
  await pg.close();
  return m;
}

const MOV = await medir("movil-390", { ancho: 390, alto: 844, movil: true });
const ESC = await medir("escritorio-1366", { ancho: 1366, alto: 900, movil: false });
const ESTRECHO = await medir("movil-320", { ancho: 320, alto: 640, movil: true });

console.log("\n── §10 · móvil 390 px ──");
ok(MOV.scrollLateral === false && MOV.scrollLateralMapa === false, "sin scroll horizontal");
ok(MOV.margenIzq >= 16 && MOV.margenDer >= 16,
   `con márgenes laterales de verdad (${MOV.margenIzq} / ${MOV.margenDer} px)`);
ok(MOV.pequenos.length === 0,
   `nada que se toque por debajo de 44 px${MOV.pequenos.length ? ": " + MOV.pequenos.join(", ") : ""}`);
ok(MOV.mapaAlto >= 230, `y el mapa tiene sitio (${MOV.mapaAlto} px de alto)`);

console.log("\n── §10 · móvil estrecho 320 px ──");
ok(ESTRECHO.scrollLateral === false && ESTRECHO.scrollLateralMapa === false,
   "tampoco hay scroll horizontal en la pantalla más estrecha");
ok(ESTRECHO.margenIzq >= 16 && ESTRECHO.margenDer >= 16,
   `y los márgenes aguantan (${ESTRECHO.margenIzq} / ${ESTRECHO.margenDer} px)`);
ok(ESTRECHO.pequenos.length === 0,
   `sin controles pequeños${ESTRECHO.pequenos.length ? ": " + ESTRECHO.pequenos.join(", ") : ""}`);

console.log("\n── §10 · escritorio 1366 px ──");
ok(ESC.scrollLateral === false, "sin scroll horizontal");
ok(ESC.cajaAncho <= 700 && ESC.margenIzq > 200,
   `el contenido va centrado y con anchura contenida (${ESC.cajaAncho} px, márgenes ${ESC.margenIzq})`);
ok(ESC.campoFraccion < 50,
   `los campos no se estiran de extremo a extremo (${ESC.campoAncho} px = ${ESC.campoFraccion}% de la pantalla)`);
ok(ESC.mapaAlto > MOV.mapaAlto,
   `y el mapa aprovecha la pantalla grande (${ESC.mapaAlto} px frente a ${MOV.mapaAlto})`);
ok(JSON.stringify(ESC.pantallas) === JSON.stringify(MOV.pantallas),
   `MISMO recorrido en las dos: ${ESC.pantallas.length} pantallas, las mismas`);
ok(ESC.paso === MOV.paso, "y se llega al mismo sitio dando los mismos pasos");

await pag.close();
await nav.close();
srv.close();

console.log("\n── sin errores de JavaScript ──");
ok(errores.length === 0, `0 errores de página (${errores.length})${errores.length ? ": " + errores.join(" | ") : ""}`);

console.log(fallos ? `\n${fallos} test(s) FALLARON` : "\n✅ TODOS LOS TESTS VERDES");
process.exit(fallos ? 1 : 0);
