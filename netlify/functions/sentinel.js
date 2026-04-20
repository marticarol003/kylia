const TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const STATS_URL = "https://sh.dataspace.copernicus.eu/api/v1/statistics";
const CORS      = { "Access-Control-Allow-Origin": "*" };

// Evalscript: NDVI por píxel + dataMask que descarta nubes, sombras, nieve, etc.
// La Statistical API promedia los píxeles válidos dentro de la geometría.
const EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }],
    output: [
      { id: "ndvi",     bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(s) {
  // SCL classes excluidas: 0 no data, 1 saturado, 3 sombra de nube,
  // 8 nube media, 9 nube alta, 10 cirrus, 11 nieve/hielo
  var bad = [0, 1, 3, 8, 9, 10, 11];
  var validScl = bad.indexOf(s.SCL) === -1 ? 1 : 0;
  var ndvi = (s.B08 - s.B04) / (s.B08 + s.B04 + 1e-10);
  return {
    ndvi:     [ndvi],
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

// Statistics API devuelve un array `data[]` con un objeto por intervalo temporal.
// Cogemos el intervalo más reciente que tenga al menos un píxel válido.
function pickLatestValid(statsJson) {
  const items = (statsJson?.data || [])
    .map((d) => {
      const stats = d?.outputs?.ndvi?.bands?.B0?.stats;
      if (!stats) return null;
      const sample = stats.sampleCount || 0;
      const nodata = stats.noDataCount || 0;
      const valid  = sample - nodata;
      if (valid <= 0) return null;
      if (typeof stats.mean !== "number" || Number.isNaN(stats.mean)) return null;
      return { from: d.interval.from, stats, validPixels: valid };
    })
    .filter(Boolean)
    .sort((a, b) => b.from.localeCompare(a.from));

  return items[0] || null;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS };

  const lat = parseFloat(event.queryStringParameters?.lat);
  const lon = parseFloat(event.queryStringParameters?.lon);
  if (isNaN(lat) || isNaN(lon)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "lat/lon requeridos" }) };
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
  if (!tokenRes.ok) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: "Auth failed" }) };
  }
  const { access_token } = await tokenRes.json();

  // ─── Rango temporal: últimos 30 días (Sentinel-2 revisita ~5 días) ─
  const hoy    = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const bounds = buildBounds(event.queryStringParameters?.geometry, lat, lon);

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
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: "Statistics API failed", detail: err }) };
  }

  const statsJson = await statsRes.json();
  const latest    = pickLatestValid(statsJson);

  if (!latest) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ndvi: null, motivo: "sin_datos" }) };
  }

  const ndvi   = +latest.stats.mean.toFixed(3);
  const stdev  = typeof latest.stats.stDev === "number" ? +latest.stats.stDev.toFixed(3) : null;
  const fecha  = latest.from.slice(0, 10);
  const estado = ndvi > 0.6 ? "buena" : ndvi > 0.35 ? "moderada" : "estres";

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      ndvi,
      stdev,
      fecha,
      estado,
      pixeles: latest.validPixels,
    }),
  };
};
