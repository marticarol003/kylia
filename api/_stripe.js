// ─────────────────────────────────────────────────────────────────
// Stripe, hablado con fetch — sin SDK, como el resto de la casa
// ─────────────────────────────────────────────────────────────────
// Mismo patrón que _supabase.js y el envío de Resend: la API es HTTP y el SDK
// solo añadiría 4 MB de node_modules al bundle de una función serverless.
//
// POR QUÉ CHECKOUT ALOJADO Y NO UN FORMULARIO PROPIO. La tarjeta no toca nunca
// este servidor: la pide Stripe en su dominio. Eso saca a Kylia del alcance de
// PCI-DSS y resuelve el SCA europeo (la autenticación del banco) sin escribir
// una línea. El precio de esa comodidad es un salto de dominio, y a cambio no
// hay que auditar nada.
//
// Y el PORTAL DE CLIENTE por el mismo motivo: cambiar de tarjeta, ver facturas y
// darse de baja son tres pantallas que Stripe ya tiene hechas y que, si las
// escribes tú, tienes que mantener bien para siempre. Que el agricultor pueda
// cancelar sin escribirte un correo también es una decisión de producto: la baja
// difícil no retiene, solo enfada.
//
// Sin STRIPE_SECRET_KEY nada de esto se activa y los endpoints lo dicen.

const crypto = require("crypto");

const API = "https://api.stripe.com/v1";

function clave()      { return (process.env.STRIPE_SECRET_KEY || "").trim(); }
function firmaWebhook(){ return (process.env.STRIPE_WEBHOOK_SECRET || "").trim(); }
function configurado() { return clave().length > 0; }

// Stripe habla form-urlencoded, incluidos los objetos anidados: un
// `{ a: { b: 1 } }` viaja como `a[b]=1`. Aplanar aquí evita repetir esa forma
// en cada llamada.
function aFormulario(obj, prefijo = "", salida = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const clave = prefijo ? `${prefijo}[${k}]` : k;
    if (typeof v === "object" && !Array.isArray(v)) aFormulario(v, clave, salida);
    else if (Array.isArray(v)) v.forEach((item, i) => {
      if (typeof item === "object") aFormulario(item, `${clave}[${i}]`, salida);
      else salida.push(`${encodeURIComponent(`${clave}[${i}]`)}=${encodeURIComponent(item)}`);
    });
    else salida.push(`${encodeURIComponent(clave)}=${encodeURIComponent(v)}`);
  }
  return salida;
}

async function llamar(ruta, cuerpo, opts = {}) {
  if (!configurado()) return { ok: false, error: "stripe_no_configurado" };
  const cabeceras = {
    Authorization: `Bearer ${clave()}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  // Clave de idempotencia: si la red falla y el móvil reintenta, no se crean dos
  // suscripciones al mismo agricultor. Stripe devuelve la primera respuesta.
  if (opts.idempotencia) cabeceras["Idempotency-Key"] = opts.idempotencia;

  const res  = await fetch(`${API}${ruta}`, {
    method: "POST", headers: cabeceras, body: aFormulario(cuerpo).join("&"),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("[stripe]", ruta, res.status, data?.error?.message || "");
    return { ok: false, error: data?.error?.message || `http_${res.status}` };
  }
  return { ok: true, data };
}

// ── Sesión de pago ─────────────────────────────────────────────────
// El importe va calculado por nosotros (price_data), no como un `price` fijo del
// catálogo de Stripe: la tarifa depende de las hectáreas de CADA explotación y
// mantener un precio de catálogo por combinación sería inmanejable.
//
// El IVA se declara aparte con `tax_behavior: exclusive` — el precio de la
// tarifa es SIN IVA y Stripe lo añade. Ojo con esto al escribir la landing:
// muchos horticultores están en el régimen especial agrario y no recuperan el
// IVA soportado, así que para ellos el precio real es el de +21%.
async function crearCheckout({ propietarioId, email, importeCent, hectareas, exito, cancelar }) {
  return llamar("/checkout/sessions", {
    mode: "subscription",
    customer_email: email || undefined,
    // Ata el pago a la persona ANTES de que exista el pago: cuando llegue el
    // webhook, esto es lo único que dice a qué fila de `usuarios` aplicarlo.
    client_reference_id: propietarioId,
    metadata: { propietario_id: propietarioId, hectareas: String(hectareas) },
    subscription_data: { metadata: { propietario_id: propietarioId } },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "eur",
        unit_amount: importeCent,
        tax_behavior: "exclusive",
        recurring: { interval: "year" },
        product_data: { name: `Kylia Productor — ${hectareas} ha` },
      },
    }],
    success_url: exito,
    cancel_url: cancelar,
  }, { idempotencia: `checkout:${propietarioId}:${importeCent}` });
}

async function crearPortal({ customerId, volverA }) {
  return llamar("/billing_portal/sessions", { customer: customerId, return_url: volverA });
}

// ── Verificación de la firma del webhook ───────────────────────────
// Sin esto, el endpoint es "cualquiera puede decirme que Fulano ha pagado".
//
// Se firma `timestamp.payload` con HMAC-SHA256, y el payload tiene que ser el
// CUERPO CRUDO, byte a byte: si algo lo parsea y lo vuelve a serializar antes,
// la firma deja de cuadrar aunque el JSON sea equivalente. De ahí que el
// endpoint desactive el body parser.
//
// La tolerancia de 5 minutos es contra reenvíos: un webhook capturado y repetido
// mañana ya no cuela.
function verificarFirma(cuerpoCrudo, cabeceraFirma, tolerancia_s = 300) {
  const secreto = firmaWebhook();
  if (!secreto) return { ok: false, error: "sin_secreto" };
  if (!cuerpoCrudo || !cabeceraFirma) return { ok: false, error: "falta_firma" };

  const partes = String(cabeceraFirma).split(",").reduce((acc, p) => {
    const [k, v] = p.split("=");
    if (k === "t") acc.t = v;
    if (k === "v1") (acc.v1 = acc.v1 || []).push(v);
    return acc;
  }, {});
  if (!partes.t || !partes.v1?.length) return { ok: false, error: "firma_malformada" };

  const edad = Math.abs(Math.floor(Date.now() / 1000) - Number(partes.t));
  if (!Number.isFinite(edad) || edad > tolerancia_s) return { ok: false, error: "firma_caducada" };

  const esperada = crypto.createHmac("sha256", secreto)
    .update(`${partes.t}.${cuerpoCrudo}`, "utf8").digest("hex");

  // Comparación en tiempo constante: comparar con === filtra información sobre
  // cuántos bytes acertó quien lo intenta.
  const bufEsp = Buffer.from(esperada, "utf8");
  const alguna = partes.v1.some(v => {
    const bufV = Buffer.from(String(v), "utf8");
    return bufV.length === bufEsp.length && crypto.timingSafeEqual(bufV, bufEsp);
  });
  return alguna ? { ok: true } : { ok: false, error: "firma_no_coincide" };
}

module.exports = { configurado, crearCheckout, crearPortal, verificarFirma, aFormulario };
