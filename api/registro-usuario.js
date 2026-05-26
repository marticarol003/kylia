// Alta o actualización de un piloto en la tabla `usuarios`.
//
// El frontend genera un UUID v4 al primer uso y lo persiste en localStorage
// como `kylia_user_id`. Cada vez que cambian datos del perfil (completa
// onboarding, añade parcela, modifica cultivos, etc.), llama aquí con upsert.
//
// Si Supabase no está configurado, devuelve 200 sin guardar — el flujo del
// agricultor sigue funcionando localmente.

const { isConfigured, supabaseInsert, parseBody, preludio } = require("./_supabase.js");

module.exports = async (req, res) => {
  if (!preludio(req, res, "POST")) return;
  const body = parseBody(req);

  const id = (body.id || "").toString().trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ error: "id inválido (debe ser UUID)" });
  }

  const fila = {
    id,
    email:        clean(body.email,        200)?.toLowerCase() || null,
    nombre:       clean(body.nombre,       120)                 || null,
    telefono:     clean(body.telefono,      40)                 || null,
    lat:          numOrNull(body.lat),
    lon:          numOrNull(body.lon),
    ciudad:       clean(body.ciudad,       160)                 || null,
    cultivos:     Array.isArray(body.cultivos)
                    ? body.cultivos.map(c => String(c).slice(0, 60)).slice(0, 20)
                    : [],
    parcela:      body.parcela && typeof body.parcela === "object" ? body.parcela : null,
    tarifa_agua:  numOrNull(body.tarifa_agua),
    origen:       clean(body.origen,       120)                 || null,
    preferencias: body.preferencias && typeof body.preferencias === "object" ? body.preferencias : {},
    ua:           clean(req.headers["user-agent"], 400)         || null,
  };

  // Log siempre (para diagnóstico aunque Supabase no esté listo)
  console.log("[registro-usuario]", JSON.stringify({ id, nombre: fila.nombre, email: fila.email, cultivos: fila.cultivos, origen: fila.origen }));

  if (!isConfigured()) {
    return res.status(200).json({ ok: true, persisted: false, reason: "supabase_not_configured" });
  }

  try {
    const filas = await supabaseInsert("usuarios", fila, { upsert: true });
    return res.status(200).json({ ok: true, persisted: true, usuario: filas?.[0] || null });
  } catch (err) {
    console.error("[registro-usuario] error:", err.message);
    return res.status(500).json({ ok: false, error: "no se pudo guardar" });
  }
};

function clean(v, max) {
  if (v == null) return null;
  return String(v).trim().slice(0, max);
}
function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
