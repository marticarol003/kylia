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

const SUPABASE_URL = process.env.SUPABASE_URL || "";
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
  const res = await fetch(url, {
    method:  "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      "Prefer":       preferParts.join(","),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase insert ${table} ${res.status}: ${text.slice(0, 400)}`);
  }
  return await res.json();
}

// Update por filtro PostgREST (ej: "id=eq.<uuid>")
async function supabaseUpdate(table, filter, patch) {
  if (!isConfigured()) {
    console.warn(`[supabase] no configurado, omitiendo update en ${table}`);
    return { ok: false, reason: "not_configured" };
  }
  const url = `${SUPABASE_URL}/rest/v1/${table}?${filter}`;
  const res = await fetch(url, {
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

// Select por filtro PostgREST (ej: "id=eq.<uuid>&select=*")
async function supabaseSelect(table, query = "") {
  if (!isConfigured()) return [];
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? "?" + query : ""}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase select ${table} ${res.status}: ${text.slice(0, 400)}`);
  }
  return await res.json();
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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", `${metodo}, OPTIONS`);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return false; }
  if (req.method !== metodo)    { res.status(405).json({ error: "Método no permitido" }); return false; }
  return true;
}

module.exports = {
  isConfigured,
  supabaseInsert,
  supabaseUpdate,
  supabaseSelect,
  parseBody,
  preludio,
};
