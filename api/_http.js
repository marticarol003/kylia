// ─────────────────────────────────────────────────────────────────
// Toda salida a internet, con reloj
// ─────────────────────────────────────────────────────────────────
// Hasta el 9-sep-2026 NINGUNA de las ~25 llamadas externas del backend tenía
// timeout: ni Open-Meteo, ni SoilGrids, ni SIGPAC, ni Copernicus, ni Gemini, ni
// Anthropic, ni Stripe, ni Supabase, ni Resend. `fetch` sin `signal` espera lo
// que haga falta.
//
// No es teórico. El 9-sep, con SoilGrids lento, tests/test-suelo-oferta.mjs pasó
// de ~1 s a 307 s — y acabó pasando, o sea que ni siquiera falla: se queda ahí.
// En un test eso es una CI tostándose; en producción es una función serverless
// colgada gastando tiempo facturable, que es exactamente el agujero de coste que
// acabamos de tapar por el otro lado con _limite.js. Y `_suelo-oferta.js` lo
// multiplica: si el punto central falla, reintenta en puntos vecinos.
//
// ⚠️ EL LÍMITE LO MANDA LA FUNCIÓN, NO EL PROVEEDOR. Esto es lo que hace que los
// números de abajo no sean arbitrarios. Vercel mata la función a los
// `maxDuration` segundos y el cliente recibe un 504 sin explicación; si el
// timeout del fetch es más largo que ese presupuesto, no sirve de nada porque
// nunca llega a dispararse. Así que cada límite se elige para caber DENTRO del
// presupuesto de la función que lo llama, dejando margen para responder un error
// decente en vez de morir.
//
//   api/ia.js e api/informe-cientifico.js → maxDuration 60 s (vercel.json)
//   todo lo demás                        → el de la plataforma (10 s en Hobby)
//
// Si algún día se sube el plan y el maxDuration, estos números se pueden subir;
// mientras tanto, subirlos sería mentirse.
//
// NO HAY REINTENTOS aquí, a propósito. Varias de estas llamadas ESCRIBEN
// (Supabase, Resend, Stripe, el registro del Diario B), y reintentar a ciegas
// una escritura que quizá sí llegó es cómo se duplican cobros y correos. Un
// reintento seguro necesita idempotencia caso por caso — Stripe ya la tiene con
// su Idempotency-Key — y eso se decide en cada sitio, no aquí.

// Milisegundos por host. La clave es el sufijo del hostname.
const LIMITES = [
  // Lentos y pesados, pero solo se llaman desde funciones con 60 s.
  ["api.anthropic.com",                 45000],  // Claude + búsqueda web en vivo
  ["generativelanguage.googleapis.com", 30000],  // Gemini
  // Copernicus: el procesado de una escena tarda de verdad. Lo llama el cron de
  // sentinel (sin límite de plataforma estrecho) y /api/sentinel en modo punto.
  ["sh.dataspace.copernicus.eu",        25000],
  ["identity.dataspace.copernicus.eu",   8000],  // solo pide un token
  // El resto vive dentro del presupuesto por defecto de 10 s.
  ["api.stripe.com",                     8000],
  ["api.resend.com",                     8000],
  ["api.callmebot.com",                  8000],
  ["archive-api.open-meteo.com",         8000],
  ["api.open-meteo.com",                 8000],
  ["sigpac.mapa.es",                     8000],
  ["supabase.co",                        8000],  // nuestra propia base de datos
  ["kylia.app",                          8000],  // llamadas de un endpoint a otro
  // SoilGrids es el que provocó todo esto y además tiene reintento por vecinos:
  // cuanto antes se rinda, mejor — el fallback ya cubre el fallo.
  ["rest.isric.org",                     6000],
];
const POR_DEFECTO = 8000;

function limiteDe(url) {
  let host = "";
  try { host = new URL(String(url)).hostname; } catch (_) { return POR_DEFECTO; }
  for (const [sufijo, ms] of LIMITES) {
    if (host === sufijo || host.endsWith(`.${sufijo}`)) return ms;
  }
  return POR_DEFECTO;
}

// Error propio para poder distinguir "tardó demasiado" de "respondió mal".
class TiempoAgotado extends Error {
  constructor(url, ms) {
    let host = url; try { host = new URL(String(url)).hostname; } catch (_) {}
    super(`tiempo agotado tras ${ms} ms: ${host}`);
    this.name = "TiempoAgotado";
    this.timeout_ms = ms;
    this.host = host;
  }
}

// Igual que fetch, pero con reloj.
//   opts.timeoutMs  → fuerza el límite (si no, sale de la tabla por host)
//   opts.fetchImpl  → inyectable, para probar sin red
async function fetchConTimeout(url, opts = {}) {
  const { timeoutMs, fetchImpl, ...resto } = opts;
  const ms = Number.isFinite(timeoutMs) ? timeoutMs : limiteDe(url);
  const doFetch = fetchImpl || globalThis.fetch;

  // AbortController a mano y no AbortSignal.timeout: así se puede limpiar el
  // temporizador en el finally. Un timer vivo mantiene despierto el bucle de
  // eventos, y en una lambda eso es tiempo facturado por no hacer nada.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await doFetch(url, { ...resto, signal: ctrl.signal });
  } catch (err) {
    // Solo se traduce si abortamos NOSOTROS: si el que llama trae su propio
    // motivo de cancelación, se deja pasar tal cual.
    if (ctrl.signal.aborted) throw new TiempoAgotado(url, ms);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

module.exports = { fetchConTimeout, limiteDe, TiempoAgotado, LIMITES, POR_DEFECTO };
