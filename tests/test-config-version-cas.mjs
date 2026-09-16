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
ok(/add column if not exists config_version bigint not null default 0/.test(SQL),
   "config_version bigint not null default 0");
ok(/check \(config_version >= 0\) not valid/.test(SQL), "constraint >= 0, NOT VALID primero");
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
  const b = await guardar(h, srv, conBase(7, { sesion: "B" }));
  const a = await guardar(h, srv, conBase(7, { sesion: "A" }));
  ok(b._json.persisted === true && a._status === 409, "B gana; A con base 7 no puede sobrescribirla");
  ok(srv.ver(UID).config_app.sesion === "B", "el estado del servidor sigue siendo el de B");
}

console.log("\n── 4. veinte peticiones concurrentes, misma base ──");
{
  const srv = servidor([{ id: UID, config_version: 3 }]);
  const h = montaHandler(srv);
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => guardar(h, srv, conBase(3, { sesion: "s" + i }))));
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
  await guardar(h, srv, conBase(8, { sesion: "tardia" }));             // el commit que el cliente no vio
  const antes = JSON.stringify(srv.ver(UID).config_app);
  const siguiente = await guardar(h, srv, conBase(8, { sesion: "nueva" }));
  ok(siguiente._status === 409, "la siguiente escritura detecta el conflicto, no pisa en silencio");
  ok(JSON.stringify(srv.ver(UID).config_app) === antes, "y no sobrescribe lo que dejó la petición tardía");
  ok(siguiente._json.sesion === "tardia", "el conflicto dice QUIÉN escribió la versión vigente");
}

console.log("\n── 8. vista=config entrega foto y versión coherentes ──");
{
  const CAMPO = readFileSync(join(RAIZ, "api", "campo.js"), "utf8");
  const cuerpo = /async function vistaConfig[\s\S]*?\n}/.exec(CAMPO)[0];
  ok(/config_version: version/.test(cuerpo), "vista=config devuelve config_version");
  ok(/u\.config_version/.test(cuerpo), "sacada de la fila de la que sale la foto");
  ok(/dueño\.config_version/.test(cuerpo), "y de la del propietario cuando la foto es suya");
  ok(!/select=id,config_app,config_version/.test(CAMPO),
     "sin nombrar la columna en un select explícito: antes de migrar eso sería un 400");
}

console.log("\n── 9. el cliente: base obligatoria y reintento solo si es SUYO ──");
{
  const APP = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
  const g = /window\.kyliaSync\.guardarConfigServidor = async function[\s\S]*?\n      \};/.exec(APP)[0];
  ok(/base_version: v/.test(g), "manda base_version");
  ok(/sesion: SESION_CONFIG/.test(g), "y su identidad de sesión");
  ok(/error: "sin_version_base"/.test(g), "sin base no manda nada");
  ok(/r\.datos\.sesion === SESION_CONFIG/.test(g),
     "y solo reintenta si la versión vigente la escribió ESTA sesión");
  const i409 = g.indexOf("r.status === 409");
  const iRet = g.indexOf("r.datos.sesion === SESION_CONFIG");
  ok(i409 > -1 && iRet > i409, "el reintento está dentro del camino del 409");
  ok(!/while|for \(/.test(g), "y no hay bucle de reintento: un intento, y el conflicto se devuelve");
}

console.log(fallos === 0 ? "\n✅ TODOS LOS TESTS VERDES\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos === 0 ? 0 : 1);
