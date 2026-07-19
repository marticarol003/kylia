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
  isConfigured, supabaseInsert, supabaseUpdate, supabaseSelect, supabaseDelete,
  parseBody, preludio,
} = require("./_supabase.js");

const HANDLERS = {
  "registro-usuario":    handleRegistroUsuario,
  "acciones":            handleAcciones,
  "borrar-accion":       handleBorrarAccion,
  "observaciones":       handleObservaciones,
  "jornadas":            handleJornadas,
  "mediciones":          handleMediciones,
  "recomendaciones-log": handleRecomendacionesLog,
  "eventos":             handleEventos,
  "pauta-goteo":         handlePautaGoteo,
  "push-sub":            handlePushSub,
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
    // Protección anti-sobreescritura de pilotos. La app hace upsert de la fila
    // ENTERA por el UUID de localStorage; si un dispositivo reutiliza el id de un
    // piloto silencioso, lo pisa (así se perdió el piloto de tomate de Breda: su
    // fila quedó con otro email/cultivo). Si la fila existente es piloto_sombra=
    // true y su email NO coincide con el entrante, es una colisión de id → no la
    // tocamos y devolvemos 409 en vez de destruir el piloto.
    const previa = (await supabaseSelect("usuarios", `id=eq.${id}&select=email,piloto_sombra`))[0];
    if (previa && previa.piloto_sombra && previa.email !== fila.email) {
      console.warn("[registro-usuario] colisión con piloto silencioso, no se sobrescribe:", id);
      return res.status(409).json({ ok: false, reason: "pilot_collision", protegido: true });
    }

    const filas = await supabaseInsert("usuarios", fila, { upsert: true });
    return res.status(200).json({ ok: true, persisted: true, usuario: filas?.[0] || null });
  } catch (err) {
    console.error("[registro-usuario] error:", err.message);
    return res.status(500).json({ ok: false, error: "no se pudo guardar" });
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
    // Anti-doble-toque: un riego IDÉNTICO (mismo día, misma duración/cantidad)
    // insertado hace <90 s es el mismo botón pulsado dos veces, no un segundo
    // riego real (dos riegos reales el mismo día siguen entrando sin problema).
    // Vimos un triple registro así el 23-jun en el campo del padre.
    if (tipo === "riego" && fila.fecha_local) {
      const haceUnMomento = new Date(Date.now() - 90_000).toISOString();
      const dup = await supabaseSelect("acciones",
        `usuario_id=eq.${usuario_id}&tipo=eq.riego&fecha_local=eq.${fila.fecha_local}` +
        `&fecha=gte.${haceUnMomento}&select=id,duracion_min,cantidad_l_m2&limit=3`);
      const igual = (dup || []).find(d =>
        (d.duracion_min ?? null) === (fila.duracion_min ?? null) &&
        (d.cantidad_l_m2 ?? null) === (fila.cantidad_l_m2 ?? null));
      if (igual) {
        console.warn("[acciones] doble toque ignorado:", JSON.stringify({ usuario_id, fecha: fila.fecha_local, id: igual.id }));
        return res.status(200).json({ ok: true, persisted: true, duplicado: true, accion: igual });
      }
    }

    const filas = await supabaseInsert("acciones", fila);
    return res.status(200).json({ ok: true, persisted: true, accion: filas?.[0] || null });
  } catch (err) {
    console.error("[acciones] error:", err.message);
    return res.status(500).json({ ok: false, error: "no se pudo guardar" });
  }
}

// ─── borrar-accion (deshacer un riego/aplicación mal apuntado) ─────
// Borra una fila de `acciones` por id, SIEMPRE acotado al usuario_id que la
// posee (así nadie puede borrar filas de otro adivinando ids). `acciones` no
// es append-only (solo recomendaciones_log lo es), así que corregir el propio
// registro real es legítimo.
async function handleBorrarAccion(req, res, body) {
  const usuario_id = (body.usuario_id || "").toString().trim();
  if (!/^[0-9a-f-]{36}$/i.test(usuario_id)) {
    return res.status(400).json({ error: "usuario_id inválido" });
  }
  const id = intOrNull(body.id ?? body.accion_id);
  if (id == null || id <= 0) return res.status(400).json({ error: "id de acción inválido" });

  console.log("[borrar-accion]", JSON.stringify({ usuario_id, id }));

  if (!isConfigured()) {
    return res.status(200).json({ ok: true, persisted: false, reason: "supabase_not_configured" });
  }

  try {
    const borradas = await supabaseDelete("acciones", `id=eq.${id}&usuario_id=eq.${usuario_id}`);
    const n = Array.isArray(borradas) ? borradas.length : 0;
    if (n === 0) return res.status(404).json({ ok: false, error: "no se encontró ese registro" });
    return res.status(200).json({ ok: true, persisted: true, borradas: n });
  } catch (err) {
    console.error("[borrar-accion] error:", err.message);
    return res.status(500).json({ ok: false, error: "no se pudo borrar" });
  }
}

// ─── pauta-goteo (admin: cambia la pauta de riego automático) ──────
// Los pilotos de goteo cambian el programador (min/frecuencia) y lo avisan
// por WhatsApp; sin esto solo se podía actualizar con SQL a mano. Protegido
// con PILOTOS_KEY (misma llave que el panel /pilotos). Solo toca los campos
// riego_auto_* y caudal — nunca el resto de la fila (a diferencia del upsert
// de registro-usuario).
async function handlePautaGoteo(req, res, body) {
  const expected = (process.env.PILOTOS_KEY || "").trim();
  if (!expected) return res.status(200).json({ ok: false, reason: "pilotos_key_not_configured" });
  if ((body.key || "").toString() !== expected) return res.status(403).json({ ok: false, error: "key inválida" });

  const usuario_id = (body.usuario_id || "").toString().trim();
  if (!/^[0-9a-f-]{36}$/i.test(usuario_id)) {
    return res.status(400).json({ error: "usuario_id inválido" });
  }

  const patch = {};
  if (body.riego_auto !== undefined)           patch.riego_auto           = Boolean(body.riego_auto);
  if (body.riego_auto_desde !== undefined)     patch.riego_auto_desde     = dateOrNull(body.riego_auto_desde);
  if (body.riego_auto_cada_dias !== undefined) patch.riego_auto_cada_dias = intOrNull(body.riego_auto_cada_dias);
  if (body.riego_auto_min !== undefined)       patch.riego_auto_min       = intOrNull(body.riego_auto_min);
  if (body.caudal !== undefined)               patch.caudal               = numOrNull(body.caudal);
  if (!Object.keys(patch).length) return res.status(400).json({ error: "nada que actualizar" });

  console.log("[pauta-goteo]", JSON.stringify({ usuario_id, patch }));

  if (!isConfigured()) {
    return res.status(200).json({ ok: true, persisted: false, reason: "supabase_not_configured" });
  }

  try {
    const filas = await supabaseUpdate("usuarios", `id=eq.${usuario_id}`, patch);
    if (!Array.isArray(filas) || filas.length === 0) {
      return res.status(404).json({ ok: false, error: "usuario no encontrado" });
    }
    const u = filas[0];
    return res.status(200).json({
      ok: true, persisted: true,
      pauta: {
        riego_auto: u.riego_auto, riego_auto_desde: u.riego_auto_desde,
        riego_auto_cada_dias: u.riego_auto_cada_dias, riego_auto_min: u.riego_auto_min,
        caudal: u.caudal,
      },
    });
  } catch (err) {
    console.error("[pauta-goteo] error:", err.message);
    return res.status(500).json({ ok: false, error: "no se pudo actualizar" });
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

// ─── push-sub (suscripción de push web del navegador) ──────────────
// La envía /campo al pulsar "Activar avisos". Upsert por endpoint (si el
// navegador renueva la suscripción, la fila vieja se sustituye). Las muertas
// las poda /api/aviso-lechugas al recibir 404/410 del servicio push.
async function handlePushSub(req, res, body) {
  const usuario_id = (body.usuario_id || "").toString().trim();
  if (!/^[0-9a-f-]{36}$/i.test(usuario_id)) {
    return res.status(400).json({ error: "usuario_id inválido" });
  }
  const endpoint = (body.endpoint || "").toString();
  const p256dh   = clean(body.p256dh, 300);
  const auth     = clean(body.auth,   120);
  if (!/^https:\/\/.{10,600}$/.test(endpoint) || !p256dh || !auth) {
    return res.status(400).json({ error: "suscripción incompleta" });
  }

  const fila = { usuario_id, endpoint, p256dh, auth, etiqueta: clean(body.etiqueta, 120) };
  console.log("[push-sub]", JSON.stringify({ usuario_id, etiqueta: fila.etiqueta }));

  if (!isConfigured()) {
    return res.status(200).json({ ok: true, persisted: false, reason: "supabase_not_configured" });
  }

  try {
    await supabaseDelete("push_subs", `endpoint=eq.${encodeURIComponent(endpoint)}`);
    // Tope por usuario: un hogar son 2-3 móviles; sin tope, cualquiera podría
    // inflar la tabla y el aviso diario acabaría enviando a endpoints basura.
    const actuales = await supabaseSelect("push_subs", `usuario_id=eq.${usuario_id}&select=id`);
    if (Array.isArray(actuales) && actuales.length >= 10) {
      return res.status(429).json({ ok: false, error: "demasiadas suscripciones para este usuario" });
    }
    await supabaseInsert("push_subs", fila);
    return res.status(200).json({ ok: true, persisted: true });
  } catch (err) {
    console.error("[push-sub] error:", err.message);
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
