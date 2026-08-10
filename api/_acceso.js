// ─────────────────────────────────────────────────────────────────
// Acceso por enlace de correo — la parcela es de la PERSONA, no del móvil
// ─────────────────────────────────────────────────────────────────
// Hasta ahora el "usuario" de /app era un UUID generado en el localStorage del
// dispositivo. La consecuencia práctica: si el agricultor cambia de móvil o abre
// la app en la tablet, su campo no existe. Con un piloto que llevas de la mano
// da igual; con alguien que se da de alta solo, es el final del recorrido.
//
// Esto lo arregla sin montar cuentas ni contraseñas: pides entrar con tu email,
// te llega un enlace de un solo uso, y al abrirlo el dispositivo adopta tu
// `propietario_id`. A partir de ahí ve TODAS sus zonas de cultivo, porque cada
// zona ya es una fila de `usuarios` con el mismo propietario.
//
// Las cuatro decisiones que sostienen esto (ver db/acceso-por-email-2026-08-07.sql):
//   1. Se guarda el SHA-256 del token, nunca el token. Quien se lleve la tabla
//      no se lleva ninguna llave utilizable.
//   2. Un solo uso y 15 minutos. Un enlace que queda en el historial del correo
//      —o reenviado por WhatsApp— deja de servir.
//   3. La respuesta a "pedir acceso" es SIEMPRE la misma exista o no el email.
//      Si no, la API contesta gratis a "¿es este señor cliente de Kylia?".
//   4. Tope de peticiones por email y hora, para que la bandeja de entrada de
//      alguien no se pueda usar como buzón de spam ajeno.

const crypto = require("crypto");
const { supabaseInsert, supabaseSelect, supabaseUpdate } = require("./_supabase.js");

const VIDA_MIN     = 15;   // minutos que vive un enlace
const MAX_POR_HORA = 5;    // peticiones por email y hora
const BASE_URL     = process.env.APP_BASE_URL || "https://kylia.app";

const ES_EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

// El token viaja en el correo; en la base solo queda su huella.
function nuevoToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: crypto.createHash("sha256").update(token).digest("hex") };
}
function huellaDe(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function correoHTML(enlace) {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#1d2b1d">
  <p style="font-size:1.05rem">Entra en tu campo</p>
  <p>Toca el botón desde el móvil o el ordenador donde quieras usar Kylia. Verás tus parcelas y tus zonas de cultivo tal y como las dejaste.</p>
  <p style="margin:24px 0">
    <a href="${enlace}" style="background:#013A27;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block">Abrir Kylia</a>
  </p>
  <p style="font-size:.85rem;color:#5a685a">El enlace sirve <strong>una sola vez</strong> y caduca en ${VIDA_MIN} minutos. Si no lo has pedido tú, no hagas nada: sin abrirlo no da acceso a nada.</p>
</div>`;
}

async function enviarCorreo(email, enlace) {
  const key = (process.env.RESEND_API_KEY || "").trim();
  // Sin Resend configurado no se puede entregar. Se dice aquí (en el log del
  // servidor), no al que pide: hacia fuera la respuesta es siempre la misma.
  if (!key) { console.warn("[acceso] RESEND_API_KEY sin configurar: no se envía"); return false; }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: process.env.ACCESO_FROM || "Kylia <onboarding@resend.dev>",
      to: [email],
      subject: "Tu enlace para entrar en Kylia",
      html: correoHTML(enlace),
    }),
  });
  if (!res.ok) {
    console.error("[acceso] resend", res.status, (await res.text().catch(() => "")).slice(0, 200));
    return false;
  }
  return true;
}

// ─── pedir: manda el enlace ────────────────────────────────────────
// Devuelve SIEMPRE {ok:true, enviado:true}. Que el email exista, que tenga
// parcelas, que Resend funcione — nada de eso se filtra a la respuesta.
async function pedir(body, ip) {
  const email = (body.email || "").toString().trim().toLowerCase().slice(0, 200);
  if (!ES_EMAIL.test(email)) return { estado: 400, cuerpo: { error: "email inválido" } };

  const respuesta = { estado: 200, cuerpo: { ok: true, enviado: true } };

  const haceUnaHora = new Date(Date.now() - 3600_000).toISOString();
  const recientes = await supabaseSelect("accesos",
    `email=eq.${encodeURIComponent(email)}&creado=gte.${haceUnaHora}&select=id`);
  if ((recientes || []).length >= MAX_POR_HORA) {
    console.warn("[acceso] tope por hora alcanzado:", email);
    return respuesta;   // callado a propósito: por fuera es indistinguible
  }

  // Cualquier fila de `usuarios` con ese email identifica a la persona; su
  // propietario_id es el que agrupa todas sus zonas.
  const filas = await supabaseSelect("usuarios",
    `email=eq.${encodeURIComponent(email)}&select=id,propietario_id&limit=1`);
  const dueño = filas?.[0];
  if (!dueño) {
    console.log("[acceso] email sin parcelas:", email);
    return respuesta;   // ídem: no se confirma ni se desmiente
  }

  const { token, hash } = nuevoToken();
  await supabaseInsert("accesos", {
    email,
    token_hash: hash,
    propietario_id: dueño.propietario_id || dueño.id,
    expira: new Date(Date.now() + VIDA_MIN * 60_000).toISOString(),
    ip: ip || null,
  });

  await enviarCorreo(email, `${BASE_URL}/app?acceso=${token}`);
  return respuesta;
}

// ─── canjear: el dispositivo adopta al propietario ─────────────────
async function canjear(body) {
  const token = (body.token || "").toString().trim();
  if (!token || token.length > 200) return { estado: 400, cuerpo: { error: "token inválido" } };

  const filas = await supabaseSelect("accesos",
    `token_hash=eq.${huellaDe(token)}&select=id,email,propietario_id,expira,usado_en&limit=1`);
  const a = filas?.[0];

  // Un motivo genérico a propósito: distinguir "no existe" de "ya usado" de
  // "caducado" le da información gratis a quien pruebe tokens.
  const noVale = { estado: 400, cuerpo: { ok: false, error: "enlace no válido o caducado" } };
  if (!a) return noVale;
  if (a.usado_en) return noVale;
  if (new Date(a.expira).getTime() < Date.now()) return noVale;

  // Se quema ANTES de devolver nada: si algo falla después, el enlace ya no
  // sirve. Y el filtro lleva usado_en=is.null para que dos canjeos simultáneos
  // no puedan ganar los dos — la condición la resuelve la base, no este proceso.
  const quemado = await supabaseUpdate("accesos",
    `id=eq.${a.id}&usado_en=is.null`, { usado_en: new Date().toISOString() });
  if (!Array.isArray(quemado) || quemado.length === 0) return noVale;

  // La config viaja EN EL CANJEO, no en una segunda llamada: si el móvil nuevo
  // adopta al propietario pero no puede restaurar la configuración, el enlace no
  // ha servido de nada — el agricultor abre la app y la ve en blanco.
  const [zonas, dueño] = await Promise.all([
    supabaseSelect("usuarios",
      `propietario_id=eq.${a.propietario_id}&select=id,nombre,cultivos,area_m2,metodo_riego,fecha_plantacion,ciudad&order=nombre.asc`),
    supabaseSelect("usuarios", `id=eq.${a.propietario_id}&select=config_app`),
  ]);

  console.log("[acceso] canjeado", JSON.stringify({ email: a.email, zonas: (zonas || []).length }));
  return {
    estado: 200,
    cuerpo: {
      ok: true,
      propietario_id: a.propietario_id,
      email: a.email,
      config: dueño?.[0]?.config_app || null,
      zonas: (zonas || []).map(z => ({
        id: z.id, nombre: z.nombre, cultivo: (z.cultivos || [])[0] || null,
        area_m2: z.area_m2, metodo_riego: z.metodo_riego,
        fecha_plantacion: z.fecha_plantacion, ciudad: z.ciudad,
      })),
    },
  };
}

module.exports = { pedir, canjear, nuevoToken, huellaDe, VIDA_MIN, MAX_POR_HORA, ES_EMAIL };
