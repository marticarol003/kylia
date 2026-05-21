// Recordatorio diario por email para pilotos.
//
// Cron Vercel diario (ver vercel.json). Sin claves/lista configurada, no envía
// nada — solo loguea, para que sea seguro tener el endpoint vivo sin riesgo.
//
// Cómo activarlo en producción:
//
//   1) RESEND_API_KEY                Clave de Resend.com (plan gratuito 100/día)
//   2) RECORDATORIO_FROM_EMAIL       Remitente verificado en Resend, ej: "Kylia <hola@kylia.app>"
//   3) PILOTOS_JSON                  JSON con la lista de pilotos:
//                                    [{"email":"x@y.com","nombre":"Eli","lat":41.38,"lon":2.17,"cultivos":["lechuga"]}]
//   4) RECORDATORIO_TOKEN            (Opcional) Secreto para invocaciones manuales.
//                                    Si se define, las llamadas necesitan ?token=...
//
// Para test manual: GET /api/recordatorio-diario?dry=1
// (dry=1 calcula y devuelve qué se enviaría, sin enviar nada).

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";

function decidirAccion({ et0AcumuladaSemana, lluviaPrevista3d }) {
  // Réplica simplificada del frontend, sin último riego real disponible.
  // Asume "hace 7 días" como referencia conservadora.
  if (et0AcumuladaSemana >= 30 && lluviaPrevista3d < 5) {
    return { nivel: "alta",  titulo: "Riega hoy",            detalle: `Se han evaporado ${et0AcumuladaSemana.toFixed(0)} mm en los últimos 7 días y no se esperan lluvias importantes.` };
  }
  if (et0AcumuladaSemana >= 15 && lluviaPrevista3d < 5) {
    return { nivel: "media", titulo: "Revisa el riego",     detalle: `Se han evaporado ${et0AcumuladaSemana.toFixed(0)} mm en los últimos 7 días. Si no has regado, conviene revisar.` };
  }
  if (lluviaPrevista3d >= 10) {
    return { nivel: "baja",  titulo: "No riegues, va a llover", detalle: `Se esperan ${lluviaPrevista3d.toFixed(0)} mm en los próximos 3 días.` };
  }
  return { nivel: "baja", titulo: "Todo en orden", detalle: "No hay alertas de riego para hoy. Abre la app para ver el detalle." };
}

async function fetchMeteo(lat, lon) {
  const url = `${OPEN_METEO_BASE}?latitude=${lat}&longitude=${lon}` +
              `&daily=et0_fao_evapotranspiration,precipitation_sum,temperature_2m_max` +
              `&timezone=auto&past_days=7&forecast_days=4`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("open-meteo " + res.status);
  return res.json();
}

function calcularDatosPiloto(meteo) {
  const daily = meteo?.daily || {};
  const fechas = daily.time || [];
  const et0    = daily.et0_fao_evapotranspiration || [];
  const lluvia = daily.precipitation_sum || [];
  const hoyIso = new Date().toISOString().slice(0, 10);

  // Índices: pasado = anteriores a hoy, futuro = desde hoy
  let et0AcumuladaSemana = 0;
  let lluviaPrevista3d = 0;
  fechas.forEach((d, i) => {
    if (d < hoyIso) et0AcumuladaSemana += (et0[i] || 0);
    if (d >= hoyIso && d <= hoyIso /* placeholder */) {}
  });
  // Lluvia: hoy + 2 días siguientes
  const idxHoy = fechas.indexOf(hoyIso);
  if (idxHoy >= 0) {
    for (let i = idxHoy; i < Math.min(idxHoy + 3, fechas.length); i++) {
      lluviaPrevista3d += (lluvia[i] || 0);
    }
  }
  return { et0AcumuladaSemana, lluviaPrevista3d };
}

function emailHtml({ nombre, accion }) {
  const color = accion.nivel === "alta" ? "#b91c1c" : accion.nivel === "media" ? "#b45309" : "#15803d";
  const saludo = nombre ? `Hola ${nombre},` : "Hola,";
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;color:#1f2a1f;line-height:1.5;padding:24px;max-width:520px;margin:0 auto;">
    <h1 style="margin:0 0 4px;font-size:1.1rem;color:#0b1f13;">🌱 Kylia · acción del día</h1>
    <p style="color:#5a685a;font-size:0.9rem;margin:0 0 18px;">${new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}</p>
    <p style="margin:0 0 14px;">${saludo}</p>
    <div style="border-left:4px solid ${color};padding:10px 14px;background:#f5f8f2;border-radius:0 8px 8px 0;margin-bottom:18px;">
      <div style="font-size:1.15rem;font-weight:700;color:${color};">${accion.titulo}</div>
      <div style="font-size:0.95rem;margin-top:4px;">${accion.detalle}</div>
    </div>
    <p style="margin:0 0 12px;"><a href="https://kylia.app/app" style="background:#1f2a1f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block;font-weight:600;">Abrir Kylia →</a></p>
    <p style="font-size:0.78rem;color:#5a685a;margin-top:24px;">¿No quieres recibir más estos avisos? Responde a este email con "BAJA" y te quito de la lista. · <a href="https://kylia.app/legal/privacidad" style="color:#5a685a;">Privacidad</a></p>
  </body></html>`;
}

async function enviarEmail({ to, nombre, accion }) {
  const subject = `Kylia · ${accion.titulo}`;
  await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      from:    process.env.RECORDATORIO_FROM_EMAIL || "Kylia <onboarding@resend.dev>",
      to:      [to],
      subject,
      html:    emailHtml({ nombre, accion }),
    }),
  });
}

module.exports = async (req, res) => {
  // Si se exige token, comprobarlo (para llamadas manuales además del cron).
  if (process.env.RECORDATORIO_TOKEN) {
    const token = (req.query?.token || req.headers["x-recordatorio-token"] || "").toString();
    // El cron de Vercel pasa la cabecera Authorization si se configura. Permitimos
    // ambas vías para flexibilidad.
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
    console.log("[recordatorio-diario] sin pilotos configurados (PILOTOS_JSON vacío)");
    return res.status(200).json({ ok: true, enviados: 0, aviso: "PILOTOS_JSON vacío" });
  }

  const resultados = [];
  for (const p of pilotos) {
    if (!p.email || typeof p.lat !== "number" || typeof p.lon !== "number") {
      resultados.push({ email: p.email || "?", error: "datos incompletos" });
      continue;
    }
    try {
      const meteo  = await fetchMeteo(p.lat, p.lon);
      const datos  = calcularDatosPiloto(meteo);
      const accion = decidirAccion(datos);
      const fila   = {
        email: p.email,
        nombre: p.nombre || null,
        et0AcumuladaSemana: Number(datos.et0AcumuladaSemana.toFixed(1)),
        lluviaPrevista3d:   Number(datos.lluviaPrevista3d.toFixed(1)),
        accion: accion.titulo,
        nivel:  accion.nivel,
      };
      if (!dry) {
        if (process.env.RESEND_API_KEY) {
          await enviarEmail({ to: p.email, nombre: p.nombre, accion });
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

  console.log("[recordatorio-diario]", JSON.stringify({ dry, resultados }));
  return res.status(200).json({ ok: true, dry, total: pilotos.length, resultados });
};
