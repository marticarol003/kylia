// PUNTO 2 · la reparación crea, nunca pisa.
//   node tests/test-reparar-historicas.mjs
//
// El Punto 1 declara las siembras históricas y NO las crea. Esto es lo que las
// crea, y lo peligroso es cómo: `registro-usuario` hace upsert, y su propio
// comentario lo llama "el vector destructivo del sistema" porque escribe la fila
// entera por UUID. Para reparar lo que creemos ausente eso es justo lo que no se
// puede usar: si entre el diagnóstico y la escritura alguien creó esa parcela, la
// pisaríamos con nuestra foto. Aquí la unicidad la impone la PRIMARY KEY.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const LOG = readFileSync(join(RAIZ, "api", "log.js"), "utf8");
const APP = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
const SCRIPT = readFileSync(join(RAIZ, "scripts", "reparar-siembras-2026-09-16.mjs"), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };
// Las guardas estructurales tienen que mirar el CÓDIGO, no la prosa: los
// comentarios de estas funciones explican precisamente por qué NO se hace upsert
// ni retry, así que buscar esas palabras en el texto entero siempre acierta.
const sinComentarios = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\s+\/\/[^\n]*/g, "");     // y los de final de línea: "…fila);  // ← SIN upsert"

// Postgres de mentira: la PK rechaza duplicados, como el de verdad.
function servidor(filas = []) {
  const t = new Map(filas.map(f => [f.id, { ...f }]));
  const log = [];
  return {
    log, ver: (id) => (t.has(id) ? { ...t.get(id) } : null), tam: () => t.size,
    insert(tabla, fila, opts) {
      log.push({ op: "insert", upsert: Boolean(opts && opts.upsert), id: fila.id });
      if (t.has(fila.id)) {
        if (opts && opts.upsert) { Object.assign(t.get(fila.id), fila); return [{ ...t.get(fila.id) }]; }
        const e = new Error('duplicate key value violates unique constraint "usuarios_pkey" (23505)');
        throw e;
      }
      t.set(fila.id, { ...fila });
      return [{ ...fila }];
    },
    select(tabla, filtro) {
      const id = /id=eq\.([^&]+)/.exec(filtro)?.[1];
      return t.has(id) ? [{ ...t.get(id) }] : [];
    },
    update(tabla, filtro) { log.push({ op: "update", filtro }); return []; },
  };
}
function montaHandler(srv) {
  const mod = { exports: {} };
  const falso = {
    isConfigured: () => true,
    supabaseInsert: async (t, f, o) => srv.insert(t, f, o),
    supabaseSelect: async (t, f) => srv.select(t, f),
    supabaseUpdate: async (t, f) => srv.update(t, f),
    supabaseDelete: async () => [],
    parseBody: (r) => r.body || {},
    preludio: () => true,
  };
  const req2 = require;
  new Function("module", "exports", "require", LOG)(
    mod, mod.exports, (m) => (m.includes("_supabase") ? falso : req2(join(RAIZ, "api", m.replace(/^\.\//, "")))));
  return mod.exports;
}
const respuesta = () => {
  const r = { _status: 200, _json: null };
  r.status = (s) => { r._status = s; return r; }; r.json = (j) => { r._json = j; return r; };
  return r;
};
const OWNER = "c46e9d6d-577f-47ab-8a67-eebadcec7109";
const SIEMBRA = "264c2a43-8a64-4a0e-ad98-07cbf76c438d";
const crear = async (h, extra = {}) => {
  const res = respuesta();
  await h({ method: "POST", headers: {}, body: {
    recurso: "crear-parcela", id: SIEMBRA, propietario_id: OWNER,
    nombre: "Col / Coliflor · 1880 m²", ciudad: "Sant Boi de Llobregat",
    lat: 41.3248, lon: 2.0636, cultivos: ["brassica"], area_m2: 1880,
    fecha_plantacion: "2026-09-06", suelo: "franco", metodo_riego: "aspersion",
    caudal: 1.8, parcela: { type: "Polygon", coordinates: [[[0, 0], [1, 1], [0, 0]]] }, ...extra } }, res);
  return res;
};

console.log("\n── 1. CREATE-ONLY: el INSERT va sin upsert ──");
{
  const srv = servidor([{ id: OWNER, email: "marti@ejemplo.es", origen: "campaña" }]);
  const h = montaHandler(srv);
  const r = await crear(h);
  ok(r._status === 201 && r._json.creada === true, `crea (${r._status})`);
  const ins = srv.log.filter(x => x.op === "insert");
  ok(ins.length === 1 && ins[0].upsert === false, "y el insert NO lleva upsert");
  ok(srv.ver(SIEMBRA)?.propietario_id === OWNER, "propietario_id = el dueño");
  ok(srv.ver(SIEMBRA)?.id === SIEMBRA, "y la siembra conserva SU id: no se redirige al del propietario");
}
{
  const cuerpo = /async function handleCrearParcela[\s\S]*?\n}/.exec(LOG)[0];
  ok(/supabaseInsert\("usuarios", fila\)/.test(cuerpo), "en el fuente: supabaseInsert sin opciones");
  ok(!/upsert/.test(sinComentarios(cuerpo)), "y no hay ni un upsert en el código del handler");
}

console.log("\n── 2. si el UUID ya existe: 409 y NO se toca ──");
{
  const previa = { id: SIEMBRA, propietario_id: "otro-dueno", cultivos: ["tomate"],
                   area_m2: 999, nombre: "de otro" };
  const srv = servidor([{ id: OWNER, email: "a@b.c", origen: null }, previa]);
  const h = montaHandler(srv);
  const r = await crear(h);
  ok(r._status === 409, `409 (${r._status})`);
  ok(r._json.error === "ya_existe" && r._json.persisted === false, "ya_existe, persisted:false");
  const ahora = srv.ver(SIEMBRA);
  ok(ahora.propietario_id === "otro-dueno", "el propietario ajeno NO se pisa");
  ok(ahora.cultivos[0] === "tomate" && ahora.area_m2 === 999, "ni el cultivo ni la superficie");
  ok(ahora.nombre === "de otro", "ni el nombre");
}

console.log("\n── 3. carrera concurrente: una crea, la otra 409 ──");
{
  const srv = servidor([{ id: OWNER, email: "a@b.c", origen: null }]);
  const h = montaHandler(srv);
  const rs = await Promise.all([crear(h), crear(h), crear(h), crear(h), crear(h)]);
  const creadas = rs.filter(r => r._status === 201);
  const duplicados = rs.filter(r => r._status === 409);
  ok(creadas.length === 1, `una sola creación (${creadas.length})`);
  ok(duplicados.length === 4, `y cuatro duplicados (${duplicados.length})`);
  ok(srv.tam() === 2, "en la tabla hay el dueño y UNA parcela, no cinco");
  ok(srv.log.every(x => x.op !== "update"), "y nadie hizo UPDATE: cero overwrite");
}

console.log("\n── 4. email y origen se heredan del propietario, no del cuerpo ──");
{
  const srv = servidor([{ id: OWNER, email: "dueño@real.es", origen: "ferias" }]);
  const h = montaHandler(srv);
  await crear(h, { email: "atacante@otro.com", origen: "inyectado" });
  const f = srv.ver(SIEMBRA);
  ok(f.email === "dueño@real.es", `email del dueño (${f.email})`);
  ok(f.origen === "ferias", `origen del dueño (${f.origen})`);
  ok(f.email !== "atacante@otro.com", "el del cuerpo se ignora: abrir la reparación desde otro navegador no cambia la parcela");
}

console.log("\n── 5. validaciones que paran antes de escribir ──");
{
  const srv = servidor([{ id: OWNER, email: null, origen: null }]);
  const h = montaHandler(srv);
  for (const [etiqueta, extra] of [
    ["id no-UUID",            { id: "no-soy-uuid" }],
    ["propietario no-UUID",   { propietario_id: "tampoco" }],
    ["siembra = propietario", { id: OWNER }],
  ]) {
    const antes = srv.log.length;
    const r = await crear(h, extra);
    ok(r._status === 400, `${etiqueta} → 400 (${r._status})`);
    ok(srv.log.length === antes, `${etiqueta}: ni un insert`);
  }
}
{
  const srv = servidor([]);                       // sin fila del propietario
  const r = await crear(montaHandler(srv));
  ok(r._status === 404 && /propietario no encontrado/.test(r._json.error),
     "sin propietario en la tabla → 404, no se crea nada huérfano");
  ok(srv.tam() === 0, "y la tabla sigue vacía");
}

console.log("\n── 6. el script: precondiciones y cero escrituras en dry-run ──");
{
  ok(/const APLICAR = process\.argv\.includes\("--aplicar"\)/.test(SCRIPT), "el dry-run es el modo por defecto");
  ok(/recurso: "crear-parcela"/.test(SCRIPT), "usa el camino create-only");
  ok(!/registro-usuario/.test(SCRIPT), "y NO registro-usuario, que haría upsert");
  ok(/if \(siembras\.length !== ESPERADAS\.length\) parar/.test(SCRIPT), "para si el censo cambió de tamaño");
  ok(/los UUID del censo no son los del dry-run/.test(SCRIPT), "y si cambiaron los UUID");
  ok(/if \(await existe\(item\.id\)\)/.test(SCRIPT), "revalida la existencia justo antes de crear");
  ok(/409[\s\S]{0,200}NO se sobrescribe/.test(SCRIPT), "y una carrera se relee, no se pisa");
  ok(/perfil\.status !== 200 \|\| hoy\.status !== 200\) parar/.test(SCRIPT), "verifica perfil y hoy tras cada alta");
  ok(/const \{ email, origen, \.\.\.resto \} = motor\.payloadSiembra/.test(SCRIPT),
     "y no manda email ni origen: los hereda el servidor");
  ok(!/kylia_riegos|estimado|lamina_mm/.test(SCRIPT), "el script no toca riegos ni láminas");
  ok(/payloadSiembra/.test(SCRIPT) && /app\/index\.html/.test(SCRIPT),
     "el payload sale de la MISMA función del Punto 1, no de una segunda interpretación");
}

console.log("\n── 7. la confirmación de s.sync es manual y demostrable ──");
{
  const f = /window\.kyliaConfirmarHistoricas = async function[\s\S]*?\n    \};/.exec(APP)[0];
  ok(/vista=hoy&usuario_id=/.test(f), "comprueba contra el servidor que la fila EXISTE");
  ok(/if \(!hay\) \{ informe\.sin_fila\.push\(id\); continue; \}/.test(f), "y si no existe, no confirma");
  ok(/token: v\.s\.sync\.token/.test(f), "conserva el token: la identidad no cambia");
  ok(/nueva: false, vista: huella, confirmada: huella/.test(f), "marca nueva:false y vista = confirmada = huella actual");
  ok(/huellaPayload\(payloadSiembra\(/.test(f), "con la huella calculada AQUÍ, donde está localStorage");
  ok(/guardarConfigServidor/.test(f), "y el guardado va por el CAS");
  const codigo = sinComentarios(f);
  ok(!/while\s*\(|for\s*\(;;\)/.test(codigo), "sin bucle de reintento");
  ok((codigo.match(/guardarConfigServidor/g) || []).length === 1, "y un solo guardado: no se reintenta");
  ok(/if \(!r \|\| !r\.persisted\) informe\.no_guardado/.test(f), "un 409 se reporta");
  // No se llama sola desde ningún sitio.
  const usos = (APP.match(/kyliaConfirmarHistoricas/g) || []).length;
  ok(usos === 1, `solo se define, nadie la invoca (${usos} apariciones)`);
}

console.log(fallos === 0 ? "\n✅ TODOS LOS TESTS VERDES\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos === 0 ? 0 : 1);
