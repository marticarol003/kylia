// La huella no depende del navegador, y un correo resuelve SIEMPRE al mismo dueño.
//   node tests/test-propietario-por-email.mjs
//
// DOS BUGS DE LA MISMA RAÍZ: `email` y `origen` estaban en payloadSiembra() y
// salían de localStorage. Como la huella del Punto 1 se calcula sobre ese payload,
// la misma siembra daba huellas distintas en el móvil y en el portátil, y cada uno
// creía que el otro la había modificado. Y como esos campos viajaban a la fila de
// cada zona, varias parcelas acababan compartiendo correo — y dos sitios hacían
// `email=eq.<x>&limit=1` tratando esa fila como si fuera la del propietario.
// PostgREST, sin `order`, devuelve una cualquiera.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const APP = readFileSync(join(RAIZ, "app", "index.html"), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };
function trozo(marca) {
  const i = APP.indexOf(marca);
  if (i < 0) throw new Error("no encuentro: " + marca);
  let k = APP.indexOf("{", APP.indexOf("(", i)), prof = 0;
  for (let j = k; j < APP.length; j++) {
    if (APP[j] === "{") prof++;
    else if (APP[j] === "}" && --prof === 0) return APP.slice(i, j + 1);
  }
  throw new Error("sin cerrar: " + marca);
}
// El payload y la huella REALES, con un localStorage que podemos cambiar.
// El cliente resuelve el caudal operativo por una puerta única
// (assets/js/riego-capacidad.js), así que el arnés tiene que darle su `window`.
const KRIEGO = createRequire(import.meta.url)("../assets/js/riego-capacidad.js");
function motorCon(almacen) {
  return new Function("localStorage", "window", `
    ${/const CULTIVOS = \[[\s\S]*?\n    \];/.exec(APP)[0]}
    ${trozo("function nombreCultivo(")}
    ${trozo("function payloadSiembra(")}
    ${trozo("function estable(")}
    ${trozo("function huellaPayload(")}
    return { payloadSiembra, huellaPayload };
  `)({ getItem: (k) => (k in almacen ? almacen[k] : null) }, { KyliaRiego: KRIEGO });
}
const FINCA = { ciudad: "Sant Boi", lat: 41.34, lon: 2.03, suelo: "franco", metodoRiego: "aspersion", caudal: 1.8 };
const ZONA  = { referencia: "R1", geometria: { type: "Polygon", coordinates: [[[0, 0], [1, 1], [0, 0]]] },
                siembras: [{ id: "s-1" }] };
const SIEMBRA = { id: "s-1", cultivo: "brassica", area_m2: 1880, fechaPlantacion: "2026-09-06", metodoRiego: "aspersion" };

console.log("\n── 1. el payload no toca localStorage ──");
{
  const m = motorCon({});
  const p = m.payloadSiembra(ZONA, SIEMBRA, FINCA, "owner");
  ok(!("email" in p), "no lleva email");
  ok(!("origen" in p), "no lleva origen");
  ok(Object.keys(p).join(",") === "id,propietario_id,nombre,ciudad,lat,lon,cultivos,parcela,area_m2,fecha_plantacion,suelo,metodo_riego,caudal",
     "y las claves son solo datos de la siembra y de la finca");
}

console.log("\n── 2. LA MISMA SIEMBRA DA LA MISMA HUELLA EN CUALQUIER NAVEGADOR ──");
{
  const ENTORNOS = [
    ["móvil del agricultor",   { kylia_user_email: "marti@ejemplo.es", kylia_origen: "ferias" }],
    ["portátil",               { kylia_user_email: "marti@ejemplo.es", kylia_origen: null }],
    ["navegador recién abierto", {}],
    ["otro correo",            { kylia_user_email: "otro@distinto.com", kylia_origen: "utm|anuncio" }],
    ["origen larguísimo",      { kylia_origen: "u|utm_source|utm_medium|utm_campaign" }],
  ];
  const huellas = ENTORNOS.map(([etiqueta, ls]) => {
    const m = motorCon(ls);
    return [etiqueta, m.huellaPayload(m.payloadSiembra(ZONA, SIEMBRA, FINCA, "owner"))];
  });
  const primera = huellas[0][1];
  for (const [etiqueta, h] of huellas) ok(h === primera, `${etiqueta}: ${h}`);
  ok(new Set(huellas.map(h => h[1])).size === 1, "una sola huella para los cinco entornos");
}
{
  // Y lo que SÍ es de la siembra sigue moviéndola.
  const m = motorCon({});
  const base = m.huellaPayload(m.payloadSiembra(ZONA, SIEMBRA, FINCA, "owner"));
  for (const [campo, valor] of [["cultivo", "lechuga"], ["area_m2", 999], ["fechaPlantacion", "2026-01-01"]]) {
    const h = m.huellaPayload(m.payloadSiembra(ZONA, { ...SIEMBRA, [campo]: valor }, FINCA, "owner"));
    ok(h !== base, `cambiar ${campo} sigue cambiando la huella`);
  }
  const hFinca = m.huellaPayload(m.payloadSiembra(ZONA, SIEMBRA, { ...FINCA, caudal: 9 }, "owner"));
  ok(hFinca !== base, "y cambiar el caudal de la finca también");
}

console.log("\n── 3. crear-parcela tampoco los escribe ──");
{
  const LOG = readFileSync(join(RAIZ, "api", "log.js"), "utf8");
  const h = /async function handleCrearParcela[\s\S]*?\n}/.exec(LOG)[0];
  const codigo = h.replace(/^\s*\/\/.*$/gm, "").replace(/\s+\/\/[^\n]*/g, "");
  ok(!/email:/.test(codigo) && !/origen:/.test(codigo), "la fila que inserta no lleva email ni origen");
  ok(!/dueño\.email|dueño\.origen/.test(codigo), "ni los hereda del propietario");
}

console.log("\n── 4. un correo resuelve SIEMPRE al mismo propietario ──");
function resolutor(filas) {
  const mod = { exports: {} };
  const src = readFileSync(join(RAIZ, "api", "_propietario.js"), "utf8");
  new Function("module", "exports", "require", src)(mod, mod.exports,
    () => ({ supabaseSelect: async () => filas }));
  return mod.exports.propietarioPorEmail;
}
{
  // El caso real de hoy: el owner y sus zonas comparten correo.
  const r = resolutor([
    { id: "owner", propietario_id: "owner" },
    { id: "zona-1", propietario_id: "owner" },
    { id: "zona-2", propietario_id: "owner" },
  ]);
  const q = await r("marti@ejemplo.es");
  ok(q.propietario_id === "owner", `resuelve al owner (${q.propietario_id})`);
  ok(!q.conflicto && !q.vacio, "sin conflicto");
}
{
  // Y da igual en qué orden lleguen: nada de "la primera que salga".
  const filas = [{ id: "zona-2", propietario_id: "owner" }, { id: "owner", propietario_id: "owner" },
                 { id: "zona-1", propietario_id: "owner" }];
  ok((await resolutor(filas)("x@y.z")).propietario_id === "owner",
     "con la zona primero en la lista, sigue resolviendo al owner");
  ok((await resolutor([...filas].reverse())("x@y.z")).propietario_id === "owner",
     "y al revés también");
}
{
  // Parcela suelta: se apunta a sí misma.
  ok((await resolutor([{ id: "sola", propietario_id: null }])("x@y.z")).propietario_id === "sola",
     "una parcela sin propietario_id es su propio dueño");
}
{
  // Mismo correo, DUEÑOS DISTINTOS: no se elige a dedo.
  const q = await resolutor([{ id: "a", propietario_id: "dueño-1" }, { id: "b", propietario_id: "dueño-2" }])("x@y.z");
  ok(Array.isArray(q.conflicto), "devuelve conflicto");
  ok(q.conflicto.length === 2 && !q.propietario_id, "con los dos dueños y SIN elegir uno");
}
{
  ok((await resolutor([])("x@y.z")).vacio === true, "sin filas: vacío, no error");
  ok((await resolutor([{ id: "a" }])(""))?.vacio === true, "correo vacío: vacío");
}
{
  const src = readFileSync(join(RAIZ, "api", "_propietario.js"), "utf8");
  // Sin comentarios: los de este fichero explican precisamente el limit=1 que se
  // quitó, así que buscarlo en el texto entero siempre acertaría.
  const codigo = src.replace(/^\s*\/\/.*$/gm, "").replace(/\s+\/\/[^\n]*/g, "");
  ok(!/limit=1/.test(codigo), "la consulta NO lleva limit=1: hay que verlas todas para detectar el conflicto");
  ok(/\[\.\.\.new Set\(filas\.map/.test(src), "colapsa por propietario_id");
}

console.log("\n── 5. los dos consumidores usan el resolutor ──");
{
  const acceso = readFileSync(join(RAIZ, "api", "_acceso.js"), "utf8");
  ok(/propietarioPorEmail\(email\)/.test(acceso), "_acceso.js lo usa");
  ok(!/email=eq\.\$\{encodeURIComponent\(email\)\}&select=id,propietario_id&limit=1/.test(acceso),
     "y ya no hace select ... limit=1 sobre usuarios");
  ok(/quien\.conflicto/.test(acceso) && /no se manda enlace/.test(acceso),
     "ante un conflicto no manda enlace, y lo registra");
  ok(/return respuesta;/.test(acceso.slice(acceso.indexOf("quien.conflicto"))),
     "sin filtrar nada por fuera: la respuesta sigue siendo indistinguible");

  const rec = readFileSync(join(RAIZ, "api", "recordatorio-wizard.js"), "utf8");
  ok(/propietarioPorEmail\(email\)/.test(rec), "recordatorio-wizard.js lo usa");
  const recCodigo = rec.replace(/^\s*\/\/.*$/gm, "").replace(/\s+\/\/[^\n]*/g, "");
  ok(!/usuarios\[0\]/.test(recCodigo), "y ya no coge usuarios[0].id");
  ok(!/email=eq\.[^`]*select=id`/.test(recCodigo), "ni busca en usuarios por email a pelo");
  ok(/const usuarioId = quien\.propietario_id/.test(rec),
     "la jornada se busca contra el PROPIETARIO, no contra una zona cualquiera");
}

console.log("\n── 6. esto funciona con y sin filas históricas con email ──");
{
  // Mientras las históricas conserven su correo heredado: varias filas, un dueño.
  ok((await resolutor([{ id: "owner", propietario_id: "owner" }, { id: "hist-1", propietario_id: "owner" }])("x@y.z"))
       .propietario_id === "owner", "con filas históricas que aún llevan email: resuelve igual");
  // Y cuando las nuevas ya no lo lleven: solo queda la del owner.
  ok((await resolutor([{ id: "owner", propietario_id: "owner" }])("x@y.z")).propietario_id === "owner",
     "y cuando solo lo tenga el owner, también");
}

console.log("\n── 7. FUNCIONAL: los módulos reales, ejecutados ──");
// Los asserts de arriba son estructurales y NO habrían cazado el bloqueante que
// encontró Codex: `_acceso.js` y `recordatorio-wizard.js` LLAMABAN a
// propietarioPorEmail sin importarlo. La regex veía la llamada y daba por bueno el
// cableado. Un import que falta solo lo caza ejecutar el módulo.
function cargar(ruta, stubs) {
  const cache = new Map();
  const uno = (r) => {
    if (cache.has(r)) return cache.get(r);
    const src = readFileSync(join(RAIZ, "api", r), "utf8");
    const mod = { exports: {} };
    const req = (m) => {
      const n = m.replace(/^\.\//, "");
      if (stubs[n]) return stubs[n];
      if (m.startsWith("./")) return uno(n);
      if (m.startsWith("../")) return require(join(RAIZ, m.replace(/^\.\.\//, "")));
      return require(m);
    };
    new Function("module", "exports", "require", src)(mod, mod.exports, req);
    cache.set(r, mod.exports);
    return mod.exports;
  };
  return uno(ruta);
}
// Un Supabase de mentira con las filas que le demos.
function supa({ usuarios = [], jornadas = [], accesos = [] }) {
  const reg = { insertados: [], consultas: [] };
  const stub = {
    isConfigured: () => true,
    supabaseSelect: async (tabla, filtro) => {
      reg.consultas.push({ tabla, filtro });
      if (tabla === "usuarios") {
        const em = /email=eq\.([^&]+)/.exec(filtro)?.[1];
        return usuarios.filter(u => u.email === decodeURIComponent(em || ""));
      }
      if (tabla === "jornadas") {
        const uid = /usuario_id=eq\.([^&]+)/.exec(filtro)?.[1];
        return jornadas.filter(j => j.usuario_id === uid);
      }
      if (tabla === "accesos") return accesos;
      return [];
    },
    supabaseInsert: async (tabla, fila) => { reg.insertados.push({ tabla, fila }); return [fila]; },
    supabaseUpdate: async () => [],
    supabaseDelete: async () => [],
    parseBody: (r) => r.body || {},
    preludio: () => true,
  };
  return { stub, reg };
}
// Con la clave puesta, `enviarCorreo` recorre su camino entero y el envío llega
// al stub de fetch. Sin ella declina a propósito —y eso también está bien—, pero
// entonces no se podría comprobar que el flujo termina.
process.env.RESEND_API_KEY = "test-key";
// ⚠️ TAMBIÉN EL SECRETO DE SESIÓN. `pedir()` y `canjear()` se niegan con 503
// cuando falta configuración —a propósito: sin ella no se puede entregar el
// enlace ni emitir la sesión, y fingir que sí es lo que dejaba al agricultor
// esperando un correo que no existía—. Este test prueba la RESOLUCIÓN del
// propietario, así que se le da el entorno que tendría en producción.
process.env.SESION_SECRET = process.env.SESION_SECRET || "secreto-de-prueba-largo-suficiente";
process.env.RESEND_FROM = "kylia@ejemplo.es";
const correos = [];
const httpStub = { fetchConTimeout: async (url, init) => {
  correos.push({ url, body: init?.body });
  return { ok: true, status: 200, text: async () => "{}", json: async () => ({}) };
} };

const EMAIL = "marti@ejemplo.es";
const CON_ZONAS = [
  { id: "zona-1", propietario_id: "owner", email: EMAIL },
  { id: "owner",  propietario_id: "owner", email: EMAIL },
  { id: "zona-2", propietario_id: "owner", email: EMAIL },
];

{
  // _acceso.js · pedir() completo, sin try/catch: un ReferenceError reventaría aquí.
  const { stub, reg } = supa({ usuarios: CON_ZONAS });
  const acceso = cargar("_acceso.js", { "_supabase.js": stub, "_http.js": httpStub });
  const antes = correos.length;
  let error = null, r = null;
  try { r = await acceso.pedir({ email: EMAIL }, "1.2.3.4"); } catch (e) { error = e; }
  ok(error === null, `_acceso.pedir no lanza${error ? " (" + error.constructor.name + ": " + error.message + ")" : ""}`);
  ok(r?.estado === 200 && r.cuerpo.ok === true, "y responde 200");
  const acc = reg.insertados.filter(x => x.tabla === "accesos");
  ok(acc.length === 1, `se crea UN acceso (${acc.length})`);
  ok(acc[0]?.fila.propietario_id === "owner",
     `contra el OWNER, no contra una zona (${acc[0]?.fila.propietario_id})`);
  ok(correos.length === antes + 1, `y el flujo llega hasta el envío del correo (${correos.length - antes})`);
  ok(/resend/i.test(correos[correos.length - 1]?.url || ""), "que sale hacia Resend");
  ok(String(correos[correos.length - 1]?.body || "").includes("/app?acceso="),
     "con el enlace de acceso dentro");
}
{
  // Con las zonas primero en la lista: sigue saliendo el owner.
  const { stub, reg } = supa({ usuarios: [CON_ZONAS[0], CON_ZONAS[2], CON_ZONAS[1]] });
  const acceso = cargar("_acceso.js", { "_supabase.js": stub, "_http.js": httpStub });
  await acceso.pedir({ email: EMAIL }, null);
  ok(reg.insertados[0]?.fila.propietario_id === "owner", "el orden de las filas no decide nada");
}
{
  // CONFLICTO: dos propietarios para el mismo correo.
  const { stub, reg } = supa({ usuarios: [
    { id: "a", propietario_id: "dueño-1", email: EMAIL },
    { id: "b", propietario_id: "dueño-2", email: EMAIL },
  ] });
  const acceso = cargar("_acceso.js", { "_supabase.js": stub, "_http.js": httpStub });
  const antes = correos.length;
  const r = await acceso.pedir({ email: EMAIL }, null);
  ok(r.estado === 200 && r.cuerpo.ok === true, "por fuera sigue siendo indistinguible");
  ok(reg.insertados.filter(x => x.tabla === "accesos").length === 0, "pero NO se crea acceso");
  ok(correos.length === antes, "ni se manda correo: no se elige un dueño a dedo");
}

{
  // recordatorio-wizard · yaRespondioHoy(). La jornada está en el OWNER.
  const hoy = (await import(`${RAIZ}/assets/js/clima-reglas.js`).catch(() => null)) ||
              require(join(RAIZ, "assets", "js", "clima-reglas.js"));
  const dia = (hoy.hoyISO || hoy.default?.hoyISO)();
  const { stub } = supa({ usuarios: CON_ZONAS, jornadas: [{ usuario_id: "owner", fecha: dia }] });
  const rec = cargar("recordatorio-wizard.js", { "_supabase.js": stub, "_http.js": httpStub });
  const resp = await rec.yaRespondioHoy(EMAIL);
  ok(resp === true, `resuelve al owner y encuentra SU jornada (${resp})`);
}
{
  // Y la prueba que distingue de verdad: la jornada está en una ZONA, no en el
  // owner. Si el módulo cogiera "una fila cualquiera" podría decir que sí.
  const hoy = require(join(RAIZ, "assets", "js", "clima-reglas.js"));
  const dia = hoy.hoyISO();
  const { stub, reg } = supa({ usuarios: CON_ZONAS, jornadas: [{ usuario_id: "zona-1", fecha: dia }] });
  const rec = cargar("recordatorio-wizard.js", { "_supabase.js": stub, "_http.js": httpStub });
  ok(await rec.yaRespondioHoy(EMAIL) === false,
     "la jornada de una ZONA no cuenta como respuesta del agricultor");
  const q = reg.consultas.filter(c => c.tabla === "jornadas");
  ok(q.length === 1 && /usuario_id=eq\.owner/.test(q[0].filtro),
     `y la jornada se consultó contra el owner (${q[0]?.filtro?.slice(0, 40)})`);
}
{
  // Conflicto en recordatorio: no se elige, y no devuelve false por un import roto.
  const { stub, reg } = supa({ usuarios: [
    { id: "a", propietario_id: "dueño-1", email: EMAIL },
    { id: "b", propietario_id: "dueño-2", email: EMAIL },
  ] });
  const rec = cargar("recordatorio-wizard.js", { "_supabase.js": stub, "_http.js": httpStub });
  ok(await rec.yaRespondioHoy(EMAIL) === false, "con conflicto devuelve false (ante duda, enviar)");
  ok(reg.consultas.filter(c => c.tabla === "jornadas").length === 0,
     "sin consultar la jornada de ninguno: no se elige a dedo");
}
{
  // Sin filas: vacío, y tampoco revienta.
  const { stub } = supa({ usuarios: [] });
  const rec = cargar("recordatorio-wizard.js", { "_supabase.js": stub, "_http.js": httpStub });
  ok(await rec.yaRespondioHoy("nadie@ninguna.parte") === false, "correo desconocido: false, sin excepción");
}
{
  // Y la guarda que habría cazado el bloqueante: los dos módulos IMPORTAN el helper.
  for (const f of ["_acceso.js", "recordatorio-wizard.js"]) {
    const src = readFileSync(join(RAIZ, "api", f), "utf8");
    ok(/require\("\.\/_propietario\.js"\)/.test(src), `${f} importa el helper de verdad`);
    ok((src.match(/function propietarioPorEmail/g) || []).length === 0,
       `${f} no duplica la función`);
  }
}

console.log(fallos === 0 ? "\n✅ TODOS LOS TESTS VERDES\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos === 0 ? 0 : 1);
