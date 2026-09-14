// ─────────────────────────────────────────────────────────────────
// Serie diaria de clima — UNA sola puerta para todo Kylia
// ─────────────────────────────────────────────────────────────────
// LA REGLA, y es la única: EL PASADO SE MIRA EN EL ARCHIVO Y EL FUTURO EN EL
// PRONÓSTICO. Un día deja de ser pronóstico en cuanto termina.
//
// Hasta el 14-sep-2026 no era así. Había cuatro implementaciones de esto
// (campo.js, diario-b.js, _clima-termico.js y app/index.html), cada una con sus
// umbrales —el archivo solo se pedía si el ciclo pasaba de 60 días, o de 92, o
// nunca— y las cuatro dejaban que el PRONÓSTICO mandara en el solape. O sea que
// una serie larga venía medio del archivo (la parte vieja) y medio del
// pronóstico (la reciente), con un escalón en medio.
//
// Lo que costaba, medido sobre los tres pilotos con el motor real:
//
//   Ferran (Breda)   mezcla 463,9 L/m²  ·  archivo entero 393,6  →  +17,9%
//   Oriol (La Selva) mezcla 343,2       ·  archivo entero 348,2  →   −1,4%
//   Padre (Sant Boi) mezcla 310,8       ·  archivo entero 323,0  →   −3,8%
//
// En Ferran son 17 PUNTOS de ahorro publicado, y el mecanismo está medido: sobre
// los 62 días que las dos fuentes cubren, el pronóstico da +8,7% de ET₀ y 28,2
// mm MENOS de lluvia efectiva. La mezcla no queda entre las dos: se queda con la
// ET₀ alta de una y sin la lluvia de la otra. Es lo peor de cada casa.
//
// ⚠️ POR QUÉ EL ARCHIVO Y NO EL PRONÓSTICO, cuando contra las estaciones de la
// XEMA ninguna de las dos gana claramente. Medido con scripts/valida-clima-xema.mjs
// (evidencia en docs/tecnico/validacion-clima-xema-2026-09-14.json): en ET₀ las
// dos se mueven en un RMSE diario de 0,46-1,43 mm y se turnan según el punto; en
// LLUVIA las dos fallan mucho y en direcciones opuestas —el archivo se pasa un
// +105% en Sant Boi y un +284% en Amposta, el pronóstico se queda corto un −78%
// en Breda—. No hay una fuente "buena" que elegir. Se elige por ESTABILIDAD, no
// por puntería: el pronóstico REESCRIBE el pasado —el mismo día de julio vale
// una cosa hoy y otra dentro de un mes, y a los ~64 días desaparece de su
// respuesta—, así que un balance calculado con él no se puede reconstruir. El
// archivo no se mueve. Para un piloto ciego, que un número de hace dos meses
// siga saliendo igual no es un detalle: es la condición para poder validarlo.
//
// El archivo de Open-Meteo llega HASTA HOY (verificado el 14-sep-2026: último
// día con dato = hoy, en las cuatro coordenadas probadas). El `RETRASO_ARCHIVO`
// de 6 días que había aquí —y los 10 de _clima-termico.js— eran una suposición
// vieja que regalaba casi una semana de pasado al pronóstico sin motivo.

const { fetchConTimeout } = require("./_http.js");
// La REGLA (qué día es hoy en Europe/Madrid, qué fuente manda en cada día, qué
// es un hueco) vive en UN fichero que cargan los dos lados, igual que el motor:
// el servidor por este require y el navegador por <script src>. Aquí solo queda
// la red. Que las cuatro copias de la regla coincidan hoy no impide que dentro
// de tres meses no.
const R = require("../assets/js/clima-reglas.js");

const FORECAST = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE  = "https://archive-api.open-meteo.com/v1/archive";
const TZ       = "Europe%2FMadrid";
const CAMPOS   = "et0_fao_evapotranspiration,precipitation_sum,temperature_2m_max,temperature_2m_min";

const MAX_PAST_FORECAST = 92;    // tope duro de la API de pronóstico
const TTL_MS = 30 * 60 * 1000;
const cache = new Map();

const { hoyISO, sumarDias, diasEntre, diasConDato, procedencia } = R;

async function pedir(url, fuente) {
  const r = await fetchConTimeout(url).catch(() => null);
  if (!r?.ok) return [];
  try { return diasConDato((await r.json()).daily || {}, fuente); }
  catch (_) { return []; }
}

/**
 * Serie diaria desde `desde` (inclusive) hasta hoy + `futuro` días.
 * Cada día lleva su `fuente`: "archivo" | "pronostico".
 * Devuelve un array (lo que esperan los llamantes) para no cambiar firmas.
 */
async function climaSerie(lat, lon, desde, opts = {}) {
  const futuro = Number.isFinite(opts.futuro) ? opts.futuro : 7;
  const hoy    = hoyISO();
  const ini    = desde ? String(desde).slice(0, 10) : sumarDias(hoy, -30);
  const clave  = `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)},${ini},${futuro}`;

  const hit = cache.get(clave);
  if (hit && Date.now() - hit.t < TTL_MS && hit.hoy === hoy) return hit.serie;

  // El pronóstico solo tiene que cubrir HOY y lo que viene, así que se le piden
  // pocos días de pasado: es el archivo quien cubre el histórico.
  //
  // PERO SI EL ARCHIVO SE CAE —y se cae: el 14-sep-2026 archive-api estuvo horas
  // sin responder— con 10 días de margen la serie se quedaba en 13 días para un
  // ciclo de 72. El balance arrancaría casi vacío, el déficit saldría corto y la
  // recomendación empujaría a "no regar", que es la dirección que no se nota y
  // la que cuesta cosecha. Por eso, si el archivo no ha cubierto el pasado, se
  // vuelve a preguntar al pronóstico por todo lo que recuerde (~64 días reales).
  // Sigue siendo una degradación, y `procedencia()` la declara igual.
  const diasCiclo = Math.max(1, diasEntre(ini, hoy));
  const past = Math.min(MAX_PAST_FORECAST, Math.min(10, diasCiclo));
  const [arch, pron] = await Promise.all([
    pedir(`${ARCHIVE}?latitude=${lat}&longitude=${lon}&daily=${CAMPOS}`
          + `&start_date=${ini}&end_date=${hoy}&timezone=${TZ}`, "archivo"),
    pedir(`${FORECAST}?latitude=${lat}&longitude=${lon}&daily=${CAMPOS}`
          + `&past_days=${past}&forecast_days=${Math.max(1, futuro)}&timezone=${TZ}`, "pronostico"),
  ]);

  if (!arch.length && !pron.length) throw new Error("open-meteo sin respuesta");

  // ¿Ha cubierto el archivo el pasado que hacía falta? Si no, segunda pasada al
  // pronóstico con toda su memoria. Solo cuando de verdad falta: en el camino
  // normal no hay petición de más.
  let pronAmplio = pron;
  const faltaPasado = diasCiclo > past &&
    !arch.some(d => d.date <= sumarDias(hoy, -past));
  if (faltaPasado) {
    const ampliado = await pedir(
      `${FORECAST}?latitude=${lat}&longitude=${lon}&daily=${CAMPOS}`
      + `&past_days=${Math.min(MAX_PAST_FORECAST, diasCiclo)}&forecast_days=${Math.max(1, futuro)}&timezone=${TZ}`,
      "pronostico");
    if (ampliado.length > pron.length) pronAmplio = ampliado;
  }

  // Si el archivo no responde, el pronóstico cubre lo que pueda — pero queda
  // MARCADO como pronóstico, así que el balance puede decir que ese día no se
  // calculó con histórico. Degradar en silencio es lo que no se hace aquí.
  // HOY ES DEL PRONÓSTICO, y el corte es estricto (`< hoy`, no `<=`). El archivo
  // sí devuelve un valor para el día en curso —comprobado: 4,25 mm en Breda
  // contra 4,93 del pronóstico, no es un acumulado parcial— pero el día no ha
  // terminado, y la decisión de riego de hoy se toma junto con los días que
  // vienen: que hoy y mañana salgan de fuentes distintas mete el escalón justo
  // en el punto donde se decide. Mañana, cuando hoy sea pasado, el archivo lo
  // sustituye solo. Eso es lo que significa "la previsión deja de mandar en
  // cuanto el día termina".
  return guardar(clave, hoy, R.fusionar(pronAmplio, arch, hoy, ini));
}

function guardar(clave, hoy, serie) {
  cache.set(clave, { t: Date.now(), hoy, serie });
  return serie;
}

module.exports = { climaSerie, procedencia, diasConDato, hoyISO, sumarDias, diasEntre,
                   fusionar: R.fusionar, horaLocal: R.horaLocal, MAX_PAST_FORECAST };
