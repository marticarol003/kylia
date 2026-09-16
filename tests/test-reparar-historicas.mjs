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

console.log("\n── 4. email y origen NO se escriben, ni del cuerpo ni heredados ──");
{
  // Este test pedía lo contrario —que se heredaran del dueño— hasta que la
  // auditoría concluyó que no son campos de la parcela: el correo es del
  // agricultor y `origen` es de qué anuncio vino el dispositivo. Tenerlos en la
  // fila de cada zona es lo que hacía que varias parcelas compartieran correo y
  // que `email=eq.<x>&limit=1` devolviera una cualquiera.
  const srv = servidor([{ id: OWNER, email: "dueño@real.es", origen: "ferias" }]);
  const h = montaHandler(srv);
  await crear(h, { email: "atacante@otro.com", origen: "inyectado" });
  const f = srv.ver(SIEMBRA);
  ok(!("email" in f) || f.email == null, `la parcela nace sin email (${f.email})`);
  ok(!("origen" in f) || f.origen == null, `y sin origen (${f.origen})`);
  ok(f.email !== "atacante@otro.com", "el del cuerpo se ignora");
  ok(f.email !== "dueño@real.es", "y tampoco se hereda del dueño: la identidad vive en SU fila");
  ok(f.cultivos[0] === "brassica" && f.area_m2 === 1880, "lo que sí es de la parcela se escribe igual");
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

console.log("\n── 7. la confirmación de s.sync es manual y acotada ──");
{
  const f = /async function confirmarHistoricas\(ids\)[\s\S]*?\n    \}/.exec(APP)[0];
  ok(/vista=verificar&usuario_id=/.test(f), "lee la fila ESTRUCTURAL del servidor, geometría incluida");
  ok(/mismaParcela\(p\.payload, fila\)/.test(f), "y la compara campo a campo con el payload de ahora");
  ok(/informe\.divergentes\.length \|\| informe\.sin_fila\.length/.test(f),
     "si alguna diverge o falta, no confirma NINGUNA");
  ok(/token: p\.token/.test(f), "conserva el token: la identidad no cambia");
  ok(/nueva: false, vista: p\.huella, confirmada: p\.huella/.test(f), "y solo toca esas tres marcas");
  ok(/huellaPayload\(payloadSiembra\(/.test(f), "con la huella calculada AQUÍ, donde está localStorage");
  ok(/guardarConfigServidor/.test(f), "el guardado va por el CAS");
  const codigo = sinComentarios(f);
  ok(!/while\s*\(|for\s*\(;;\)/.test(codigo), "sin bucle de reintento");
  ok((codigo.match(/guardarConfigServidor/g) || []).length === 1, "y un solo guardado: no se reintenta");
  ok(/if \(!r \|\| !r\.persisted\)/.test(f), "un 409 se reporta y no se toca nada");
  ok(/window\.kyliaConfirmarHistoricas = \(\) => confirmarHistoricas\(HISTORICAS_B1\)/.test(APP),
     "el envoltorio público no acepta argumentos: la lista no se puede sustituir");
  const iCas = f.indexOf("guardarConfigServidor"), iLocal = f.indexOf("guardarZonasSinSubir");
  ok(iCas > -1 && iLocal > iCas, "el CAS va ANTES de escribir en local");
}
{
  // mismaParcela, ejecutada.
  const m = new Function(`${/function mismaParcela\(payload, fila\)[\s\S]*?\n    \}/.exec(APP)[0]}\nreturn mismaParcela;`)();
  const base = { id: "a", propietario_id: "o", cultivos: ["lechuga"], area_m2: 100,
                 fecha_plantacion: "2026-01-01", suelo: "franco", metodo_riego: "goteo",
                 caudal: 1.8, parcela: { type: "Polygon", coordinates: [[[0, 0]]] } };
  ok(m(base, { ...base }).length === 0, "idénticos → sin diferencias");
  for (const [campo, valor] of [["id", "b"], ["propietario_id", "otro"], ["cultivos", ["tomate"]],
                                ["area_m2", 999], ["fecha_plantacion", "2020-01-01"], ["suelo", "arcilloso"],
                                ["metodo_riego", "surco"], ["caudal", 9],
                                ["parcela", { type: "Polygon", coordinates: [[[9, 9]]] }]]) {
    ok(m(base, { ...base, [campo]: valor }).length === 1, `detecta ${campo} distinto`);
  }
}

console.log("\n── 8. B.2 · el camino completo, reproducido ──");
// La secuencia exacta: histórica pendiente de reparación → B.1 crea su fila → la
// normalización saca email/origen y la huella cambia → aparece en
// pendientes_sincronizacion → B.2 verifica contra el servidor y confirma SIN
// tocar `usuarios`.
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
function almacen(inicial = {}) {
  const m = new Map(Object.entries(inicial));
  return { getItem: k => (m.has(k) ? m.get(k) : null),
           setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
// La app real, con el servidor de `vista=verificar` bajo control.
function cargarApp({ ls, filas, guardaConfig, uid = "owner", retenVerificar = null }) {
  const peticiones = [];
  const cuerpo = `
    const userId = uid;
    const encodeURIComponent = (x) => x;
    const cfgFinca = FINCA;
    const zonaActiva = null;
    const nombreCultivo = (c) => ({ brassica: "Col / Coliflor", lechuga: "Lechuga", calabacin: "Calabacín" }[c] || c);
    const kyliaSync = { userId: uid, guardarConfigServidor: async (cfg) => guardaConfig(cfg) };
    const window = { kyliaSync };
    ${/const esVersion = [^\n]+/.exec(APP)[0]}
    ${trozo("function zonasGuardadas(")}
    ${trozo("function guardarZonasSinSubir(")}
    ${trozo("function payloadSiembra(")}
    ${trozo("function estable(")}
    ${trozo("function huellaPayload(")}
    ${/const firmaSync = [^\n]+/.exec(APP)[0]}
    ${trozo("function syncValido(")}
    ${trozo("function decidirSiembra(")}
    ${trozo("function buscarSiembra(")}
    ${trozo("function clasificarSiembras(")}
    ${/const HISTORICAS_B1 = \[[\s\S]*?\];/.exec(APP)[0]}
    ${trozo("function mismaParcela(")}
    ${trozo("function buscarEn(")}
    const fincaVigente = () => FINCA;
    ${/async function confirmarHistoricas\(ids\)[\s\S]*?\n    \}/.exec(APP)[0]}
    const confirmar = (ids) => confirmarHistoricas(ids || HISTORICAS_B1);
    return { confirmar, clasificar: () => clasificarSiembras(FINCA),
             zonas: zonasGuardadas, mismaParcela,
             payload: (z, s) => payloadSiembra(z, s, FINCA, uid),
             huella: (p) => huellaPayload(p) };
  `;
  const f = new Function("uid", "localStorage", "FINCA", "fetch", "console", "guardaConfig", "leerBase", cuerpo);
  const fetchFalso = async (url) => {
    peticiones.push(url);
    if (retenVerificar) await retenVerificar;
    const id = /usuario_id=([^&]+)/.exec(url)?.[1];
    const fila = filas[id];
    return fila ? { ok: true, json: async () => ({ ok: true, parcela: fila }) } : { ok: false };
  };
  return { ...f(uid, ls, FINCA_REAL, fetchFalso, { warn: () => {} }, guardaConfig,
                () => ({ owner_id: "owner", base_version: 3 })), peticiones };
}
const FINCA_REAL = { ciudad: "Sant Boi de Llobregat", lat: 41.32, lon: 2.06,
                     suelo: "franco", metodoRiego: "goteo", caudal: 1.8 };
const GEOM = { type: "Polygon", coordinates: [[[2.06, 41.32], [2.07, 41.33], [2.06, 41.32]]] };
const IDS = ["264c2a43-8a64-4a0e-ad98-07cbf76c438d", "ba603bc6-6f39-4c76-ad06-f7ca4b723d86",
             "62dcd2da-6b93-4761-9cae-727c5315d22c", "eff32768-b032-401b-add1-82ca30337134"];
const CULTIVOS = ["brassica", "lechuga", "calabacin", "lechuga"];
const AREAS = [1880, 2174, 1172, 2570];
// Zonas tal como quedaron tras B.1: sync con la huella VIEJA (la que llevaba
// email y origen), que es la que las manda a pendientes_sincronizacion.
const zonasTrasB1 = () => [{
  referencia: "R1", geometria: GEOM,
  siembras: IDS.map((id, i) => ({
    id, cultivo: CULTIVOS[i], area_m2: AREAS[i], fechaPlantacion: "2026-09-06",
    geometria: GEOM,
    sync: { nueva: false, vista: "huella-vieja-con-email", confirmada: null, token: `tok-${i}` },
  })),
}];
// Y las filas que B.1 dejó en `usuarios`, coherentes con el payload de ahora.
const filasB1 = (mod = {}) => Object.fromEntries(IDS.map((id, i) => [id, {
  id, propietario_id: "owner", nombre: null, ciudad: "Sant Boi de Llobregat",
  lat: 41.32, lon: 2.06, cultivos: [CULTIVOS[i]], parcela: GEOM,
  area_m2: AREAS[i], fecha_plantacion: "2026-09-06", suelo: "franco",
  metodo_riego: "goteo", caudal: 1.8, ...(mod[id] || {}),
}]));

{
  const ls = almacen({ kylia_zonas: JSON.stringify(zonasTrasB1()) });
  let guardado = null;
  const app = cargarApp({ ls, filas: filasB1(), guardaConfig: async (c) => { guardado = c; return { ok: true, persisted: true, status: 200 }; } });

  const antes = app.clasificar();
  ok(antes.pendientes_sincronizacion.length === 4, `de partida, 4 en pendientes_sincronizacion (${antes.pendientes_sincronizacion.length})`);
  ok(antes.pendientes_reparacion.length === 0, "y 0 en pendientes_reparacion: B.1 ya creó las filas");
  ok(antes.confirmadas.length === 0, "0 confirmadas");

  const r = await app.confirmar();
  ok(r.confirmadas.length === 4, `confirma las 4 (${r.confirmadas.length})`);
  ok(r.divergentes.length === 0 && r.sin_fila.length === 0, "sin divergentes ni ausentes");
  ok(!r.no_guardado, "y el guardado por CAS sale bien");

  const despues = app.clasificar();
  ok(despues.confirmadas.length === 4, `confirmadas: 4 (${despues.confirmadas.length})`);
  ok(despues.pendientes_sincronizacion.length === 0, "pendientes_sincronizacion: 0");
  ok(despues.pendientes_reparacion.length === 0, "pendientes_reparacion: 0");
  ok(despues.sin_cultivo.length === 0, "sin_cultivo: 0");

  // NI UN POST a usuarios: solo lecturas de vista=verificar.
  ok(app.peticiones.every(u => /vista=verificar/.test(u)), "solo se consulta vista=verificar");
  ok(app.peticiones.length === 4, `una lectura por siembra (${app.peticiones.length})`);
  ok(guardado && Array.isArray(guardado.zonas), "el CAS recibe la config entera");

  // Las marcas, exactamente las tres, con el token de siempre.
  const z = JSON.parse(ls.getItem("kylia_zonas"))[0];
  z.siembras.forEach((s, i) => {
    ok(s.sync.token === `tok-${i}`, `${s.id.slice(0, 8)}… conserva su token`);
    ok(s.sync.nueva === false && s.sync.vista === s.sync.confirmada && s.sync.vista !== "huella-vieja-con-email",
       `${s.id.slice(0, 8)}… vista = confirmada = huella actual`);
    ok(s.cultivo === CULTIVOS[i] && s.area_m2 === AREAS[i] && s.fechaPlantacion === "2026-09-06",
       `${s.id.slice(0, 8)}… contenido agronómico intacto`);
  });

  // Y tras "recargar" —releer de localStorage—, sigue cerrado.
  const app2 = cargarApp({ ls, filas: filasB1(), guardaConfig: async () => ({ ok: true, persisted: true }) });
  const tras = app2.clasificar();
  ok(tras.confirmadas.length === 4 && tras.pendientes_sincronizacion.length === 0,
     "tras recargar sigue en 4 confirmadas y 0 pendientes");
}

console.log("\n── 9. B.2 no confirma lo que no puede demostrar ──");
for (const [etiqueta, mod] of [
  ["cultivo distinto",   { [IDS[0]]: { cultivos: ["tomate"] } }],
  ["área distinta",      { [IDS[1]]: { area_m2: 999 } }],
  ["fecha distinta",     { [IDS[2]]: { fecha_plantacion: "2020-01-01" } }],
  ["suelo distinto",     { [IDS[3]]: { suelo: "arcilloso" } }],
  ["método distinto",    { [IDS[0]]: { metodo_riego: "surco" } }],
  ["caudal distinto",    { [IDS[1]]: { caudal: 9 } }],
  ["propietario ajeno",  { [IDS[2]]: { propietario_id: "otro" } }],
  ["GEOMETRÍA distinta", { [IDS[3]]: { parcela: { type: "Polygon", coordinates: [[[0, 0], [1, 1], [0, 0]]] } } }],
]) {
  const ls = almacen({ kylia_zonas: JSON.stringify(zonasTrasB1()) });
  let guardado = false;
  const app = cargarApp({ ls, filas: filasB1(mod), guardaConfig: async () => { guardado = true; return { ok: true, persisted: true }; } });
  const r = await app.confirmar();
  ok(r.confirmadas.length === 0, `${etiqueta}: 0 confirmadas (todo o nada)`);
  ok(r.divergentes.length === 1, `${etiqueta}: se señala la que diverge`);
  ok(!guardado, `${etiqueta}: no se guarda nada`);
  const z = JSON.parse(ls.getItem("kylia_zonas"))[0];
  ok(z.siembras.every(s => s.sync.confirmada === null), `${etiqueta}: ninguna marca avanza`);
}
{
  // Fila que no existe en el servidor: tampoco.
  const ls = almacen({ kylia_zonas: JSON.stringify(zonasTrasB1()) });
  const filas = filasB1(); delete filas[IDS[0]];
  const app = cargarApp({ ls, filas, guardaConfig: async () => ({ ok: true, persisted: true }) });
  const r = await app.confirmar();
  ok(r.sin_fila.includes(IDS[0]) && r.confirmadas.length === 0, "sin fila en el servidor: no confirma ninguna");
}
{
  // 409 del CAS: se reporta y no se reintenta.
  const ls = almacen({ kylia_zonas: JSON.stringify(zonasTrasB1()) });
  let intentos = 0;
  const app = cargarApp({ ls, filas: filasB1(),
    guardaConfig: async () => { intentos++; return { ok: false, status: 409, persisted: false, error: "conflicto_version" }; } });
  const r = await app.confirmar();
  ok(r.no_guardado?.status === 409, "un 409 se reporta");
  ok(intentos === 1, `sin retry (${intentos} intento)`);
}

console.log("\n── 10. la lista es explícita: no confirma pendientes ajenos ──");
{
  // Una siembra con edición local de verdad, pendiente de sincronizar, que NO
  // está en la lista de B.1. Confirmarla sería perder el cambio del agricultor.
  const zonas = zonasTrasB1();
  zonas[0].siembras.push({ id: "editada-local", cultivo: "lechuga", area_m2: 500,
    fechaPlantacion: "2026-09-06", geometria: GEOM,
    sync: { nueva: true, vista: null, confirmada: null, token: "tok-x" } });
  const ls = almacen({ kylia_zonas: JSON.stringify(zonas) });
  const app = cargarApp({ ls, filas: filasB1(), guardaConfig: async () => ({ ok: true, persisted: true }) });
  const antes = app.clasificar();
  ok(antes.pendientes_sincronizacion.length === 5, "hay 5 pendientes de sincronizar, una es una edición local");
  const r = await app.confirmar();
  ok(r.confirmadas.length === 4, "B.2 confirma solo las 4 de la lista");
  ok(!r.confirmadas.includes("editada-local"), "y NO la edición local");
  const z = JSON.parse(ls.getItem("kylia_zonas"))[0];
  const ed = z.siembras.find(s => s.id === "editada-local");
  ok(ed.sync.nueva === true && ed.sync.confirmada === null,
     "que sigue pendiente: su cambio no se da por subido");
  ok(app.clasificar().pendientes_sincronizacion.length === 1, "y queda ella sola pendiente");
}
{
  const fuente = /async function confirmarHistoricas\(ids\)[\s\S]*?\n    \}/.exec(APP)[0];
  ok(!/registroUsuario|crear-parcela/.test(fuente), "B.2 no llama a registroUsuario ni a crear-parcela");
  ok(!/pendientes_sincronizacion/.test(fuente), "y no se cuelga de la categoría genérica");
  ok(/ajenos\.length/.test(fuente), "y rechaza cualquier id fuera de la lista");
  ok(/HISTORICAS_B1\.includes\(id\)/.test(fuente), "opera sobre la lista cerrada");
}

console.log("\n── 11. A · CAS 409 · el estado local NO puede mentir ──");
{
  const zonasIniciales = JSON.stringify(zonasTrasB1());
  const ls = almacen({ kylia_zonas: zonasIniciales });
  let intentos = 0;
  const app = cargarApp({ ls, filas: filasB1(),
    guardaConfig: async () => { intentos++; return { ok: false, status: 409, persisted: false, error: "conflicto_version" }; } });
  const antes = app.clasificar();
  ok(antes.pendientes_sincronizacion.length === 4, "antes: 4 pendientes de sincronizar");

  const r = await app.confirmar();
  ok(r.confirmadas.length === 0, `confirmadas: 0 (${r.confirmadas.length})`);
  ok(r.no_guardado?.status === 409, "el 409 se reporta");
  ok(intentos === 1, `un solo intento (${intentos})`);
  const despues = app.clasificar();
  ok(despues.pendientes_sincronizacion.length === 4, `después SIGUEN 4 pendientes (${despues.pendientes_sincronizacion.length})`);
  ok(despues.confirmadas.length === 0, "y 0 confirmadas: la pantalla no miente");
  ok(ls.getItem("kylia_zonas") === zonasIniciales, "la foto local es IDÉNTICA byte a byte");
}

console.log("\n── 12. B · un id ajeno no se puede colar ──");
{
  const ls = almacen({ kylia_zonas: JSON.stringify(zonasTrasB1()) });
  let llamadas = 0;
  const app = cargarApp({ ls, filas: filasB1(), guardaConfig: async () => { llamadas++; return { ok: true, persisted: true }; } });
  const antes = ls.getItem("kylia_zonas");
  for (const intento of [["quinta"], ["quinta", ...IDS], [IDS[0], "otra-cualquiera"], []]) {
    const r = await app.confirmar(intento);
    ok(r.confirmadas.length === 0, `confirmar(${JSON.stringify(intento).slice(0, 30)}) → 0 confirmadas`);
  }
  ok(llamadas === 0, "ninguno llega al CAS");
  ok(ls.getItem("kylia_zonas") === antes, "y el estado local no se toca");
  ok(/window\.kyliaConfirmarHistoricas = \(\) => confirmarHistoricas\(HISTORICAS_B1\)/.test(APP),
     "y desde consola no hay forma de pasar ids: el envoltorio no los acepta");
}
{
  // La quinta con cambio local real sigue exactamente igual tras la llamada buena.
  const zonas = zonasTrasB1();
  zonas[0].siembras.push({ id: "quinta", cultivo: "lechuga", area_m2: 500,
    fechaPlantacion: "2026-09-06", geometria: GEOM,
    sync: { nueva: true, vista: null, confirmada: null, token: "tok-q" } });
  const ls = almacen({ kylia_zonas: JSON.stringify(zonas) });
  const app = cargarApp({ ls, filas: filasB1(), guardaConfig: async () => ({ ok: true, persisted: true }) });
  const antesQ = JSON.stringify(JSON.parse(ls.getItem("kylia_zonas"))[0].siembras.find(x => x.id === "quinta"));
  const r = await app.confirmar();
  ok(r.confirmadas.length === 4 && !r.confirmadas.includes("quinta"), "confirma las 4 y no la quinta");
  const despuesQ = JSON.stringify(JSON.parse(ls.getItem("kylia_zonas"))[0].siembras.find(x => x.id === "quinta"));
  ok(antesQ === despuesQ, "la quinta queda EXACTAMENTE como estaba");
}

console.log("\n── 13. C · edición durante la verificación: gana la edición ──");
{
  let soltar; const reten = new Promise(r => { soltar = r; });
  const ls = almacen({ kylia_zonas: JSON.stringify(zonasTrasB1()) });
  let llamadasCas = 0;
  const app = cargarApp({ ls, filas: filasB1(), retenVerificar: reten,
    guardaConfig: async () => { llamadasCas++; return { ok: true, persisted: true }; } });
  const enCurso = app.confirmar();
  await new Promise(r => setTimeout(r, 0));
  // El agricultor cambia el área de la primera mientras se verifica.
  const z = JSON.parse(ls.getItem("kylia_zonas"));
  z[0].siembras[0].area_m2 = 900;
  ls.setItem("kylia_zonas", JSON.stringify(z));
  soltar();
  const r = await enCurso;

  ok(r.confirmadas.length === 0, "B.2 aborta: 0 confirmadas");
  ok(/gana la edición local/.test(r.motivo || ""), `y lo dice (${(r.motivo || "").slice(0, 60)})`);
  ok(llamadasCas === 0, `0 CAS (${llamadasCas})`);
  const fin = JSON.parse(ls.getItem("kylia_zonas"))[0].siembras[0];
  ok(fin.area_m2 === 900, `el área final es 900 (${fin.area_m2})`);
  ok(fin.sync.confirmada === null, "y sigue pendiente, sin marca");
  ok(app.clasificar().pendientes_sincronizacion.length === 4, "las 4 siguen pendientes");
}

console.log("\n── 14. D · edición DURANTE el CAS ──");
{
  let soltarCas; const retenCas = new Promise(r => { soltarCas = r; });
  const ls = almacen({ kylia_zonas: JSON.stringify(zonasTrasB1()) });
  let enviado = null;
  const app = cargarApp({ ls, filas: filasB1(),
    guardaConfig: async (cfg) => { enviado = cfg; await retenCas; return { ok: true, persisted: true, status: 200 }; } });
  const enCurso = app.confirmar();
  await new Promise(r => setTimeout(r, 0));
  // El CAS está en vuelo con H1. El agricultor cambia el área a 900.
  const z = JSON.parse(ls.getItem("kylia_zonas"));
  z[0].siembras[0].area_m2 = 900;
  ls.setItem("kylia_zonas", JSON.stringify(z));
  soltarCas();
  const r = await enCurso;

  const fin = JSON.parse(ls.getItem("kylia_zonas"))[0];
  const editada = fin.siembras[0];
  ok(editada.area_m2 === 900, `el área nueva PERMANECE (${editada.area_m2})`);
  ok(r.confirmadas.length === 4, "las 4 se marcan con lo que confirmó el servidor");
  const H1 = app.huella(app.payload({ ...fin, siembras: [] }, { id: IDS[0], cultivo: CULTIVOS[0], area_m2: 1880, fechaPlantacion: "2026-09-06", geometria: GEOM }));
  ok(editada.sync.confirmada === H1, "confirmada = H1, la huella que viajó al CAS");
  const H2 = app.huella(app.payload(fin, editada));
  ok(H2 !== H1, "y la huella actual es otra: H2");
  const clas = app.clasificar();
  ok(clas.pendientes_sincronizacion.some(x => x.id === IDS[0]),
     "así que esa siembra queda PENDIENTE, no falsamente confirmada");
  ok(clas.confirmadas.length === 3, `y las otras tres sí confirmadas (${clas.confirmadas.length})`);
  ok(JSON.stringify(enviado.zonas[0].siembras[0].area_m2) === "1880",
     "el CAS recibió la foto de antes de la edición, que es lo coherente con H1");
}
{
  // Y si la instancia se sustituye durante el CAS, no se le pone marca.
  let soltarCas; const retenCas = new Promise(r => { soltarCas = r; });
  const ls = almacen({ kylia_zonas: JSON.stringify(zonasTrasB1()) });
  const app = cargarApp({ ls, filas: filasB1(),
    guardaConfig: async () => { await retenCas; return { ok: true, persisted: true }; } });
  const enCurso = app.confirmar();
  await new Promise(r => setTimeout(r, 0));
  const z = JSON.parse(ls.getItem("kylia_zonas"));
  z[0].siembras[0].sync = { nueva: true, vista: null, confirmada: null, token: "tok-OTRO" };
  ls.setItem("kylia_zonas", JSON.stringify(z));
  soltarCas();
  const r = await enCurso;
  const s0 = JSON.parse(ls.getItem("kylia_zonas"))[0].siembras[0];
  ok(s0.sync.token === "tok-OTRO" && s0.sync.confirmada === null,
     "instancia sustituida durante el CAS: NO hereda la confirmación");
  ok(r.confirmadas.length === 3, `y solo se marcan las otras tres (${r.confirmadas.length})`);
}

console.log("\n── 15. E · camino estable ──");
{
  const ls = almacen({ kylia_zonas: JSON.stringify(zonasTrasB1()) });
  const app = cargarApp({ ls, filas: filasB1(), guardaConfig: async () => ({ ok: true, persisted: true, status: 200 }) });
  ok(app.clasificar().pendientes_sincronizacion.length === 4, "antes: 4 pendientes");
  const r = await app.confirmar();
  ok(r.confirmadas.length === 4 && !r.no_guardado, "el CAS confirma las 4");
  const c = app.clasificar();
  ok(c.confirmadas.length === 4 && c.pendientes_sincronizacion.length === 0 &&
     c.pendientes_reparacion.length === 0 && c.sin_cultivo.length === 0,
     "4 confirmadas · 0 · 0 · 0");
  const app2 = cargarApp({ ls, filas: filasB1(), guardaConfig: async () => ({ ok: true, persisted: true }) });
  const c2 = app2.clasificar();
  ok(c2.confirmadas.length === 4 && c2.pendientes_sincronizacion.length === 0,
     "y tras recargar siguen las 4 confirmadas");
}

console.log(fallos === 0 ? "\n✅ TODOS LOS TESTS VERDES\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos === 0 ? 0 : 1);
