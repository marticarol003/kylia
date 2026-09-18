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
const { propietarioPorEmail } = require("./_propietario.js");
const { configDesdeFila, COLUMNAS_FINCA } = require("./_config-app.js");
const SESION = require("./_sesion.js");

const { fetchConTimeout } = require("./_http.js");
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

// Qué falta para que el acceso por enlace funcione DE VERDAD. Las dos son
// necesarias: una entrega el enlace y la otra convierte el canje en una sesión.
// Con cualquiera de las dos sin poner, el circuito no se cierra y más vale
// decirlo que simularlo.
function faltaConfiguracion() {
  const falta = [];
  if (!(process.env.RESEND_API_KEY || "").trim()) falta.push("RESEND_API_KEY");
  if (!SESION.hayConfig()) falta.push("SESION_SECRET");
  return falta;
}

async function enviarCorreo(email, enlace) {
  const key = (process.env.RESEND_API_KEY || "").trim();
  // Sin Resend configurado no se puede entregar. Se dice aquí (en el log del
  // servidor), no al que pide: hacia fuera la respuesta es siempre la misma.
  if (!key) { console.warn("[acceso] RESEND_API_KEY sin configurar: no se envía"); return false; }

  const res = await fetchConTimeout("https://api.resend.com/emails", {
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

  // ⚠️ SIN INFRAESTRUCTURA, ERROR EXPLÍCITO — NO UN FALSO ÉXITO. Antes, sin
  // RESEND_API_KEY esto devolvía {ok:true, enviado:true} y la app decía "el
  // enlace ya va de camino": una promesa que no se podía cumplir, y el
  // agricultor esperando un correo que no existía. Y sin SESION_SECRET el canje
  // no puede emitir sesión, así que mandar el enlace tampoco serviría de nada.
  //
  // Decir "esto no está configurado" no filtra NADA sobre quién es cliente: es
  // información del servidor, no del usuario. El silencio neutral se conserva
  // exactamente donde importa —existir o no existir—, unas líneas más abajo.
  const falta = faltaConfiguracion();
  if (falta.length) {
    console.error("[acceso] sin configurar, no se puede dar acceso:", falta.join(", "));
    return { estado: 503, cuerpo: { ok: false, error: "acceso_no_configurado", falta } };
  }

  const respuesta = { estado: 200, cuerpo: { ok: true, enviado: true } };

  const haceUnaHora = new Date(Date.now() - 3600_000).toISOString();
  const recientes = await supabaseSelect("accesos",
    `email=eq.${encodeURIComponent(email)}&creado=gte.${haceUnaHora}&select=id`);
  if ((recientes || []).length >= MAX_POR_HORA) {
    console.warn("[acceso] tope por hora alcanzado:", email);
    return respuesta;   // callado a propósito: por fuera es indistinguible
  }

  // Resolución DETERMINISTA del propietario. Antes era `select=id&limit=1` y se
  // usaba esa fila como si fuera la del dueño; con varias parcelas compartiendo
  // correo, PostgREST devuelve una cualquiera. Ahora se colapsa por
  // propietario_id: si todas apuntan al mismo, ese es. Si apuntan a dueños
  // distintos, no se elige a dedo — se para.
  const quien = await propietarioPorEmail(email);
  if (quien.conflicto) {
    console.error("[acceso] email con varios propietarios, no se manda enlace:",
      JSON.stringify({ email, dueños: quien.conflicto }));
    return respuesta;   // por fuera, indistinguible: no se confirma ni se desmiente
  }
  // ─── ALTA: un correo que todavía no es de nadie TAMBIÉN recibe enlace ────
  //
  // Antes esto se paraba aquí, y eso dejaba a los usuarios nuevos sin camino:
  // `registro-usuario` ya no escribe correos (no acreditan nada) y `pedir()`
  // resuelve el propietario POR el correo de la fila. Sin bootstrap, quien no
  // tuviera correo asociado no podía recibir enlace, luego no podía acreditarlo,
  // luego no podía asociarlo. Circular.
  //
  // Se rompe así: el enlace se manda igual, y el propietario se crea EN EL
  // CANJE, cuando esa persona ha demostrado que controla el buzón. Aquí no se
  // toca `usuarios`: ni una fila, ni una zona, ni un correo.
  //
  // ⚠️ EL UUID SE RESERVA AHORA, y no es un capricho: `accesos.propietario_id`
  // es NOT NULL (db/acceso-por-email-2026-08-07.sql) y no se tocan migraciones.
  // Reservarlo tiene además una propiedad que hacía falta: el id vive en el
  // acceso, así que dos canjeos del MISMO enlace no pueden crear dos
  // propietarios distintos ni aunque lleguen a la vez. Un UUID reservado no es
  // una cuenta: mientras no exista la fila en `usuarios`, no hay nada.
  const alta = !!quien.vacio;
  const destino = alta ? crypto.randomUUID() : quien.propietario_id;
  if (alta) console.log("[acceso] correo sin cuenta: se reserva un alta");

  const { token, hash } = nuevoToken();
  await supabaseInsert("accesos", {
    email,
    token_hash: hash,
    propietario_id: destino,
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

  // ⚠️ ANTES DE QUEMAR NADA. Sin SESION_SECRET no se puede emitir la sesión
  // firmada, y canjear igualmente dejaría al dispositivo ADOPTANDO una cuenta
  // sin poder demostrar después que es suya: justo el agujero que este camino
  // existe para cerrar. Se para aquí, con el enlace INTACTO —sigue valiendo
  // cuando la configuración esté puesta— y sin tocar una sola fila.
  const falta = faltaConfiguracion();
  if (falta.length) {
    console.error("[acceso] sin configurar, no se canjea:", falta.join(", "));
    return { estado: 503, cuerpo: { ok: false, error: "acceso_no_configurado", falta } };
  }

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

  // ─── ALTA: el propietario nace AQUÍ, y como mucho una vez ────────────────
  //
  // El enlace ya está quemado arriba con un UPDATE condicionado a
  // `usado_en=is.null`: esa condición la resuelve la base, no este proceso, así
  // que de dos canjeos simultáneos solo UNO llega hasta aquí. El otro ya ha
  // salido por `noVale`.
  //
  // Y aunque llegaran los dos, el id viene del acceso —reservado al pedir el
  // enlace—, así que sería el MISMO: el insert sin upsert daría 23505 y se
  // trataría como "ya está". En ningún camino salen dos propietarios.
  //
  // La fila nace con el correo ya puesto porque en este punto está acreditado:
  // llegó a ese buzón y esta persona abrió el enlace. Es el único sitio del
  // sistema donde eso es verdad.
  const existentes = await supabaseSelect("usuarios",
    `id=eq.${a.propietario_id}&select=id,email,propietario_id`);
  if (!existentes?.length) {
    try {
      await supabaseInsert("usuarios", {
        id: a.propietario_id, propietario_id: a.propietario_id, email: a.email,
      });
      console.log("[acceso] alta: propietario creado en el canje");
    } catch (err) {
      // 23505 = ya existía. Otro canjeo ganó la carrera, o un reintento: no es
      // un error y no se crea nada más.
      if (!/23505|duplicate key/i.test(err.message || "")) {
        console.error("[acceso] no se pudo crear el propietario:", err.message);
        return { estado: 500, cuerpo: { ok: false, error: "no se pudo completar el alta" } };
      }
    }
  }

  // La config viaja EN EL CANJEO, no en una segunda llamada: si el móvil nuevo
  // adopta al propietario pero no puede restaurar la configuración, el enlace no
  // ha servido de nada — el agricultor abre la app y la ve en blanco.
  const [zonas, dueño] = await Promise.all([
    supabaseSelect("usuarios",
      `propietario_id=eq.${a.propietario_id}&select=id,nombre,cultivos,area_m2,metodo_riego,fecha_plantacion,ciudad&order=nombre.asc`),
    supabaseSelect("usuarios", `id=eq.${a.propietario_id}&select=config_app,${COLUMNAS_FINCA}`),
  ]);

  // El espejo si existe; si no, la finca reconstruida desde su propia fila. Sin
  // esto, quien no haya tocado la configuración desde que existe `config_app`
  // adopta a su propietario y abre la app vacía — ver _config-app.js.
  const fila   = dueño?.[0] || null;
  const config = fila?.config_app || configDesdeFila(fila);

  // ─── EL ÚNICO SITIO QUE ASOCIA UN CORREO A UNA CUENTA ────────────────────
  // Aquí, y solo aquí, el correo está ACREDITADO: llegó a ese buzón, y quien
  // abrió el enlace de un solo uso demostró tenerlo. `registro-usuario` ya no
  // escribe `email` desde ningún camino, así que esta es la asociación.
  //
  // Se escribe SOLO en la fila del propietario. Las filas de sus zonas no se
  // tocan: heredaban el correo por historia y eso es justo lo que llenaba
  // `propietarioPorEmail` de filas repetidas.
  //
  // Es idempotente: si ya lo tenía, queda igual. Y si falla, el canje sigue
  // siendo válido —la sesión ya se ha ganado—; se anota y se sigue.
  // Solo SI FALTA: una fila que ya lleva su correo no se toca, ni para
  // confirmarlo. Y solo la fila PROPIETARIA — las de sus zonas nunca, que es
  // lo que llenaba `propietarioPorEmail` de filas repetidas.
  const yaTenia = (fila?.email || "").trim().toLowerCase() === a.email;
  if (!yaTenia) {
    try {
      await supabaseUpdate("usuarios", `id=eq.${a.propietario_id}`, { email: a.email });
    } catch (err) {
      console.error("[acceso] no se pudo asociar el correo acreditado:", err.message);
    }
  }

  console.log("[acceso] canjeado", JSON.stringify({
    email: a.email, zonas: (zonas || []).length,
    config: fila?.config_app ? "espejo" : (config ? "sintetizada" : "ninguna"),
  }));
  // El canjeo es el ÚNICO punto del sistema donde alguien demuestra ser quien
  // dice —abrió un enlace de un solo uso que llegó a su correo—, así que es
  // donde nace la sesión. Sin SESION_SECRET configurado no se emite ninguna y
  // todo sigue funcionando igual que antes.
  const cookies = [SESION.cabeceraSetCookie(SESION.emitir(a.propietario_id))].filter(Boolean);

  return {
    estado: 200,
    cookies,
    cuerpo: {
      ok: true,
      propietario_id: a.propietario_id,
      email: a.email,
      // El nombre viaja para que el móvil nuevo salude igual que el viejo.
      nombre: fila?.nombre || null,
      config,
      zonas: (zonas || []).map(z => ({
        id: z.id, nombre: z.nombre, cultivo: (z.cultivos || [])[0] || null,
        area_m2: z.area_m2, metodo_riego: z.metodo_riego,
        fecha_plantacion: z.fecha_plantacion, ciudad: z.ciudad,
      })),
    },
  };
}

module.exports = { pedir, canjear, nuevoToken, huellaDe, VIDA_MIN, MAX_POR_HORA, ES_EMAIL };
