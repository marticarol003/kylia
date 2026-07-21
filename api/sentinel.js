const { isConfigured, supabaseSelect, supabaseInsert } = require("./_supabase.js");

const TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const STATS_URL = "https://sh.dataspace.copernicus.eu/api/v1/statistics";

// NDVI (B04/B08) + NDMI (B08/B11) + NDRE (B08/B05) + dataMask.
// NDVI = vigor/biomasa; NDMI = agua en la hoja; NDRE = proxy de estado de
// NITRÓGENO (el red-edge B05 es donde absorbe la clorofila, y el N foliar va
// casi todo en clorofila). Señal RELATIVA: sin calibrar contra nitrato en
// tejido es "más/menos verde", no kg — se reporta como tal (ver pilar de
// fertilizantes). B05 es nativo a 20 m: en parcelas pequeñas, menos fiable.
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
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(s) {
  // SCL excluidas: 0 no data, 1 saturado, 3 sombra de nube,
  // 8 nube media, 9 nube alta, 10 cirrus, 11 nieve/hielo
  var bad = [0, 1, 3, 8, 9, 10, 11];
  var validScl = bad.indexOf(s.SCL) === -1 ? 1 : 0;
  var ndvi = (s.B08 - s.B04) / (s.B08 + s.B04 + 1e-10);
  var ndmi = (s.B08 - s.B11) / (s.B08 + s.B11 + 1e-10);
  var ndre = (s.B08 - s.B05) / (s.B08 + s.B05 + 1e-10);
  return {
    ndvi:     [ndvi],
    ndmi:     [ndmi],
    ndre:     [ndre],
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

function pickLatestValid(statsJson) {
  const items = (statsJson?.data || [])
    .map((d) => {
      const statsNdvi = d?.outputs?.ndvi?.bands?.B0?.stats;
      const statsNdmi = d?.outputs?.ndmi?.bands?.B0?.stats;
      const statsNdre = d?.outputs?.ndre?.bands?.B0?.stats;
      if (!statsNdvi) return null;
      const sample = statsNdvi.sampleCount || 0;
      const nodata = statsNdvi.noDataCount || 0;
      const valid  = sample - nodata;
      if (valid <= 0) return null;
      if (typeof statsNdvi.mean !== "number" || Number.isNaN(statsNdvi.mean)) return null;
      return { from: d.interval.from, statsNdvi, statsNdmi, statsNdre, validPixels: valid };
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

  const num = (x) => (typeof x === "number" && !Number.isNaN(x) ? x : null);
  const ndvi = +latest.statsNdvi.mean.toFixed(3);
  return {
    ndvi,
    stdev:     num(latest.statsNdvi.stDev) != null ? +latest.statsNdvi.stDev.toFixed(3) : null,
    ndmi:      latest.statsNdmi && num(latest.statsNdmi.mean)  != null ? +latest.statsNdmi.mean.toFixed(3)  : null,
    ndmiStdev: latest.statsNdmi && num(latest.statsNdmi.stDev) != null ? +latest.statsNdmi.stDev.toFixed(3) : null,
    ndre:      latest.statsNdre && num(latest.statsNdre.mean)  != null ? +latest.statsNdre.mean.toFixed(3)  : null,
    ndreStdev: latest.statsNdre && num(latest.statsNdre.stDev) != null ? +latest.statsNdre.stDev.toFixed(3) : null,
    fecha:     latest.from.slice(0, 10),
    estado:    ndvi > 0.6 ? "buena" : ndvi > 0.35 ? "moderada" : "estres",
    pixeles:   latest.validPixels,
  };
}

// ─── Refresco por lote (el puente que faltaba) ────────────────────────
// Sentinel calculaba pero NADIE lo persistía → `mediciones` sin NDVI → el factor
// de vigor del rendimiento (y la señal NDRE de nutrición) quedaban inertes. Este
// modo recorre los pilotos con coordenadas y escribe su NDVI/NDMI en `mediciones`.
// Lo dispara el cron sentinel-refresh (GitHub Actions). Protegido con SENTINEL_TOKEN
// opcional (mismo patrón que AVISO_TOKEN). La tabla no tiene columna ndre hoy: se
// persiste ndvi/ndmi; ndre queda como follow-up (necesita ALTER + señal de N).
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
        ndvi: m.ndvi, ndmi: m.ndmi, ndmi_stdev: m.ndmiStdev,
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
