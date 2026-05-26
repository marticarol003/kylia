// Recibe eventos de uso de la app (sustituye a Plausible para el piloto).
//
// El helper window.kyliaTrack del frontend hace POST aquí con cada evento.
// Sin coste, sin tercero — todo queda en Supabase y se puede agregar en SQL.

const { isConfigured, supabaseInsert, parseBody, preludio } = require("./_supabase.js");

const NOMBRE_MAX = 80;

module.exports = async (req, res) => {
  if (!preludio(req, res, "POST")) return;
  const body = parseBody(req);

  const nombre = clean(body.nombre, NOMBRE_MAX);
  if (!nombre) return res.status(400).json({ error: "nombre evento requerido" });

  // usuario_id es opcional — algunos eventos llegan antes de completar onboarding.
  const usuario_idRaw = (body.usuario_id || "").toString().trim();
  const usuario_id = /^[0-9a-f-]{36}$/i.test(usuario_idRaw) ? usuario_idRaw : null;

  const fila = {
    usuario_id,
    nombre,
    props: body.props && typeof body.props === "object" ? body.props : {},
    url:   clean(body.url, 400),
    ua:    clean(req.headers["user-agent"], 400),
  };

  if (!isConfigured()) {
    // Log silencioso si no hay Supabase, así no falla nada y el dev ve el evento.
    console.log("[eventos]", JSON.stringify({ usuario_id, nombre, props: fila.props }));
    return res.status(200).json({ ok: true, persisted: false });
  }

  try {
    await supabaseInsert("eventos", fila);
    return res.status(200).json({ ok: true, persisted: true });
  } catch (err) {
    console.error("[eventos] error:", err.message);
    // No 500 — los eventos no deben romper el flujo. Devolvemos 200.
    return res.status(200).json({ ok: false, error: "no se pudo guardar" });
  }
};

function clean(v, max) {
  if (v == null || v === "") return null;
  return String(v).trim().slice(0, max);
}
