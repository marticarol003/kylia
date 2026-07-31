const { aplicaSatelite, motivoSinSatelite } = require("./_satelite.js");

// Usos SIGPAC que son cultivo. Se dejan fuera los que nunca son una zona de
// cultivo del agricultor y solo ensucian el mapa: CA camino, ZU zona urbana,
// AG agua, IM improductivo, ED edificaciones, ZV zona censurada, MT monte.
// (Códigos de la tabla de usos SIGPAC del MAPA.)
const USOS_AGRICOLAS = new Set([
  "TA",  // tierra arable
  "TH",  // huerta
  "FY",  // frutales
  "FS",  // frutos secos
  "FL",  // frutal cáscara
  "CI",  // cítricos
  "CS",  // cítricos-frutal
  "VI",  // viñedo
  "VF",  // viñedo-frutal
  "VO",  // viñedo-olivar
  "OV",  // olivar
  "OF",  // olivar-frutal
  "PR",  // pasto arbustivo
  "PS",  // pastizal
  "PA",  // pasto con arbolado
  "IV",  // invernaderos y cultivos bajo plástico
  "FV",  // frutal-viñedo
]);

// Por debajo de esto no es una zona de cultivo declarable, es un ribazo o un
// resto de geometría. Nada que ver con el umbral del satélite (_satelite.js):
// esto solo evita llenar el mapa de motas intocables en un móvil.
const SUP_MIN_RECINTO_M2 = 200;

// Referencia SIGPAC completa (la que vale para la PAC), o null si falta algo.
function refSigpac(p) {
  const partes = [p.provincia, p.municipio, p.agregado, p.zona, p.poligono, p.parcela, p.recinto];
  return partes.every((v) => v != null) ? partes.join(":") : null;
}

function wgs84ToMercator(lon, lat) {
  const x = (lon * 20037508.34) / 180;
  const y = (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (20037508.34 / 180);
  return [x, y];
}

function mercatorToWgs84(x, y) {
  const lon = (x * 180) / 20037508.34;
  const lat = (Math.atan(Math.exp((y * Math.PI) / 20037508.34)) * 360) / Math.PI - 90;
  // 6 decimales ≈ 11 cm. SIGPAC no dibuja los linderos con esa precisión, así
  // que los 15 decimales que salen del float son ruido — pero ruido que se paga:
  // con vecinos=1 el tile de Palafolls pasa de 208 a 123 KB (41% menos), y esto
  // se descarga en el campo, con datos móviles.
  return [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
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

    // ── Los recintos del entorno (vecinos=1) ──────────────────────
    // Este tile ya venía descargado (~476 KB, ~200 recintos en zona hortícola) y
    // se tiraban todos menos uno. Devolverlos es lo que permite que el agricultor
    // DELIMITE SUS ZONAS tocando, sin dibujar nada: un recinto de SIGPAC es por
    // definición un trozo de uso homogéneo, así que la finca ya viene partida —
    // y por la partición oficial que él mismo declara en la PAC.
    //
    // Se calculan ANTES de mirar dónde tocó, y se devuelven ACIERTE O NO. Si el
    // dedo (o el GPS, que suele dejarle en casa) cae en un camino o en el pueblo,
    // lo útil es enseñarle las parcelas que tiene alrededor para que elija, no
    // decirle que ahí no hay nada.
    const recintos = req.query.vecinos === "1"
      ? geojson.features
          .filter((f) => {
            const q = f.properties || {};
            return USOS_AGRICOLAS.has(q.uso_sigpac) && Number(q.dn_surface) >= SUP_MIN_RECINTO_M2;
          })
          .map((f) => {
            const q   = f.properties || {};
            const sup = Math.round(Number(q.dn_surface));
            return {
              referencia: refSigpac(q),
              superficie_m2: sup,
              uso: q.uso_sigpac || null,
              // Se decide aquí y no en la UI, para que el mapa no tenga que
              // conocer el criterio (vive en _satelite.js y en ningún sitio más).
              satelite: aplicaSatelite(sup),
              motivo_sin_satelite: motivoSinSatelite(sup),
              geometria: { type: f.geometry.type, coordinates: convertCoords(f.geometry.coordinates) },
            };
          })
          .sort((a, b) => b.superficie_m2 - a.superficie_m2)
      : null;

    const conVecinos = (extra) => res.status(200).json(
      recintos ? { ...extra, recintos, recintos_total_tile: geojson.features.length } : extra
    );

    const [mx, my] = wgs84ToMercator(lon, lat);
    const feature  = geojson.features.find((f) => containsPoint(f.geometry, mx, my));

    if (!feature) return conVecinos({ parcela: null, motivo: "no_encontrada" });

    // El recinto que contiene el punto puede no ser agrícola, y devolverlo como
    // "tu parcela" hace daño de verdad. La horticultura periurbana del Baix
    // Llobregat no está subdividida en SIGPAC: en Sant Boi el tile entero es UN
    // recinto `ZU` (zona urbana) de 22.228.572 m². La app ofrecería "Usar toda la
    // parcela (≈22.228.572 m²)" y, de aceptarlo, el plan de abonado y las
    // regaderas saldrían calculados sobre 22 km².
    const usoContenedor = (feature.properties || {}).uso_sigpac || null;
    if (!USOS_AGRICOLAS.has(usoContenedor)) {
      return conVecinos({
        parcela: null,
        motivo: "no_agricola",
        uso: usoContenedor,
        detalle: "Ahí SIGPAC no tiene parcela agrícola (el recinto es de uso "
               + `"${usoContenedor || "desconocido"}"). Toca una de las parcelas marcadas, `
               + "o dinos la superficie a mano: el riego y el abonado funcionan igual.",
      });
    }

    // Propiedades oficiales del recinto. La superficie (dn_surface, m²) es más
    // fiable que calcularla del polígono: los vector tiles RECORTAN la geometría
    // en el borde del tile, así que un recinto a caballo entre tiles daría un
    // área geométrica truncada. La referencia SIGPAC completa sirve para el PAC.
    const p   = feature.properties || {};
    const sup = Number.isFinite(p.dn_surface) ? Math.round(p.dn_surface) : null;

    return conVecinos({
      parcela: { type: feature.geometry.type, coordinates: convertCoords(feature.geometry.coordinates) },
      superficie_m2: sup,
      uso: p.uso_sigpac || null,
      referencia: refSigpac(p),
      satelite: aplicaSatelite(sup),
      motivo_sin_satelite: motivoSinSatelite(sup),
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
