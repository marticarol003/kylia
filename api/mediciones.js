// Persiste la medición Sentinel-2 / suelo del usuario.
//
// El frontend llama aquí cada vez que recibe datos nuevos de /api/sentinel
// (NDVI, NDMI) o de Open-Meteo (humedad de suelo). Si ya hay fila para esa
// fecha+fuente, se ignora (upsert con merge).

const { isConfigured, supabaseInsert, parseBody, preludio } = require("./_supabase.js");

module.exports = async (req, res) => {
  if (!preludio(req, res, "POST")) return;
  const body = parseBody(req);

  const usuario_id = (body.usuario_id || "").toString().trim();
  if (!/^[0-9a-f-]{36}$/i.test(usuario_id)) {
    return res.status(400).json({ error: "usuario_id inválido" });
  }
  const fecha = dateOrNull(body.fecha);
  if (!fecha) return res.status(400).json({ error: "fecha inválida (YYYY-MM-DD)" });

  const fila = {
    usuario_id,
    fecha,
    ndvi:         numOrNull(body.ndvi),
    ndmi:         numOrNull(body.ndmi),
    ndmi_stdev:   numOrNull(body.ndmi_stdev),
    suelo_0_7:    numOrNull(body.suelo_0_7),
    suelo_7_28:   numOrNull(body.suelo_7_28),
    suelo_28_100: numOrNull(body.suelo_28_100),
    fuente:       (body.fuente || "sentinel-2").toString().slice(0, 40),
  };

  if (!isConfigured()) {
    return res.status(200).json({ ok: true, persisted: false, reason: "supabase_not_configured" });
  }

  try {
    const filas = await supabaseInsert("mediciones", fila, { upsert: true });
    return res.status(200).json({ ok: true, persisted: true, medicion: filas?.[0] || null });
  } catch (err) {
    console.error("[mediciones] error:", err.message);
    return res.status(500).json({ ok: false, error: "no se pudo guardar" });
  }
};

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function dateOrNull(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
