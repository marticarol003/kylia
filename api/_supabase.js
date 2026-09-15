// Helper ligero para hablar con Supabase desde los endpoints serverless.
//
// Usa la REST API de PostgREST con la service_role key (entorno servidor).
// Sin dependencias: solo fetch nativo de Node 18+.
//
// Variables de entorno requeridas:
//   SUPABASE_URL          → https://<proyecto>.supabase.co
//   SUPABASE_SERVICE_KEY  → service_role key (NO la anon)
//
// Si alguna falta, las funciones devuelven { ok:false, reason:"not_configured" }
// y loguean por consola, pero NO lanzan — así los endpoints siguen respondiendo
// 200 y el frontend no rompe (ej. cuando todavía no se han configurado).

// Normaliza SUPABASE_URL a la base del proyecto, sin importar cómo esté puesto
// el env: tolera barra final y un "/rest/v1" ya incluido. Las funciones añaden
// "/rest/v1/<tabla>", así que si el env trae cualquiera de esos sufijos se
// duplicaría el path ("//rest/v1" o "/rest/v1/rest/v1") y PostgREST lo rechaza
// con PGRST125 "Invalid path". Dejamos solo "https://<ref>.supabase.co".

const { fetchConTimeout } = require("./_http.js");

const SUPABASE_URL = (process.env.SUPABASE_URL || "")
  .trim()
  .replace(/\/+$/, "")          // sin barra(s) final(es)
  .replace(/\/rest\/v1$/, "")   // sin "/rest/v1" si el env ya lo incluía
  .replace(/\/+$/, "");
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);
}

function authHeaders() {
  return {
    "apikey":        SUPABASE_SERVICE_KEY,
    "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
  };
}

// ── Las tres columnas que congela la migración del 14-sep ─────────────────
// db/congelar-lamina-riego-2026-09-14.sql añade lamina_mm, lamina_origen y
// caudal_mmh a `acciones`. El paso 5 de ese fichero da por hecho que el código
// que las usa se despliega DESPUÉS de crearlas, y sobre esa premisa dice "no
// falla". La premisa no se cumplió: el código salió a producción al pushear a
// main y la migración sigue sin ejecutar, así que PostgREST rechazaba el SELECT
// ENTERO con 42703 y en producción contestaban 400 la pantalla de hoy, el perfil
// y el reveal. Se encontró ejecutando la API real, no leyendo el fichero.
//
// Una columna que todavía no existe no puede tumbar la consulta entera. Aquí se
// quita de la lista y se repite una vez. NO SE INVENTA NADA: sin lámina
// congelada, laminaDeAccion() recalcula con el caudal actual y lo declara
// (`recalculada_caudal_actual`), que es exactamente lo que hacía la app antes de
// la migración. Y en los INSERT se caen los tres campos, o sea que el riego se
// guarda igual en vez de perderse.
//
// Sirve en los DOS sentidos, que es lo que lo hace algo más que un parche:
//   · antes de migrar → producción funciona con el código nuevo ya desplegado;
//   · después del rollback (c), que dropea las columnas → tampoco rompe.
const COLS_CONGELADAS = ["lamina_mm", "lamina_origen", "caudal_mmh"];
const TTL_SIN_COLUMNAS_MS = 60_000;   // se vuelve a probar: tras migrar, se recupera solo
let sinColumnasHasta = 0;

const faltanCongeladas = () => Date.now() < sinColumnasHasta;
function marcarFaltanCongeladas(table, detalle) {
  sinColumnasHasta = Date.now() + TTL_SIN_COLUMNAS_MS;
  console.warn(`[supabase] ${table}: faltan las columnas congeladas `
    + `(${COLS_CONGELADAS.join(", ")}) — migración del 14-sep sin ejecutar. `
    + `Se sigue sin ellas: la lámina se recalcula con el caudal actual y se declara. ${detalle}`);
}

// 42703 = columna inexistente (SELECT). PGRST204 = columna fuera del schema
// cache (INSERT/PATCH). Solo se trata si el que falta es uno de los tres: un
// 42703 por cualquier otra columna es un error de verdad y tiene que subir.
function esFaltaDeCongelada(texto = "") {
  return /42703|PGRST204/.test(texto) && COLS_CONGELADAS.some(c => texto.includes(c));
}

// Quita las tres de `select=`. Si no queda ninguna columna, se borra el
// parámetro entero y PostgREST devuelve `*`.
function sinCongeladasEnSelect(query = "") {
  return query.replace(/(^|&)select=([^&]*)/, (_m, pre, lista) => {
    const cols = lista.split(",").filter(c => !COLS_CONGELADAS.includes(c.trim()));
    return cols.length ? `${pre}select=${cols.join(",")}` : (pre === "&" ? "" : "");
  }).replace(/&&+/g, "&").replace(/^&/, "").replace(/&$/, "");
}

const sinCongeladasEnFilas = (filas) => filas.map((f) => {
  const copia = { ...f };
  for (const c of COLS_CONGELADAS) delete copia[c];
  return copia;
});

// Inserta una o varias filas.
// opts.upsert: true → merge duplicates por la PK (o por on_conflict si se pasa)
// opts.onConflict: "col1,col2" → columnas únicas a usar para upsert
// opts.ignoreDuplicates: true → no actualizar, solo ignorar duplicados (NDVI ya cargado)
async function supabaseInsert(table, payload, opts = {}) {
  if (!isConfigured()) {
    console.warn(`[supabase] no configurado, omitiendo insert en ${table}`);
    return { ok: false, reason: "not_configured" };
  }
  const body = Array.isArray(payload) ? payload : [payload];
  const qs = opts.onConflict ? `?on_conflict=${encodeURIComponent(opts.onConflict)}` : "";
  const url = `${SUPABASE_URL}/rest/v1/${table}${qs}`;
  const preferParts = ["return=representation"];
  if (opts.upsert)            preferParts.push("resolution=merge-duplicates");
  if (opts.ignoreDuplicates)  preferParts.push("resolution=ignore-duplicates");
  const enviar = (filas) => fetchConTimeout(url, {
    method:  "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      "Prefer":       preferParts.join(","),
    },
    body: JSON.stringify(filas),
  });

  const res = await enviar(faltanCongeladas() ? sinCongeladasEnFilas(body) : body);
  if (res.ok) return await res.json();

  const text = await res.text().catch(() => "");
  // Un riego que no se puede guardar porque falta una columna es un riego
  // perdido: el agricultor ya ha regado. Se guarda sin los campos congelados.
  if (esFaltaDeCongelada(text) && !faltanCongeladas()) {
    marcarFaltanCongeladas(table, `insert ${res.status}`);
    const res2 = await enviar(sinCongeladasEnFilas(body));
    if (res2.ok) return await res2.json();
    const text2 = await res2.text().catch(() => "");
    throw new Error(`Supabase insert ${table} ${res2.status}: ${text2.slice(0, 400)}`);
  }
  throw new Error(`Supabase insert ${table} ${res.status}: ${text.slice(0, 400)}`);
}

// Update por filtro PostgREST (ej: "id=eq.<uuid>")
async function supabaseUpdate(table, filter, patch) {
  if (!isConfigured()) {
    console.warn(`[supabase] no configurado, omitiendo update en ${table}`);
    return { ok: false, reason: "not_configured" };
  }
  const url = `${SUPABASE_URL}/rest/v1/${table}?${filter}`;
  const res = await fetchConTimeout(url, {
    method:  "PATCH",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      "Prefer":       "return=representation",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase update ${table} ${res.status}: ${text.slice(0, 400)}`);
  }
  return await res.json();
}

// Borra por filtro PostgREST (ej: "id=eq.5&usuario_id=eq.<uuid>").
// Devuelve las filas borradas (return=representation) para poder confirmar
// que se borró exactamente lo esperado (0 filas → nada coincidió).
async function supabaseDelete(table, filter) {
  if (!isConfigured()) {
    console.warn(`[supabase] no configurado, omitiendo delete en ${table}`);
    return { ok: false, reason: "not_configured" };
  }
  const url = `${SUPABASE_URL}/rest/v1/${table}?${filter}`;
  const res = await fetchConTimeout(url, {
    method:  "DELETE",
    headers: { ...authHeaders(), "Prefer": "return=representation" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase delete ${table} ${res.status}: ${text.slice(0, 400)}`);
  }
  return await res.json();
}

// Select por filtro PostgREST (ej: "id=eq.<uuid>&select=*")
async function supabaseSelect(table, query = "") {
  if (!isConfigured()) return [];
  // Si ya se sabe que las congeladas no están, no se pide un round-trip de más.
  const primera = faltanCongeladas() ? sinCongeladasEnSelect(query) : query;
  const r = await pedirSelect(table, primera);
  if (r.ok) return r.datos;

  const recortada = sinCongeladasEnSelect(query);
  if (esFaltaDeCongelada(r.texto) && recortada !== primera) {
    marcarFaltanCongeladas(table, r.path);
    const r2 = await pedirSelect(table, recortada);
    if (r2.ok) return r2.datos;
    throw new Error(`Supabase select ${table} ${r2.status} [${r2.path}]: ${r2.texto.slice(0, 300)}`);
  }
  throw new Error(`Supabase select ${table} ${r.status} [${r.path}]: ${r.texto.slice(0, 300)}`);
}

// Una petición suelta. Devuelve el error en vez de lanzarlo para poder decidir
// si toca reintentar sin las columnas congeladas.
async function pedirSelect(table, query) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? "?" + query : ""}`;
  const path = url.replace(SUPABASE_URL, "");   // sin dominio/clave, solo el path+query
  const res = await fetchConTimeout(url, { headers: authHeaders() });
  if (res.ok) return { ok: true, datos: await res.json() };
  return { ok: false, status: res.status, path, texto: await res.text().catch(() => "") };
}

// Helper común para parsear body JSON de Vercel.
function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  return body || {};
}

// CORS + método. Llama res.status(...).end()/.json(...) si decide cortar.
// Devuelve true si la request debe procesarse; false si ya respondió.
function preludio(req, res, metodo = "POST") {
  // El ACAO era "*". Ahora solo se devuelve si el origen está en la lista de
  // _origen.js; una petición sin `Origin` (crons, servidor a servidor) sigue
  // pasando igual, porque ahí CORS no pinta nada.
  require("./_origen.js").cabecerasCors(req, res, `${metodo}, OPTIONS`);
  if (req.method === "OPTIONS") { res.status(204).end(); return false; }
  if (req.method !== metodo)    { res.status(405).json({ error: "Método no permitido" }); return false; }
  return true;
}

module.exports = {
  isConfigured,
  supabaseInsert,
  supabaseUpdate,
  supabaseSelect,
  supabaseDelete,
  parseBody,
  preludio,
  // Expuestos para tests/test-columnas-congeladas.mjs: la regla de qué se
  // considera "falta una columna congelada" y cómo se recorta la consulta se
  // prueban ejecutándolas, no leyéndolas.
  COLS_CONGELADAS,
  esFaltaDeCongelada,
  sinCongeladasEnSelect,
  sinCongeladasEnFilas,
};
