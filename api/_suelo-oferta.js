// ─────────────────────────────────────────────────────────────────
// Oferta del suelo desde satélite/modelo — SoilGrids (pilar fertilizantes)
// ─────────────────────────────────────────────────────────────────
// Rellena el `ofertaSuelo` que _motor-nutricion.js ya sabe restar, SIN pedir
// una analítica de laboratorio ni instalar nada en el campo: solo una consulta
// por coordenada a SoilGrids (ISRIC), el mapa global de propiedades del suelo a
// 250 m, CC-BY. Encaja con la premisa de Kylia: todo de modelos + satélite.
//
// FRONTERA HONESTA — esto es un PRIOR regional, no la parcela:
//   · SoilGrids da nitrógeno TOTAL, carbono orgánico, pH, textura, densidad
//     aparente. NO da fósforo ni potasio asimilables (P₂O₅/K₂O disponibles):
//     esas formas no se leen desde el espacio. Por eso aquí P y K se devuelven
//     como null (desconocidos declarados), no como cero disfrazado. Su fuente
//     natural es ESDAC/LUCAS (mapas europeos medidos) o una analítica. Ver [[project_sesion_2026-07-08]].
//   · El nitrógeno TOTAL del suelo tampoco es N disponible: casi todo es N
//     orgánico inmovilizado. Lo que la planta puede usar en una campaña es la
//     fracción que MINERALIZA. Aplicamos un modelo de primer orden documentado
//     (abajo), conservador, con el coeficiente expuesto y afinable.
//   · Resolución 250 m: un píxel cubre parcelas enteras de Kylia. Es un prior de
//     ZONA, honesto como punto de partida; no sustituye a una analítica de la
//     parcela cuando el agricultor la tenga.

const SG_BASE = "https://rest.isric.org/soilgrids/v2.0/properties/query";

// Modelo de mineralización de N (primer orden, base agronómica estándar):
//   N_disponible_campaña (kg/ha) = N_orgánico_stock(kg/ha) × k_mineralización
// donde el stock sale de la concentración × masa de suelo del horizonte útil, y
// k es la fracción que mineraliza en un ciclo de cultivo. En suelos hortícolas
// mediterráneos ricos en materia orgánica, la mineralización anual ronda el
// 1-3% del N orgánico total; por CICLO (3-4 meses en cálido) usamos un valor
// central conservador. Es el equivalente del Kc: un coeficiente afinable, no un
// dogma. Se puede ajustar por temperatura/humedad cuando lo cablemos al clima.
const K_MINERALIZACION_CICLO = 0.012; // 1,2% del N orgánico por campaña
const PROF_HORIZONTE_M       = 0.30;  // horizonte radicular útil considerado (0-30 cm)

// SoilGrids devuelve valores enteros escalados por d_factor. Propiedades y sus
// unidades objetivo tras dividir por d_factor:
//   nitrogen → g/kg (N total)   soc → g/kg (C orgánico)   phh2o → pH
//   clay/sand/silt → %          bdod → kg/dm³ (= t/m³, densidad aparente)
const PROPIEDADES = ["nitrogen", "soc", "phh2o", "clay", "sand", "bdod"];
const PROFUNDIDADES = ["0-5cm", "5-15cm", "15-30cm"]; // se ponderan a 0-30 cm
const GROSOR_CM = { "0-5cm": 5, "5-15cm": 10, "15-30cm": 15 };

function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

// Una llamada a SoilGrids para un punto. Devuelve, por propiedad, la media
// ponderada en profundidad 0-30 cm en unidades reales, o null si el píxel está
// enmascarado (urbano/agua) o no hay dato.
async function consultaPunto(lat, lon, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  const qs = new URLSearchParams();
  for (const p of PROPIEDADES) qs.append("property", p);
  for (const d of PROFUNDIDADES) qs.append("depth", d);
  qs.append("value", "mean");
  qs.append("lon", String(lon));
  qs.append("lat", String(lat));

  const resp = await doFetch(`${SG_BASE}?${qs.toString()}`);
  if (!resp.ok) throw new Error(`SoilGrids HTTP ${resp.status}`);
  const json = await resp.json();

  const out = {};
  for (const layer of json?.properties?.layers || []) {
    const factor = layer?.unit_measure?.d_factor || 1;
    let acc = 0, grosor = 0;
    for (const d of layer.depths || []) {
      const v = d?.values?.mean;
      if (typeof v === "number") {
        const g = GROSOR_CM[d.label] || 0;
        acc += (v / factor) * g;
        grosor += g;
      }
    }
    out[layer.name] = grosor > 0 ? acc / grosor : null;
  }
  return out;
}

// SoilGrids enmascara suelo construido/agua (p. ej. el campo del padre en Sant
// Boi urbano da null). Fallback: anillo de puntos alrededor y media de válidos.
async function consultaConFallback(lat, lon, fetchImpl) {
  const centro = await consultaPunto(lat, lon, fetchImpl);
  if (centro.nitrogen != null) return { props: centro, fuente_punto: "exacto" };

  const paso = 0.004; // ~400 m
  const anillo = [
    [paso, 0], [-paso, 0], [0, paso], [0, -paso],
    [paso, paso], [paso, -paso], [-paso, paso], [-paso, -paso],
  ];
  const validos = [];
  for (const [dlat, dlon] of anillo) {
    try {
      const p = await consultaPunto(lat + dlat, lon + dlon, fetchImpl);
      if (p.nitrogen != null) validos.push(p);
    } catch (_) { /* seguimos con el resto del anillo */ }
  }
  if (!validos.length) return { props: null, fuente_punto: "sin_dato" };

  const media = {};
  for (const k of PROPIEDADES) {
    const vals = validos.map(p => p[k]).filter(v => typeof v === "number");
    media[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  return { props: media, fuente_punto: "vecino_cercano" };
}

// Oferta de suelo lista para _motor-nutricion.js.
//   lat, lon   : coordenadas de la parcela (de SIGPAC/onboarding)
//   areaM2     : superficie de la parcela, para escalar de kg/ha a kg de parcela
//   opts.k     : coeficiente de mineralización por campaña (por defecto K_MINERALIZACION_CICLO)
//   opts.fetch : inyectable en tests
// Devuelve { N, P2O5, K2O } en kg de la parcela (P2O5/K2O = null: desconocidos)
// más las propiedades observadas y la trazabilidad, para no esconder el prior.
async function ofertaSuelo(lat, lon, areaM2, opts = {}) {
  if (!(Number.isFinite(lat) && Number.isFinite(lon))) {
    return { disponible: false, motivo: "Faltan coordenadas de la parcela." };
  }
  const area = Number(areaM2);
  if (!(area > 0)) {
    return { disponible: false, motivo: "Falta la superficie de la parcela (m²) para escalar la oferta." };
  }

  let props, fuentePunto;
  try {
    ({ props, fuente_punto: fuentePunto } = await consultaConFallback(lat, lon, opts.fetch));
  } catch (e) {
    return { disponible: false, motivo: `SoilGrids no accesible: ${e.message}` };
  }
  if (!props || props.nitrogen == null || props.bdod == null) {
    return {
      disponible: false,
      motivo: "SoilGrids sin dato en la zona (píxel enmascarado). Sin prior de suelo; el motor usará extracción bruta.",
    };
  }

  const k = Number(opts.k) > 0 ? Number(opts.k) : K_MINERALIZACION_CICLO;

  // Stock de N orgánico en 0-30 cm → N mineralizable en la campaña.
  //   masa de suelo (t/ha) = bdod(t/m³) × prof(m) × 10 000 m²/ha
  //   N total (kg/ha)      = N_conc(g/kg = kg/t) × masa(t/ha)
  const masaSueloTHa = props.bdod * PROF_HORIZONTE_M * 10000;
  const nTotalKgHa   = props.nitrogen * masaSueloTHa;
  const nMinKgHa     = nTotalKgHa * k;
  const nMinParcela  = nMinKgHa * (area / 10000);

  return {
    disponible: true,
    // Lo que el motor consume: N estimado; P/K desconocidos (no se inventan).
    N: r2(nMinParcela),
    P2O5: null,
    K2O: null,
    // Trazabilidad honesta.
    fuente: "SoilGrids v2.0 (ISRIC), 250 m, CC-BY",
    fuente_punto: fuentePunto, // exacto | vecino_cercano
    observado: {
      n_total_g_kg: r2(props.nitrogen),
      carbono_org_g_kg: r2(props.soc),
      ph: r2(props.phh2o),
      arcilla_pct: r2(props.clay),
      arena_pct: r2(props.sand),
      densidad_t_m3: r2(props.bdod),
    },
    modelo_n: {
      k_mineralizacion_ciclo: k,
      n_total_kg_ha: r2(nTotalKgHa),
      n_mineralizable_kg_ha: r2(nMinKgHa),
    },
    nota:
      "N estimado por mineralización del N orgánico del suelo (prior regional de " +
      "SoilGrids, no analítica de la parcela). P₂O₅ y K₂O no se derivan de satélite: " +
      "quedan como desconocidos hasta ESDAC/LUCAS o una analítica.",
  };
}

module.exports = {
  K_MINERALIZACION_CICLO,
  ofertaSuelo,
  // exportadas para test
  consultaPunto,
  consultaConFallback,
};
