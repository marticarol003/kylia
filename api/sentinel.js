const TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const STATS_URL = "https://sh.dataspace.copernicus.eu/api/v1/statistics";

// NDVI (B04/B08) + NDMI (B08/B11) + dataMask.
// NDVI = vigor/biomasa; NDMI = contenido de agua en la hoja.
// La Statistical API promedia los píxeles válidos dentro de la geometría,
// de forma que cada parcela devuelve valores específicos, no genéricos.
const EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "B11", "SCL", "dataMask"] }],
    output: [
      { id: "ndvi",     bands: 1, sampleType: "FLOAT32" },
      { id: "ndmi",     bands: 1, sampleType: "FLOAT32" },
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
  return {
    ndvi:     [ndvi],
    ndmi:     [ndmi],
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
      if (!statsNdvi) return null;
      const sample = statsNdvi.sampleCount || 0;
      const nodata = statsNdvi.noDataCount || 0;
      const valid  = sample - nodata;
      if (valid <= 0) return null;
      if (typeof statsNdvi.mean !== "number" || Number.isNaN(statsNdvi.mean)) return null;
      return { from: d.interval.from, statsNdvi, statsNdmi, validPixels: valid };
    })
    .filter(Boolean)
    .sort((a, b) => b.from.localeCompare(a.from));

  return items[0] || null;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();

  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (isNaN(lat) || isNaN(lon)) {
    return res.status(400).json({ error: "lat/lon requeridos" });
  }

  // ─── OAuth2 Copernicus ────────────────────────────────────────────
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "client_credentials",
      client_id:     process.env.CDSE_CLIENT_ID,
      client_secret: process.env.CDSE_CLIENT_SECRET,
    }),
  });
  if (!tokenRes.ok) return res.status(502).json({ error: "Auth failed" });
  const { access_token } = await tokenRes.json();

  // Rango: últimos 30 días. Se queda con la observación válida más reciente.
  const hoy    = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const bounds = buildBounds(req.query.geometry, lat, lon);

  const statsReq = {
    input: {
      bounds,
      data: [{
        type: "sentinel-2-l2a",
        dataFilter: { maxCloudCoverage: 60 },
      }],
    },
    aggregation: {
      timeRange:           { from: `${hace30}T00:00:00Z`, to: `${hoy}T23:59:59Z` },
      aggregationInterval: { of: "P1D" },
      evalscript:          EVALSCRIPT,
      resx: 10,
      resy: 10,
    },
  };

  const statsRes = await fetch(STATS_URL, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${access_token}`,
      "Content-Type": "application/json",
      "Accept":       "application/json",
    },
    body: JSON.stringify(statsReq),
  });

  if (!statsRes.ok) {
    const err = await statsRes.text();
    return res.status(502).json({ error: "Statistics API failed", detail: err });
  }

  const statsJson = await statsRes.json();
  const latest    = pickLatestValid(statsJson);

  if (!latest) {
    return res.status(200).json({ ndvi: null, motivo: "sin_datos" });
  }

  const ndvi   = +latest.statsNdvi.mean.toFixed(3);
  const stdev  = typeof latest.statsNdvi.stDev === "number" ? +latest.statsNdvi.stDev.toFixed(3) : null;
  const ndmi      = latest.statsNdmi && typeof latest.statsNdmi.mean === "number"
    ? +latest.statsNdmi.mean.toFixed(3) : null;
  const ndmiStdev = latest.statsNdmi && typeof latest.statsNdmi.stDev === "number"
    ? +latest.statsNdmi.stDev.toFixed(3) : null;
  const fecha  = latest.from.slice(0, 10);
  const estado = ndvi > 0.6 ? "buena" : ndvi > 0.35 ? "moderada" : "estres";

  return res.status(200).json({
    ndvi,
    stdev,
    ndmi,
    ndmiStdev,
    fecha,
    estado,
    pixeles: latest.validPixels,
  });
};
