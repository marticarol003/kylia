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

const FORECAST = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE  = "https://archive-api.open-meteo.com/v1/archive";
const TZ       = "Europe%2FMadrid";

// El archivo va con retraso; por debajo de esto no se le pregunta y manda el
// pronóstico, que sí tiene el pasado reciente.
const RETRASO_ARCHIVO_DIAS = 10;
const MAX_PAST_FORECAST    = 92;   // tope de la API de pronóstico

const cache = new Map();
const TTL = { serie: 6 * 3600e3, normales: 30 * 24 * 3600e3 };

function hoyISO()             { return new Date().toISOString().slice(0, 10); }
function sumarDias(iso, n)    { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function diasEntre(a, b)      { return Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000); }

function guardado(clave, ttl) {
  const hit = cache.get(clave);
  return hit && Date.now() - hit.t < ttl ? hit.v : null;
}
function guardar(clave, v) { cache.set(clave, { t: Date.now(), v }); return v; }

function aSerie(d) {
  return (d?.time || []).map((date, i) => ({
    date,
    tmax: d.temperature_2m_max?.[i] ?? null,
    tmin: d.temperature_2m_min?.[i] ?? null,
  })).filter(x => x.tmax != null && x.tmin != null);
}

async function pedir(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  return aSerie((await res.json()).daily);
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

  const hoy      = hoyISO();
  const atras    = Math.max(1, diasEntre(ini, hoy) + 1);
  const past     = Math.min(MAX_PAST_FORECAST, atras);
  const cortePrn = sumarDias(hoy, -past);            // primer día que cubre el pronóstico

  const tareas = [pedir(
    `${FORECAST}?latitude=${lat}&longitude=${lon}`
    + `&daily=temperature_2m_max,temperature_2m_min`
    + `&past_days=${past}&forecast_days=16&timezone=${TZ}`)];

  // ¿Se queda ciclo por debajo del pronóstico? Entonces el archivo cubre la cola.
  if (ini < cortePrn) {
    const fin = sumarDias(hoy, -RETRASO_ARCHIVO_DIAS);
    tareas.push(pedir(
      `${ARCHIVE}?latitude=${lat}&longitude=${lon}`
      + `&start_date=${ini}&end_date=${fin < ini ? ini : fin}`
      + `&daily=temperature_2m_max,temperature_2m_min&timezone=${TZ}`));
  }

  const partes = await Promise.all(tareas.map(t => t.catch(() => [])));
  // El pronóstico manda en el solape: es la observación más fresca del mismo día.
  const mapa = new Map();
  for (const p of partes.slice(1)) for (const d of p) mapa.set(d.date, d);
  for (const d of partes[0])                          mapa.set(d.date, d);

  const serie = [...mapa.values()]
    .filter(d => d.date >= ini)
    .sort((a, b) => a.date.localeCompare(b.date));
  return guardar(clave, serie);
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
