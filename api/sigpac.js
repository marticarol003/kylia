function wgs84ToMercator(lon, lat) {
  const x = (lon * 20037508.34) / 180;
  const y = (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (20037508.34 / 180);
  return [x, y];
}

function mercatorToWgs84(x, y) {
  const lon = (x * 180) / 20037508.34;
  const lat = (Math.atan(Math.exp((y * Math.PI) / 20037508.34)) * 360) / Math.PI - 90;
  return [lon, lat];
}

function latLonToTile(lat, lon, z) {
  const n      = Math.pow(2, z);
  const x      = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const yXYZ   = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y: n - 1 - yXYZ };
}

function pointInRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function containsPoint(geom, mx, my) {
  if (geom.type === "Polygon")      return pointInRing(mx, my, geom.coordinates[0]);
  if (geom.type === "MultiPolygon") return geom.coordinates.some((poly) => pointInRing(mx, my, poly[0]));
  return false;
}

function convertCoords(coords) {
  if (typeof coords[0] === "number") return mercatorToWgs84(coords[0], coords[1]);
  return coords.map(convertCoords);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (isNaN(lat) || isNaN(lon)) {
    return res.status(400).json({ error: "lat/lon requeridos" });
  }

  const Z   = 15;
  const { x, y } = latLonToTile(lat, lon, Z);
  const url = `https://sigpac.mapa.es/vectorsdg/vector/recinto@3857/${Z}.${x}.${y}.geojson`;

  try {
    const sigpacRes = await fetch(url, { headers: { "User-Agent": "Kylia/1.0" } });
    if (!sigpacRes.ok) {
      return res.status(502).json({ error: "SIGPAC no responde", status: sigpacRes.status });
    }

    const geojson = await sigpacRes.json();
    if (!geojson.features?.length) {
      return res.status(200).json({ parcela: null, motivo: "no_encontrada" });
    }

    const [mx, my] = wgs84ToMercator(lon, lat);
    const feature  = geojson.features.find((f) => containsPoint(f.geometry, mx, my));

    if (!feature) {
      return res.status(200).json({ parcela: null, motivo: "no_encontrada" });
    }

    const geomWgs84 = { type: feature.geometry.type, coordinates: convertCoords(feature.geometry.coordinates) };
    return res.status(200).json({ parcela: geomWgs84 });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
