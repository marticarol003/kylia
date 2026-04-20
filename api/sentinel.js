const { inflateSync } = require('zlib');

const TOKEN_URL   = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process";

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function unfilterPng(raw, width, channels) {
  const stride = 1 + width * channels;
  const height = Math.floor(raw.length / stride);
  const out    = Buffer.alloc(width * channels * height);

  for (let y = 0; y < height; y++) {
    const filterType = raw[y * stride];
    const rowIn  = y * stride + 1;
    const rowOut = y * width * channels;
    const prevOut = (y - 1) * width * channels;

    for (let x = 0; x < width * channels; x++) {
      const byte = raw[rowIn + x];
      const a = x >= channels ? out[rowOut + x - channels] : 0;
      const b = y > 0 ? out[prevOut + x] : 0;
      const c = (x >= channels && y > 0) ? out[prevOut + x - channels] : 0;
      out[rowOut + x] = (filterType === 1 ? byte + a
                       : filterType === 2 ? byte + b
                       : filterType === 3 ? byte + Math.floor((a + b) / 2)
                       : filterType === 4 ? byte + paeth(a, b, c)
                       : byte) & 0xFF;
    }
  }
  return out;
}

function parsePngNdviStats(buf) {
  const chunks = [];
  let pos = 8, width = 0, height = 0;
  while (pos + 12 <= buf.length) {
    const len  = buf.readUInt32BE(pos);
    const type = buf.slice(pos + 4, pos + 8).toString('ascii');
    if (type === 'IHDR') {
      width  = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
    }
    if (type === 'IDAT') chunks.push(buf.slice(pos + 8, pos + 8 + len));
    if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!chunks.length || !width || !height) return null;

  const raw      = inflateSync(Buffer.concat(chunks));
  const pixels   = unfilterPng(raw, width, 4); // RGBA
  const values   = [];

  for (let i = 0; i < width * height; i++) {
    const r = pixels[i * 4], g = pixels[i * 4 + 1], a = pixels[i * 4 + 3];
    if (a === 0) continue;
    const u16 = (r << 8) | g;
    values.push((u16 / 65535) * 2 - 1);
  }

  if (!values.length) return null;
  const mean     = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return {
    ndvi:   +mean.toFixed(3),
    stdev:  +Math.sqrt(variance).toFixed(3),
    pixels: values.length,
  };
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
  const hace30 = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);

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
            maxCloudCoverage: 30,
            mosaickingOrder:  "mostRecent",
          },
        }],
      },
      output: {
        width:  50,
        height: 50,
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
  const stats    = parsePngNdviStats(Buffer.from(arrayBuf));

  if (!stats) {
    return res.status(200).json({ ndvi: null, motivo: "sin_datos" });
  }

  const estado = stats.ndvi > 0.6 ? "buena" : stats.ndvi > 0.35 ? "moderada" : "estres";
  return res.status(200).json({ ndvi: stats.ndvi, stdev: stats.stdev, pixels: stats.pixels, fecha: hoy, nubes: false, estado });
};
