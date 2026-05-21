// Endpoint para recibir feedback in-app del piloto.
//
// Misma estrategia que /api/waitlist:
//   1) Siempre log en Vercel (queda recuperable en Deployments → Logs).
//   2) Webhook opcional (Zapier / Slack / Discord) vía FEEDBACK_WEBHOOK_URL.
//   3) Email opcional vía Resend si RESEND_API_KEY + FEEDBACK_FORWARD_EMAIL.
//
// Sin claves configuradas, el endpoint sigue funcionando — solo loguea.

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  const texto = (body.texto || "").toString().trim().slice(0, 2000);
  if (texto.length < 4) {
    return res.status(400).json({ error: "texto demasiado corto" });
  }

  const tiposValidos = ["problema", "sugerencia", "duda", "otro"];
  const tipo = tiposValidos.includes(body.tipo) ? body.tipo : "otro";

  const registro = {
    tipo,
    texto,
    email:    (body.email   || "").toString().trim().toLowerCase().slice(0, 200) || null,
    nombre:   (body.nombre  || "").toString().trim().slice(0, 120) || null,
    contexto: body.contexto && typeof body.contexto === "object" ? body.contexto : {},
    ua:       (body.ua  || "").toString().slice(0, 400),
    url:      (body.url || "").toString().slice(0, 400),
    fecha:    new Date().toISOString(),
    ip:       req.headers["x-forwarded-for"] || req.socket?.remoteAddress || null,
  };

  // 1) Log siempre
  console.log("[feedback]", JSON.stringify(registro));

  // 2) Webhook opcional
  if (process.env.FEEDBACK_WEBHOOK_URL) {
    try {
      await fetch(process.env.FEEDBACK_WEBHOOK_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(registro),
      });
    } catch (err) {
      console.error("[feedback] webhook falló:", err.message);
    }
  }

  // 3) Reenvío por email vía Resend (opcional)
  if (process.env.RESEND_API_KEY && process.env.FEEDBACK_FORWARD_EMAIL) {
    try {
      const ctx = registro.contexto || {};
      const lineasCtx = [
        ctx.cultivos     && `Cultivos:           ${(ctx.cultivos || []).join(", ")}`,
        ctx.ciudad       && `Ubicación:          ${ctx.ciudad}`,
        ctx.lat != null && ctx.lon != null && `Coordenadas:        ${ctx.lat}, ${ctx.lon}`,
        ctx.tieneParcela != null && `Parcela SIGPAC:     ${ctx.tieneParcela ? "sí" : "no"}`,
        ctx.ndvi != null  && `NDVI:               ${ctx.ndvi} (${ctx.ndviFecha || "?"})`,
        ctx.ndmi != null  && `NDMI:               ${ctx.ndmi}`,
        ctx.sueloHoy != null && `Humedad suelo:      ${(ctx.sueloHoy * 100).toFixed(0)}%`,
        ctx.et0Acumulada != null && `ET₀ acumulada:      ${ctx.et0Acumulada} mm`,
        ctx.ultimoRiego && `Último riego:       ${ctx.ultimoRiego}`,
        ctx.numAplicaciones != null && `Nº aplicaciones:    ${ctx.numAplicaciones}`,
      ].filter(Boolean).join("\n");

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          from:    "Kylia feedback <onboarding@resend.dev>",
          to:      [process.env.FEEDBACK_FORWARD_EMAIL],
          reply_to: registro.email || undefined,
          subject: `[Kylia ${tipo}] ${texto.slice(0, 60)}${texto.length > 60 ? "…" : ""}`,
          text:
            `Tipo:     ${tipo}\n` +
            `De:       ${registro.nombre || "(sin nombre)"} <${registro.email || "sin email"}>\n` +
            `Fecha:    ${registro.fecha}\n\n` +
            `${"-".repeat(40)}\n${texto}\n${"-".repeat(40)}\n\n` +
            `Contexto:\n${lineasCtx || "(sin contexto)"}\n\n` +
            `UA:  ${registro.ua}\n` +
            `URL: ${registro.url}\n`,
        }),
      });
    } catch (err) {
      console.error("[feedback] resend falló:", err.message);
    }
  }

  return res.status(200).json({ ok: true });
};
