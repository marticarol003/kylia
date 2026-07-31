const { isConfigured, supabaseSelect, supabaseInsert } = require("./_supabase.js");

const TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const STATS_URL = "https://sh.dataspace.copernicus.eu/api/v1/statistics";

// Calidad mínima para fiarnos de una observación. La nube se filtra por píxel
// (SCL), pero una escena casi toda tapada deja unos pocos supervivientes cuyo
// promedio es RUIDO (así salían todos los pilotos a NDVI ~0,3 con 1 píxel el
// 20-jul). Exigimos un mínimo de píxeles válidos Y una fracción válida alta;
// como las parcelas son diminutas (pocos píxeles a 10 m), la FRACCIÓN es el guard
// robusto (escala-independiente) y el mínimo absoluto solo descarta el caso peor.
// Si ningún paso de los últimos 30 días lo cumple → "sin datos" (mejor que un
// número inventado: el estimador de rendimiento cae al rinde de referencia).
const MIN_PIXELES_VALIDOS = 2;
const MIN_FRACCION_VALIDA = 0.5;

// Cinco índices de las MISMAS cuatro bandas (B04, B05, B08, B11) — añadir OSAVI
// y CIre no cuesta ni una descarga más, solo dos líneas de aritmética por píxel.
//
//   NDVI  (B08/B04)      vigor/biomasa. El histórico y los umbrales de `estado`
//                        van sobre él, así que se queda como estaba.
//   NDMI  (B08/B11)      agua en la hoja. B11 es nativo a 20 m.
//   NDRE  (B08/B05)      red-edge, proxy de N foliar. B05 nativo a 20 m.
//   OSAVI (B08/B04, L)   NDVI CORREGIDO POR SUELO. Con la planta pequeña, el
//                        NDVI mide sobre todo la tierra que se ve entre plantas
//                        y lee vigor bajo aunque el cultivo esté perfecto.
//                        OSAVI mete un término L=0,16 en el denominador que
//                        cancela buena parte de esa señal del suelo (Rondeaux,
//                        Steven & Baret 1996, optimizado justo para cultivo,
//                        mejor que el SAVI clásico de L=0,5).
//   CIre  (B08/B05 − 1)  clorofila en cubierta (Gitelson et al. 2003). Para
//                        NITRÓGENO es mejor que el NDRE: es casi lineal con la
//                        clorofila y NO satura donde el NDVI ya está plano.
//
// OJO con los rangos: NDVI/NDMI/NDRE/OSAVI van en [−1, 1], pero CIre es un
// COCIENTE sin acotar (≈0 en suelo desnudo, 3-8 en cubierta densa). No se puede
// meter en los mismos umbrales ni pintar con la misma escala de color.
//
// OSAVI y CIre se calculan y se guardan, pero NO tocan todavía lo que ve el
// agricultor: `estado` sigue saliendo del NDVI. Cambiarlo exige recalibrar los
// cortes (0,6 / 0,35), porque OSAVI da sistemáticamente MÁS BAJO que el NDVI
// sobre la misma parcela — el +0,16 del denominador. Aplicarle los umbrales del
// NDVI pintaría de "estrés" cultivos sanos. Primero hay que acumular serie de
// los dos a la vez sobre las mismas parcelas; para eso se persisten.
//
// La Statistical API promedia los píxeles válidos dentro de la geometría,
// de forma que cada parcela devuelve valores específicos, no genéricos.
const EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B05", "B08", "B11", "SCL", "dataMask"] }],
    output: [
      { id: "ndvi",     bands: 1, sampleType: "FLOAT32" },
      { id: "ndmi",     bands: 1, sampleType: "FLOAT32" },
      { id: "ndre",     bands: 1, sampleType: "FLOAT32" },
      { id: "osavi",    bands: 1, sampleType: "FLOAT32" },
      { id: "cire",     bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(s) {
  // SCL excluidas: 0 no data, 1 saturado, 3 sombra de nube,
  // 8 nube media, 9 nube alta, 10 cirrus, 11 nieve/hielo
  var bad = [0, 1, 3, 8, 9, 10, 11];
  var validScl = bad.indexOf(s.SCL) === -1 ? 1 : 0;
  var ndvi  = (s.B08 - s.B04) / (s.B08 + s.B04 + 1e-10);
  var ndmi  = (s.B08 - s.B11) / (s.B08 + s.B11 + 1e-10);
  var ndre  = (s.B08 - s.B05) / (s.B08 + s.B05 + 1e-10);
  // OSAVI: L = 0,16 (Rondeaux 1996). Sin el factor (1+L): es la forma que usan
  // Sentinel Hub y la mayoría de la literatura agronómica.
  var osavi = (s.B08 - s.B04) / (s.B08 + s.B04 + 0.16);
  // CIre: el red-edge en el denominador. Sobre suelo desnudo B05 se acerca a
  // cero y el cociente se dispara, así que se acota a 10 — por encima de ~8 ya
  // no es cubierta agrícola, es un artefacto.
  var cire  = Math.min(10, s.B08 / (s.B05 + 1e-6) - 1);
  return {
    ndvi:     [ndvi],
    ndmi:     [ndmi],
    ndre:     [ndre],
    osavi:    [osavi],
    cire:     [cire],
    dataMask: [s.dataMask * validScl]
  };
}`;

function buildBounds(geometryParam, lat, lon) {
  const d = 0.001;
  if (geometryParam) {
    try {
      return {
        geometry:   JSON.parse(geometryParam),
        properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" },
      };
    } catch (_) {
      // cae al bbox
    }
  }
  return {
    bbox:       [lon - d, lat - d, lon + d, lat + d],
    properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" },
  };
}

// Índices que se leen de cada paso. Una lista en vez de una variable por índice:
// añadir el siguiente es tocar aquí y nada más.
const INDICES = ["ndvi", "ndmi", "ndre", "osavi", "cire"];

function pickLatestValid(statsJson) {
  const items = (statsJson?.data || [])
    .map((d) => {
      const stats = {};
      for (const id of INDICES) stats[id] = d?.outputs?.[id]?.bands?.B0?.stats || null;
      // El NDVI manda: es el que decide si el paso vale. Los demás índices salen
      // de las mismas bandas y la misma máscara, así que si falta alguno es que
      // la petición no lo pidió (despliegue viejo) — se degrada a null, no rompe.
      if (!stats.ndvi) return null;
      const sample = stats.ndvi.sampleCount || 0;
      const nodata = stats.ndvi.noDataCount || 0;
      const valid  = sample - nodata;
      const fraccion = sample > 0 ? valid / sample : 0;
      // Guard de calidad: descarta pasos casi todos enmascarados por nube.
      if (valid < MIN_PIXELES_VALIDOS || fraccion < MIN_FRACCION_VALIDA) return null;
      if (typeof stats.ndvi.mean !== "number" || Number.isNaN(stats.ndvi.mean)) return null;
      return {
        from: d.interval.from, stats,
        validPixels: valid, fraccionValida: Math.round(fraccion * 100) / 100,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.from.localeCompare(a.from));

  return items[0] || null;
}

// OAuth2 Copernicus: un token, reutilizable para varias parcelas en un lote.
async function obtenerToken() {
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "client_credentials",
      client_id:     process.env.CDSE_CLIENT_ID,
      client_secret: process.env.CDSE_CLIENT_SECRET,
    }),
  });
  if (!tokenRes.ok) return null;
  const j = await tokenRes.json();
  return j.access_token || null;
}

// Mide UNA parcela: Statistical API sobre su geometría (o bbox del punto) en los
// últimos 30 días, se queda con la observación válida más reciente. Devuelve el
// objeto de medición o null (sin paso limpio). Lanza si la API responde error.
async function medirParcela(token, lat, lon, geometry) {
  const hoy    = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const bounds = buildBounds(geometry, lat, lon);

  const statsReq = {
    input: { bounds, data: [{ type: "sentinel-2-l2a", dataFilter: { maxCloudCoverage: 60 } }] },
    aggregation: {
      timeRange:           { from: `${hace30}T00:00:00Z`, to: `${hoy}T23:59:59Z` },
      aggregationInterval: { of: "P1D" },
      evalscript:          EVALSCRIPT,
      resx: 10, resy: 10,
    },
  };

  const statsRes = await fetch(STATS_URL, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept":       "application/json",
    },
    body: JSON.stringify(statsReq),
  });
  if (!statsRes.ok) throw new Error(`Statistics API ${statsRes.status}: ${await statsRes.text()}`);

  const latest = pickLatestValid(await statsRes.json());
  if (!latest) return null;

  // Media y desviación de un índice, redondeadas, o null si ese índice no vino.
  const r3  = (x) => (typeof x === "number" && !Number.isNaN(x) ? +x.toFixed(3) : null);
  const med = (id) => (latest.stats[id] ? r3(latest.stats[id].mean)  : null);
  const dev = (id) => (latest.stats[id] ? r3(latest.stats[id].stDev) : null);

  const ndvi = med("ndvi");
  return {
    ndvi,
    stdev:      dev("ndvi"),
    ndmi:       med("ndmi"),  ndmiStdev:  dev("ndmi"),
    ndre:       med("ndre"),  ndreStdev:  dev("ndre"),
    osavi:      med("osavi"), osaviStdev: dev("osavi"),
    cire:       med("cire"),  cireStdev:  dev("cire"),
    fecha:      latest.from.slice(0, 10),
    // `estado` sigue saliendo del NDVI a propósito: los cortes están calibrados
    // sobre él y sobre su histórico. Ver la nota del EVALSCRIPT.
    estado:     ndvi > 0.6 ? "buena" : ndvi > 0.35 ? "moderada" : "estres",
    pixeles:    latest.validPixels,
    fraccion_valida: latest.fraccionValida,
  };
}

// ─── Refresco por lote (el puente que faltaba) ────────────────────────
// Sentinel calculaba pero NADIE lo persistía → `mediciones` sin NDVI → el factor
// de vigor del rendimiento (y la señal NDRE de nutrición) quedaban inertes. Este
// modo recorre los pilotos con coordenadas y escribe su NDVI/NDMI/NDRE en
// `mediciones`. Lo dispara el cron sentinel-refresh (GitHub Actions). Protegido con
// SENTINEL_TOKEN opcional (mismo patrón que AVISO_TOKEN). El NDRE (red-edge, proxy de
// N foliar) se persiste desde el ALTER de db/anadir-ndre-mediciones-2026-07-23.sql.
async function refrescarMediciones(req, res) {
  if (process.env.SENTINEL_TOKEN) {
    const t = (req.query?.token || req.headers["x-sentinel-token"] || "").toString();
    if (t !== process.env.SENTINEL_TOKEN) return res.status(401).json({ error: "no autorizado" });
  }
  if (!isConfigured()) return res.status(200).json({ ok: false, reason: "supabase_not_configured" });

  const cdseToken = await obtenerToken();
  if (!cdseToken) {
    return res.status(502).json({ ok: false, error: "Copernicus auth failed (revisa CDSE_CLIENT_ID / CDSE_CLIENT_SECRET en Vercel)" });
  }

  const pilotos = await supabaseSelect("usuarios",
    "piloto_sombra=eq.true&lat=not.is.null&lon=not.is.null&select=id,lat,lon,parcela,nombre");

  let escritos = 0, sinDatos = 0, errores = 0;
  for (const u of (pilotos || [])) {
    try {
      // Geometría real del recinto si el onboarding la guardó; si no, bbox del punto.
      const geom = u.parcela && u.parcela.geometry ? JSON.stringify(u.parcela.geometry) : null;
      const m = await medirParcela(cdseToken, Number(u.lat), Number(u.lon), geom);
      if (!m) { sinDatos++; continue; }
      await supabaseInsert("mediciones", {
        usuario_id: u.id, fecha: m.fecha,
        ndvi:  m.ndvi,  ndmi: m.ndmi, ndmi_stdev: m.ndmiStdev,
        ndre:  m.ndre,  ndre_stdev:  m.ndreStdev,
        // OSAVI/CIre aún no se enseñan; se acumulan para poder calibrarlos
        // contra el NDVI sobre las mismas parcelas y los mismos días.
        osavi: m.osavi, osavi_stdev: m.osaviStdev,
        cire:  m.cire,  cire_stdev:  m.cireStdev,
        fuente: "sentinel-2",
      }, { upsert: true });
      escritos++;
    } catch (e) {
      console.error("[sentinel-refresh]", u.id, e.message);
      errores++;
    }
  }

  const resultado = {
    ok: errores === 0, generado_en: new Date().toISOString(),
    pilotos: (pilotos || []).length, escritos, sin_datos: sinDatos, errores,
  };
  // Si había parcelas y NINGUNA se escribió por error, 500 → el cron avisa con ruido.
  if ((pilotos || []).length > 0 && escritos === 0 && errores > 0) return res.status(500).json(resultado);
  return res.status(200).json(resultado);
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();

  // Modo lote (cron): escribe el NDVI de todos los pilotos en `mediciones`.
  if (req.query?.refresh === "1" || req.query?.refresh === "true") {
    try { return await refrescarMediciones(req, res); }
    catch (e) { console.error("[sentinel-refresh]", e.message); return res.status(500).json({ ok: false, error: e.message }); }
  }

  // Modo punto: NDVI de UNA parcela (lat/lon[/geometry]). Lo usa la app/landing.
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ error: "lat/lon requeridos" });

  const token = await obtenerToken();
  if (!token) return res.status(502).json({ error: "Auth failed" });

  let m;
  try { m = await medirParcela(token, lat, lon, req.query.geometry); }
  catch (e) { return res.status(502).json({ error: "Statistics API failed", detail: e.message }); }

  if (!m) return res.status(200).json({ ndvi: null, motivo: "sin_datos" });
  return res.status(200).json(m);
};

// Expuestos para test (Vercel llama a la función; los tests leen estas props).
module.exports.pickLatestValid = pickLatestValid;
module.exports.MIN_PIXELES_VALIDOS = MIN_PIXELES_VALIDOS;
module.exports.MIN_FRACCION_VALIDA = MIN_FRACCION_VALIDA;
