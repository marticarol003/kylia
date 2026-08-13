// ─────────────────────────────────────────────────────────────────
// Sesión firmada — que el servidor sepa QUIÉN pregunta, no solo por quién
// ─────────────────────────────────────────────────────────────────
// El enlace por correo (_acceso.js) establece quién es cada persona, pero las
// APIs todavía no lo usaban: `/api/campo` acepta cualquier `usuario_id` con
// forma de UUID y devuelve la parcela entera, y `registro-usuario` hace upsert
// sobre el UUID que le manden. Como el backend habla con Supabase con la
// service_role key, no hay RLS que lo pare por debajo.
//
// Y los UUID no son secretos: campo/index.html lleva tres en texto plano y esa
// página se despliega (.vercelignore excluye db/, docs/, tests/ y scripts/,
// pero no campo/).
//
// ESTO NO CIERRA EL AGUJERO POR SÍ SOLO, y conviene no engañarse: mientras las
// APIs sigan aceptando peticiones SIN sesión —que es obligatorio hoy, porque el
// cron de avisos llama por HTTP sin cookie y ningún usuario actual ha canjeado
// todavía un enlace— a quien quiera saltarse esto le basta con no mandar la
// cookie. Lo que sí hace desde el primer día:
//
//   · quien TIENE sesión no puede pedir la parcela de otro (salto entre
//     usuarios), que es el caso realista: el UUID del vecino se filtra, no se
//     adivina;
//   · deja el andamiaje y una señal en los logs para poder cerrar del todo
//     (ver PASO 2 abajo) sabiendo a quién se va a romper.
//
// PASO 2, cuando los usuarios activos hayan entrado alguna vez por el enlace:
// pasar a exigir sesión en las vistas con datos personales y en las escrituras
// sobre filas ya existentes. Ese cambio ROMPE a quien no tenga cookie, así que
// es una decisión con fecha, no un despliegue silencioso. Precedente a
// respetar: el 28-jul se revirtió una auth fail-closed de los crons por
// romperlos sin avisar.
//
// El secreto va en SESION_SECRET. Sin él no se emite ninguna sesión y todo se
// comporta exactamente como antes — nunca al revés, para que un despliegue sin
// configurar no deje a nadie fuera.

const crypto = require("crypto");

const COOKIE = "kylia_sesion";
const VIDA_DIAS = 90;

function secreto() {
  return (process.env.SESION_SECRET || "").trim();
}
function hayConfig() {
  return secreto().length >= 16;
}

function firmar(datos) {
  return crypto.createHmac("sha256", secreto()).update(datos).digest("base64url");
}

// token = base64url({propietario, expira}) + "." + hmac
function emitir(propietarioId) {
  if (!hayConfig() || !propietarioId) return null;
  const cuerpo = Buffer.from(JSON.stringify({
    p: String(propietarioId),
    e: Date.now() + VIDA_DIAS * 86400_000,
  })).toString("base64url");
  return `${cuerpo}.${firmar(cuerpo)}`;
}

// Devuelve el propietario_id o null. Nunca lanza: esto corre en el camino de
// lectura de todas las vistas y un token corrupto no puede tumbar la petición.
function leerToken(token) {
  try {
    if (!hayConfig() || typeof token !== "string") return null;
    const [cuerpo, mac] = token.split(".");
    if (!cuerpo || !mac) return null;

    // timingSafeEqual exige longitudes iguales, así que se compara sobre los
    // buffers ya normalizados; una firma de otra longitud es inválida y punto.
    const esperado = Buffer.from(firmar(cuerpo));
    const recibido = Buffer.from(mac);
    if (esperado.length !== recibido.length) return null;
    if (!crypto.timingSafeEqual(esperado, recibido)) return null;

    const { p, e } = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8"));
    if (!p || !e || Date.now() > e) return null;
    return String(p);
  } catch (_) {
    return null;
  }
}

function deCabecera(req) {
  const raw = (req?.headers?.cookie || "").toString();
  if (!raw) return null;
  for (const trozo of raw.split(";")) {
    const i = trozo.indexOf("=");
    if (i < 0) continue;
    if (trozo.slice(0, i).trim() !== COOKIE) continue;
    return leerToken(decodeURIComponent(trozo.slice(i + 1).trim()));
  }
  return null;
}

// HttpOnly para que ningún script de la página pueda leerla (ni uno inyectado);
// SameSite=Lax porque el enlace del correo llega por navegación de nivel
// superior y con Strict no viajaría en ese primer salto.
function cabeceraSetCookie(token) {
  if (!token) return null;
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${VIDA_DIAS * 86400}` +
         `; HttpOnly; Secure; SameSite=Lax`;
}

// ── La comprobación que ya vale hoy ────────────────────────────────
// Si esta petición trae sesión, el usuario_id pedido tiene que ser suyo: o su
// propia fila, o una zona cuyo propietario_id es él. Sin sesión se deja pasar
// (compatibilidad), y se devuelve el motivo para poder contarlo en los logs.
//
// `filaUsuario` es la fila ya leída de `usuarios`, para no cobrar otra consulta.
function puedeVer(req, filaUsuario) {
  const sesion = deCabecera(req);
  if (!sesion) return { permitido: true, motivo: "sin_sesion" };
  if (!filaUsuario) return { permitido: true, motivo: "sin_fila" };

  const dueño = filaUsuario.propietario_id || filaUsuario.id;
  if (String(dueño) === sesion || String(filaUsuario.id) === sesion) {
    return { permitido: true, motivo: "propia", sesion };
  }
  return { permitido: false, motivo: "ajena", sesion };
}

module.exports = {
  COOKIE, VIDA_DIAS, emitir, leerToken, deCabecera, cabeceraSetCookie, puedeVer, hayConfig,
};
