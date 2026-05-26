// Persiste lo que Kylia HABRÍA recomendado (shadow log).
//
// El frontend ejecuta el motor de reglas como siempre (en silencio en modo
// piloto, visible en modo demo). Cada vez que se calcula la recomendación
// del día, envía el snapshot aquí. Una fila por (usuario, día, tipo).

const { isConfigured, supabaseInsert, parseBody, preludio } = require("./_supabase.js");

const TIPOS = new Set(["riego", "tratamiento", "nutricion"]);
const NIVELES = new Set(["alta", "media", "baja"]);

module.exports = async (req, res) => {
  if (!preludio(req, res, "POST")) return;
  const body = parseBody(req);

  const usuario_id = (body.usuario_id || "").toString().trim();
  if (!/^[0-9a-f-]{36}$/i.test(usuario_id)) {
    return res.status(400).json({ error: "usuario_id inválido" });
  }

  // Permite enviar varias recomendaciones a la vez (array) o una sola (objeto).
  const lista = Array.isArray(body.recomendaciones) ? body.recomendaciones
              : body.recomendacion ? [body.recomendacion]
              : [];

  if (lista.length === 0) {
    return res.status(400).json({ error: "sin recomendaciones en el payload" });
  }

  const filas = lista.map(r => ({
    usuario_id,
    tipo:               TIPOS.has(r.tipo)    ? r.tipo  : "riego",
    texto:              clean(r.texto,             500),
    cantidad_l_m2:      numOrNull(r.cantidad_l_m2),
    producto_id:        clean(r.producto_id,        80),
    producto_nombre:    clean(r.producto_nombre,   160),
    dosis:              clean(r.dosis,              80),
    nivel:              NIVELES.has(r.nivel) ? r.nivel : null,
    coste_estimado_eur: numOrNull(r.coste_estimado_eur),
    contexto:           r.contexto && typeof r.contexto === "object" ? r.contexto : {},
  }));

  console.log("[recomendaciones-log]", JSON.stringify({ usuario_id, n: filas.length, tipos: filas.map(f => f.tipo) }));

  if (!isConfigured()) {
    return res.status(200).json({ ok: true, persisted: false, reason: "supabase_not_configured" });
  }

  try {
    const insertadas = await supabaseInsert("recomendaciones_log", filas);
    return res.status(200).json({ ok: true, persisted: true, n: insertadas.length });
  } catch (err) {
    console.error("[recomendaciones-log] error:", err.message);
    return res.status(500).json({ ok: false, error: "no se pudo guardar" });
  }
};

function clean(v, max) {
  if (v == null || v === "") return null;
  return String(v).trim().slice(0, max);
}
function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
