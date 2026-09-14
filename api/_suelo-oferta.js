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
//   · El nitrógeno TOTAL del suelo no es N disponible: casi todo es N orgánico
//     inmovilizado. Lo que la planta usa en una campaña es la fracción que
//     MINERALIZA. Se estima con la Tabla 4.2 de la Guía de fertilización de MAPA
//     (ver abajo) — el método oficial español, validado en docs/tecnico/validacion-nutricion.md.
//   · Resolución 250 m: un píxel cubre parcelas enteras de Kylia. Es un prior de
//     ZONA, honesto como punto de partida; no sustituye a una analítica de la
//     parcela cuando el agricultor la tenga.

const { fetchConTimeout } = require("./_http.js");

const SG_BASE = "https://rest.isric.org/soilgrids/v2.0/properties/query";

// Modelo de mineralización de N — Tabla 4.2 de la Guía de fertilización de MAPA
// ("Aportación anual al suelo de N procedente de la materia orgánica"). La tabla
// es exactamente lineal: N_anual (kg/ha·año) = FACTOR[textura] × MO%, con FACTOR
// {arcilloso 15, franco 22, arenoso 30} (los arenosos mineralizan más por aireación).
// MO% = C_orgánico% × 1,724 (factor de van Bemmelen). Del aporte ANUAL, una fracción
// ocurre en el ciclo de cultivo (la mineralización se concentra en los meses cálidos):
// para un ciclo hortícola de verano usamos ~½ del anual. Recalibrado el 2026-07-16;
// antes un k=1,2%/ciclo sobre el N total sobreestimaba ×2,4 (ver validación).
const N_MIN_FACTOR   = { arcilloso: 15, franco: 22, arenoso: 30 }; // kg N/ha·año por 1% de MO
const C_A_MO         = 1.724;  // C orgánico % → materia orgánica %
const FRACCION_CICLO = 0.5;    // parte del aporte anual que cae en un ciclo de verano

// Clasifica la textura del suelo (para elegir el FACTOR) desde clay/sand de SoilGrids.
function clasificarTextura(clayPct, sandPct) {
  if (clayPct >= 35) return "arcilloso";
  if (sandPct >= 65 && clayPct < 20) return "arenoso";
  return "franco";
}

// ¿Cuánto falta para que esta parcela cambie de clase? Importa porque la clase
// no es un adorno: elige el AWC del balance de riego, y el salto no es simétrico.
//   arenoso 0,08 → franco 0,15   = +88% de capacidad de suelo
//   franco  0,15 → arcilloso 0,16 = +7%
//
// ⚠️ ESTO ESTABA MAL HASTA EL 14-SEP, y lo cazó Codex. Se medía la distancia a
// DOS umbrales sueltos —|35 − arcilla| y |65 − arena|— como si cada uno fuera
// una frontera por sí mismo. Pero la clasificación real es:
//
//     arcilla ≥ 35                     → arcilloso
//     arena ≥ 65 Y arcilla < 20        → arenoso
//     resto                            → franco
//
// La regla del arenoso es una CONJUNCIÓN, así que la distancia a "arena = 65" no
// significa nada por sí sola. Los tres casos que lo demostraban:
//
//   clay=30 sand=64 → decía "a 1 punto de arenoso". Falso: con arcilla 30 nunca
//                     puede ser arenoso, por mucha arena que se le eche.
//   clay=36 sand=65 → decía margen 0 por la arena. Es arcilloso, y lo seguirá
//                     siendo; su frontera real es arcilla=35, a 1 punto.
//   clay=19 sand=70 → decía margen 5 (a la arena). Pero lo que lo saca de
//                     arenoso es la arcilla subiendo 1 punto, de 19 a 20.
//
// Ahora se mide la distancia a la frontera REAL de la región: el cambio mínimo,
// en cualquier dirección, que haga que clasificarTextura devuelva otra cosa.
const MARGEN_FRAGIL = 8;   // puntos porcentuales

// Distancia mínima desde (clay, sand) hasta un punto de OTRA clase, DENTRO DEL
// DOMINIO FÍSICO. Las fracciones de un suelo suman 100 con el limo, así que
// arcilla + arena ≤ 100 y las dos ≥ 0. Fuera de ahí no hay suelos.
//
// ⚠️ Segundo hallazgo de Codex sobre esto: la versión anterior proponía
// candidatos imposibles. Para clay=0 sand=100 decía "a 20 pp de franco" por el
// punto (20, 100) — que serían 120% de suelo. El punto franco más cercano de
// verdad es (20, 80), a 28,3 pp: para ganar arcilla hay que perder arena.
//
// Se proyecta sobre cada RECTA de decisión recortada a su tramo válido, más las
// esquinas donde esas rectas se cortan entre sí y con arcilla+arena = 100. En 2D
// con fronteras rectas, el punto más cercano de una región siempre cae en una
// arista o en un vértice, así que con eso está cubierto.
// El límite de suma es 100, pero se tolera el redondeo: SoilGrids da medias
// ponderadas en profundidad y la suma puede salir en 100,4 o 101 sin que el dato
// sea malo. Se toma como techo la suma REAL del punto cuando pasa de 100 —así un
// redondeo no deja la parcela sin evaluar— y se rechaza solo lo que ya no es un
// suelo. Lo que NO se hace es proponer candidatos por encima de ese techo, que
// era el defecto: para clay=0 sand=100 se sugería (20, 100), un 120% de suelo.
const SUMA_MAX = 105;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const enDominio = (c, a, techo) => c >= 0 && a >= 0 && c + a <= techo + 1e-9;

function fragilidadTextura(clayPct, sandPct) {
  // ⚠️ Number(null) es 0 y Number("") también, así que `Number.isFinite(Number(x))`
  // deja pasar los dos como si fueran un 0% legítimo de arcilla — y con arcilla 0
  // y arena 40 esto respondía "franco, margen 25 pp" sobre datos que no existen.
  // Es el mismo agujero que ya mordió cuatro veces en el motor y que allí se
  // cerró con el predicado `finito`. Aquí, igual.
  const finito = x => x != null && x !== "" && typeof x !== "boolean" && Number.isFinite(Number(x));
  if (!(finito(clayPct) && finito(sandPct))) return null;
  const clay = Number(clayPct), sand = Number(sandPct);
  // DOMINIO FÍSICO, comprobado antes de calcular nada. Las fracciones de un
  // suelo no pueden ser negativas ni sumar más de 100 (el resto es limo). Sin
  // esto, clay = −5 devolvía tan campante "franco, margen 25,5 pp" sobre un
  // suelo que no existe. Entrada válida → se calcula; entrada imposible → null,
  // igual que cuando falta el dato: en los dos casos no hay fragilidad que dar.
  if (clay < 0 || sand < 0) return null;
  if (clay + sand > SUMA_MAX) return null;       // eso ya no es un suelo, es un dato roto
  const techo = Math.max(100, clay + sand);
  const clase = clasificarTextura(clay, sand);

  const EPS = 0.01;
  const cand = [];
  const probar = (c, a, via) => {
    if (!enDominio(c, a, techo)) return;         // nada de puntos imposibles
    if (clasificarTextura(c, a) === clase) return;
    cand.push({ d: Math.hypot(c - clay, a - sand), clase: clasificarTextura(c, a), via, c, a });
  };

  // Rectas verticales de arcilla (clay = k), recortadas a la arena que cabe.
  for (const [k, via] of [[35, "arcilla=35"], [35 - EPS, "arcilla<35"],
                          [20, "arcilla=20"], [20 - EPS, "arcilla<20"]]) {
    probar(k, clamp(sand, 0, techo - k), via);
  }
  // Rectas horizontales de arena (sand = k), recortadas a la arcilla que cabe.
  for (const [k, via] of [[65, "arena=65"], [65 - EPS, "arena<65"]]) {
    probar(clamp(clay, 0, techo - k), k, via);
  }
  // Vértices: donde las rectas se cortan entre sí y con arcilla+arena = 100.
  for (const [c, a, via] of [
    [35, 65, "esquina arcilla=35 · arena=65"],
    [20, 65, "esquina arcilla=20 · arena=65"],
    [20 - EPS, 65, "esquina arcilla<20 · arena=65"],
    [20, techo - 20, "esquina arcilla=20 · borde de la suma"],
    [35, techo - 35, "esquina arcilla=35 · borde de la suma"],
    [0, 65, "arena=65 sin arcilla"],
    [35, 0, "arcilla=35 sin arena"],
  ]) probar(c, a, via);
  // Y la proyección sobre el borde arcilla+arena = 100, por si la clase vecina
  // solo se alcanza pegado a ese límite.
  const t = (clay - sand + techo) / 2;
  probar(clamp(t, 0, techo), clamp(techo - t, 0, techo), "borde arcilla+arena=" + Math.round(techo));

  if (!cand.length) return { clase, margen_pp: null, clase_vecina: null, via: null, fragil: false, salto_awc: "pequeno" };
  cand.sort((x, y) => x.d - y.d);
  const mejor = cand[0];
  return {
    clase,
    margen_pp: Math.round(mejor.d * 10) / 10,
    clase_vecina: mejor.clase,
    via: mejor.via,
    fragil: mejor.d <= MARGEN_FRAGIL,
    // La frontera que de verdad duele es la de arena/arenoso: cambia el AWC casi
    // al doble. Cruzar a arcilloso solo lo mueve un 7%.
    salto_awc: mejor.clase === "arenoso" || clase === "arenoso" ? "grande" : "pequeno",
  };
}

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
  // Con reloj: este es EL fetch que provocó el helper. El 9-sep, con SoilGrids
  // lento, la consulta se fue a 307 s — y encima consultaConFallback reintenta en
  // puntos vecinos, así que sin tope se multiplica. El límite corto (6 s) es
  // deliberado: el fallback ya cubre el fallo, así que rendirse pronto es mejor
  // que esperar a un servidor que no va a contestar.
  const doFetch = fetchImpl || fetchConTimeout;
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
//   opts.fraccionCiclo : parte del aporte anual de N que cae en el ciclo (def. FRACCION_CICLO)
//   opts.fetch         : inyectable en tests
// Devuelve { N, P2O5, K2O } en kg de la parcela (P2O5/K2O = null: desconocidos)
// más las propiedades observadas y la trazabilidad, para no esconder el prior.
async function ofertaSuelo(lat, lon, areaM2, opts = {}) {
  if (!(Number.isFinite(lat) && Number.isFinite(lon))) {
    return { disponible: false, motivo: "Faltan coordenadas de la parcela." };
  }
  const area = Number(areaM2);

  let props, fuentePunto;
  try {
    ({ props, fuente_punto: fuentePunto } = await consultaConFallback(lat, lon, opts.fetch));
  } catch (e) {
    return { disponible: false, motivo: `SoilGrids no accesible: ${e.message}` };
  }
  if (!props || props.soc == null || props.clay == null || props.sand == null) {
    return {
      disponible: false,
      motivo: "SoilGrids sin dato en la zona (píxel enmascarado). Sin prior de suelo; el motor usará extracción bruta.",
    };
  }

  // LA TEXTURA NO DEPENDE DE LA SUPERFICIE. El área solo sirve para pasar de
  // kg/ha a kg de la parcela; el suelo que hay bajo el punto es el mismo se
  // cultiven 5 m² o 5 ha. Esta comprobación estaba ARRIBA, antes de consultar, y
  // con ella el alta nunca deducía el suelo: `vista=textura` llama a propósito
  // sin área (durante el alta todavía no se ha preguntado la superficie) y
  // siempre recibía "Falta la superficie". El alta se quedaba con el defecto
  // franco sin decirlo, y el suelo mueve el umbral de riego entre uno y tres
  // días (7,4 mm en arenoso contra 13,8 en franco para una lechuga).
  //
  // Sin área se devuelve lo OBSERVADO y `disponible: false`, que es lo que el
  // motor de nutrición ya sabe leer: para él no cambia nada.
  const textura     = clasificarTextura(props.clay, props.sand);
  const moPct       = (props.soc / 10) * C_A_MO;
  const fragil      = fragilidadTextura(props.clay, props.sand);
  const observado   = {
    n_total_g_kg: r2(props.nitrogen),
    carbono_org_g_kg: r2(props.soc),
    materia_organica_pct: r2(moPct),
    ph: r2(props.phh2o),
    arcilla_pct: r2(props.clay),
    arena_pct: r2(props.sand),
    textura,
    densidad_t_m3: r2(props.bdod),
    // Cuánto margen hay hasta cambiar de clase. `fragil: true` = la textura no
    // aguanta el error del mapa y conviene confirmarla con el agricultor.
    fragilidad: fragil,
  };
  if (!(area > 0)) {
    return { disponible: false, fuente_punto: fuentePunto, observado,
             motivo: "Falta la superficie de la parcela (m²) para escalar la oferta." };
  }

  const fraccion = Number(opts.fraccionCiclo) > 0 ? Number(opts.fraccionCiclo) : FRACCION_CICLO;

  // Mineralización de N del suelo — Tabla 4.2 de MAPA:
  //   MO% = C_orgánico% × 1,724        (soc viene en g/kg → /10 = %)
  //   N_anual (kg/ha) = FACTOR[textura] × MO%
  //   N_ciclo (kg/ha) = N_anual × fracción de ciclo de verano
  const nAnualKgHa  = N_MIN_FACTOR[textura] * moPct;
  const nCicloKgHa  = nAnualKgHa * fraccion;
  const nMinParcela = nCicloKgHa * (area / 10000);

  return {
    disponible: true,
    // Lo que el motor consume: N estimado; P/K desconocidos (no se inventan).
    N: r2(nMinParcela),
    P2O5: null,
    K2O: null,
    // Trazabilidad honesta.
    fuente: "SoilGrids v2.0 (ISRIC), 250 m, CC-BY · mineralización: Tabla 4.2 Guía MAPA",
    fuente_punto: fuentePunto, // exacto | vecino_cercano
    observado,
    modelo_n: {
      metodo: "MAPA Tabla 4.2 (N_anual = factor[textura] × MO%)",
      factor_textura: N_MIN_FACTOR[textura],
      fraccion_ciclo: fraccion,
      n_mineralizable_anual_kg_ha: r2(nAnualKgHa),
      n_mineralizable_ciclo_kg_ha: r2(nCicloKgHa),
    },
    nota:
      "N estimado por mineralización de la materia orgánica del suelo (Tabla 4.2 de la " +
      "Guía de fertilización de MAPA; prior regional de SoilGrids, no analítica de la " +
      "parcela). P₂O₅ y K₂O no se derivan de satélite: quedan como desconocidos hasta una analítica.",
  };
}

module.exports = {
  N_MIN_FACTOR,
  FRACCION_CICLO,
  ofertaSuelo,
  // exportadas para test
  clasificarTextura,
  fragilidadTextura,
  consultaPunto,
  consultaConFallback,
};
