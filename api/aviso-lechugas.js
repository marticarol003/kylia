// ─────────────────────────────────────────────────────────────────
// /api/aviso-lechugas — avisos por email del bancal de 33 lechugas
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
//   LECHUGAS_EMAILS  destinatarios separados por coma (Martí + padre).
//   AVISO_TOKEN      opcional; si está, el GET exige ?token= (mismo patrón
//                    que RECORDATORIO_TOKEN en recordatorio-wizard).
// Para test manual: GET /api/aviso-lechugas?fase=manana&dry=1

const { isConfigured, supabaseSelect } = require("./_supabase.js");

const USUARIO_ID = "d5475c3d-365b-47ff-b31e-fa659a8362fb"; // 33 lechugas · aspersión
const CAMPO_URL  = "https://kylia.app/campo";
const DESTINATARIOS_DEFECTO = ["marticarol003@gmail.com"];

function destinatarios() {
  const env = (process.env.LECHUGAS_EMAILS || "").split(",").map(s => s.trim()).filter(Boolean);
  return env.length ? env : DESTINATARIOS_DEFECTO;
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
      html: htmlBase("💧 Hoy toca regar", `
        <p style="font-size:1.6rem;font-weight:800;color:#013A27;margin:0 0 10px;">${h.presentacion.texto} de aspersor</p>
        <p style="margin:0 0 6px;">El suelo lleva un déficit de <b>${h.deficit_mm} mm</b> y el umbral para regar es <b>${h.umbral_mm} mm</b>. Con ${h.presentacion.texto} (${h.presentacion.mm} mm) queda repuesto.</p>
        <p style="color:#5a685a;font-size:0.9rem;margin:0;">Hoy: lluvia ${h.lluvia} mm · evaporación ${h.et0} mm.</p>
        ${boton("Regado ✓ — registrar con 1 toque")}`),
    };
  }
  const proximo = data.proximo
    ? `Próximo riego previsto: <b>${fmtFecha(data.proximo.fecha)}</b> (aprox. ${data.proximo.presentacion?.texto || "—"}).`
    : "Sin riego previsto en los próximos 7 días.";
  const vigila = h.nivel === "media"
    ? `<p style="margin:0 0 6px;color:#b45309;"><b>Ojo:</b> el déficit (${h.deficit_mm} mm) se acerca al umbral (${h.umbral_mm} mm) — probablemente mañana toque.</p>` : "";
  return {
    subject: `✅ Kylia · hoy no toca regar`,
    html: htmlBase("✅ Hoy no toca regar", `
      <p style="font-size:1.3rem;font-weight:800;color:#013A27;margin:0 0 10px;">El suelo aún tiene reserva</p>
      ${vigila}
      <p style="margin:0 0 6px;">Déficit <b>${h.deficit_mm} mm</b> de un umbral de <b>${h.umbral_mm} mm</b>. ${proximo}</p>
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
    html: htmlBase("✅ Riego hecho", `<p style="margin:0;">Tocaba regar y consta el riego de hoy (<b>${detalle}</b>). Todo en orden.</p>`),
  };
  if (h.regar && !riego) return {
    subject: "⚠️ Kylia · aún no consta el riego de hoy",
    html: htmlBase("⚠️ Falta el riego de hoy", `
      <p style="margin:0 0 6px;">Esta mañana tocaba regar <b>${h.presentacion?.texto || "—"}</b> y a mediodía no consta ningún riego registrado.</p>
      <p style="margin:0;">Si se regó, regístralo (1 toque). Si no, aún se está a tiempo esta tarde.</p>
      ${boton("Abrir y registrar")}`),
  };
  if (!h.regar && riego) return {
    subject: "ℹ️ Kylia · consta un riego que no tocaba",
    html: htmlBase("ℹ️ Riego fuera de pauta", `<p style="margin:0;">Hoy no tocaba regar pero consta un riego (<b>${detalle}</b>). Si fue un error de registro, se puede borrar con la ✕ en la lista.</p>`),
  };
  return {
    subject: "✅ Kylia · hoy no tocaba y no se regó",
    html: htmlBase("✅ Todo en orden", `<p style="margin:0;">Hoy no tocaba regar y no consta ningún riego. El suelo sigue con reserva (déficit ${h.deficit_mm} de ${h.umbral_mm} mm).</p>`),
  };
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

    const to = destinatarios();
    const resultados = [];
    for (const dest of to) {
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
