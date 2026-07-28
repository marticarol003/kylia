// Recordatorio vespertino: invita al piloto a cerrar el diario de la jornada.
//
// Cron Vercel diario a las 17:00 UTC (= 19:00 CEST en verano, 18:00 CET en
// invierno). Distinto del cron de las 06:00 UTC (`recordatorio-diario.js`),
// que envía la recomendación agronómica para modo demo.
//
// Lógica:
//   1) Lee PILOTOS_JSON (la misma lista que `recordatorio-diario.js`).
//   2) Por cada piloto, consulta Supabase: ¿hay fila en `jornadas` para
//      su usuario_id y hoy?  Si sí → skip (ya cerró).
//   3) Si no → envía email cortísimo con un único CTA que abre la app
//      con `?diario=1`, lo que hace que el wizard se abra solo.
//
// Para test manual: GET /api/recordatorio-wizard?dry=1
// (calcula y devuelve qué se enviaría, sin enviar nada).

const { isConfigured, supabaseSelect } = require("./_supabase.js");

const APP_URL = "https://kylia.app/app";

function emailHtml({ nombre }) {
  const saludo = nombre ? `Hola ${nombre},` : "Hola,";
  const fecha  = new Date().toLocaleDateString("es-ES", {
    weekday: "long", day: "numeric", month: "long",
  });
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;color:#1f2a1f;line-height:1.5;padding:24px;max-width:520px;margin:0 auto;">
    <h1 style="margin:0 0 4px;font-size:1.1rem;color:#0b1f13;">🌱 Kylia · diario de hoy</h1>
    <p style="color:#5a685a;font-size:0.9rem;margin:0 0 18px;">${fecha}</p>
    <p style="margin:0 0 14px;">${saludo}</p>
    <p style="margin:0 0 16px;">¿Cómo ha ido tu jornada? Cuéntamelo en 30 segundos, son solo 4 preguntas.</p>
    <p style="margin:0 0 12px;">
      <a href="${APP_URL}?diario=1"
         style="background:#1f5a2b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600;font-size:1rem;">
        📝 Abrir y responder →
      </a>
    </p>
    <p style="font-size:0.85rem;color:#5a685a;margin:18px 0 0;">Tu respuesta ayuda a mejorar el piloto. Gracias por colaborar.</p>
    <p style="font-size:0.78rem;color:#5a685a;margin-top:24px;">¿No quieres recibir más estos recordatorios? Responde a este email con "BAJA" y te quito de la lista. · <a href="https://kylia.app/legal/privacidad" style="color:#5a685a;">Privacidad</a></p>
  </body></html>`;
}

async function enviarEmail({ to, nombre }) {
  await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      from:    process.env.RECORDATORIO_FROM_EMAIL || "Kylia <onboarding@resend.dev>",
      to:      [to],
      subject: "Kylia · ¿cómo ha ido tu jornada hoy?",
      html:    emailHtml({ nombre }),
    }),
  });
}

// Devuelve true si el piloto ya cerró su diario hoy.
async function yaRespondioHoy(email) {
  if (!isConfigured() || !email) return false;
  try {
    // 1) buscar uuid en usuarios por email
    const usuarios = await supabaseSelect(
      "usuarios",
      `email=eq.${encodeURIComponent(email.toLowerCase())}&select=id`
    );
    if (!usuarios.length) return false;
    const usuarioId = usuarios[0].id;

    // 2) buscar jornada de hoy
    const hoyIso = new Date().toISOString().slice(0, 10);
    const jornadas = await supabaseSelect(
      "jornadas",
      `usuario_id=eq.${usuarioId}&fecha=eq.${hoyIso}&select=id`
    );
    return jornadas.length > 0;
  } catch (err) {
    console.error("[recordatorio-wizard] error consulta supabase:", err.message);
    return false; // ante duda, enviar
  }
}

module.exports = async (req, res) => {
  if (process.env.RECORDATORIO_TOKEN) {
    const token   = (req.query?.token || req.headers["x-recordatorio-token"] || "").toString();
    const authHdr = (req.headers.authorization || "").toString();
    if (token !== process.env.RECORDATORIO_TOKEN && authHdr !== `Bearer ${process.env.RECORDATORIO_TOKEN}`) {
      return res.status(401).json({ error: "no autorizado" });
    }
  }

  const dry = String(req.query?.dry || "") === "1";

  let pilotos = [];
  try {
    pilotos = JSON.parse(process.env.PILOTOS_JSON || "[]");
  } catch (_) {
    pilotos = [];
  }

  if (!pilotos.length) {
    console.log("[recordatorio-wizard] sin pilotos configurados (PILOTOS_JSON vacío)");
    return res.status(200).json({ ok: true, enviados: 0, aviso: "PILOTOS_JSON vacío" });
  }

  const resultados = [];
  for (const p of pilotos) {
    if (!p.email) {
      resultados.push({ email: "?", error: "falta email" });
      continue;
    }
    try {
      const yaCerrado = await yaRespondioHoy(p.email);
      const fila = { email: p.email, nombre: p.nombre || null, yaCerrado };
      if (yaCerrado) {
        fila.enviado = false;
        fila.aviso = "ya cerró el diario hoy";
        resultados.push(fila);
        continue;
      }
      if (!dry) {
        if (process.env.RESEND_API_KEY) {
          await enviarEmail({ to: p.email, nombre: p.nombre });
          fila.enviado = true;
        } else {
          fila.enviado = false;
          fila.aviso = "RESEND_API_KEY no configurada";
        }
      } else {
        fila.enviado = false;
        fila.dry = true;
      }
      resultados.push(fila);
    } catch (err) {
      resultados.push({ email: p.email, error: err.message });
    }
  }

  console.log("[recordatorio-wizard]", JSON.stringify({ dry, resultados }));
  return res.status(200).json({ ok: true, dry, total: pilotos.length, resultados });
};
