const CORS = { "Access-Control-Allow-Origin": "*" };

// EPSG:4326 → EPSG:3857
function wgs84ToMercator(lon, lat) {
  const x = (lon * 20037508.34) / 180;
  const y =
    (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) *
    (20037508.34 / 180);
  return [x, y];
}

// EPSG:3857 → EPSG:4326
function mercatorToWgs84(x, y) {
  const lon = (x * 180) / 20037508.34;
  const lat =
    (Math.atan(Math.exp((y * Math.PI) / 20037508.34)) * 360) / Math.PI - 90;
  return [lon, lat];
}

// Lat/lon → TMS tile (zoom z)
function latLonToTile(lat, lon, z) {
  const n = Math.pow(2, z);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const yXYZ = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  const yTMS = n - 1 - yXYZ;
  return { x, y: yTMS };
}

// Ray-casting point-in-polygon (ring = array of [x,y])
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
  if (geom.type === "Polygon") {
    return pointInRing(mx, my, geom.coordinates[0]);
  }
  if (geom.type === "MultiPolygon") {
    return geom.coordinates.some((poly) => pointInRing(mx, my, poly[0]));
  }
  return false;
}

// Recursively convert coordinate arrays from EPSG:3857 to WGS84
function convertCoords(coords) {
  if (typeof coords[0] === "number") return mercatorToWgs84(coords[0], coords[1]);
  return coords.map(convertCoords);
}

function convertGeomToWgs84(geom) {
  return { type: geom.type, coordinates: convertCoords(geom.coordinates) };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS };
  }

  const lat = parseFloat(event.queryStringParameters?.lat);
  const lon = parseFloat(event.queryStringParameters?.lon);
  if (isNaN(lat) || isNaN(lon)) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "lat/lon requeridos" }),
    };
  }

  const Z = 15;
  const { x, y } = latLonToTile(lat, lon, Z);
  const url = `https://sigpac.mapa.es/vectorsdg/vector/recinto@3857/${Z}.${x}.${y}.geojson`;

  try {
    const res = await fetch(url, { headers: { "User-Agent": "Kylia/1.0" } });
    if (!res.ok) {
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({ error: "SIGPAC no responde", status: res.status }),
      };
    }

    const geojson = await res.json();
    if (!geojson.features?.length) {
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ parcela: null, motivo: "no_encontrada" }),
      };
    }

    const [mx, my] = wgs84ToMercator(lon, lat);
    const feature = geojson.features.find((f) => containsPoint(f.geometry, mx, my));

    if (!feature) {
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ parcela: null, motivo: "no_encontrada" }),
      };
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ parcela: convertGeomToWgs84(feature.geometry) }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
