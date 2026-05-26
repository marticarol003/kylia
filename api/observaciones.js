// Registra una observación del agricultor (plaga, enfermedad, estrés, otro).
//
// Capturado desde el modal de observaciones o desde el wizard "Cerrar jornada".
// Sirve para validar las alertas de plaga de Kylia: si el agricultor ve algo,
// queda registrado; si no ve nada, también es un dato.

const { isConfigured, supabaseInsert, parseBody, preludio } = require("./_supabase.js");

const TIPOS = new Set(["plaga", "enfermedad", "estres", "otro"]);

module.exports = async (req, res) => {
  if (!preludio(req, res, "POST")) return;
  const body = parseBody(req);

  const usuario_id = (body.usuario_id || "").toString().trim();
  if (!/^[0-9a-f-]{36}$/i.test(usuario_id)) {
    return res.status(400).json({ error: "usuario_id inválido" });
  }

  const tipo = TIPOS.has(body.tipo) ? body.tipo : "otro";

  const fila = {
    usuario_id,
    jornada_id:  idOrNull(body.jornada_id),
    fecha_local: dateOrNull(body.fecha_local),
    tipo,
    descripcion: clean(body.descripcion, 300),
    severidad:   sevOrNull(body.severidad),
    cultivo:     clean(body.cultivo,      60),
    notas:       clean(body.notas,       500),
  };

  console.log("[observaciones]", JSON.stringify({ usuario_id, tipo, severidad: fila.severidad }));

  if (!isConfigured()) {
    return res.status(200).json({ ok: true, persisted: false, reason: "supabase_not_configured" });
  }

  try {
    const filas = await supabaseInsert("observaciones", fila);
    return res.status(200).json({ ok: true, persisted: true, observacion: filas?.[0] || null });
  } catch (err) {
    console.error("[observaciones] error:", err.message);
    return res.status(500).json({ ok: false, error: "no se pudo guardar" });
  }
};

function clean(v, max) {
  if (v == null || v === "") return null;
  return String(v).trim().slice(0, max);
}
function idOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}
function sevOrNull(v) {
  if (v == null || v === "") return null;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(5, n));
}
function dateOrNull(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
