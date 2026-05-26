// Registra una acción real del agricultor (riego o aplicación de producto).
//
// El frontend mantiene localStorage (instantáneo + offline), y dispara este
// endpoint en background para sincronizar con Supabase. Cualquier fallo se
// reintenta en el próximo abrir.

const { isConfigured, supabaseInsert, parseBody, preludio } = require("./_supabase.js");

module.exports = async (req, res) => {
  if (!preludio(req, res, "POST")) return;
  const body = parseBody(req);

  const usuario_id = (body.usuario_id || "").toString().trim();
  if (!/^[0-9a-f-]{36}$/i.test(usuario_id)) {
    return res.status(400).json({ error: "usuario_id inválido" });
  }

  const tipo = body.tipo === "aplicacion" ? "aplicacion" : "riego";

  const fila = {
    usuario_id,
    jornada_id:           idOrNull(body.jornada_id),
    fecha_local:          dateOrNull(body.fecha_local),
    tipo,
    cantidad_l_m2:        numOrNull(body.cantidad_l_m2),
    producto_id:          clean(body.producto_id,      80),
    producto_nombre:      clean(body.producto_nombre, 160),
    sustancia_activa:     clean(body.sustancia_activa,160),
    dosis:                clean(body.dosis,            80),
    cultivo:              clean(body.cultivo,          60),
    plazo_seguridad_dias: intOrNull(body.plazo_seguridad_dias),
    fue_otro:             Boolean(body.fue_otro),
    motivo:               clean(body.motivo,           40),
    coste_estimado_eur:   numOrNull(body.coste_estimado_eur),
    notas:                clean(body.notas,           500),
  };

  console.log("[acciones]", JSON.stringify({ usuario_id, tipo, cantidad: fila.cantidad_l_m2, producto: fila.producto_nombre }));

  if (!isConfigured()) {
    return res.status(200).json({ ok: true, persisted: false, reason: "supabase_not_configured" });
  }

  try {
    const filas = await supabaseInsert("acciones", fila);
    return res.status(200).json({ ok: true, persisted: true, accion: filas?.[0] || null });
  } catch (err) {
    console.error("[acciones] error:", err.message);
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
function intOrNull(v) {
  const n = numOrNull(v);
  return n == null ? null : Math.trunc(n);
}
function idOrNull(v) {
  const n = intOrNull(v);
  return n != null && n > 0 ? n : null;
}
function dateOrNull(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
