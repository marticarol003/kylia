// Las escrituras de la app dejan de ser mudas.
//   node tests/test-post-observable.mjs
//
// POR QUÉ EXISTE. `post()` era `fetch(...).catch(() => null)`: ni miraba res.ok,
// ni reintentaba, ni avisaba. Toda escritura de la app —riegos, altas de parcela,
// config— podía fallar con apariencia de éxito. Se vio el 15-sep: la zona
// `zonas[0]` del agricultor llevaba desde el 11-sep en `config_app` del servidor
// SIN sus filas en `usuarios`, y nadie se enteró en cuatro días.
//
// Aquí se ejecuta el `post()` real de app/index.html contra un fetch simulado.
// EL CONTRATO QUE NO SE PUEDE ROMPER: la promesa nunca rechaza. 12 de los 13
// sitios que escriben no la esperan; un throw sería un unhandled rejection.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const FUENTE = readFileSync(join(RAIZ, "app", "index.html"), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

// Recorta una función del fuente con llaves balanceadas.
// ⚠️ El cuerpo NO empieza en la primera llave que aparezca: `addRiego(date,
// litros, opciones = {})` lleva una en los parámetros por defecto, y contarla
// devolvía la función cortada por la mitad. Primero se cierra la lista de
// parámetros, y solo después se busca la llave del cuerpo.
function recorta(marca) {
  const i = FUENTE.indexOf(marca);
  if (i < 0) throw new Error(`no encuentro: ${marca}`);
  let k = FUENTE.indexOf("(", i), prof = 0;
  for (; k < FUENTE.length; k++) {
    if (FUENTE[k] === "(") prof++;
    else if (FUENTE[k] === ")" && --prof === 0) { k++; break; }
  }
  while (k < FUENTE.length && FUENTE[k] !== "{") k++;
  prof = 0;
  for (let j = k; j < FUENTE.length; j++) {
    if (FUENTE[j] === "{") prof++;
    else if (FUENTE[j] === "}" && --prof === 0) return FUENTE.slice(i, j + 1);
  }
  throw new Error(`llaves sin cerrar: ${marca}`);
}
// Para una constante suelta, que no tiene cuerpo que recortar.
function recortaLinea(marca) {
  const i = FUENTE.indexOf(marca);
  if (i < 0) throw new Error(`no encuentro: ${marca}`);
  return FUENTE.slice(i, FUENTE.indexOf("\n", i));
}

// localStorage de mentira, con un interruptor para hacerlo explotar.
function almacen({ rompe = false } = {}) {
  const m = new Map();
  return {
    getItem: k => { if (rompe) throw new Error("SecurityError"); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (rompe) throw new Error("QuotaExceededError"); m.set(k, String(v)); },
    removeItem: k => { if (rompe) throw new Error("SecurityError"); m.delete(k); },
    _crudo: m,
  };
}

// Monta post() + anotarFallo() reales sobre un fetch y un localStorage dados.
function montar(respuesta, opts = {}) {
  const avisos = [];
  const ls = almacen(opts);
  const ctx = {
    localStorage: ls,
    console: { warn: (...a) => avisos.push(a.join(" ")) },
    fetch: respuesta,
  };
  const cuerpo = `
    ${recortaLinea("const FALLOS_KEY = ")}
    ${recorta("function anotarFallo(")}
    ${recorta("async function post(")}
    return { post, leerFallos: () => { try { return JSON.parse(localStorage.getItem(FALLOS_KEY)) || []; } catch (_) { return []; } } };
  `;
  const f = new Function("localStorage", "console", "fetch", cuerpo);
  return { ...f(ctx.localStorage, ctx.console, ctx.fetch), avisos, ls };
}
const resp = (status, texto) => async () => ({
  ok: status >= 200 && status < 300, status, text: async () => texto,
});

console.log("\n── 1. el contrato: la promesa NUNCA rechaza ──");
const CASOS = [
  ["200 ok y escrito",        resp(200, JSON.stringify({ ok: true, persisted: true }))],
  ["200 ok pero sin escribir", resp(200, JSON.stringify({ ok: true, persisted: false, reason: "supabase_not_configured" }))],
  ["200 con ok:false",        resp(200, JSON.stringify({ ok: false, error: "propietario no encontrado" }))],
  ["404",                     resp(404, JSON.stringify({ ok: false, error: "usuario no encontrado" }))],
  ["500 que NO es JSON",      resp(500, "<html>Internal Server Error</html>")],
  ["cuerpo vacío",            resp(204, "")],
  ["la red se cae",           async () => { throw new TypeError("Failed to fetch"); }],
];
for (const [etiqueta, f] of CASOS) {
  const { post } = montar(f);
  let rechazo = null, r = null;
  try { r = await post("/api/log", { recurso: "acciones" }); } catch (e) { rechazo = e; }
  ok(rechazo === null, `${etiqueta}: no rechaza`);
  ok(r && typeof r.ok === "boolean", `${etiqueta}: devuelve un resultado con ok booleano`);
}

console.log("\n── 2. qué dice cada caso ──");
{
  const r = await montar(CASOS[0][1]).post("/x", {});
  ok(r.ok === true && r.persisted === true && r.error === null, "escrito → ok:true persisted:true");
}
{
  const m = montar(CASOS[1][1]);
  const r = await m.post("/x", { recurso: "acciones" });
  ok(r.ok === true, "200 sin escribir: ok sigue siendo true (la petición fue bien)");
  ok(r.persisted === false, "  pero persisted:false — que es lo que de verdad importa");
  ok(m.leerFallos().length === 1, "  y QUEDA REGISTRADO, aunque ok sea true");
}
{
  const r = await montar(CASOS[2][1]).post("/x", {});
  ok(r.ok === false, "200 con ok:false → ok:false (mirar res.ok solo no lo cazaba)");
  ok(r.error === "propietario no encontrado", "  y arrastra el error del servidor");
}
{
  const r = await montar(CASOS[3][1]).post("/x", {});
  ok(r.ok === false && r.status === 404, "404 → ok:false con su status");
}
{
  const r = await montar(CASOS[4][1]).post("/x", {});
  ok(r.status === 500, "500 no-JSON: CONSERVA el status (no lo degrada a 0)");
  ok(r.error === "HTTP 500" && r.ok === false, "  y no se confunde con sin_red");
  ok(r.datos === null, "  datos a null, sin reventar al parsear");
}
{
  const r = await montar(CASOS[5][1]).post("/x", {});
  ok(r.status === 204 && r.ok === true, "cuerpo vacío con 2xx: ok, sin romper");
}
{
  const r = await montar(CASOS[6][1]).post("/x", {});
  ok(r.error === "sin_red" && r.status === 0, "la red caída → sin_red, status 0");
}

console.log("\n── 2b. JSON VÁLIDO PERO PRIMITIVO: el caso que rompía el contrato ──");
// `true`, `1` y `"texto"` son JSON válidos. `"persisted" in datos` sobre ellos
// lanza TypeError, y como post() es async eso rechaza la promesa: con 10 de los
// 12 call sites sin esperarla, unhandledrejection. `null` cortocircuitaba con
// `datos &&` y por eso no se veía.
const PRIMITIVOS = [
  ["true",    "true"],
  ["1",       "1"],
  ['"texto"', '"texto"'],
  ["null",    "null"],
  ["[]",      "[]"],
  ["{}",      "{}"],
  ["false",   "false"],
  ["0",       "0"],
  ['""',      '""'],
];
for (const [etiqueta, cuerpo] of PRIMITIVOS) {
  for (const status of [200, 500]) {
    const { post } = montar(resp(status, cuerpo));
    let rechazo = null, r = null;
    try { r = await post("/api/log", { recurso: "acciones" }); } catch (e) { rechazo = e; }
    ok(rechazo === null,
       `body ${etiqueta} con ${status}: no rechaza${rechazo ? " (" + rechazo.constructor.name + ")" : ""}`);
    ok(r && r.status === status, `  y conserva el status real (${r ? r.status : "—"})`);
    ok(r && r.error !== "sin_red", "  y no se confunde con sin_red");
  }
}
{
  // Y que el resultado siga siendo el correcto, no solo que no explote.
  const r = await montar(resp(200, "true")).post("/x", {});
  ok(r.ok === true && r.persisted === true, "body `true` con 200 → ok y persisted (no hay campo que diga lo contrario)");
  const r2 = await montar(resp(500, "1")).post("/x", {});
  ok(r2.ok === false && r2.persisted === false && r2.error === "HTTP 500", "body `1` con 500 → fallo con su status");
}

console.log("\n── 3. el registro de fallos ──");
{
  const m = montar(CASOS[3][1]);
  await m.post("/api/log", { recurso: "acciones", usuario_id: "u-1", fecha_local: "2026-09-15",
                             cantidad_l_m2: 20, notas: "texto larguísimo que no debe viajar" });
  const [f] = m.leerFallos();
  ok(f.recurso === "acciones" && f.id === "u-1", "guarda recurso e id");
  ok(f.ref === "2026-09-15", "y una referencia mínima");
  ok(!("cantidad_l_m2" in f) && !("notas" in f), "NO guarda el payload: ni cantidad ni notas");
  ok(f.status === 404 && f.persisted === false, "con status y persisted");
}
{
  const m = montar(CASOS[3][1]);
  for (let i = 0; i < 60; i++) await m.post("/x", { recurso: "acciones" });
  ok(m.leerFallos().length === 50, `se acota a 50 (${m.leerFallos().length}), no crece sin fin`);
}
{
  const m = montar(CASOS[0][1]);
  await m.post("/x", {});
  ok(m.leerFallos().length === 0, "lo que SÍ sube no deja fallo — la señal no es ruido");
}

console.log("\n── 4. BLINDAJE: localStorage roto no puede tumbar post() ──");
for (const [etiqueta, f] of [["con la red caída", CASOS[6][1]], ["con un 404", CASOS[3][1]]]) {
  const m = montar(f, { rompe: true });
  let rechazo = null, r = null;
  try { r = await m.post("/x", { recurso: "acciones" }); } catch (e) { rechazo = e; }
  ok(rechazo === null, `${etiqueta} y localStorage lanzando: post NO rechaza`);
  ok(r && r.ok === false, `${etiqueta}: y sigue devolviendo su resultado`);
}

console.log("\n── 5. guarda de regresión: nadie consume el valor sin protegerse ──");
{
  const metodos = "registroUsuario|accion|observacion|jornada|medicion|recomendacionesLog|evento|guardarConfigServidor";
  const re = new RegExp("(await|\\.then\\s*\\(|=\\s*)\\s*window\\.kyliaSync\\??\\.(" + metodos + ")", "g");
  const usos = FUENTE.match(re) || [];
  // Son DOS, y las dos están protegidas:
  //   · el `await` del envío de correo, dentro de un try/catch que ya avisa;
  //   · el `const envio =` de addRiego, que encadena .then().catch().
  // Si aparece un tercero, hay que mirarlo a mano: una promesa consumida sin
  // protección es justo lo que este cambio viene a evitar.
  ok(usos.length === 2, `call sites que consumen el valor: ${usos.length} (esperado 2)`);
  // Y el censo completo, que Codex corrigió: son 12, no 13. La cuenta anterior
  // se dejaba fuera `guardarConfigServidor?.(`, que lleva llamada opcional.
  const todos = FUENTE.match(
    new RegExp("window\\.kyliaSync\\??\\.(" + metodos + ")\\??\\.?\\(", "g")) || [];
  ok(todos.length === 12, `call sites en total: ${todos.length} (esperado 12)`);
  ok(recorta("function addRiego(").includes(".catch(() => marcarNoSincronizado"),
     "y el de addRiego encadena .catch: no puede quedar colgada");
}

// ── Escrituras críticas: addRiego y la reconciliación, ejecutadas de verdad ──
function monta1App({ respuestaAccion, riegosIniciales = [], remotos = [] }) {
  const ls = almacen();
  const MOTOR = { laminaRiego: (cant, dur, caudal) =>
    (dur > 0 && caudal > 0) ? Math.round(caudal * dur / 60 * 10) / 10 : (cant ?? null) };
  const win = {
    kyliaSync: { accion: () => respuestaAccion() },
    _kyliaJornadaActual: null,
  };
  const fetchFake = async () => ({
    ok: true, status: 200,
    json: async () => ({ ok: true, riegos_recientes: remotos }),
  });
  const cuerpo = `
    let riegos = JSON.parse(JSON.stringify(riegosIniciales));
    let ultimoRiego = null;
    const zonaActiva = null;
    const cfg = { caudal: 11 };
    const idParcelaActiva = () => "parcela-1";
    ${recorta("function riegosKey(")}
    ${recorta("function saveRiegos(")}
    ${recorta("function addRiego(")}
    ${recorta("function marcarNoSincronizado(")}
    ${recorta("function firmaRiego(")}
    ${recorta("async function reconciliarRiegos(")}
    return { addRiego, reconciliarRiegos, ver: () => riegos };
  `;
  const f = new Function("riegosIniciales", "localStorage", "window", "MOTOR", "fetch", "encodeURIComponent", cuerpo);
  return f(riegosIniciales, ls, win, MOTOR, fetchFake, encodeURIComponent);
}
const espera = () => new Promise(r => setTimeout(r, 0));

console.log("\n── 6. un riego que no sube deja de aparentar que subió ──");
{
  const app = monta1App({ respuestaAccion: async () => ({ ok: false, status: 404, persisted: false, error: "usuario no encontrado" }) });
  app.addRiego("2026-09-15", null, { duracion: 60 });
  await espera();
  const [r] = app.ver();
  ok(r.sincronizado === false, "marcado sincronizado:false");
  ok(r.date === "2026-09-15" && r.duracion === 60, "y sus datos intactos: no se pierde nada");
  ok(r.lamina_mm === 11, "con su lámina congelada al apuntar (60 min x 11 mm/h)");
}
{
  const app = monta1App({ respuestaAccion: async () => ({ ok: true, status: 200, persisted: false, error: null }) });
  app.addRiego("2026-09-15", null, { duracion: 60 });
  await espera();
  ok(app.ver()[0].sincronizado === false, "200 con persisted:false TAMBIÉN se marca — el caso que pediste");
}
{
  const app = monta1App({ respuestaAccion: async () => ({ ok: true, status: 200, persisted: true, error: null }) });
  app.addRiego("2026-09-15", null, { duracion: 60 });
  await espera();
  ok(!("sincronizado" in app.ver()[0]), "y cuando SÍ sube no se marca: la marca depende de la respuesta");
}
{
  const app = monta1App({ respuestaAccion: () => { throw new Error("boom"); } });
  app.addRiego("2026-09-15", null, { duracion: 60 });
  await espera();
  ok(app.ver()[0].sincronizado === false, "si el envío ni sale, también se marca");
}

console.log("\n── 7. y la reconciliación la limpia cuando el riego aparece arriba ──");
{
  const previo = [{ date: "2026-09-15", litros: null, duracion: 60, lamina_mm: 11,
                    lamina_origen: "duracion_x_caudal", caudal_mmh: 11, sincronizado: false }];
  const remotos = [{ fecha: "2026-09-15", duracion_min: 60, cantidad_l_m2: null,
                     lamina_mm: 11, lamina_origen: "duracion_x_caudal", caudal_mmh: 11 }];
  const app = monta1App({ respuestaAccion: async () => ({ ok: true }), riegosIniciales: previo, remotos });
  const res = await app.reconciliarRiegos();
  ok(res.limpiados === 1, `limpiados = ${res.limpiados}`);
  ok(!("sincronizado" in app.ver()[0]), "la marca desaparece: el riego SÍ está en el servidor");
  ok(app.ver()[0].lamina_mm === 11, "y su lámina no se toca");
}
{
  // El caso que hace falta que funcione: el riego ya nace con lamina_mm, así que
  // si la limpieza fuera después del early return, no se limpiaría NUNCA.
  const previo = [{ date: "2026-09-15", litros: null, duracion: 60, lamina_mm: 11,
                    lamina_origen: "duracion_x_caudal", caudal_mmh: 11, sincronizado: false }];
  const app = monta1App({ respuestaAccion: async () => ({ ok: true }), riegosIniciales: previo, remotos: [] });
  const res = await app.reconciliarRiegos();
  ok(res.limpiados === 0, "si NO está en el servidor, la marca se queda");
  ok(app.ver()[0].sincronizado === false, "  y sigue diciendo la verdad");
}
{
  // Ambigüedad: dos locales con la misma firma el mismo día. No es inequívoco.
  const previo = [
    { date: "2026-09-15", litros: null, duracion: 60, lamina_mm: 11, sincronizado: false },
    { date: "2026-09-15", litros: null, duracion: 60, lamina_mm: 11, sincronizado: false },
  ];
  const remotos = [{ fecha: "2026-09-15", duracion_min: 60, cantidad_l_m2: null, lamina_mm: 11 }];
  const app = monta1App({ respuestaAccion: async () => ({ ok: true }), riegosIniciales: previo, remotos });
  const res = await app.reconciliarRiegos();
  ok(res.limpiados === 0, "con dos iguales el mismo día no se limpia nada: la clave no es inequívoca");
}
{
  // Los sintéticos del alta no se tocan en ningún caso.
  const previo = [{ date: "2026-09-10", litros: 5, duracion: null, estimado: true }];
  const app = monta1App({ respuestaAccion: async () => ({ ok: true }), riegosIniciales: previo, remotos: [] });
  await app.reconciliarRiegos();
  const [r] = app.ver();
  ok(r.estimado === true && r.litros === 5, "los riegos estimado:true del alta siguen intactos");
  ok(!("sincronizado" in r), "y no se les inventa una marca de sincronización");
}

console.log(fallos === 0 ? "\n✅ TODOS LOS TESTS VERDES\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos === 0 ? 0 : 1);
