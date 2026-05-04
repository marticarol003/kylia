// Endpoint orquestador: dado un punto (lat, lon) o una referencia SIGPAC textual,
// devuelve la geometría de la parcela junto con NDVI/NDMI agregados de la última
// pasada Sentinel-2 disponible. Es el endpoint público que consume la landing
// para la demo "ver tu parcela".
//
// Query params (acepta cualquiera de las dos formas):
//   - lat, lon            → resuelve por punto (usa SIGPAC tile lookup)
//   - ref                 → referencia SIGPAC textual "PP:MMM:AGG:ZZ:POL:PAR:REC"
//                           (provincia:municipio:agregado:zona:polígono:parcela:recinto)
//   - days (opcional)     → ventana de días hacia atrás para buscar pasada
//                           Sentinel-2 (default 12, máx 60)
//
// Response:
//   { parcela: { geometry, area_ha, sigpac_ref },
//     indices: { ndvi, ndmi, fecha_pasada, n_pixeles_validos },
//     interpretacion: { vigor, estres_hidrico, accion_sugerida } }
//
// Errores:
//   400 → params inválidos
//   404 → no se encuentra parcela
//   502 → falla SIGPAC o Sentinel (con detalle)
//   503 → no hay pasada Sentinel sin nubes en la ventana

const SIGPAC_REF_RE = /^(\d{1,2}):(\d{1,3}):(\d{1,3}):(\d{1,2}):(\d{1,3}):(\d{1,4}):(\d{1,3})$/;

function parseSigpacRef(ref) {
  const m = SIGPAC_REF_RE.exec(ref);
  if (!m) return null;
  const [, prov, muni, agreg, zona, pol, par, rec] = m;
  return {
    provincia:  parseInt(prov, 10),
    municipio:  parseInt(muni, 10),
    agregado:   parseInt(agreg, 10),
    zona:       parseInt(zona, 10),
    poligono:   parseInt(pol, 10),
    parcela:    parseInt(par, 10),
    recinto:    parseInt(rec, 10),
    asString:   `${prov}:${muni}:${agreg}:${zona}:${pol}:${par}:${rec}`,
  };
}

// Área de un anillo cerrado en hectáreas usando la fórmula de la cuerda esférica.
// Aproximación buena para parcelas <100 ha; para fines comerciales el cliente
// debería re-proyectar a UTM 30N. Suficiente para mostrar al agricultor.
function ringAreaHa(ring) {
  if (!ring || ring.length < 4) return 0;
  const R = 6378137;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    total += ((lon2 - lon1) * Math.PI / 180) *
             (2 + Math.sin(lat1 * Math.PI / 180) + Math.sin(lat2 * Math.PI / 180));
  }
  total = total * R * R / 2;
  return Math.abs(total) / 10000; // m² → ha
}

function geometryAreaHa(geom) {
  if (!geom) return 0;
  if (geom.type === "Polygon")      return ringAreaHa(geom.coordinates[0]);
  if (geom.type === "MultiPolygon") return geom.coordinates.reduce((s, p) => s + ringAreaHa(p[0]), 0);
  return 0;
}

function interpretar(ndvi, ndmi) {
  let vigor;
  if (ndvi == null || isNaN(ndvi)) vigor = "no_calculable";
  else if (ndvi < 0.2)             vigor = "suelo_desnudo";
  else if (ndvi < 0.4)             vigor = "vigor_bajo";
  else if (ndvi < 0.6)             vigor = "vigor_moderado";
  else if (ndvi < 0.75)            vigor = "vigor_bueno";
  else                              vigor = "vigor_alto";

  let estres;
  if (ndmi == null || isNaN(ndmi)) estres = "no_calculable";
  else if (ndmi < 0.15)            estres = "severo";
  else if (ndmi < 0.30)            estres = "temprano";
  else if (ndmi < 0.40)            estres = "ligero";
  else                              estres = "ninguno";

  let accion = "sin_accion";
  if (estres === "severo")        accion = "regar_inmediato";
  else if (estres === "temprano") accion = "revisar_riego_48h";
  else if (vigor === "vigor_bajo" && estres === "ninguno") accion = "revisar_nutricion";

  return { vigor, estres_hidrico: estres, accion_sugerida: accion };
}

async function fetchSigpacByPoint(lat, lon, baseUrl) {
  const r = await fetch(`${baseUrl}/api/sigpac?lat=${lat}&lon=${lon}`, {
    headers: { "User-Agent": "Kylia/1.0" },
  });
  if (!r.ok) throw new Error(`SIGPAC error ${r.status}`);
  return r.json();
}

async function fetchSentinelForGeometry(geometry, days, baseUrl) {
  const params = new URLSearchParams({
    geometry: JSON.stringify(geometry),
    days:     String(days),
  });
  const r = await fetch(`${baseUrl}/api/sentinel?${params}`, {
    headers: { "User-Agent": "Kylia/1.0" },
  });
  if (!r.ok) throw new Error(`Sentinel error ${r.status}`);
  return r.json();
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET")     return res.status(405).json({ error: "method_not_allowed" });

  const days = Math.min(60, Math.max(1, parseInt(req.query.days || "12", 10)));
  const ref  = req.query.ref ? parseSigpacRef(String(req.query.ref)) : null;
  const lat  = parseFloat(req.query.lat);
  const lon  = parseFloat(req.query.lon);

  if (!ref && (isNaN(lat) || isNaN(lon))) {
    return res.status(400).json({ error: "params_required", hint: "pasa lat/lon o ref=PP:MMM:AGG:ZZ:POL:PAR:REC" });
  }

  const baseUrl = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;

  try {
    // 1. Resolver geometría
    let geometry, sigpacRef;

    if (ref) {
      // TODO real: llamada a servicio SIGPAC by-ref. Hoy aprovechamos sigpac por
      // punto si el cliente nos da también lat/lon; si no, devolvemos 501.
      if (isNaN(lat) || isNaN(lon)) {
        return res.status(501).json({
          error: "ref_lookup_no_implementado",
          hint:  "por ahora pasa también lat/lon de cualquier punto interior a la parcela",
        });
      }
      const sigpac = await fetchSigpacByPoint(lat, lon, baseUrl);
      if (!sigpac.parcela) return res.status(404).json({ error: "parcela_no_encontrada" });
      geometry  = sigpac.parcela;
      sigpacRef = ref.asString;
    } else {
      const sigpac = await fetchSigpacByPoint(lat, lon, baseUrl);
      if (!sigpac.parcela) return res.status(404).json({ error: "parcela_no_encontrada" });
      geometry  = sigpac.parcela;
      sigpacRef = null;
    }

    const areaHa = geometryAreaHa(geometry);

    // 2. Calcular índices Sentinel-2
    const sentinel = await fetchSentinelForGeometry(geometry, days, baseUrl);
    if (sentinel.error) {
      return res.status(503).json({ error: "sentinel_no_disponible", detalle: sentinel.error });
    }

    const ndvi    = sentinel.ndvi    ?? null;
    const ndmi    = sentinel.ndmi    ?? null;
    const fecha   = sentinel.fecha   ?? null;
    const nValid  = sentinel.n_validos ?? sentinel.nPixels ?? null;

    // 3. Interpretación accionable
    const interp = interpretar(ndvi, ndmi);

    return res.status(200).json({
      parcela: {
        geometry,
        area_ha:    Math.round(areaHa * 100) / 100,
        sigpac_ref: sigpacRef,
      },
      indices: {
        ndvi,
        ndmi,
        fecha_pasada:        fecha,
        n_pixeles_validos:   nValid,
      },
      interpretacion: interp,
    });
  } catch (err) {
    return res.status(502).json({ error: "upstream_error", detalle: err.message });
  }
};
