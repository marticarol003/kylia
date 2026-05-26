// Cierra el diario de una jornada (encuesta de fin de día).
//
// Crea o actualiza la fila de jornadas para (usuario_id, fecha). El frontend
// llama aquí PRIMERO para obtener el jornada_id, y luego enlaza acciones y
// observaciones del wizard con ese id.

const { isConfigured, supabaseInsert, supabaseUpdate, supabaseSelect, parseBody, preludio } = require("./_supabase.js");

const FUENTES_VALIDAS = new Set(["experiencia", "meteo", "asesor", "vecino", "rutina", "otro"]);

module.exports = async (req, res) => {
  if (!preludio(req, res, "POST")) return;
  const body = parseBody(req);

  const usuario_id = (body.usuario_id || "").toString().trim();
  if (!/^[0-9a-f-]{36}$/i.test(usuario_id)) {
    return res.status(400).json({ error: "usuario_id inválido" });
  }

  const fecha = dateOrNull(body.fecha);
  if (!fecha) return res.status(400).json({ error: "fecha inválida (YYYY-MM-DD)" });

  const fuenteRaw = Array.isArray(body.fuente_decision) ? body.fuente_decision : [];
  const fuente_decision = fuenteRaw
    .map(s => String(s).trim().toLowerCase())
    .filter(s => FUENTES_VALIDAS.has(s))
    .slice(0, 6);

  const comentario = clean(body.comentario, 600);

  console.log("[jornadas]", JSON.stringify({ usuario_id, fecha, fuente_decision }));

  if (!isConfigured()) {
    return res.status(200).json({ ok: true, persisted: false, reason: "supabase_not_configured" });
  }

  try {
    // ¿Existe ya para (usuario, fecha)?
    const existentes = await supabaseSelect(
      "jornadas",
      `usuario_id=eq.${usuario_id}&fecha=eq.${fecha}&select=id`
    );
    if (existentes.length > 0) {
      const id = existentes[0].id;
      const filas = await supabaseUpdate(
        "jornadas",
        `id=eq.${id}`,
        { fuente_decision, comentario, completada_en: new Date().toISOString() }
      );
      return res.status(200).json({ ok: true, persisted: true, jornada: filas?.[0] || null });
    } else {
      const filas = await supabaseInsert("jornadas", {
        usuario_id, fecha, fuente_decision, comentario,
      });
      return res.status(200).json({ ok: true, persisted: true, jornada: filas?.[0] || null });
    }
  } catch (err) {
    console.error("[jornadas] error:", err.message);
    return res.status(500).json({ ok: false, error: "no se pudo guardar" });
  }
};

function clean(v, max) {
  if (v == null || v === "") return null;
  return String(v).trim().slice(0, max);
}
function dateOrNull(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
