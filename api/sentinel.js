const { inflateSync } = require('zlib');

const TOKEN_URL   = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process";

function parsePng1x1(buf) {
  const chunks = [];
  let pos = 8;
  while (pos + 12 <= buf.length) {
    const len  = buf.readUInt32BE(pos);
    const type = buf.slice(pos + 4, pos + 8).toString('ascii');
    if (type === 'IDAT') chunks.push(buf.slice(pos + 8, pos + 8 + len));
    if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!chunks.length) return null;
  const raw = inflateSync(Buffer.concat(chunks));
  if (raw.length < 5) return null;
  return { r: raw[1], g: raw[2], a: raw[4] };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (isNaN(lat) || isNaN(lon)) {
    return res.status(400).json({ error: "lat/lon requeridos" });
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
    return res.status(502).json({ error: "Auth failed" });
  }
  const { access_token } = await tokenRes.json();

  const d      = 0.001;
  const hoy    = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  let bounds;
  try {
    bounds = req.query.geometry
      ? { geometry: JSON.parse(req.query.geometry), properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" } }
      : { bbox: [lon - d, lat - d, lon + d, lat + d], properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" } };
  } catch (_) {
    bounds = { bbox: [lon - d, lat - d, lon + d, lat + d], properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" } };
  }

  const evalscript = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08"] }],
    output: { bands: 4, sampleType: "UINT8" }
  };
}
function evaluatePixel(s) {
  if (s.B08 === 0 && s.B04 === 0) return [0, 0, 0, 0];
  var ndvi = (s.B08 - s.B04) / (s.B08 + s.B04 + 1e-10);
  var u16  = Math.round(((ndvi + 1) / 2) * 65535);
  return [(u16 >> 8) / 255, (u16 & 0xFF) / 255, 0, 1];
}`;

  const processRes = await fetch(PROCESS_URL, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${access_token}`,
      "Content-Type": "application/json",
      "Accept":       "image/png",
    },
    body: JSON.stringify({
      input: {
        bounds,
        data: [{
          type: "sentinel-2-l2a",
          dataFilter: {
            timeRange:        { from: `${hace30}T00:00:00Z`, to: `${hoy}T23:59:59Z` },
            maxCloudCoverage: 80,
          },
        }],
      },
      output: {
        width:  1,
        height: 1,
        responses: [{ identifier: "default", format: { type: "image/png" } }],
      },
      evalscript,
    }),
  });

  if (!processRes.ok) {
    const err = await processRes.text();
    return res.status(502).json({ error: "Process API failed", detail: err });
  }

  const arrayBuf = await processRes.arrayBuffer();
  const pixel    = parsePng1x1(Buffer.from(arrayBuf));

  if (!pixel || pixel.a === 0) {
    return res.status(200).json({ ndvi: null, motivo: "sin_datos" });
  }

  const u16    = (pixel.r << 8) | pixel.g;
  const ndvi   = +((u16 / 65535) * 2 - 1).toFixed(3);
  const estado = ndvi > 0.6 ? "buena" : ndvi > 0.35 ? "moderada" : "estres";

  return res.status(200).json({ ndvi, fecha: hoy, nubes: false, estado });
};
