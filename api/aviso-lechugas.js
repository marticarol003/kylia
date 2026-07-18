// ─────────────────────────────────────────────────────────────────
// /api/aviso-lechugas — avisos (WhatsApp/email) del bancal de 33 lechugas
// ─────────────────────────────────────────────────────────────────
// El bancal de 33 lechugas es el primer campo donde las decisiones de Kylia
// SE EJECUTAN (Kylia decide, el padre riega a las 8-9). Dos avisos diarios:
//
//   GET /api/aviso-lechugas?fase=manana   → la decisión de HOY antes del riego
//        ("riega X min" / "no toca"), con el porqué en una frase.
//   GET /api/aviso-lechugas?fase=mediodia → confirmación tras la ventana de
//        riego: ¿consta el riego que tocaba? (✓ hecho / ⚠️ falta registrar).
//
// Los 2 crons de Vercel (plan Hobby) están ocupados (recordatorio-wizard y
// diario-b), así que esto lo dispara GitHub Actions:
// .github/workflows/aviso-lechugas.yml (07:10 y 13:10 hora de Madrid en verano).
//
// La decisión NO se calcula aquí: se pide a /api/campo?vista=hoy (la misma
// fuente que ve el padre en la pantalla), así el email y la app nunca discrepan.
//
// Config (Vercel):
//   LECHUGAS_WHATSAPP  canal principal: "34600111222:APIKEY,34600333444:APIKEY"
//                      (teléfono:apikey de CallMeBot, separados por coma).
//                      Cada teléfono se activa UNA vez: enviar por WhatsApp el
//                      mensaje de autorización al número que indica
//                      callmebot.com/blog/free-api-whatsapp-messages/ y te
//                      responde con tu apikey. Gratis, para uso personal.
//   LECHUGAS_EMAILS    canal secundario opcional (coma-separado). Si no hay
//                      NINGÚN canal configurado, cae al email de Martí.
//   AVISO_TOKEN        opcional; si está, el GET exige ?token= (mismo patrón
//                      que RECORDATORIO_TOKEN en recordatorio-wizard).
// Para test manual: GET /api/aviso-lechugas?fase=manana&dry=1

const { isConfigured, supabaseSelect } = require("./_supabase.js");

const USUARIO_ID = "d5475c3d-365b-47ff-b31e-fa659a8362fb"; // 33 lechugas · aspersión
const CAMPO_URL  = "https://kylia.app/campo";
const EMAIL_DEFECTO = "marticarol003@gmail.com";

const lista = v => (v || "").split(",").map(s => s.trim()).filter(Boolean);

// [{ phone, apikey }] desde LECHUGAS_WHATSAPP ("teléfono:apikey,...")
function destinatariosWhatsapp() {
  return lista(process.env.LECHUGAS_WHATSAPP).map(par => {
    const [phone, apikey] = par.split(":").map(s => s.trim());
    return phone && apikey ? { phone, apikey } : null;
  }).filter(Boolean);
}

function destinatariosEmail(hayWhatsapp) {
  const env = lista(process.env.LECHUGAS_EMAILS);
  if (env.length) return env;
  return hayWhatsapp ? [] : [EMAIL_DEFECTO];  // sin ningún canal → email de Martí
}

function hoyISO() { return new Date().toISOString().slice(0, 10); }
const fmtFecha = iso => { const [, m, d] = (iso || "").split("-"); return d ? `${d}/${m}` : "—"; };

// La vista "hoy" del propio /api/campo: misma decisión que ve el padre en pantalla.
async function decisionDeHoy(req) {
  const base = `https://${req.headers.host || "kylia.app"}`;
  const res = await fetch(`${base}/api/campo?vista=hoy&usuario_id=${USUARIO_ID}`);
  if (!res.ok) throw new Error(`campo?vista=hoy ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "vista hoy sin datos");
  return data;
}

// ¿Consta un riego registrado HOY? (el asentamiento del 18-jul también es tipo
// riego, pero solo miramos la fecha de hoy, así que no interfiere).
async function riegoDeHoy() {
  if (!isConfigured()) return null;
  const filas = await supabaseSelect("acciones",
    `usuario_id=eq.${USUARIO_ID}&tipo=eq.riego&fecha_local=eq.${hoyISO()}` +
    `&select=cantidad_l_m2,duracion_min&order=id.desc`);
  return (filas || [])[0] || null;
}

// ── Los dos emails ───────────────────────────────────────────────
function htmlBase(titulo, cuerpo) {
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;color:#1f2a1f;line-height:1.5;padding:24px;max-width:520px;margin:0 auto;">
    <h1 style="margin:0 0 4px;font-size:1.1rem;color:#0b1f13;">${titulo}</h1>
    <p style="color:#5a685a;font-size:0.9rem;margin:0 0 18px;">${new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })} · 33 lechugas</p>
    ${cuerpo}
    <p style="font-size:0.78rem;color:#5a685a;margin-top:24px;">Aviso automático del bancal de 33 lechugas. · <a href="${CAMPO_URL}" style="color:#5a685a;">Abrir el campo</a></p>
  </body></html>`;
}

const boton = (txt) => `<p style="margin:16px 0 0;"><a href="${CAMPO_URL}" style="background:#013A27;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600;">${txt}</a></p>`;

function emailManana(data) {
  const h = data.hoy;
  if (h.regar && h.presentacion) {
    return {
      subject: `💧 Kylia · hoy riega ${h.presentacion.texto}`,
      texto: `💧 Kylia — HOY TOCA REGAR las lechugas: ${h.presentacion.texto} de aspersor (${h.presentacion.mm} mm). ` +
             `El suelo lleva ${h.deficit_mm} mm de déficit (umbral ${h.umbral_mm}). Cuando riegues, apúntalo: ${CAMPO_URL}`,
      html: htmlBase("💧 Hoy toca regar", `
        <p style="font-size:1.6rem;font-weight:800;color:#013A27;margin:0 0 10px;">${h.presentacion.texto} de aspersor</p>
        <p style="margin:0 0 6px;">El suelo lleva un déficit de <b>${h.deficit_mm} mm</b> y el umbral para regar es <b>${h.umbral_mm} mm</b>. Con ${h.presentacion.texto} (${h.presentacion.mm} mm) queda repuesto.</p>
        <p style="color:#5a685a;font-size:0.9rem;margin:0;">Hoy: lluvia ${h.lluvia} mm · evaporación ${h.et0} mm.</p>
        ${boton("Regado ✓ — registrar con 1 toque")}`),
    };
  }
  const proximoTxt = data.proximo
    ? `Próximo riego previsto: ${fmtFecha(data.proximo.fecha)} (aprox. ${data.proximo.presentacion?.texto || "—"}).`
    : "Sin riego previsto en los próximos 7 días.";
  const vigilaTxt = h.nivel === "media" ? " Ojo: el déficit se acerca al umbral, probablemente mañana toque." : "";
  const vigila = h.nivel === "media"
    ? `<p style="margin:0 0 6px;color:#b45309;"><b>Ojo:</b> el déficit (${h.deficit_mm} mm) se acerca al umbral (${h.umbral_mm} mm) — probablemente mañana toque.</p>` : "";
  return {
    subject: `✅ Kylia · hoy no toca regar`,
    texto: `✅ Kylia — hoy NO toca regar las lechugas. Déficit ${h.deficit_mm} de ${h.umbral_mm} mm.${vigilaTxt} ${proximoTxt}`,
    html: htmlBase("✅ Hoy no toca regar", `
      <p style="font-size:1.3rem;font-weight:800;color:#013A27;margin:0 0 10px;">El suelo aún tiene reserva</p>
      ${vigila}
      <p style="margin:0 0 6px;">Déficit <b>${h.deficit_mm} mm</b> de un umbral de <b>${h.umbral_mm} mm</b>. ${proximoTxt}</p>
      <p style="color:#5a685a;font-size:0.9rem;margin:0;">Hoy: lluvia ${h.lluvia} mm · evaporación ${h.et0} mm.</p>`),
  };
}

function emailMediodia(data, riego) {
  const h = data.hoy;
  const durTxt = riego?.duracion_min != null
    ? (riego.duracion_min < 60 ? `${riego.duracion_min} min` : `${Math.round(riego.duracion_min / 6) / 10} h`)
    : null;
  const detalle = riego ? [durTxt, riego.cantidad_l_m2 != null ? `${riego.cantidad_l_m2} L/m²` : null].filter(Boolean).join(" · ") : null;

  if (h.regar && riego) return {
    subject: "✅ Kylia · riego hecho y registrado",
    texto: `✅ Kylia — riego de las lechugas hecho y registrado (${detalle}). Todo en orden.`,
    html: htmlBase("✅ Riego hecho", `<p style="margin:0;">Tocaba regar y consta el riego de hoy (<b>${detalle}</b>). Todo en orden.</p>`),
  };
  if (h.regar && !riego) return {
    subject: "⚠️ Kylia · aún no consta el riego de hoy",
    texto: `⚠️ Kylia — esta mañana tocaba regar las lechugas ${h.presentacion?.texto || ""} y no consta ningún riego. ` +
           `Si se regó, apúntalo (1 toque): ${CAMPO_URL} — y si no, aún se está a tiempo esta tarde.`,
    html: htmlBase("⚠️ Falta el riego de hoy", `
      <p style="margin:0 0 6px;">Esta mañana tocaba regar <b>${h.presentacion?.texto || "—"}</b> y a mediodía no consta ningún riego registrado.</p>
      <p style="margin:0;">Si se regó, regístralo (1 toque). Si no, aún se está a tiempo esta tarde.</p>
      ${boton("Abrir y registrar")}`),
  };
  if (!h.regar && riego) return {
    subject: "ℹ️ Kylia · consta un riego que no tocaba",
    texto: `ℹ️ Kylia — hoy no tocaba regar las lechugas pero consta un riego (${detalle}). Si fue un error de registro, se puede borrar con la ✕ en ${CAMPO_URL}`,
    html: htmlBase("ℹ️ Riego fuera de pauta", `<p style="margin:0;">Hoy no tocaba regar pero consta un riego (<b>${detalle}</b>). Si fue un error de registro, se puede borrar con la ✕ en la lista.</p>`),
  };
  return {
    subject: "✅ Kylia · hoy no tocaba y no se regó",
    texto: `✅ Kylia — hoy no tocaba regar las lechugas y no consta riego. Suelo con reserva (déficit ${h.deficit_mm} de ${h.umbral_mm} mm).`,
    html: htmlBase("✅ Todo en orden", `<p style="margin:0;">Hoy no tocaba regar y no consta ningún riego. El suelo sigue con reserva (déficit ${h.deficit_mm} de ${h.umbral_mm} mm).</p>`),
  };
}

// WhatsApp vía CallMeBot (gratis, uso personal): GET simple con el texto plano.
// Cada teléfono autorizó al bot una vez y tiene su apikey (ver cabecera).
async function enviarWhatsApp({ phone, apikey, texto }) {
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}` +
              `&apikey=${encodeURIComponent(apikey)}&text=${encodeURIComponent(texto)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`callmebot ${res.status}`);
}

async function enviarEmail({ to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RECORDATORIO_FROM_EMAIL || "Kylia <onboarding@resend.dev>",
      to: [to], subject, html,
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}`);
}

module.exports = async (req, res) => {
  if (process.env.AVISO_TOKEN) {
    const token = (req.query?.token || req.headers["x-aviso-token"] || "").toString();
    if (token !== process.env.AVISO_TOKEN) return res.status(401).json({ error: "no autorizado" });
  }

  const fase = (req.query?.fase || "").toString();
  if (fase !== "manana" && fase !== "mediodia") {
    return res.status(400).json({ error: "fase debe ser manana o mediodia" });
  }
  const dry = String(req.query?.dry || "") === "1";

  try {
    const data  = await decisionDeHoy(req);
    const email = fase === "manana"
      ? emailManana(data)
      : emailMediodia(data, await riegoDeHoy());

    const porWhatsapp = destinatariosWhatsapp();
    const porEmail    = destinatariosEmail(porWhatsapp.length > 0);
    const resultados  = [];

    for (const w of porWhatsapp) {
      if (dry) { resultados.push({ whatsapp: w.phone, dry: true }); continue; }
      try { await enviarWhatsApp({ ...w, texto: email.texto }); resultados.push({ whatsapp: w.phone, enviado: true }); }
      catch (err) { resultados.push({ whatsapp: w.phone, error: err.message }); }
    }
    for (const dest of porEmail) {
      if (dry) { resultados.push({ to: dest, dry: true }); continue; }
      if (!process.env.RESEND_API_KEY) { resultados.push({ to: dest, error: "RESEND_API_KEY no configurada" }); continue; }
      try { await enviarEmail({ to: dest, ...email }); resultados.push({ to: dest, enviado: true }); }
      catch (err) { resultados.push({ to: dest, error: err.message }); }
    }

    console.log("[aviso-lechugas]", JSON.stringify({ fase, dry, subject: email.subject, resultados }));
    return res.status(200).json({ ok: true, fase, dry, subject: email.subject, resultados });
  } catch (err) {
    console.error("[aviso-lechugas] error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
