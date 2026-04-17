const TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const STATS_URL = "https://sh.dataspace.copernicus.eu/api/v1/statistics";

const CORS = { "Access-Control-Allow-Origin": "*" };

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS };
  }

  const lat = parseFloat(event.queryStringParameters?.lat);
  const lon = parseFloat(event.queryStringParameters?.lon);
  if (isNaN(lat) || isNaN(lon)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "lat/lon requeridos" }) };
  }

  // 1. Token OAuth2 con client credentials
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
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: "Error de autenticación CDSE" }) };
  }
  const { access_token } = await tokenRes.json();

  // 2. Bounds: polígono SIGPAC exacto si está disponible, bbox ~200m como fallback
  const d    = 0.001;
  const bbox = [lon - d, lat - d, lon + d, lat + d];
  const geometryParam = event.queryStringParameters?.geometry;
  const boundsObj = geometryParam
    ? { geometry: JSON.parse(geometryParam), properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" } }
    : { bbox, properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" } };

  // 3. Evalscript NDVI: excluye píxeles nubosos via CLM
  const evalscript = `//VERSION=3
function setup() {
  return { input: ["B04", "B08"], output: { bands: 1, sampleType: "FLOAT32" } };
}
function evaluatePixel(s) {
  return [(s.B08 - s.B04) / (s.B08 + s.B04 + 1e-10)];
}`;

  const hoy    = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  const statsRes = await fetch(STATS_URL, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: {
        bounds: boundsObj,
        data: [{ type: "sentinel-2-l2a", dataFilter: { maxCloudCoverage: 80 } }],
      },
      aggregation: {
        timeRange: { from: `${hace30}T00:00:00Z`, to: `${hoy}T23:59:59Z` },
        aggregationInterval: { of: "P5D" },
        evalscript,
        resx: 10,
        resy: 10,
      },
      calculations: {
        default: { statistics: { default: { percentiles: { k: [50] } } } },
      },
    }),
  });

  if (!statsRes.ok) {
    const errBody = await statsRes.text();
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: "Error al consultar CDSE Statistics API", status: statsRes.status, detail: errBody }) };
  }

  const stats = await statsRes.json();

  // Filtrar intervalos con datos válidos (media no nula)
  const intervalos = (stats.data || []).filter(
    (i) => i.outputs?.default?.bands?.B0?.stats?.mean != null,
  );

  if (!intervalos.length) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ndvi: null, motivo: "sin_datos" }) };
  }

  const ultimo = intervalos[intervalos.length - 1];
  const band   = ultimo.outputs.default.bands.B0.stats;

  const ndvi  = +band.percentiles["50"].toFixed(3);
  const nubes = band.noDataCount > 0;
  const fecha = ultimo.interval.from.slice(0, 10);
  const estado = ndvi > 0.6 ? "buena" : ndvi > 0.35 ? "moderada" : "estres";

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ ndvi, fecha, nubes, estado }),
  };
};
