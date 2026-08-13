// ─────────────────────────────────────────────────────────────────
// /api/pago — precio, alta de suscripción y webhook de Stripe
// ─────────────────────────────────────────────────────────────────
//   GET  /api/pago?usuario_id=…            → qué le tocaría pagar, y por qué
//   POST /api/pago {accion:"checkout"}     → sesión de pago alojada en Stripe
//   POST /api/pago {accion:"portal"}       → portal de cliente (baja, tarjeta, facturas)
//   POST /api/pago  (con stripe-signature) → webhook: activa o corta la suscripción
//
// ESTO ES EL ESQUELETO. Sin STRIPE_SECRET_KEY todo responde `configurado:false`
// y no cobra a nadie; el cálculo del precio sí funciona ya, porque no necesita
// Stripe para nada y conviene poder enseñarlo antes de encender el cobro.
//
// ⚠️ ANTES DE COBRAR UN SOLO EURO, y no son detalles de implementación:
//   · Vercel Hobby y CallMeBot PROHÍBEN el uso comercial. Hay que pasar a
//     planes comerciales, no es opcional.
//   · /precios promete "gratis durante el piloto" y "app completa gratis de por
//     vida al cerrar". Los pilotos de 2026 tienen esa gratuidad GANADA: por eso
//     existe la columna `gratuito_de_por_vida` y se marca ANTES de encender esto.
//   · Facturación española (numeración, datos fiscales, sistemas de facturación
//     verificable): confírmalo con un gestor. Stripe emite facturas, pero quien
//     responde de que cumplan la norma de aquí eres tú.
//   · La política de privacidad necesita a Stripe como subencargado.

const { isConfigured, supabaseSelect, supabaseUpdate } = require("./_supabase.js");
const PRECIO = require("./_precio.js");
const STRIPE = require("./_stripe.js");

const ES_UUID  = /^[0-9a-f-]{36}$/i;
const BASE_URL = process.env.APP_BASE_URL || "https://kylia.app";

// El webhook necesita el cuerpo TAL CUAL llegó para poder verificar la firma; si
// el runtime lo parsea y lo vuelve a serializar, la firma ya no cuadra aunque el
// JSON sea equivalente. Por eso este endpoint no puede colgar de /api/log (que
// trabaja con el cuerpo ya parseado) y por eso se apaga el parser aquí.
module.exports.config = { api: { bodyParser: false } };

function leerCuerpoCrudo(req) {
  return new Promise((resolve, reject) => {
    if (typeof req.body === "string") return resolve(req.body);
    if (req.body && typeof req.body === "object") return resolve(JSON.stringify(req.body));
    let datos = "";
    req.on("data", t => { datos += t; if (datos.length > 1e6) req.destroy(); });
    req.on("end", () => resolve(datos));
    req.on("error", reject);
  });
}

// Todas las parcelas de la persona: cada fila de `usuarios` con su propietario
// es una parcela, y la suma de sus áreas es lo que se factura.
async function zonasDe(propietarioId) {
  return (await supabaseSelect("usuarios",
    `propietario_id=eq.${propietarioId}&select=id,area_m2,gratuito_de_por_vida,email,suscripcion_estado,stripe_customer_id`)) || [];
}

async function calcularPara(usuarioId) {
  const filas = await supabaseSelect("usuarios",
    `id=eq.${usuarioId}&select=id,propietario_id,email,gratuito_de_por_vida,suscripcion_estado,stripe_customer_id`);
  const u = filas?.[0];
  if (!u) return null;

  const propietarioId = u.propietario_id || u.id;
  const zonas = await zonasDe(propietarioId);
  // La gratuidad es de la PERSONA: basta con que esté marcada en cualquiera de
  // sus filas para que no se le cobre por ninguna.
  const gratis = zonas.some(z => z.gratuito_de_por_vida) || !!u.gratuito_de_por_vida;

  const p = PRECIO.precioAnual(zonas, { gratuitoDePorVida: gratis });
  return { u, propietarioId, zonas, precio: p, explicacion: PRECIO.explicacion(p) };
}

async function handleGet(req, res) {
  const usuarioId = (req.query?.usuario_id || "").toString().trim();
  if (!ES_UUID.test(usuarioId)) return res.status(400).json({ error: "usuario_id inválido (UUID)" });
  if (!isConfigured()) return res.status(200).json({ ok: false, reason: "supabase_not_configured" });

  const r = await calcularPara(usuarioId);
  if (!r) return res.status(404).json({ ok: false, error: "usuario no encontrado" });

  return res.status(200).json({
    ok: true,
    configurado: STRIPE.configurado(),
    propietario_id: r.propietarioId,
    parcelas: r.zonas.length,
    precio: r.precio,
    explicacion: r.explicacion,
    prorrateo_primer_anio: r.precio.cobrable
      ? PRECIO.prorrateoHastaFinDeAnio(r.precio.total_cent)
      : null,
    estado: r.u.suscripcion_estado || "sin_suscripcion",
  });
}

async function handleCheckout(req, res, body) {
  const usuarioId = (body.usuario_id || "").toString().trim();
  if (!ES_UUID.test(usuarioId)) return res.status(400).json({ error: "usuario_id inválido (UUID)" });
  if (!STRIPE.configurado()) return res.status(200).json({ ok: false, reason: "stripe_no_configurado" });

  const r = await calcularPara(usuarioId);
  if (!r) return res.status(404).json({ ok: false, error: "usuario no encontrado" });
  if (!r.precio.cobrable) {
    // No es un error: a un piloto con gratuidad ganada NO se le abre una pasarela.
    return res.status(200).json({ ok: true, cobrar: false, motivo: r.precio.motivo, explicacion: r.explicacion });
  }

  const sesion = await STRIPE.crearCheckout({
    propietarioId: r.propietarioId,
    email: r.u.email,
    importeCent: r.precio.total_cent,
    hectareas: r.precio.hectareas,
    exito:    `${BASE_URL}/app?pago=ok`,
    cancelar: `${BASE_URL}/app?pago=cancelado`,
  });
  if (!sesion.ok) return res.status(502).json({ ok: false, error: sesion.error });
  return res.status(200).json({ ok: true, cobrar: true, url: sesion.data.url });
}

async function handlePortal(req, res, body) {
  const usuarioId = (body.usuario_id || "").toString().trim();
  if (!ES_UUID.test(usuarioId)) return res.status(400).json({ error: "usuario_id inválido (UUID)" });
  if (!STRIPE.configurado()) return res.status(200).json({ ok: false, reason: "stripe_no_configurado" });

  const r = await calcularPara(usuarioId);
  const customer = r?.u?.stripe_customer_id || r?.zonas.find(z => z.stripe_customer_id)?.stripe_customer_id;
  if (!customer) return res.status(400).json({ ok: false, error: "sin cliente de Stripe todavía" });

  const portal = await STRIPE.crearPortal({ customerId: customer, volverA: `${BASE_URL}/app` });
  if (!portal.ok) return res.status(502).json({ ok: false, error: portal.error });
  return res.status(200).json({ ok: true, url: portal.data.url });
}

// ── Webhook ────────────────────────────────────────────────────────
// La verdad del cobro la tiene Stripe, no el navegador: volver a /app?pago=ok
// no prueba nada (esa URL la puede escribir cualquiera). Lo único que activa una
// suscripción es este webhook, con su firma verificada.
//
// Se responde 200 en cuanto se entiende el evento, incluso si no se hace nada
// con él: un 500 hace que Stripe reintente durante días.
async function handleWebhook(req, res, crudo) {
  const firma = req.headers["stripe-signature"];
  const v = STRIPE.verificarFirma(crudo, firma);
  if (!v.ok) {
    console.warn("[pago] webhook rechazado:", v.error);
    return res.status(400).json({ ok: false, error: v.error });
  }

  let evento;
  try { evento = JSON.parse(crudo); } catch (_) { return res.status(400).json({ ok: false }); }

  const objeto = evento?.data?.object || {};
  const propietarioId = objeto.client_reference_id
    || objeto.metadata?.propietario_id
    || objeto.subscription_details?.metadata?.propietario_id
    || null;

  const ESTADOS = {
    "checkout.session.completed":    "activa",
    "customer.subscription.updated": null,      // el estado lo trae el objeto
    "customer.subscription.deleted": "cancelada",
    "invoice.payment_failed":        "impago",
  };
  if (!(evento.type in ESTADOS)) {
    return res.status(200).json({ ok: true, ignorado: evento.type });
  }
  if (!propietarioId || !ES_UUID.test(propietarioId)) {
    console.warn("[pago] evento sin propietario_id utilizable:", evento.type);
    return res.status(200).json({ ok: true, sin_propietario: true });
  }

  const estado = ESTADOS[evento.type] || (objeto.status === "active" ? "activa" : objeto.status || "desconocido");
  try {
    await supabaseUpdate("usuarios", `propietario_id=eq.${propietarioId}`, {
      suscripcion_estado: estado,
      stripe_customer_id: objeto.customer || undefined,
      suscripcion_actualizada: new Date().toISOString(),
    });
    console.log("[pago]", evento.type, "→", estado, propietarioId);
  } catch (err) {
    // Aquí sí conviene fallar: si no se pudo escribir, que Stripe reintente.
    console.error("[pago] no se pudo actualizar:", err.message);
    return res.status(500).json({ ok: false });
  }
  return res.status(200).json({ ok: true, estado });
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    try { return await handleGet(req, res); }
    catch (err) { console.error("[pago] GET:", err.message); return res.status(500).json({ ok: false }); }
  }
  if (req.method !== "POST") return res.status(405).json({ error: "método no permitido" });

  const crudo = await leerCuerpoCrudo(req);
  if (req.headers["stripe-signature"]) {
    try { return await handleWebhook(req, res, crudo); }
    catch (err) { console.error("[pago] webhook:", err.message); return res.status(500).json({ ok: false }); }
  }

  let body;
  try { body = JSON.parse(crudo || "{}"); } catch (_) { return res.status(400).json({ error: "JSON inválido" }); }
  if (!isConfigured()) return res.status(200).json({ ok: false, reason: "supabase_not_configured" });

  try {
    const accion = (body.accion || "").toString();
    if (accion === "checkout") return await handleCheckout(req, res, body);
    if (accion === "portal")   return await handlePortal(req, res, body);
    return res.status(400).json({ error: "accion debe ser 'checkout' o 'portal'" });
  } catch (err) {
    console.error("[pago] POST:", err.message);
    return res.status(500).json({ ok: false });
  }
};
module.exports.config = { api: { bodyParser: false } };
