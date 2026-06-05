// ─────────────────────────────────────────────────────────────────
// /api/reveal — informe final del piloto (lee Supabase → _reveal.js)
// ─────────────────────────────────────────────────────────────────
// Cruza lo que Kylia decidió (recomendaciones_log, congelado por el Diario B)
// contra lo que el agricultor hizo (acciones / jornadas) y devuelve el reveal:
// las 4 dimensiones de /piloto. El cálculo vive en api/_reveal.js (puro,
// testeable); aquí solo se leen las filas y se ensamblan.
//
// Uso:   GET /api/reveal?usuario_id=<uuid>          → JSON del informe
//        GET /api/reveal?usuario_id=<uuid>&dump=1   → + filas crudas (debug)
//
// AUTH: si existe REVEAL_TOKEN en entorno, se exige (?token= o header
//   x-reveal-token / Authorization: Bearer). El reveal contiene datos del
//   piloto: no debe quedar abierto en producción.

const { isConfigured, supabaseSelect, preludio } = require("./_supabase.js");
const { construirReveal } = require("./_reveal.js");

const ES_UUID = /^[0-9a-f-]{36}$/i;

module.exports = async (req, res) => {
  if (!preludio(req, res, "GET")) return;

  if (process.env.REVEAL_TOKEN) {
    const token   = (req.query?.token || req.headers["x-reveal-token"] || "").toString();
    const authHdr = (req.headers.authorization || "").toString();
    if (token !== process.env.REVEAL_TOKEN && authHdr !== `Bearer ${process.env.REVEAL_TOKEN}`) {
      return res.status(401).json({ error: "no autorizado" });
    }
  }

  const usuarioId = (req.query?.usuario_id || "").toString().trim();
  if (!ES_UUID.test(usuarioId)) {
    return res.status(400).json({ error: "usuario_id inválido (UUID)" });
  }

  if (!isConfigured()) {
    return res.status(200).json({ ok: false, reason: "supabase_not_configured" });
  }

  try {
    const [usuarios, recs, acciones, jornadas] = await Promise.all([
      supabaseSelect("usuarios",
        `id=eq.${usuarioId}&select=id,ciudad,cultivos,metodo_riego,fecha_plantacion,tarifa_agua,area_m2`),
      supabaseSelect("recomendaciones_log",
        `usuario_id=eq.${usuarioId}&select=fecha,tipo,cantidad_l_m2,nivel&order=fecha.asc`),
      supabaseSelect("acciones",
        `usuario_id=eq.${usuarioId}&select=fecha_local,tipo,cantidad_l_m2,producto_nombre&order=fecha_local.asc`),
      supabaseSelect("jornadas",
        `usuario_id=eq.${usuarioId}&select=fuente_decision`),
    ]);

    const usuario = (usuarios || [])[0];
    if (!usuario) return res.status(404).json({ error: "usuario no encontrado" });

    const dia = f => (f ? String(f).slice(0, 10) : null);

    const riegosKylia = (recs || []).filter(r => r.tipo === "riego")
      .map(r => ({ dia: dia(r.fecha), l_m2: r.cantidad_l_m2, nivel: r.nivel }));
    const tratKylia = (recs || []).filter(r => r.tipo === "tratamiento" || r.tipo === "nutricion")
      .map(r => ({ dia: dia(r.fecha) }));

    const riegosReales = (acciones || []).filter(a => a.tipo === "riego")
      .map(a => ({ dia: dia(a.fecha_local), l_m2: a.cantidad_l_m2 }));
    const tratReales = (acciones || []).filter(a => a.tipo === "tratamiento" || a.tipo === "aplicacion")
      .map(a => ({ dia: dia(a.fecha_local), producto: a.producto_nombre }));

    const informe = construirReveal({
      usuario, riegosReales, riegosKylia, tratReales, tratKylia, jornadas: jornadas || [],
    });

    const payload = { ok: true, informe };
    if (String(req.query?.dump || "") === "1") {
      payload.crudo = { riegosKylia, tratKylia, riegosReales, tratReales, jornadas };
    }
    return res.status(200).json(payload);
  } catch (err) {
    console.error("[reveal] error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
