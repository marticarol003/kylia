// Endpoint consolidado para todas las trazas del piloto silencioso.
//
// El frontend (window.kyliaSync) hace POST aquí con un campo `recurso`
// que enruta internamente a uno de los handlers. Se consolidaron en un
// solo serverless function para no superar el límite del plan Hobby
// de Vercel (12 funciones máximo).
//
// Recursos soportados:
//   registro-usuario, acciones, observaciones, jornadas,
//   mediciones, recomendaciones-log, eventos

const {
  isConfigured, supabaseInsert, supabaseUpdate, supabaseSelect,
  parseBody, preludio,
} = require("./_supabase.js");

const HANDLERS = {
  "registro-usuario":    handleRegistroUsuario,
  "acciones":            handleAcciones,
  "observaciones":       handleObservaciones,
  "jornadas":            handleJornadas,
  "mediciones":          handleMediciones,
  "recomendaciones-log": handleRecomendacionesLog,
  "eventos":             handleEventos,
};

const METODOS_RIEGO = new Set(["goteo", "aspersion", "surco", "manguera", "regadera"]);
const FRANJAS       = new Set(["manana", "mediodia", "tarde", "noche"]);
const MANEJOS       = new Set(["convencional", "ecologico"]);
const SUELOS        = new Set(["arenoso", "franco", "arcilloso"]);

module.exports = async (req, res) => {
  if (!preludio(req, res, "POST")) return;
  const body = parseBody(req);
  const recurso = (body.recurso || "").toString();
  const handler = HANDLERS[recurso];
  if (!handler) {
    return res.status(400).json({ error: `recurso desconocido: ${recurso}` });
  }
  return handler(req, res, body);
};

// ─── registro-usuario ──────────────────────────────────────────────
async function handleRegistroUsuario(req, res, body) {
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
    cultivos:             Array.isArray(body.cultivos)
                            ? body.cultivos.map(c => String(c).slice(0, 60)).slice(0, 20)
                            : [],
    cultivos_secundarios: clean(body.cultivos_secundarios, 200),
    parcela:              body.parcela && typeof body.parcela === "object" ? body.parcela : null,
    tarifa_agua:          numOrNull(body.tarifa_agua),
    metodo_riego:         METODOS_RIEGO.has(body.metodo_riego) ? body.metodo_riego : null,
    manejo:               MANEJOS.has(body.manejo) ? body.manejo : null,
    suelo:                SUELOS.has(body.suelo) ? body.suelo : null,
    fecha_plantacion:     dateOrNull(body.fecha_plantacion),
    caudal:               numOrNull(body.caudal),
    area_m2:              numOrNull(body.area_m2),
    capacidad_regadera:   numOrNull(body.capacidad_regadera),
    origen:               clean(body.origen,       120)                 || null,
    piloto_sombra:        body.piloto_sombra === undefined ? undefined : Boolean(body.piloto_sombra),
    preferencias: body.preferencias && typeof body.preferencias === "object" ? body.preferencias : {},
    ua:           clean(req.headers["user-agent"], 400)         || null,
  };

  console.log("[registro-usuario]", JSON.stringify({ id, nombre: fila.nombre, email: fila.email, cultivos: fila.cultivos, origen: fila.origen }));

  if (!isConfigured()) {
    return res.status(200).json({ ok: true, persisted: false, reason: "supabase_not_configured" });
  }

  try {
    const filas = await supabaseInsert("usuarios", fila, { upsert: true });
    return res.status(200).json({ ok: true, persisted: true, usuario: filas?.[0] || null });
  } catch (err) {
    console.error("[registro-usuario] error:", err.message);
    return res.status(500).json({ ok: false, error: "no se pudo guardar", detalle: body.debug ? err.message : undefined });
  }
}

// ─── acciones (riego o aplicación) ─────────────────────────────────
async function handleAcciones(req, res, body) {
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
    franja_horaria:       FRANJAS.has(body.franja_horaria) ? body.franja_horaria : null,
    duracion_min:         intOrNull(body.duracion_min),
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
}

// ─── observaciones (plaga, enfermedad, estrés, otro) ───────────────
const OBS_TIPOS = new Set(["plaga", "enfermedad", "estres", "otro"]);

async function handleObservaciones(req, res, body) {
  const usuario_id = (body.usuario_id || "").toString().trim();
  if (!/^[0-9a-f-]{36}$/i.test(usuario_id)) {
    return res.status(400).json({ error: "usuario_id inválido" });
  }

  const tipo = OBS_TIPOS.has(body.tipo) ? body.tipo : "otro";

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
}

// ─── jornadas (cierre del diario diario) ───────────────────────────
const FUENTES_VALIDAS = new Set(["experiencia", "meteo", "asesor", "vecino", "rutina", "otro"]);

async function handleJornadas(req, res, body) {
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
}

// ─── mediciones (NDVI / NDMI / humedad suelo) ──────────────────────
async function handleMediciones(req, res, body) {
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
}

// ─── recomendaciones-log (shadow log) ──────────────────────────────
const REC_TIPOS = new Set(["riego", "tratamiento", "nutricion"]);
const REC_NIVELES = new Set(["alta", "media", "baja"]);

async function handleRecomendacionesLog(req, res, body) {
  const usuario_id = (body.usuario_id || "").toString().trim();
  if (!/^[0-9a-f-]{36}$/i.test(usuario_id)) {
    return res.status(400).json({ error: "usuario_id inválido" });
  }

  const lista = Array.isArray(body.recomendaciones) ? body.recomendaciones
              : body.recomendacion ? [body.recomendacion]
              : [];

  if (lista.length === 0) {
    return res.status(400).json({ error: "sin recomendaciones en el payload" });
  }

  const filas = lista.map(r => ({
    usuario_id,
    tipo:               REC_TIPOS.has(r.tipo)    ? r.tipo  : "riego",
    texto:              clean(r.texto,             500),
    cantidad_l_m2:      numOrNull(r.cantidad_l_m2),
    producto_id:        clean(r.producto_id,        80),
    producto_nombre:    clean(r.producto_nombre,   160),
    dosis:              clean(r.dosis,              80),
    nivel:              REC_NIVELES.has(r.nivel) ? r.nivel : null,
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
}

// ─── eventos (telemetría) ──────────────────────────────────────────
async function handleEventos(req, res, body) {
  const nombre = clean(body.nombre, 80);
  if (!nombre) return res.status(400).json({ error: "nombre evento requerido" });

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
    console.log("[eventos]", JSON.stringify({ usuario_id, nombre, props: fila.props }));
    return res.status(200).json({ ok: true, persisted: false });
  }

  try {
    await supabaseInsert("eventos", fila);
    return res.status(200).json({ ok: true, persisted: true });
  } catch (err) {
    console.error("[eventos] error:", err.message);
    return res.status(200).json({ ok: false, error: "no se pudo guardar" });
  }
}

// ─── Helpers comunes ───────────────────────────────────────────────
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
function sevOrNull(v) {
  if (v == null || v === "") return null;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(5, n));
}
