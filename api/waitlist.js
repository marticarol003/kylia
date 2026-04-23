// Endpoint para capturar emails de la lista de espera.
//
// Funciona sin configuración: registra el contacto en los logs de Vercel y
// responde 200. Para recibir los emails en tu buzón, configura una de estas
// variables de entorno en el dashboard de Vercel:
//
//   WAITLIST_WEBHOOK_URL   → URL (Zapier / Make / Discord / Slack) que recibe
//                            el JSON por POST.
//   WAITLIST_FORWARD_EMAIL → Email destino, requiere también RESEND_API_KEY.
//   RESEND_API_KEY         → Clave de Resend.com (plan gratuito 100 emails/día).
//
// Si ninguna está configurada el endpoint funciona igual, pero los contactos
// solo quedan en los logs del servidor (Vercel → Deployments → Logs).

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  // Parseo defensivo del body (Vercel ya lo parsea si Content-Type es JSON)
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  const email = (body.email || "").toString().trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "email inválido" });
  }

  const nombre       = (body.nombre       || "").toString().trim().slice(0, 120);
  const organizacion = (body.organizacion || "").toString().trim().slice(0, 160);

  const contacto = {
    email,
    nombre,
    organizacion,
    fecha:  new Date().toISOString(),
    ip:     req.headers["x-forwarded-for"] || req.socket?.remoteAddress || null,
    origen: req.headers.referer || null,
  };

  // 1) Siempre log — queda grabado en los logs de Vercel
  console.log("[waitlist]", JSON.stringify(contacto));

  // 2) Webhook opcional
  if (process.env.WAITLIST_WEBHOOK_URL) {
    try {
      await fetch(process.env.WAITLIST_WEBHOOK_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(contacto),
      });
    } catch (err) {
      console.error("[waitlist] webhook falló:", err.message);
    }
  }

  // 3) Reenvío por email vía Resend (opcional)
  if (process.env.RESEND_API_KEY && process.env.WAITLIST_FORWARD_EMAIL) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          from:    "Kylia waitlist <onboarding@resend.dev>",
          to:      [process.env.WAITLIST_FORWARD_EMAIL],
          subject: `Nueva lista de espera: ${email}`,
          text:
            `Nuevo contacto en la lista de espera de Kylia\n\n` +
            `Email:         ${email}\n` +
            `Nombre:        ${nombre        || "(sin nombre)"}\n` +
            `Organización:  ${organizacion  || "(sin organización)"}\n` +
            `Fecha:         ${contacto.fecha}\n` +
            `Origen:        ${contacto.origen || "(desconocido)"}\n`,
        }),
      });
    } catch (err) {
      console.error("[waitlist] Resend falló:", err.message);
    }
  }

  return res.status(200).json({ ok: true });
};
