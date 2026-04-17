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
    const e = await tokenRes.text();
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: "Auth failed", detail: e }) };
  }
  const { access_token } = await tokenRes.json();

  const d = 0.001;
  const bbox = [lon - d, lat - d, lon + d, lat + d];
  const geometryParam = event.queryStringParameters?.geometry;
  const bounds = geometryParam
    ? { geometry: JSON.parse(geometryParam), properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" } }
    : { bbox, properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" } };

  const evalscript = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08"] }],
    output: [{ id: "ndvi", bands: 1 }]
  };
}
function evaluatePixel(s) {
  return { ndvi: [(s.B08 - s.B04) / (s.B08 + s.B04 + 1e-10)] };
}`;

  const hoy    = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  const statsRes = await fetch(STATS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      input: {
        bounds,
        data: [{ type: "sentinel-2-l2a", dataFilter: { maxCloudCoverage: 80 } }],
      },
      aggregation: {
        timeRange: { from: `${hace30}T00:00:00Z`, to: `${hoy}T23:59:59Z` },
        aggregationInterval: { of: "P5D" },
        evalscript,
        resx: 10,
        resy: 10,
      },
      calculations: { ndvi: {} },
    }),
  });

  if (!statsRes.ok) {
    const errBody = await statsRes.text();
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: "Stats API failed", status: statsRes.status, detail: errBody }) };
  }

  const stats = await statsRes.json();

  const intervalos = (stats.data || []).filter(
    (i) => i.outputs?.ndvi?.bands?.B0?.stats?.mean != null
  );

  if (!intervalos.length) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ndvi: null, motivo: "sin_datos" }) };
  }

  const ultimo = intervalos[intervalos.length - 1];
  const band   = ultimo.outputs.ndvi.bands.B0.stats;
  const ndvi   = +(band.mean).toFixed(3);
  const fecha  = ultimo.interval.from.slice(0, 10);
  const estado = ndvi > 0.6 ? "buena" : ndvi > 0.35 ? "moderada" : "estres";

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ ndvi, fecha, nubes: false, estado }),
  };
};
