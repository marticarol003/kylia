// ─────────────────────────────────────────────────────────────────
// Clima TÉRMICO: la temperatura que mueve el reloj del cultivo
// ─────────────────────────────────────────────────────────────────
// El motor dejó de contar días y pasó a contar calor (ver FAO_GDD en
// assets/js/motor-riego.js). Para eso hace falta la temperatura de TODO el
// ciclo, desde el día de la plantación — y ahí hay un límite que obliga a este
// módulo: la API de pronóstico de Open-Meteo solo devuelve 92 días de pasado.
// Un tomate son 145. Sin cubrir el arranque del ciclo la suma térmica va corta
// y el cultivo parece más joven de lo que es, que es justo el defecto que
// veníamos a arreglar, así que el motor prefiere volver al calendario antes que
// usar media serie. Este módulo es lo que evita tener que elegir:
//
//   [plantación … hoy−92]  → API de archivo   (histórico, con ~5 días de retraso)
//   [hoy−92 … hoy+16]      → API de pronóstico (pasado reciente + previsión)
//
// Y las NORMALES MENSUALES del sitio, que son lo que permite proyectar la
// madurez más allá del pronóstico: a un tomate le pueden quedar 60 días y nadie
// tiene una previsión a 60 días. Con las medias de los últimos 10 años sí se
// puede decir "hacia mediados de octubre", que es lo que el agricultor necesita.
//
// Todo cacheado en memoria: son datos que no cambian (el histórico no se
// reescribe, las normales se mueven en décadas) y cada refresco de /campo o
// /pilotos preguntaría por todos los pilotos a la vez.

const { fetchConTimeout } = require("./_http.js");

const FORECAST = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE  = "https://archive-api.open-meteo.com/v1/archive";
const TZ       = "Europe%2FMadrid";

// MISMA REGLA QUE api/_clima.js: el pasado se mira en el archivo y el futuro en
// el pronóstico. Aquí había un `RETRASO_ARCHIVO_DIAS = 10` —y campo.js tenía un
// 6— que daban por hecho que el archivo iba con retraso. No va: comprobado el
// 14-sep-2026, tiene dato de hoy en las cuatro coordenadas probadas. Ese margen
// le regalaba al pronóstico diez días de pasado, y con ellos el reloj térmico de
// un mismo día cambiaba según cuándo se consultara.
const MAX_PAST_FORECAST = 92;   // tope de la API de pronóstico

const cache = new Map();
const TTL = { serie: 6 * 3600e3, normales: 30 * 24 * 3600e3 };

// La regla de clima (día civil en Europe/Madrid, quién manda en cada día) sale
// del MISMO fichero que usa api/_clima.js y que carga la app. Aquí vivía la
// tercera copia: su hoyISO iba en UTC, así que en la franja de medianoche el
// reloj térmico podía coger del pronóstico un día que ya era pasado.
const R = require("../assets/js/clima-reglas.js");
const { hoyISO, sumarDias, diasEntre } = R;

function guardado(clave, ttl) {
  const hit = cache.get(clave);
  return hit && Date.now() - hit.t < ttl ? hit.v : null;
}
function guardar(clave, v) { cache.set(clave, { t: Date.now(), v }); return v; }

function aSerie(d, fuente) {
  return (d?.time || []).map((date, i) => ({
    date,
    tmax: d.temperature_2m_max?.[i] ?? null,
    tmin: d.temperature_2m_min?.[i] ?? null,
    fuente: fuente || null,          // para poder declarar de dónde salió el calor
  })).filter(x => x.tmax != null && x.tmin != null);
}

async function pedir(url, fuente) {
  const res = await fetchConTimeout(url);
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  return aSerie((await res.json()).daily, fuente);
}

// Serie diaria de Tmax/Tmin desde `desde` (la plantación) hasta +16 días.
// Devuelve [] si no hay coordenadas o fecha: quien llame se queda sin reloj
// térmico y el motor sigue con el calendario, que es el comportamiento seguro.
async function serieTermica(lat, lon, desde) {
  if (lat == null || lon == null || !desde) return [];
  const ini   = String(desde).slice(0, 10);
  const clave = `s:${Number(lat).toFixed(3)},${Number(lon).toFixed(3)},${ini}`;
  const hit   = guardado(clave, TTL.serie);
  if (hit) return hit;

  const hoy   = hoyISO();
  const atras = Math.max(1, diasEntre(ini, hoy) + 1);
  const past  = Math.min(MAX_PAST_FORECAST, Math.min(10, atras));

  // El pronóstico cubre HOY y los 16 días que vienen (el reloj térmico proyecta
  // el final del ciclo); el archivo cubre todo el pasado, desde la plantación.
  const partes = await Promise.all([
    pedir(`${FORECAST}?latitude=${lat}&longitude=${lon}`
          + `&daily=temperature_2m_max,temperature_2m_min`
          + `&past_days=${past}&forecast_days=16&timezone=${TZ}`, "pronostico").catch(() => []),
    pedir(`${ARCHIVE}?latitude=${lat}&longitude=${lon}`
          + `&start_date=${ini}&end_date=${hoy}`
          + `&daily=temperature_2m_max,temperature_2m_min&timezone=${TZ}`, "archivo").catch(() => []),
  ]);

  // MISMA fusión que el clima de riego, del mismo fichero: pasado → archivo,
  // hoy y futuro → pronóstico, y lo que el archivo no cubra queda marcado.
  return guardar(clave, R.fusionar(partes[0], partes[1], hoy, ini));
}

// Medias mensuales de los últimos `anios` años completos, para proyectar más
// allá del pronóstico. Se piden años CERRADOS (hasta el 31-dic pasado) para que
// la normal no se mueva según el día en que se consulte.
async function normalesMensuales(lat, lon, anios = 10) {
  if (lat == null || lon == null) return null;
  const clave = `n:${Number(lat).toFixed(2)},${Number(lon).toFixed(2)},${anios}`;
  const hit   = guardado(clave, TTL.normales);
  if (hit) return hit;

  const finAnio = new Date().getUTCFullYear() - 1;
  let serie;
  try {
    serie = await pedir(
      `${ARCHIVE}?latitude=${lat}&longitude=${lon}`
      + `&start_date=${finAnio - anios + 1}-01-01&end_date=${finAnio}-12-31`
      + `&daily=temperature_2m_max,temperature_2m_min&timezone=${TZ}`);
  } catch (_) { return null; }

  const { normalesMensuales: calcular } = require("./_motor-riego.js");
  return guardar(clave, calcular(serie));
}

module.exports = { serieTermica, normalesMensuales };
