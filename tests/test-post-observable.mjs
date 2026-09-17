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
// EL CONTRATO QUE NO SE PUEDE ROMPER: la promesa nunca rechaza. 10 de los 12
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
const resp = (status, texto) => {
  const f = async () => { f.llamadas++; return { ok: status >= 200 && status < 300, status, text: async () => texto }; };
  f.llamadas = 0;
  return f;
};
// Un fetch que NUNCA resuelve salvo que lo aborten: lo que provoca el timeout.
const colgado = () => {
  const f = (url, init) => new Promise((_, rej) => {
    f.llamadas++;
    const sig = init && init.signal;
    if (!sig) return;                       // sin signal se queda colgado de verdad
    const e = new Error("The operation was aborted."); e.name = "AbortError";
    if (sig.aborted) return rej(e);
    sig.addEventListener("abort", () => rej(e));
  });
  f.llamadas = 0;
  return f;
};

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
  // Este assert decía lo contrario en la ronda anterior —daba por escrito un 200
  // con body `true`— y la regla nueva lo invalida a propósito: un 200 no
  // confirma nada. La petición fue bien (ok), pero no hay confirmación.
  const r = await montar(resp(200, "true")).post("/x", {});
  ok(r.ok === true, "body `true` con 200 → la petición fue bien");
  ok(r.persisted === false && r.error === "respuesta_invalida",
     "  pero NO se da por escrito: persisted:false y respuesta_invalida");
  const r2 = await montar(resp(500, "1")).post("/x", {});
  ok(r2.ok === false && r2.persisted === false && r2.error === "HTTP 500", "body `1` con 500 → fallo con su status");
}

console.log("\n── 2c. SERIALIZAR NO ES RED: un payload imposible no es sin_red ──");
// JSON.stringify estaba DENTRO del try del fetch, así que un objeto cíclico o un
// BigInt salían clasificados como "sin_red": diagnóstico falso, y encima decía
// que la petición había salido cuando ni se intentó.
{
  const ciclico = { recurso: "acciones" }; ciclico.yo = ciclico;
  const conBigInt = { recurso: "acciones", n: 10n };
  for (const [etiqueta, payload] of [["objeto cíclico", ciclico], ["BigInt", conBigInt]]) {
    const f = resp(200, JSON.stringify({ ok: true, persisted: true }));
    const { post, leerFallos } = montar(f);
    let rechazo = null, r = null;
    try { r = await post("/api/log", payload); } catch (e) { rechazo = e; }
    ok(rechazo === null, `${etiqueta}: no rechaza`);
    ok(f.llamadas === 0, `${etiqueta}: fetchCalls === 0 — no se intenta enviar lo que no se puede serializar (${f.llamadas})`);
    ok(r && r.status === 0, `${etiqueta}: status 0`);
    ok(r && r.persisted === false, `${etiqueta}: persisted false`);
    ok(r && r.error === "payload_no_serializable", `${etiqueta}: error explícito, no genérico (${r && r.error})`);
    ok(r && r.error !== "sin_red", `${etiqueta}: y NUNCA sin_red`);
    ok(leerFallos().length === 1, `${etiqueta}: queda registrado`);
  }
}
{
  // Y al revés: sin_red se reserva para lo que de verdad es un fallo de fetch.
  const { post } = montar(async () => { throw new TypeError("Failed to fetch"); });
  const r = await post("/x", { recurso: "acciones" });
  ok(r.error === "sin_red", "una excepción REAL de fetch sigue siendo sin_red");
}

console.log("\n── 2d. UN 200 NO CONFIRMA QUE SE HAYA ESCRITO ──");
// Para una escritura crítica, persisted:true solo si el servidor lo dice.
const SIN_CONFIRMAR = [
  ["primitivo true",        "true"],
  ["primitivo 1",           "1"],
  ['primitivo "texto"',     '"texto"'],
  ["array",                 "[]"],
  ["array con datos",       '[{"persisted":true}]'],
  ["cuerpo vacío",          ""],
  ["no-JSON",               "<html>ok</html>"],
  ["objeto sin persisted",  '{"ok":true}'],
  ["objeto persisted:1",    '{"ok":true,"persisted":1}'],
];
for (const [etiqueta, cuerpo] of SIN_CONFIRMAR) {
  const { post } = montar(resp(200, cuerpo));
  const r = await post("/api/log", { recurso: "acciones" });
  ok(r.persisted === false, `200 con ${etiqueta} → persisted:false`);
  ok(r.status === 200, `  conserva el status 200 (${r.status})`);
  ok(r.error !== "sin_red", "  y no se degrada a sin_red");
}
{
  const r = await montar(resp(200, '{"ok":true}')).post("/x", {});
  ok(r.error === "respuesta_invalida", `objeto sin persisted → error "${r.error}"`);
  const r2 = await montar(resp(200, '{"ok":true,"persisted":false,"reason":"supabase_not_configured"}')).post("/x", {});
  ok(r2.error === "supabase_not_configured", `persisted:false arrastra su reason ("${r2.error}")`);
  const r3 = await montar(resp(200, '{"ok":true,"persisted":true}')).post("/x", {});
  ok(r3.persisted === true && r3.error === null, "y la confirmación explícita SÍ cuenta");
}
{
  // El invariante que no se puede perder al endurecer esto.
  const r = await montar(resp(200, '{"ok":false,"error":"propietario no encontrado"}')).post("/x", {});
  ok(r.ok === false && r.error === "propietario no encontrado", "{ok:false} con HTTP 200 se sigue detectando");
}

console.log("\n── 2e. TIMEOUT OPCIONAL: aborta de verdad, y no es sin_red ──");
{
  // Sin opts, comportamiento idéntico al de siempre: ningún caller existente cambia.
  const cuerpo = recorta("async function post(");
  ok(/async function post\(path, data, opts\)/.test(cuerpo), "post acepta opts, y es opcional");
  ok(cuerpo.includes("Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 0"),
     "sin timeoutMs no se arma ningún reloj");
  ok(cuerpo.includes("AbortController"), "y usa AbortController, no un Promise.race");
  ok(cuerpo.includes("clearTimeout(reloj)"), "el reloj se limpia siempre");
}
{
  const f = colgado();
  const { post, leerFallos } = montar(f);
  let rechazo = null, r = null;
  const t0 = Date.now();
  try { r = await post("/api/log", { recurso: "config-app" }, { timeoutMs: 20 }); }
  catch (e) { rechazo = e; }
  ok(rechazo === null, "al vencer NO rechaza: devuelve resultado resuelto");
  ok(r.error === "timeout", `error explícito "timeout" (${r.error})`);
  ok(r.error !== "sin_red", "y NUNCA sin_red: la red puede estar perfecta");
  ok(r.ok === false && r.persisted === false, "ok:false y persisted:false");
  ok(r.status === 0, "status 0: no hubo respuesta");
  ok(Date.now() - t0 < 500, "y vence pronto, no se queda colgado");
  ok(leerFallos()[0]?.error === "timeout", "queda registrado como timeout");
}
{
  // Un fallo de red REAL sigue siendo sin_red aunque haya timeout puesto.
  const { post } = montar(async () => { throw new TypeError("Failed to fetch"); });
  const r = await post("/x", { recurso: "acciones" }, { timeoutMs: 5000 });
  ok(r.error === "sin_red", `con timeout puesto, un fallo real de red sigue siendo sin_red (${r.error})`);
}
{
  // Un AbortError que NO viene de nuestro reloj tampoco se llama timeout.
  const { post } = montar(async () => { const e = new Error("abortada"); e.name = "AbortError"; throw e; });
  const r = await post("/x", { recurso: "acciones" });
  ok(r.error === "sin_red", "sin nuestro reloj, un abort ajeno no se etiqueta como timeout");
}
{
  // Sin timeout, una petición normal se comporta igual que antes.
  const f = resp(200, JSON.stringify({ ok: true, persisted: true }));
  const { post } = montar(f);
  const r = await post("/x", { recurso: "acciones" });
  ok(r.ok === true && r.persisted === true && r.error === null, "sin opts: idéntico a antes");
  ok(f.llamadas === 1, "y se llama una vez");
}
{
  // guardarConfigServidor acepta opts y se los pasa a post.
  const g = recorta("window.kyliaSync.guardarConfigServidor = async function (config, opts)");
  ok(g.includes(", opts)"), "guardarConfigServidor pasa opts a post()");
}

console.log("\n── 2f. TIMEOUT INTEGRAL: también si el CUERPO se queda colgado ──");
// El reloj se paraba al recibir los headers. Un servidor puede devolver la
// Response y dejar el body sin cerrar para siempre: la petición no terminaba
// nunca y la cola se quedaba muerta igual que antes.
{
  const conCuerpoColgado = (init) => {
    const sig = init && init.signal;
    return Promise.resolve({
      ok: true, status: 200,
      text: () => new Promise((_, rej) => {
        if (!sig) return;                       // sin signal, colgado de verdad
        const e = new Error("The operation was aborted."); e.name = "AbortError";
        if (sig.aborted) return rej(e);
        sig.addEventListener("abort", () => rej(e));
      }),
    });
  };
  const { post, leerFallos } = montar((url, init) => conCuerpoColgado(init));
  const t0 = Date.now();
  let rechazo = null, r = null;
  try { r = await post("/api/log", { recurso: "config-app" }, { timeoutMs: 20 }); }
  catch (e) { rechazo = e; }
  ok(rechazo === null, "cuerpo colgado: no rechaza");
  ok(r.error === "timeout", `error "timeout" (${r.error})`);
  ok(r.status === 0 && r.persisted === false, "status 0 y persisted:false");
  ok(Date.now() - t0 < 500, "y vence: no se queda esperando el cuerpo para siempre");
  ok(leerFallos()[0]?.error === "timeout", "registrado como timeout");
}
{
  // Headers OK y cuerpo que se corta SIN ser nuestro abort: no es sin_red, y el
  // status real se conserva.
  const { post } = montar(async () => ({
    ok: false, status: 503,
    text: async () => { throw new TypeError("network error while reading body"); },
  }));
  const r = await post("/x", { recurso: "acciones" });
  ok(r.status === 503, `se conserva el status real (${r.status}), no se degrada a 0`);
  ok(r.error !== "sin_red", "y no se llama sin_red: los headers llegaron");
  ok(r.error === "respuesta_invalida" && r.persisted === false, `error "${r.error}", persisted:false`);
}
{
  // Lo normal sigue igual: cuerpo que sí se lee.
  const { post } = montar(resp(200, JSON.stringify({ ok: true, persisted: true })));
  const r = await post("/x", {}, { timeoutMs: 5000 });
  ok(r.ok === true && r.persisted === true, "con timeout de sobra, una respuesta normal va bien");
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
  // Son CUATRO, y las cuatro están protegidas:
  //   · el `await` del envío de correo, dentro de un try/catch que ya avisa;
  //   · el `const envio =` de addRiego, que encadena .then().catch();
  //   · el `await registroUsuario` de sincronizarZonas, en try/catch con
  //     fallback a null y comprobación de r antes de usarlo;
  //   · el `await guardarConfigServidor` de kyliaConfirmarHistoricas (Punto 2),
  //     que comprueba `!r || !r.persisted` antes de usarlo.
  //   · el `await registroUsuario` de la pantalla de identificación del alta
  //     (onboarding), también en try/catch: su valor NO se usa para decidir
  //     nada, y el correo ya está en localStorage antes de llamar, así que un
  //     fallo de red no puede dejar al agricultor sin identificar ni perderle
  //     el borrador. Revisado a mano al añadirlo, que es lo que pide esta guarda.
  // Si aparece un SEXTO, hay que mirarlo a mano: una promesa consumida sin
  // protección es justo lo que este trabajo viene a evitar. Esta guarda ha
  // saltado ya tres veces al añadir un consumidor, que es para lo que está.
  ok(usos.length === 5, `call sites que consumen el valor: ${usos.length} (esperado 5)`);
  // Vive en confirmarHistoricas; el envoltorio público es una línea.
  const conf = /async function confirmarHistoricas\(ids\)[\s\S]*?\n    \}/.exec(FUENTE)[0];
  ok(/if \(!r \|\| !r\.persisted\)/.test(conf),
     "el de confirmarHistoricas comprueba r antes de tocarlo");
  ok(conf.indexOf("guardarConfigServidor") < conf.indexOf("guardarZonasSinSubir"),
     "y no escribe en local hasta que el CAS confirma");
  // El tercero vive en rondaSincro, la ronda de sincronización de zonas.
  const sincro = recorta("async function rondaSincro(");
  ok(sincro.includes("try { r = await window.kyliaSync?.registroUsuario(payload); } catch (_) { r = null; }"),
     "el de rondaSincro va en try/catch con fallback a null");
  ok(sincro.includes("if (r && r.ok === true && r.persisted === true)"),
     "y comprueba r antes de tocarlo: un null no puede reventar");
  // Y el censo completo, que Codex corrigió: son 12, no 13. La cuenta anterior
  // se dejaba fuera `guardarConfigServidor?.(`, que lleva llamada opcional.
  const todos = FUENTE.match(
    new RegExp("window\\.kyliaSync\\??\\.(" + metodos + ")\\??\\.?\\(", "g")) || [];
  ok(todos.length === 14, `call sites en total: ${todos.length} (esperado 14)`);
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
  ok(app.ver()[0].sincronizado === false, "200 con persisted:false TAMBIÉN se marca");
}
{
  // Sin confirmación explícita, conservador: se marca igual.
  for (const [etiqueta, resultado] of [
    ["persisted ausente",  { ok: true, status: 200, error: "respuesta_invalida" }],
    ["persisted undefined",{ ok: true, status: 200, persisted: undefined }],
    ["persisted truthy 1", { ok: true, status: 200, persisted: 1 }],
  ]) {
    const app = monta1App({ respuestaAccion: async () => resultado });
    app.addRiego("2026-09-15", null, { duracion: 60 });
    await espera();
    ok(app.ver()[0].sincronizado === false, `${etiqueta}: se marca — solo vale persisted === true`);
  }
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
