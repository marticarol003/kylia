// La configuración no puede llegar desordenada al servidor.
//   node tests/test-config-version-cas.mjs
//
// POR QUÉ EXISTE. `config_app` se escribía con un PATCH incondicional: el último
// POST que LLEGA gana, y ese no es el último que se PIDIÓ. Dos guardados en vuelo
// pueden terminar al revés. La cola del cliente ordena lo que sale de un
// navegador, pero no puede hacer nada contra dos dispositivos, ni contra una
// petición que el servidor procesa tarde después de que el cliente la abortara
// por timeout: abortar aquí no detiene al servidor.
//
// El orden lo pone un UPDATE condicionado a la versión, en UN solo statement.
// Nada de SELECT → comprobar → UPDATE, que es la misma carrera con más pasos.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const SQL = readFileSync(join(RAIZ, "db", "config-version-cas-2026-09-16.sql"), "utf8");
const LOG = readFileSync(join(RAIZ, "api", "log.js"), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

// ─── Un Postgres de mentira con la semántica que importa ───────────────
// `UPDATE … WHERE id=? AND config_version=?` es ATÓMICO: o casa y escribe, o no
// casa y devuelve 0 filas. Aquí se modela exactamente eso, y el resto del test
// comprueba que el handler se apoya en ello y no en comprobaciones propias.
function servidor(filas) {
  const tabla = new Map(filas.map(f => [f.id, { ...f }]));
  let updates = 0;
  return {
    updates: () => updates,
    ver: (id) => ({ ...tabla.get(id) }),
    // Devuelve las filas afectadas, como PostgREST con return=representation.
    patch(filtro, patch) {
      updates++;
      const id = /id=eq\.([^&]+)/.exec(filtro)?.[1];
      const ver = /config_version=eq\.(\d+)/.exec(filtro)?.[1];
      const f = tabla.get(id);
      if (!f) return [];
      if (ver !== undefined && String(f.config_version) !== ver) return [];   // ← el CAS
      Object.assign(f, patch);
      return [{ ...f }];
    },
    select(filtro) {
      const id = /id=eq\.([^&]+)/.exec(filtro)?.[1];
      const f = tabla.get(id);
      return f ? [{ ...f }] : [];
    },
  };
}

// Ejecuta el handler real contra ese servidor.
function montaHandler(srv) {
  const mod = { exports: {} };
  const falso = {
    isConfigured: () => true,
    supabaseUpdate: async (t, filtro, patch) => srv.patch(filtro, patch),
    supabaseSelect: async (t, filtro) => srv.select(filtro),
    supabaseInsert: async () => [{}],
    supabaseDelete: async () => [],
    parseBody: (r) => r.body || {},
    preludio: () => true,
  };
  const req2 = require;
  const cargar = new Function("module", "exports", "require", LOG);
  cargar(mod, mod.exports, (m) => (m.includes("_supabase") ? falso : req2(join(RAIZ, "api", m.replace(/^\.\//, "")))));
  // El módulo despacha por `recurso`; se entra por la puerta de siempre.
  return mod.exports;
}
const respuesta = () => {
  const r = { _status: 200, _json: null };
  r.status = (s) => { r._status = s; return r; };
  r.json = (j) => { r._json = j; return r; };
  return r;
};
const CONFIG = { finca: { cultivos: ["lechuga"], areaParcela: 100 }, zonas: [] };
const UID = "11111111-1111-1111-1111-111111111111";
const guardar = async (h, srv, cuerpo) => {
  const res = respuesta();
  await h({ method: "POST", headers: {}, body: { recurso: "config-app", propietario_id: UID, config: CONFIG, ...cuerpo } }, res);
  return res;
};
const conBase = (base, extra = {}) => ({ base_version: base, ...extra });

console.log("\n── 1. el SQL: una columna, un default y una constraint ──");
ok(/add column config_version bigint not null default 0/.test(SQL),
   "config_version bigint not null default 0");
ok(/check \(config_version >= 0\) not valid/.test(SQL), "constraint >= 0, NOT VALID al crearla");
ok(/validate constraint usuarios_config_version_ck/.test(SQL), "y validada después");
ok(/notify pgrst, 'reload schema'/.test(SQL), "recarga el schema cache de PostgREST");
ok(/drop column if exists config_version/.test(SQL), "y trae rollback");
ok(/INDEPENDIENTE de db\/congelar-lamina-riego/.test(SQL) && /No mezclarlas/.test(SQL),
   "declarada INDEPENDIENTE de la migración de láminas");

console.log("\n── 2. el handler: CAS de verdad, no comprobación previa ──");
{
  const cuerpo = /async function handleConfigApp[\s\S]*?\n}/.exec(LOG)[0];
  ok(/config_version=eq\.\$\{base\}/.test(cuerpo), "el PATCH filtra por id Y por config_version");
  ok(/config_version: base \+ 1/.test(cuerpo), "y escribe la versión nueva en el MISMO statement");
  const iSel = cuerpo.indexOf("supabaseSelect");
  const iUpd = cuerpo.indexOf("supabaseUpdate");
  ok(iUpd > -1 && (iSel === -1 || iUpd < iSel),
     "el UPDATE va primero: el SELECT solo sirve para explicar el conflicto");
}

console.log("\n── 3. A y B parten de 7 ──");
{
  const srv = servidor([{ id: UID, config_version: 7, config_app: { v: "vieja" } }]);
  const h = montaHandler(srv);
  const a = await guardar(h, srv, conBase(7));
  ok(a._status === 200 && a._json.persisted === true, "A escribe con base 7");
  ok(a._json.config_version === 8, `y devuelve la versión nueva (${a._json.config_version})`);
  const antes = JSON.stringify(srv.ver(UID).config_app);
  const b = await guardar(h, srv, conBase(7));
  ok(b._status === 409, `B con base 7 → conflicto (${b._status})`);
  ok(b._json.persisted === false, "y NO persiste");
  ok(JSON.stringify(srv.ver(UID).config_app) === antes, "config_app intacta: la versión incorrecta no la toca");
  ok(b._json.config_version === 8, "el conflicto dice cuál es la versión vigente");
}
{
  // Al revés: B gana primero y A no puede sobrescribirla.
  const srv = servidor([{ id: UID, config_version: 7 }]);
  const h = montaHandler(srv);
  const b = await guardar(h, srv, conBase(7));
  const a = await guardar(h, srv, conBase(7));
  ok(b._json.persisted === true && a._status === 409, "B gana; A con base 7 no puede sobrescribirla");
  ok(srv.ver(UID).config_version === 8, "y la versión solo avanzó una vez");
}

console.log("\n── 4. veinte peticiones concurrentes, misma base ──");
{
  const srv = servidor([{ id: UID, config_version: 3 }]);
  const h = montaHandler(srv);
  const rs = await Promise.all(Array.from({ length: 20 }, () => guardar(h, srv, conBase(3))));
  const ganadoras = rs.filter(r => r._status === 200 && r._json.persisted === true);
  ok(ganadoras.length === 1, `gana exactamente UNA (${ganadoras.length})`);
  ok(rs.filter(r => r._status === 409).length === 19, "las otras 19 dan conflicto");
  ok(srv.ver(UID).config_version === 4, `y la versión avanza una sola vez (${srv.ver(UID).config_version})`);
}

console.log("\n── 5. primer guardado de una fila existente: versión 0 ──");
{
  const srv = servidor([{ id: UID, config_version: 0, config_app: null }]);
  const h = montaHandler(srv);
  const r = await guardar(h, srv, conBase(0));
  ok(r._status === 200 && r._json.config_version === 1, "base 0 funciona sin caso especial");
  ok(srv.ver(UID).config_app.finca.areaParcela === 100, "y la foto queda escrita");
}

console.log("\n── 6. cliente viejo: SIN base_version no hay UPDATE incondicional ──");
{
  const srv = servidor([{ id: UID, config_version: 5, config_app: { v: "buena" } }]);
  const h = montaHandler(srv);
  const res = await guardar(h, srv, {});          // sin base_version
  ok(res._status === 426, `se rechaza explícitamente (${res._status})`);
  ok(res._json.error === "base_version_requerida", `con un error nombrado ("${res._json.error}")`);
  ok(res._json.persisted === false, "persisted:false");
  ok(srv.updates() === 0, "y NO se ejecuta ningún UPDATE: cero riesgo de pisar");
  ok(srv.ver(UID).config_app.v === "buena", "la config del servidor sigue intacta");
}
{
  const srv = servidor([{ id: UID, config_version: 5 }]);
  const h = montaHandler(srv);
  for (const mala of ["-1", "abc", 1.5, null]) {
    const r = await guardar(h, srv, conBase(mala));
    ok(r._status === 400 || r._status === 426, `base_version ${JSON.stringify(mala)} → rechazada (${r._status})`);
  }
  ok(srv.updates() === 0, "ninguna de ellas llega a tocar la fila");
}

console.log("\n── 7. timeout del cliente + commit tardío del servidor ──");
{
  // El cliente abortó por timeout, pero el servidor terminó y dejó la versión en
  // 9. La escritura siguiente parte de 8, que es lo que el cliente creía.
  const srv = servidor([{ id: UID, config_version: 8 }]);
  const h = montaHandler(srv);
  await guardar(h, srv, conBase(8));             // el commit que el cliente no vio
  const antes = JSON.stringify(srv.ver(UID).config_app);
  const siguiente = await guardar(h, srv, conBase(8));
  ok(siguiente._status === 409, "la siguiente escritura detecta el conflicto, no pisa en silencio");
  ok(JSON.stringify(srv.ver(UID).config_app) === antes, "y no sobrescribe lo que dejó la petición tardía");
  ok(siguiente._json.config_version === 9, "el conflicto dice cuál es la versión vigente");
  ok(!("sesion" in siguiente._json), "y NO devuelve ninguna marca de autoría: el cliente la controlaba");
}

console.log("\n── 8. vista=config no fabrica versiones ──");
{
  const CAMPO = readFileSync(join(RAIZ, "api", "campo.js"), "utf8");
  ok(!/select=id,config_app,config_version/.test(CAMPO),
     "sin nombrar la columna en un select explícito: antes de migrar eso sería un 400");
  ok(!/Number\.isFinite\(Number\(u\.config_version\)\) \? Number\(u\.config_version\) : 0/.test(CAMPO),
     "y ya no hay ningún `: 0` de relleno");
}

console.log("\n── 9. el cliente: base obligatoria y CERO reintentos ──");
{
  const A = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
  const g = /window\.kyliaSync\.guardarConfigServidor = async function[\s\S]*?\n      \};/.exec(A)[0];
  ok(/base_version: base\.base_version/.test(g), "manda la base PERSISTIDA, no una de memoria");
  ok(/propietario_id: base\.owner_id/.test(g), "y el POST va al owner de esa base");
  ok(!/sesion/.test(g), "ninguna marca de sesión: el cliente la controlaba, no probaba nada");
  ok(/error: "base_desconocida"/.test(g), "sin base persistida no manda nada");
  ok(/anotarConflicto\(/.test(g), "un conflicto se anota");
  ok(!/await post\([\s\S]*await post\(/.test(g), "y NO reintenta: un solo POST en toda la función");
  const rama409 = g.slice(g.indexOf("r.status === 409"));
  ok(!/guardarBase\(/.test(rama409), "tras un 409 la base local no se mueve");
  ok(/if \(abierto\)/.test(g), "con un conflicto abierto no se escribe nada");
  ok(/abierto\.foto_local_sin_guardar = config/.test(g),
     "conservando la última foto local que no pudo guardarse");
  ok(/srv\.config_version !== base\.base_version/.test(g),
     "y se compara la versión del servidor contra la base local ANTES de escribir");
}
{
  const A = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
  const esV = /const esVersion = [^\n]+/.exec(A)[0];
  ok(/typeof v === "number"/.test(esV) && /Number\.isSafeInteger\(v\)/.test(esV) && /v >= 0/.test(esV),
     "esVersion comprueba por TIPO, no con Number()");
  const f = new Function("return " + esV.replace("const esVersion = ", ""))();
  const CASOS = [[0, true], [7, true], [null, false], ["", false], ["0", false], [undefined, false],
                 [-1, false], [1.5, false], [Infinity, false], [NaN, false], [{}, false], [true, false]];
  for (const [v, esperado] of CASOS) {
    ok(f(v) === esperado, `esVersion(${JSON.stringify(v) ?? String(v)}) = ${esperado}`);
  }
  ok(!/esVersion\(Number\(/.test(A), "y en NINGÚN camino se le pasa un Number(): cero coerción");
}
{
  const A = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
  const leer = /async function leerConfigServidor\(\)[\s\S]*?\n      \}/.exec(A)[0];
  ok(/AbortController/.test(leer), "la LECTURA de versión también lleva AbortController");
  ok(/TIMEOUT_VERSION_MS/.test(leer), "con su tope explícito");
  ok(/return null;/.test(leer), "y al vencer devuelve null: no se escribe, nunca se asume 0");
}

console.log("\n── 10. vista=config: foto y versión de la MISMA fila propietaria ──");
{
  const CAMPO = readFileSync(join(RAIZ, "api", "campo.js"), "utf8");
  const cuerpo = /async function vistaConfig[\s\S]*?\n}/.exec(CAMPO)[0];
  ok(/const propietario = \{/.test(cuerpo), "hay un bloque `propietario` explícito");
  ok(/config:\s+filaDueno \? \(filaDueno\.config_app \|\| configDesdeFila\(filaDueno\) \|\| null\) : null/.test(cuerpo),
     "su config sale de la fila del dueño, reconstruida de ESA fila si hiciera falta");
  ok(/config_version: filaDueno \? versionValida\(filaDueno\.config_version\) : null/.test(cuerpo),
     "y su versión, de esa MISMA fila");
  const vv = /function versionValida[\s\S]*?\n}/.exec(CAMPO)[0];
  const f = new Function("return " + vv.replace("function versionValida", "function"))();
  ok(f(7) === 7 && f("7") === 7, "versionValida acepta número y bigint como cadena");
  ok(f(null) === null && f(undefined) === null && f("") === null && f(-1) === null && f(1.5) === null,
     "y devuelve null para todo lo demás: NO fabrica 0");
}
{
  // owner en 7 con su config; zone en 2 con otra. El CAS tiene que usar 7.
  const srv = servidor([
    { id: "owner", propietario_id: "owner", config_version: 7, config_app: { finca: { nombre: "del dueño" } } },
    { id: "zone",  propietario_id: "owner", config_version: 2, config_app: { finca: { nombre: "de la zona" } } },
  ]);
  const CAMPO = readFileSync(join(RAIZ, "api", "campo.js"), "utf8");
  const cuerpo = /function versionValida[\s\S]*?\nasync function vistaConfig[\s\S]*?\n}/.exec(CAMPO)[0];
  const f = new Function("supabaseSelect", "configDesdeFila", cuerpo + ";\nreturn vistaConfig;")(
    async (t, filtro) => srv.select(filtro), () => null);
  const res = respuesta();
  await f(res, srv.ver("zone"));
  ok(res._json.propietario.id === "owner", "propietario.id = owner");
  ok(res._json.propietario.config_version === 7,
     `propietario.config_version = 7, no la 2 de la zona (${res._json.propietario.config_version})`);
  ok(res._json.propietario.config.finca.nombre === "del dueño",
     "y propietario.config es la del dueño, no la de la zona");
  ok(res._json.config_version === 7, "el config_version de primer nivel también es el del dueño");
}
{
  // El propietario no tiene config: null + SU versión, sin buscarla en otra fila.
  const srv = servidor([
    { id: "owner", propietario_id: "owner", config_version: 4, config_app: null },
    { id: "zone",  propietario_id: "owner", config_version: 2, config_app: { finca: { nombre: "de la zona" } } },
  ]);
  const CAMPO = readFileSync(join(RAIZ, "api", "campo.js"), "utf8");
  const cuerpo = /function versionValida[\s\S]*?\nasync function vistaConfig[\s\S]*?\n}/.exec(CAMPO)[0];
  const f = new Function("supabaseSelect", "configDesdeFila", cuerpo + ";\nreturn vistaConfig;")(
    async (t, filtro) => srv.select(filtro), () => null);
  const res = respuesta();
  await f(res, srv.ver("zone"));
  ok(res._json.propietario.config === null, "sin config del dueño → null, no la de la zona");
  ok(res._json.propietario.config_version === 4, "y SU versión, la 4");
}

console.log("\n── 11. la migración es idempotente y no degrada nada ──");
{
  ok(!/^\s*alter table usuarios drop constraint/m.test(SQL.split("-- ROLLBACK")[0]),
     "fuera del rollback no hay ni un drop constraint");
  ok(/if not exists \(\s*\n\s*select 1 from pg_constraint/.test(SQL),
     "la constraint se crea solo si falta");
  ok(/and not convalidated\s*\n\s*\) then\s*\n\s*alter table usuarios validate constraint/.test(SQL),
     "y se valida SOLO si está pendiente: una ya validada no se toca");
  ok(/config_version ya existe: no se toca/.test(SQL) && /constraint ya validada: no se toca/.test(SQL),
     "y lo dice en voz alta al reejecutarse");
  ok(/EN LA PRODUCCIÓN DE MARTÍ ESTO YA ESTÁ HECHO/.test(SQL),
     "el runbook refleja el estado REAL: en su producción ya está");
  const antesRollback = SQL.split("-- ROLLBACK")[0];
  ok(!/config_app\s*=/.test(antesRollback) && !/update usuarios set config_app/.test(antesRollback),
     "y config_app no se toca en ningún punto");
}

console.log("\n── 12. la BASE local persiste, y es lo que detecta el conflicto ──");
// Arnés: instancias REALES del cliente sobre un localStorage compartido. Un
// "reload" es construir otra instancia con el mismo almacén, no reasignar dos
// variables a mano — que es justo lo que ocultaría que la garantía vivía en
// memoria.
const APP = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
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
function almacenCompartido(inicial = {}) {
  const m = new Map(Object.entries(inicial));
  return { getItem: k => (m.has(k) ? m.get(k) : null),
           setItem: (k, v) => m.set(k, String(v)),
           removeItem: k => m.delete(k), _m: m };
}
// Cada llamada = una carga nueva de la app.
function cargarApp({ almacen, servidor, responde, uid = "zone-1" }) {
  const enviados = [];
  const cuerpo = `
    const userId = uid;
    const encodeURIComponent = (x) => x;
    ${/const BASE_KEY\s+= "[^"]+";/.exec(APP)[0]}
    ${/const CONFLICTO_KEY\s+= "[^"]+";/.exec(APP)[0]}
    ${/const TIMEOUT_VERSION_MS = \d+;/.exec(APP)[0]}
    ${/const esVersion = [^\n]+/.exec(APP)[0]}
    ${/const esOwner   = [^\n]+/.exec(APP)[0]}
    const post = async (p, d) => { enviados.push(d); return responde(d); };
    const kyliaSync = {};
    ${trozo("function leerBase()")}
    ${trozo("function guardarBase(")}
    ${trozo("function escribirConfigLocal(")}
    ${trozo("function adoptarConfigPropietario(")}
    ${trozo("function tuplaDe(")}
    ${trozo("async function adoptarDelPropietario(")}
    ${trozo("function tieneConfigLocal(")}
    ${trozo("async function restaurarSiVacio(")}
    ${/const STORAGE_KEY = "[^"]+";/.exec(APP)[0]}
    let cfgFinca = null, cfg = null;
    const configEfectiva = () => cfgFinca;
    const subirConfig = () => {};
    ${trozo("function saveConfig(")}
    ${trozo("function leerConflicto()")}
    ${trozo("function guardarConflicto(")}
    ${trozo("async function leerConfigServidor(")}
    ${trozo("function anotarConflicto(")}
    ${/window\.kyliaSync\.guardarConfigServidor = async function[\s\S]*?\n      \};/.exec(APP)[0].replace("window.kyliaSync.", "kyliaSync.")}
    return { guardar: kyliaSync.guardarConfigServidor,
             adoptar: adoptarConfigPropietario, tuplaDe,
             restaurarSiVacio, adoptarDelPropietario, saveConfig,
             base: leerBase, conflicto: leerConflicto,
             configLocal: () => { try { return JSON.parse(localStorage.getItem("kylia_config")); } catch (_) { return null; } },
             dueno: () => localStorage.getItem("kylia_user_id") };
  `;
  const f = new Function("uid", "localStorage", "sessionStorage", "responde", "enviados",
                        "fetch", "console", "location", cuerpo);
  const recargas = [];
  const fetchFalso = async (url) => ({ ok: true, json: async () => servidor(url) });
  // ⚠️ `sessionStorage` TAMBIÉN, y NUEVO EN CADA INSTANCIA: el navegador lo
  // tiene, y `restaurarSiVacio` lo usa para no encadenar recargas. Una instancia
  // nueva del arnés es una PESTAÑA nueva, así que empieza vacío —si se
  // compartiera, la segunda carga no restauraría y estaríamos probando el arnés—.
  const sesion = (() => { const m = new Map(); return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })();
  return { ...f(uid, almacen, sesion, responde, enviados, fetchFalso, { warn: () => {} },
                { reload: () => recargas.push(1), replace: () => {} }), enviados, recargas };
}
const OK_CAS = (v) => async () => ({ ok: true, persisted: true, status: 200, datos: { ok: true, config_version: v } });
const vistaOwner = (id, version, config) => () => ({ ok: true, propietario: { id, config_version: version, config } });

{
  // Mac y móvil en 7. Mac escribe 8. El móvil manda, recibe 409, RECARGA, y
  // vuelve a guardar: sigue sin poder escribir.
  const ls = almacenCompartido();
  let versionServidor = 7;
  const srv = () => ({ ok: true, propietario: { id: "owner", config_version: versionServidor, config: { n: "del servidor" } } });
  const a1 = cargarApp({ almacen: ls, servidor: srv,
    responde: async () => ({ ok: false, status: 409, persisted: false, datos: { config_version: 8 } }) });
  a1.adoptar({ owner_id: "owner", config_version: 7, config: { finca: { n: "owner" } } });
  ok(a1.base().base_version === 7 && a1.base().owner_id === "owner", "el móvil adopta base 7 del owner");

  versionServidor = 7;                                  // aún no ha llegado lo de Mac
  const r1 = await a1.guardar({ n: "B del móvil" });
  ok(r1.status === 409, "el móvil manda con base 7 y recibe 409");
  ok(a1.enviados[0].base_version === 7 && a1.enviados[0].propietario_id === "owner",
     "el POST fue al OWNER con base 7");
  ok(a1.base().base_version === 7, "y la base local SIGUE en 7, no adopta la 8");

  // RELOAD: instancia nueva, mismo localStorage.
  versionServidor = 8;
  const a2 = cargarApp({ almacen: ls, servidor: srv, responde: OK_CAS(9) });
  ok(a2.base().base_version === 7, "tras recargar, la base local sigue siendo 7");
  const r2 = await a2.guardar({ n: "C tras recargar" });
  ok(r2.error === "conflicto_config", `y el guardado no sale: ${r2.error}`);
  ok(a2.enviados.length === 0, `0 POST (${a2.enviados.length})`);
  ok(a2.base().base_version === 7, "la base sigue sin moverse");
}
{
  // Igual, pero SIN guardar después del 409 antes del reload. El conflicto se
  // detecta igual, porque la base lo dice.
  const ls = almacenCompartido();
  const a1 = cargarApp({ almacen: ls, servidor: vistaOwner("owner", 7, {}), responde: OK_CAS(8) });
  a1.adoptar({ owner_id: "owner", config_version: 7, config: { finca: { n: "owner" } } });
  const a2 = cargarApp({ almacen: ls, servidor: vistaOwner("owner", 8, { n: "de Mac" }), responde: OK_CAS(9) });
  const r = await a2.guardar({ n: "del móvil" });
  ok(r.error === "conflicto_config", "servidor en 8 y base local en 7 → conflicto SIN haber visto un 409");
  ok(a2.enviados.length === 0, "0 POST");
  ok(a2.conflicto()?.motivo === "servidor_adelantado", `y se anota el motivo (${a2.conflicto()?.motivo})`);
  ok(a2.conflicto()?.foto_local_sin_guardar.n === "del móvil", "con la foto local que no pudo guardarse");
}
{
  // Base ausente o corrupta → 0 POST, y NUNCA se adopta la versión del servidor.
  for (const [etiqueta, valor] of [["ausente", null], ["basura", "{{"], ["sin owner", '{"base_version":7}'],
                                   ["sin versión", '{"owner_id":"owner"}'],
                                   ['versión "7"', '{"owner_id":"owner","base_version":"7"}'],
                                   ["versión -1", '{"owner_id":"owner","base_version":-1}']]) {
    const ls = almacenCompartido(valor === null ? {} : { kylia_config_base: valor });
    const a = cargarApp({ almacen: ls, servidor: vistaOwner("owner", 7, { n: "hay algo" }), responde: OK_CAS(8) });
    const r = await a.guardar({ n: "x" });
    ok(r.error === "base_desconocida" && a.enviados.length === 0,
       `base ${etiqueta} → base_desconocida y 0 POST`);
    ok(a.base() === null, "y no se le asocia la versión actual del servidor");
  }
}
{
  // Éxito 7→8: la base pasa a 8 y sobrevive al reload.
  const ls = almacenCompartido();
  const a1 = cargarApp({ almacen: ls, servidor: vistaOwner("owner", 7, {}), responde: OK_CAS(8) });
  a1.adoptar({ owner_id: "owner", config_version: 7, config: { finca: { n: "owner" } } });
  const r = await a1.guardar({ n: "mío" });
  ok(r.persisted === true, "el CAS confirma");
  ok(a1.base().base_version === 8, "la base local pasa a 8");
  const a2 = cargarApp({ almacen: ls, servidor: vistaOwner("owner", 8, {}), responde: OK_CAS(9) });
  ok(a2.base().base_version === 8, "y sobrevive al reload");
  const r2 = await a2.guardar({ n: "otro" });
  ok(r2.persisted === true && a2.enviados[0].base_version === 8, "el guardado siguiente usa la 8");
}
{
  // Servidor virgen: config null en versión 0. Es la ÚNICA excepción.
  const ls = almacenCompartido();
  const a = cargarApp({ almacen: ls, servidor: vistaOwner("owner", 0, null), responde: OK_CAS(1) });
  const r = await a.guardar({ n: "primera vez" });
  ok(r.persisted === true && a.enviados[0].base_version === 0,
     "sin config en el servidor se puede arrancar en base 0: no hay nada que pisar");
  ok(a.base().base_version === 1, "y la base queda en 1");
}
{
  // Pero con config en el servidor y sin base local, NO.
  const ls = almacenCompartido();
  const a = cargarApp({ almacen: ls, servidor: vistaOwner("owner", 0, { n: "algo hay" }), responde: OK_CAS(1) });
  const r = await a.guardar({ n: "x" });
  ok(r.error === "base_desconocida" && a.enviados.length === 0,
     "con config en el servidor y sin base local: 0 POST aunque la versión sea 0");
}

console.log("\n── 13. tipado estricto TAMBIÉN tras el éxito ──");
{
  for (const [etiqueta, v] of [['"1"', "1"], ["null", null], ["true", true], ['""', ""], ["1.5", 1.5], ["undefined", undefined]]) {
    const ls = almacenCompartido({ kylia_config_base: JSON.stringify({ owner_id: "owner", base_version: 7 }) });
    const a = cargarApp({ almacen: ls, servidor: vistaOwner("owner", 7, {}),
      responde: async () => ({ ok: true, persisted: true, status: 200, datos: { ok: true, config_version: v } }) });
    const r = await a.guardar({ n: "x" });
    ok(r.error === "version_no_confirmable", `éxito con versión ${etiqueta} → no confirmable`);
    ok(a.base().base_version === 7, "la base NO avanza");
    const r2 = await a.guardar({ n: "y" });
    ok(r2.error === "conflicto_config" && a.enviados.length === 1,
       "y la escritura siguiente queda bloqueada");
  }
  // El 1 numérico sí.
  const ls = almacenCompartido({ kylia_config_base: JSON.stringify({ owner_id: "owner", base_version: 7 }) });
  const a = cargarApp({ almacen: ls, servidor: vistaOwner("owner", 7, {}), responde: OK_CAS(8) });
  ok((await a.guardar({ n: "x" })).persisted === true && a.base().base_version === 8,
     "y un 8 numérico sí confirma y avanza la base");
}

console.log("\n── 14. la tupla owner+versión+foto es inseparable ──");
{
  // userId = zone; owner en 7; zone en 2. El POST tiene que ir al OWNER con 7.
  const ls = almacenCompartido();
  const a = cargarApp({ almacen: ls, uid: "zone",
    servidor: vistaOwner("owner", 7, { n: "del dueño" }), responde: OK_CAS(8) });
  a.adoptar({ owner_id: "owner", config_version: 7, config: { finca: { n: "owner" } } });
  const r = await a.guardar({ n: "x" });
  ok(r.persisted === true, "escribe");
  ok(a.enviados[0].propietario_id === "owner", `y va al OWNER (${a.enviados[0].propietario_id}), no a la zona`);
  ok(a.enviados[0].base_version === 7, "con la base 7 del owner, no la 2 de la zona");
}
{
  // La versión se obtuvo para otro owner: no se reutiliza.
  const ls = almacenCompartido({ kylia_config_base: JSON.stringify({ owner_id: "otro-dueno", base_version: 7 }) });
  const a = cargarApp({ almacen: ls, servidor: vistaOwner("owner", 7, {}), responde: OK_CAS(8) });
  const r = await a.guardar({ n: "x" });
  ok(r.error === "owner_no_coincide" && a.enviados.length === 0,
     "una base obtenida para otro UUID no autoriza a escribir aquí");
}

console.log("\n── 15. A · restaurarSiVacio() REAL, con owner y zone distintos ──");
{
  // El servidor devuelve el bloque propietario del OWNER y un `config` de primer
  // nivel que es el de la ZONA. Solo puede adoptarse el del propietario.
  const ls = almacenCompartido();
  const respuestaServidor = () => ({
    ok: true, vista: "config",
    propietario_id: "owner",
    config: { finca: { n: "ZONE" } },              // ← foto de la zona, NO adoptable
    de: "zone",
    propietario: { id: "owner", config_version: 7, config: { finca: { n: "OWNER" } } },
  });
  const a = cargarApp({ almacen: ls, uid: "zone", servidor: respuestaServidor, responde: OK_CAS(8) });
  await a.restaurarSiVacio();                      // ← el camino real, no adoptar() a mano
  ok(a.configLocal()?.n === "OWNER", `la foto adoptada es la del OWNER (${a.configLocal()?.n})`);
  ok(a.configLocal()?.n !== "ZONE", "y NO la de la zona");
  ok(a.base()?.owner_id === "owner", "el owner de la base es el propietario");
  ok(a.base()?.base_version === 7, `y la base es 7, no la 2 de la zona (${a.base()?.base_version})`);
  ok(a.dueno() === "owner", "el dispositivo adopta al propietario");
  ok(a.recargas.length === 1, "y recarga, porque media app ya leyó localStorage");

  // Ahora edita y guarda: el POST tiene que ir al owner con base 7.
  const r = await a.guardar({ finca: { n: "OWNER editado" } });
  ok(r.persisted === true, "el guardado sale");
  ok(a.enviados[0].propietario_id === "owner" && a.enviados[0].base_version === 7,
     `POST a owner con base 7 (${a.enviados[0].propietario_id}/${a.enviados[0].base_version})`);
  ok(a.enviados[0].config.finca.n === "OWNER editado", "con la foto del owner editada");
}

console.log("\n── 16. B · canje REAL: identificar, adoptar, recargar, editar, guardar ──");
{
  const ls = almacenCompartido();                  // dispositivo vacío
  const servidor = () => ({
    ok: true, propietario_id: "owner", de: "owner",
    config: { finca: { n: "OWNER" } },
    propietario: { id: "owner", config_version: 4, config: { finca: { n: "OWNER" } } },
  });
  // El canje identifica; la adopción va por el camino canónico.
  const a1 = cargarApp({ almacen: ls, uid: "vacio", servidor, responde: OK_CAS(5) });
  ls.setItem("kylia_user_id", "owner");            // lo que hace el canje
  ok(await a1.adoptarDelPropietario("owner") === true, "el canje adopta la tupla del propietario");
  ok(a1.base()?.owner_id === "owner" && a1.base()?.base_version === 4,
     "queda base válida: owner + 4");

  // RELOAD real: instancia nueva sobre el mismo almacén.
  const a2 = cargarApp({ almacen: ls, uid: "owner", servidor, responde: OK_CAS(5) });
  ok(a2.base()?.base_version === 4, "la base sobrevive al reload");
  const r = await a2.guardar({ finca: { n: "editado tras canjear" } });
  ok(r.persisted === true, "y el guardado funciona");
  ok(a2.enviados[0].propietario_id === "owner" && a2.enviados[0].base_version === 4,
     "con el owner correcto y su base");
  ok(a2.base()?.base_version === 5, "la base avanza a 5");
}

console.log("\n── 17. C · ya hay datos locales y no hay base ──");
{
  // La foto local se construyó vete a saber sobre qué. Pegarle la versión actual
  // del servidor es justo el bug: foto vieja autorizada a escribir sobre lo nuevo.
  const ls = almacenCompartido({
    kylia_config: JSON.stringify({ cultivos: ["lechuga"], areaParcela: 100, parcela: { g: 1 } }),
  });
  const servidor = () => ({ ok: true, propietario_id: "owner",
    config: { finca: { n: "del servidor" } }, de: "owner",
    propietario: { id: "owner", config_version: 9, config: { finca: { n: "del servidor" } } } });
  const a = cargarApp({ almacen: ls, uid: "owner", servidor, responde: OK_CAS(10) });
  await a.restaurarSiVacio();
  ok(a.base() === null, "NO se asocia la versión 9 del servidor a la foto local");
  ok(a.configLocal()?.areaParcela === 100, "y la config local no se sobrescribe");
  ok(a.recargas.length === 0, "ni se recarga");
  const r = await a.guardar({ finca: { n: "x" } });
  ok(r.error === "base_desconocida" && a.enviados.length === 0, "0 POST remoto");
}

console.log("\n── 18. D · tuplas incompletas o mezcladas: 0 adopción ──");
{
  const TUPLAS = [
    ["sin owner",            { config_version: 7, config: { finca: {} } }],
    ["owner vacío",          { owner_id: "", config_version: 7, config: { finca: {} } }],
    ["sin versión",          { owner_id: "o", config: { finca: {} } }],
    ['versión "7"',          { owner_id: "o", config_version: "7", config: { finca: {} } }],
    ["versión -1",           { owner_id: "o", config_version: -1, config: { finca: {} } }],
    ["versión null",         { owner_id: "o", config_version: null, config: { finca: {} } }],
    ["sin config",           { owner_id: "o", config_version: 7 }],
    ["config null",          { owner_id: "o", config_version: 7, config: null }],
    ["config array",         { owner_id: "o", config_version: 7, config: [] }],
    ["tupla null",           null],
    ["tupla array",          []],
  ];
  for (const [etiqueta, t] of TUPLAS) {
    const ls = almacenCompartido();
    const a = cargarApp({ almacen: ls, servidor: vistaOwner("owner", 7, {}), responde: OK_CAS(8) });
    ok(a.adoptar(t) === false, `${etiqueta}: no se adopta`);
    ok(a.base() === null, `${etiqueta}: sin base`);
    ok(a.configLocal() === null, `${etiqueta}: sin foto`);
    const r = await a.guardar({ finca: { n: "x" } });
    ok(r.error === "base_desconocida" && a.enviados.length === 0, `${etiqueta}: 0 POST`);
  }
}
{
  // Y la respuesta del servidor sin bloque propietario tampoco adopta nada.
  const ls = almacenCompartido();
  const a = cargarApp({ almacen: ls, servidor: () => ({ ok: true, config: { finca: { n: "suelta" } } }),
                        responde: OK_CAS(8) });
  ok(a.tuplaDe({ ok: true, config: { finca: {} } }) === null, "sin bloque propietario no hay tupla");
  await a.restaurarSiVacio();
  ok(a.base() === null && a.configLocal() === null, "y no se adopta ni foto ni base");
}

console.log("\n── 19. la adopción está CENTRALIZADA, no repartida ──");
{
  const A = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
  // El escritor de la foto solo lo llama la función canónica.
  const llamadas = (A.match(/escribirConfigLocal\(/g) || []).length;
  ok(llamadas === 2, `escribirConfigLocal: su definición y UN solo llamante (${llamadas})`);
  const adop = /function adoptarConfigPropietario\(tupla\)[\s\S]*?\n      \}/.exec(A)[0];
  ok(/escribirConfigLocal\(config, owner_id\)/.test(adop) && /guardarBase\(owner_id, config_version\)/.test(adop),
     "y ese llamante es adoptarConfigPropietario, que escribe foto y base JUNTAS");
  // guardarBase, igual: solo la adopción y el éxito del CAS.
  const bases = (A.match(/guardarBase\(/g) || []).length;
  ok(bases === 4,
     `guardarBase: definición + adopción + arranque en 0 + éxito del CAS (${bases})`);
  ok(!/adoptarBaseConfig/.test(A), "no queda ningún adoptador de base suelto");
  ok(!/restaurarConfig\(/.test(A), "ni el antiguo restaurarConfig con dos fuentes");
  const rsv = /async function restaurarSiVacio\(\)[\s\S]*?\n      \}/.exec(A)[0];
  ok(!/d\.config/.test(rsv), "restaurarSiVacio ya no toca `d.config`");
  ok(/adoptarDelPropietario\(userId, \(\) => !tieneConfigLocal\(\)\)/.test(rsv),
     "sino que adopta por el camino canónico, y con la comprobación vigente");
  const canje = /async function canjearAcceso\(token\)[\s\S]*?\n      \}/.exec(A)[0];
  ok(!/restaurarConfig|guardarBase/.test(canje), "el canje no escribe config ni base por su cuenta");
  ok(/adoptarDelPropietario\(d\.propietario_id\)/.test(canje), "usa la misma función");
}

console.log("\n── 20. la restauración no puede pisar lo que se guardó mientras esperaba ──");
// Arnés con el GET RETENIDO: se arranca restaurarSiVacio(), se deja la petición
// en vuelo, y mientras tanto se llama al saveConfig() REAL.
function appConGetRetenido({ almacen, respuestaServidor, uid = "owner" }) {
  let soltar;
  const enVuelo = new Promise(res => { soltar = res; });
  const APP2 = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
  const base = cargarApp({ almacen, uid, servidor: () => respuestaServidor, responde: OK_CAS(9) });
  // Reconstruir con un fetch que espera a que lo suelten.
  const enviados = [];
  const cuerpo = `
    const userId = uid;
    const encodeURIComponent = (x) => x;
    ${/const BASE_KEY\s+= "[^"]+";/.exec(APP2)[0]}
    ${/const CONFLICTO_KEY\s+= "[^"]+";/.exec(APP2)[0]}
    ${/const TIMEOUT_VERSION_MS = \d+;/.exec(APP2)[0]}
    ${/const esVersion = [^\n]+/.exec(APP2)[0]}
    ${/const esOwner   = [^\n]+/.exec(APP2)[0]}
    ${/const STORAGE_KEY = "[^"]+";/.exec(APP2)[0]}
    const post = async (p, d) => { enviados.push(d); return { ok: true, persisted: true, status: 200, datos: { config_version: 9 } }; };
    let cfgFinca = null, cfg = null;
    const configEfectiva = () => cfgFinca;
    const subirConfig = () => {};
    const kyliaSync = {};
    ${trozo("function leerBase()")}
    ${trozo("function guardarBase(")}
    ${trozo("function escribirConfigLocal(")}
    ${trozo("function adoptarConfigPropietario(")}
    ${trozo("function tuplaDe(")}
    ${trozo("async function adoptarDelPropietario(")}
    ${trozo("function tieneConfigLocal(")}
    ${trozo("async function restaurarSiVacio(")}
    ${trozo("function saveConfig(")}
    return { restaurarSiVacio, saveConfig, base: leerBase,
             configLocal: () => { try { return JSON.parse(localStorage.getItem("kylia_config")); } catch (_) { return null; } } };
  `;
  const recargas = [];
  const f = new Function("uid", "localStorage", "sessionStorage", "enviados", "fetch",
                        "console", "location", cuerpo);
  const fetchRetenido = async () => { await enVuelo; return { ok: true, json: async () => respuestaServidor }; };
  // Mismo motivo que arriba: el navegador tiene sessionStorage y la restauración
  // lo usa para no encadenar recargas. Uno nuevo por instancia = una pestaña.
  const sesion = (() => { const m = new Map(); return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })();
  return { ...f(uid, almacen, sesion, enviados, fetchRetenido, { warn: () => {} },
                { reload: () => recargas.push(1), replace: () => {} }),
           soltar, recargas };
}
const DEL_SERVIDOR = {
  ok: true, propietario_id: "owner",
  propietario: { id: "owner", config_version: 7,
                 config: { finca: { cultivos: ["lechuga"], areaParcela: 100, parcela: { g: 1 } } } },
};
{
  // EL CASO: local vacío, GET en vuelo, el agricultor guarda tomate/900,
  // y entonces responde el servidor con lechuga/100.
  const ls = almacenCompartido();
  const a = appConGetRetenido({ almacen: ls, respuestaServidor: DEL_SERVIDOR });
  const restaurando = a.restaurarSiVacio();                  // arranca el GET
  await new Promise(r => setTimeout(r, 0));
  a.saveConfig({ cultivos: ["tomate"], areaParcela: 900, parcela: { g: 9 } });   // saveConfig REAL
  a.soltar();                                                // ahora responde el servidor
  await restaurando;

  const local = a.configLocal();
  ok(local?.cultivos?.[0] === "tomate", `el cultivo local sigue siendo tomate (${local?.cultivos?.[0]})`);
  ok(local?.areaParcela === 900, `y el área sigue en 900 (${local?.areaParcela})`);
  ok(local?.cultivos?.[0] !== "lechuga", "el servidor NO sustituye lo que acaba de guardar el agricultor");
  ok(a.base() === null, "no se adopta base para una foto del servidor que no se escribió");
  ok(a.recargas.length === 0, `y no hay reload provocado por la restauración (${a.recargas.length})`);
}
{
  // CONTROL: si sigue vacío cuando responde, la restauración sí adopta.
  const ls = almacenCompartido();
  const a = appConGetRetenido({ almacen: ls, respuestaServidor: DEL_SERVIDOR });
  const restaurando = a.restaurarSiVacio();
  await new Promise(r => setTimeout(r, 0));
  a.soltar();                                                // nadie guarda nada
  await restaurando;
  ok(a.configLocal()?.cultivos?.[0] === "lechuga", "con el local vacío sí se adopta la del servidor");
  ok(a.base()?.base_version === 7 && a.base()?.owner_id === "owner", "y su base: owner + 7");
  ok(a.recargas.length === 1, "y recarga");
}
{
  // La config local aparece JUSTO antes de adoptar: entre que resuelve el GET y
  // se escribe. Gana siempre el estado local.
  const ls = almacenCompartido();
  const a = cargarApp({ almacen: ls, uid: "owner",
    servidor: () => {
      // Se guarda algo local en el mismo instante en que el GET entrega su JSON.
      ls.setItem("kylia_config", JSON.stringify({ cultivos: ["tomate"], areaParcela: 900, parcela: { g: 9 } }));
      return DEL_SERVIDOR;
    },
    responde: OK_CAS(8) });
  const adoptado = await a.adoptarDelPropietario("owner", () => {
    try { const c = JSON.parse(ls.getItem("kylia_config")); return !c; } catch (_) { return true; }
  });
  ok(adoptado === false, "no se adopta");
  ok(a.configLocal()?.cultivos?.[0] === "tomate", "gana el estado local");
  ok(a.base() === null, "y no se escribe base");
}
{
  // Estructural: la comprobación está pegada a la escritura, sin await en medio.
  const A = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
  const f = /async function adoptarDelPropietario\([\s\S]*?\n      \}/.exec(A)[0];
  const iChk = f.indexOf("sigueSiendoSeguro()");
  const iEsc = f.indexOf("adoptarConfigPropietario(tupla)");
  ok(iChk > -1 && iEsc > iChk, "se comprueba ANTES de adoptar");
  ok(!/await/.test(f.slice(iChk, iEsc)), "y entre la comprobación y la escritura no hay ningún await");
  const rsv = /async function restaurarSiVacio\(\)[\s\S]*?\n      \}/.exec(A)[0];
  ok(/\(\) => !tieneConfigLocal\(\)/.test(rsv), "restaurarSiVacio pasa la comprobación vigente, no una foto vieja");
}

console.log(fallos === 0 ? "\n✅ TODOS LOS TESTS VERDES\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos === 0 ? 0 : 1);
