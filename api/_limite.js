// ─────────────────────────────────────────────────────────────────
// Límite de uso — el que sí para a un script, no solo a un navegador
// ─────────────────────────────────────────────────────────────────
// Los endpoints de IA y de satélite eran públicos, sin límite y con CORS
// abierto: un bucle de curl podía quemar la cuota de Gemini, el crédito de
// Anthropic y el tiempo de ejecución de Vercel, y nadie se enteraba hasta ver
// la factura. Cerrar el CORS (_origen.js) tapa el abuso DESDE UN NAVEGADOR
// ajeno; esto tapa el resto.
//
// POR QUÉ VA EN LA BASE DE DATOS Y NO EN MEMORIA. En Vercel cada petición puede
// caer en una instancia distinta, y las instancias mueren y nacen solas. Un
// contador en memoria cuenta por instancia, así que un atacante con paralelismo
// pasa por encima sin enterarse: parecería protección y no lo sería. Supabase ya
// está ahí, es compartido y persiste — no hace falta traer Redis ni un
// proveedor nuevo (que además habría que añadir a la política de privacidad).
//
// LA IP SE GUARDA HASHEADA, y no es una florituras: una IP es un dato personal.
// Guardar el log de IPs de todo el que toca la API sería un tratamiento nuevo
// que la política de privacidad no declara. Con el hash se puede contar cuántas
// veces ha llamado alguien sin poder decir quién es.
//
// FALLA ABIERTO A PROPÓSITO. Si Supabase no está configurado, o si la tabla
// todavía no existe porque no se ha ejecutado db/limite-uso-2026-09-09.sql, se
// deja pasar y se avisa por consola. El precedente manda: el 13-ago /api/pago
// devolvía 500 en producción por pedir columnas de una migración sin ejecutar, y
// el 28-jul hubo que revertir una auth fail-closed que rompió los crons sin
// avisar. Un guardia de COSTE no puede tumbar el producto de un usuario real.
// La contrapartida hay que decirla clara: mientras el SQL no se ejecute, esto
// no protege de nada.

const crypto = require("crypto");
const { isConfigured, supabaseSelect, supabaseInsert, supabaseDelete } = require("./_supabase.js");

const TABLA = "limite_uso";

// Cuánto se permite por recurso: [por hora, por día]. Los de Gemini son
// generosos (una sesión normal de /app hace unas pocas llamadas); el de
// producto-fertilizante es tacaño a propósito, porque sale a buscar al mercado
// en vivo con Claude + búsqueda web y cada consulta cuesta dinero de verdad.
const LIMITES = {
  "ia:recomendacion":          { hora:  40, dia: 200 },
  "ia:recomendaciones-texto":  { hora:  40, dia: 200 },
  "ia:sugerencia-producto":    { hora:  40, dia: 200 },
  "ia:producto-fertilizante":  { hora:   6, dia:  20 },
  "sentinel:punto":            { hora:  60, dia: 300 },
};
const POR_DEFECTO = { hora: 60, dia: 300 };

let avisado = false;
function avisarUnaVez(motivo) {
  if (avisado) return;
  avisado = true;
  console.warn(`[limite] SIN PROTECCIÓN (${motivo}). Ejecuta db/limite-uso-2026-09-09.sql.`);
}

// Hash con sal. Si no hay sal configurada se usa una constante: el hash sigue
// sin ser una IP en claro, pero deja de ser irreversible para quien tenga el
// código. Suficiente para un contador que se borra cada día, y se puede
// endurecer poniendo LIMITE_SALT.
function clavear(valor) {
  const sal = (process.env.LIMITE_SALT || process.env.SESION_SECRET || "kylia-limite").trim();
  return crypto.createHmac("sha256", sal).update(String(valor)).digest("hex").slice(0, 32);
}

// ¿Puede pasar esta petición?
//   recurso: "ia:recomendacion", "sentinel:punto"…
//   quien:   la IP (o el usuario_id, si se prefiere contar por persona)
// Devuelve { permitido, motivo, restantes_hora, restantes_dia }.
async function consumir(recurso, quien) {
  const lim = LIMITES[recurso] || POR_DEFECTO;
  if (!isConfigured()) { avisarUnaVez("supabase no configurado"); return { permitido: true, motivo: "sin_backend" }; }

  const clave = clavear(quien);
  const ahora = Date.now();
  const desde = new Date(ahora - 24 * 3600e3).toISOString();

  let filas;
  try {
    filas = await supabaseSelect(TABLA,
      `recurso=eq.${encodeURIComponent(recurso)}&clave=eq.${clave}` +
      `&momento=gt.${encodeURIComponent(desde)}&select=momento&order=momento.desc&limit=1000`);
  } catch (err) {
    avisarUnaVez(`consulta falló: ${err.message}`);
    return { permitido: true, motivo: "sin_backend" };
  }
  // `supabaseSelect` devuelve null cuando la tabla no existe todavía.
  if (!Array.isArray(filas)) { avisarUnaVez("la tabla no existe"); return { permitido: true, motivo: "sin_backend" }; }

  // Una sola consulta y las dos ventanas se cuentan aquí. El número de filas
  // está acotado por el propio límite diario, así que esto no crece sin freno.
  const corteHora = ahora - 3600e3;
  const enHora = filas.filter(f => new Date(f.momento).getTime() > corteHora).length;
  const enDia  = filas.length;

  if (enHora >= lim.hora || enDia >= lim.dia) {
    return {
      permitido: false,
      motivo: enHora >= lim.hora ? "por_hora" : "por_dia",
      restantes_hora: Math.max(0, lim.hora - enHora),
      restantes_dia:  Math.max(0, lim.dia - enDia),
    };
  }

  // Se apunta DESPUÉS de decidir. Dos peticiones simultáneas pueden colarse por
  // el mismo hueco; para un guardia de coste eso es ruido, y evitarlo pediría un
  // bloqueo en base de datos que no compensa.
  try { await supabaseInsert(TABLA, { clave, recurso }); }
  catch (_) { /* si no se puede apuntar, se deja pasar: nunca se corta por un fallo nuestro */ }

  // Barrido oportunista: la tabla es un log y crecería sola para siempre. Una de
  // cada 50 peticiones se lleva por delante lo que ya no cuenta para ninguna
  // ventana. Sin cron nuevo y sin que nadie tenga que acordarse.
  if (Math.random() < 0.02) {
    const viejo = new Date(ahora - 26 * 3600e3).toISOString();
    supabaseDelete(TABLA, `momento=lt.${encodeURIComponent(viejo)}`).catch(() => {});
  }

  return {
    permitido: true, motivo: "dentro",
    restantes_hora: lim.hora - enHora - 1,
    restantes_dia:  lim.dia - enDia - 1,
  };
}

// Atajo para endpoints: si no puede pasar, responde 429 y devuelve false.
async function guardia(req, res, recurso, quien) {
  const r = await consumir(recurso, quien);
  if (r.permitido) return true;
  res.setHeader("Retry-After", r.motivo === "por_hora" ? "3600" : "86400");
  res.status(429).json({
    error: "Demasiadas peticiones",
    detalle: r.motivo === "por_hora"
      ? "Has llegado al límite por hora de este servicio. Vuelve a intentarlo dentro de un rato."
      : "Has llegado al límite diario de este servicio. Vuelve a intentarlo mañana.",
  });
  return false;
}

module.exports = { consumir, guardia, clavear, LIMITES, TABLA };
