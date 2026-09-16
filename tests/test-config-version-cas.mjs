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
  const APP = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
  const g = /window\.kyliaSync\.guardarConfigServidor = async function[\s\S]*?\n      \};/.exec(APP)[0];
  ok(/base_version: base/.test(g), "manda base_version");
  ok(!/sesion/.test(g), "y NINGUNA marca de sesión: el cliente la controlaba, no probaba nada");
  ok(/error: "version_desconocida"/.test(g), "sin versión válida no manda nada");
  ok(/marcarConflicto\(base, r, config\)/.test(g), "un 409 marca conflicto");
  ok(!/enviar\(configVersion\)|await enviar\(/.test(g), "y NO reintenta: no hay segundo envío");
  const rama409 = g.slice(g.indexOf("r.status === 409"));
  ok(!/configVersion\s*=/.test(rama409), "ni adopta la versión del servidor tras un 409");
  const i409 = g.indexOf("r.status === 409");
  const iOk  = g.indexOf("r.ok && r.persisted");
  ok(iOk > -1 && i409 > iOk, "configVersion solo avanza en el camino de éxito");
  ok(/if \(conflictoConfig\)/.test(g), "y con un conflicto abierto no se escribe nada");
  ok(/conflictoConfig\.foto_local_sin_guardar = config/.test(g),
     "conservando la última foto local que no pudo guardarse");
}
{
  const APP = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
  const esV = /const esVersion = [^\n]+/.exec(APP)[0];
  ok(/typeof v === "number"/.test(esV) && /Number\.isSafeInteger\(v\)/.test(esV) && /v >= 0/.test(esV),
     "esVersion comprueba por TIPO, no con Number()");
  // Y se ejecuta, que es lo que cuenta.
  const f = new Function("return " + esV.replace("const esVersion = ", ""))();
  const CASOS = [[0, true], [7, true], [null, false], ["", false], ["0", false], [undefined, false],
                 [-1, false], [1.5, false], [Infinity, false], [NaN, false], [{}, false], [true, false]];
  for (const [v, esperado] of CASOS) {
    ok(f(v) === esperado, `esVersion(${JSON.stringify(v) ?? String(v)}) = ${esperado}`);
  }
}
{
  const APP = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
  const leer = /async function leerConfigServidor\(\)[\s\S]*?\n      \}/.exec(APP)[0];
  ok(/AbortController/.test(leer), "la LECTURA de versión también lleva AbortController");
  ok(/TIMEOUT_VERSION_MS/.test(leer), "con su tope explícito");
  ok(/return null;/.test(leer), "y al vencer devuelve null: versión DESCONOCIDA, nunca 0");
  const ver = /async function versionVigente\(\)[\s\S]*?\n      \}/.exec(APP)[0];
  ok(/d\.propietario\?\.config_version/.test(ver), "la versión se toma del bloque del PROPIETARIO");
  ok(!/\|\| 0|\?\? 0/.test(ver), "y no hay ningún fallback a 0");
}

console.log("\n── 10. vista=config: foto y versión de la MISMA fila propietaria ──");
{
  const CAMPO = readFileSync(join(RAIZ, "api", "campo.js"), "utf8");
  const cuerpo = /async function vistaConfig[\s\S]*?\n}/.exec(CAMPO)[0];
  ok(/const propietario = \{/.test(cuerpo), "hay un bloque `propietario` explícito");
  ok(/config:\s+filaDueno\?\.config_app \|\| null/.test(cuerpo), "su config sale de la fila del dueño");
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

console.log("\n── 12. Mac y móvil: el conflicto CIERRA las escrituras ──");
// Ejecuta el guardarConfigServidor REAL del cliente contra un servidor de
// mentira, para que no sea una lectura del fuente sino comportamiento.
function clienteConfig({ versionInicial, responde }) {
  const APP = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
  const trozo = (marca) => {
    const i = APP.indexOf(marca);
    if (i < 0) throw new Error("no encuentro: " + marca);
    let k = APP.indexOf("{", APP.indexOf("(", i));
    let prof = 0;
    for (let j = k; j < APP.length; j++) {
      if (APP[j] === "{") prof++;
      else if (APP[j] === "}" && --prof === 0) return APP.slice(i, j + 1);
    }
    throw new Error("sin cerrar: " + marca);
  };
  const enviados = [];
  const cuerpo = `
    const userId = "u-1";
    const encodeURIComponent = (x) => x;
    let configVersion = versionInicial;
    ${/const TIMEOUT_VERSION_MS = \d+;/.exec(APP)[0]}
    ${/const esVersion = [^\n]+/.exec(APP)[0]}
    let conflictoConfig = null;
    const post = async (p, d) => { enviados.push(d); return responde(d); };
    ${trozo("function marcarConflicto(")}
    ${trozo("async function leerConfigServidor(")}
    ${trozo("async function versionVigente(")}
    const kyliaSync = {};
    ${trozo("window.kyliaSync.guardarConfigServidor = async function").replace("window.kyliaSync.", "kyliaSync.")}
    return { guardar: kyliaSync.guardarConfigServidor,
             conflicto: () => conflictoConfig, version: () => configVersion };
  `;
  const f = new Function("versionInicial", "responde", "enviados", "fetch", "console", cuerpo);
  return { ...f(versionInicial, responde, enviados, async () => ({ ok: false }), { warn: () => {} }), enviados };
}
{
  // Mac y móvil parten de 7. Mac escribe 8. El móvil manda B y recibe 409, y
  // tenía C ya en cola. Ni B ni C pueden escribir con base 8.
  const c = clienteConfig({
    versionInicial: 7,
    responde: async () => ({ ok: false, status: 409, persisted: false, error: "conflicto_version",
                             datos: { ok: false, config_version: 8, guardado: "2026-09-16T10:00:00Z" } }),
  });
  const rB = await c.guardar({ finca: { nombre: "B del móvil" } });
  ok(rB.status === 409, "B recibe 409");
  ok(c.enviados.length === 1 && c.enviados[0].base_version === 7, "B se mandó con base 7, no con 8");
  ok(c.conflicto() !== null, "queda marcado el conflicto");

  const rC = await c.guardar({ finca: { nombre: "C del móvil" } });
  ok(rC.error === "conflicto_config", `C NO sale: ${rC.error}`);
  ok(c.enviados.length === 1, `y no se manda ninguna petición más (${c.enviados.length})`);
  ok(c.version() === 7, `configVersion NO adopta la 8 del servidor (sigue en ${c.version()})`);
  ok(c.conflicto().foto_local_sin_guardar.finca.nombre === "C del móvil",
     "se conserva la ÚLTIMA foto local que no pudo guardarse");
  ok(c.conflicto().version_servidor === 8, "y se anota la versión del servidor, para diagnóstico");

  // Un guardado posterior del usuario tampoco se salta el bloqueo.
  const rD = await c.guardar({ finca: { nombre: "D, más tarde" } });
  ok(rD.error === "conflicto_config" && c.enviados.length === 1,
     "un guardado posterior tampoco escribe: el bloqueo no se salta en silencio");
  ok(c.conflicto().foto_local_sin_guardar.finca.nombre === "D, más tarde",
     "pero la foto pendiente se actualiza a la última");
}
{
  // Versión desconocida en todas sus formas → 0 POST.
  for (const [etiqueta, v] of [["null", null], ['""', ""], ['"0"', "0"], ["undefined", undefined],
                               ["-1", -1], ["1.5", 1.5], ["Infinity", Infinity]]) {
    const c = clienteConfig({ versionInicial: v, responde: async () => ({ ok: true, persisted: true, datos: {} }) });
    const r = await c.guardar({ finca: { nombre: "x" } });
    ok(r.error === "version_desconocida" && c.enviados.length === 0,
       `versión ${etiqueta} → desconocida y 0 POST`);
  }
  // Y el 0 numérico SÍ vale.
  const c0 = clienteConfig({ versionInicial: 0,
    responde: async () => ({ ok: true, persisted: true, status: 200, datos: { config_version: 1 } }) });
  const r0 = await c0.guardar({ finca: { nombre: "x" } });
  ok(r0.persisted === true && c0.enviados[0].base_version === 0, "el 0 numérico sí es una base válida");
  ok(c0.version() === 1, "y la versión avanza a 1");
}
{
  // El GET de versión se queda colgado: vence, no se escribe, y la versión sigue
  // desconocida. Nunca se asume 0.
  const APP = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
  const c = clienteConfig({ versionInicial: null, responde: async () => ({ ok: true, persisted: true, datos: {} }) });
  const t0 = Date.now();
  const r = await c.guardar({ finca: { nombre: "x" } });
  ok(r.error === "version_desconocida", "con la lectura caída, versión desconocida");
  ok(c.enviados.length === 0, "y 0 POST de config");
  ok(c.version() === null, "la versión sigue en null, no en 0");
  ok(Date.now() - t0 < 2000, "sin quedarse colgado esperando");
}

console.log(fallos === 0 ? "\n✅ TODOS LOS TESTS VERDES\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos === 0 ? 0 : 1);
