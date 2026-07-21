// ─────────────────────────────────────────────────────────────────
// Motor de nutrición — balance de masa de nutrientes (pilar fertilizantes)
// ─────────────────────────────────────────────────────────────────
// Gemelo de _motor-riego.js pero para el abonado. Núcleo PURO (sin red ni
// estado) para poder testearse determinista.
//
// Modelo (peldaño 1 de la escalera de validación, análogo a FAO-56 en agua):
//
//   Necesidad(nutriente) = Extracción(nutriente) × Rendimiento_esperado
//                          − Oferta_del_suelo(nutriente)
//
// Para el NITRÓGENO se completan dos términos del balance oficial de MAPA que NO
// necesitan analítica (solo el área de la parcela, para escalar de kg/ha a kg):
//
//   Necesidad(N) = Extracción(N) + Colchón_N_final
//                  − Oferta_del_suelo(N) − Crédito_residuos
//
// - Colchón_N_final (SUBE la dosis): mínimo de N mineral que MAPA deja en el suelo
//   a cosecha para que el cultivo no acabe con hambre de N justo en el llenado
//   (30-60 kg/ha general; 60-90 en cebolla y afines de raíz poco eficiente).
// - Crédito_residuos (BAJA la dosis): N del cultivo anterior que se libera si se
//   incorporan los restos. Es dato del onboarding; 0 mientras no se capture.
// Ambos términos se aplican SOLO si llega `opts.area_m2`; si no, quedan inactivos
// (retrocompatible). Ver docs/tecnico/validacion-nutricion.md §4.
//
// - Extracción: kg de N / P₂O₅ / K₂O que el cultivo retira por tonelada de
//   producto cosechado. Es el equivalente del Kc: un coeficiente agronómico.
// - Rendimiento esperado (t): del onboarding o, más adelante, estimado por
//   satélite (biomasa → cosecha, modelo B1, validado contra peso real).
// - Oferta del suelo: N/P/K disponibles según ANALÍTICA DE SUELO. Es el patrón
//   oro y NO se puede sacar del satélite (el satélite ve la cubierta, no la
//   química del suelo). Sin analítica, se devuelve la extracción bruta y se
//   declara `oferta_conocida: false` (no se inventa el aporte).
//
// FRONTERA HONESTA: estos coeficientes son el CENTRO de los rangos de
// extracción por tonelada publicados en guías de abonado españolas (agroes.es,
// "extracciones y dosis de nutrientes"), que distinguen extracción (lo que
// retira el cultivo) de dosis (lo que se aplica, mayor, por eficiencia/reservas
// del suelo). Nosotros usamos EXTRACCIÓN. Varían por variedad, zona y manejo:
// afinables con guía autonómica / IPNI antes de traducir a € o a un plan de
// abonado RD 1051/2022. Lo robusto es la estructura del balance y la relación
// N:P:K por cultivo, no el segundo decimal.

// Extracción en kg por TONELADA de producto cosechado (fresco).
//   N    = nitrógeno
//   P2O5 = fósforo expresado como P₂O₅
//   K2O  = potasio expresado como K₂O
// Rangos fuente (agroes.es, absorción por producción comercializada):
//   tomate  N 2,5-3,5 · P2O5 1,1-1,5 · K2O 5,0-5,5
//   cebolla N 2,1-2,5 · P2O5 0,9-1,5 · K2O 3,0-3,8
//   lechuga N 2,2-2,7 · P2O5 0,8-1,4 · K2O 4,6-6,0
const EXTRACCION = {
  // Tomate (fruto fresco): muy exigente en K en cuaje/engorde.
  tomate:  { N: 3.0, P2O5: 1.3, K2O: 5.2 },
  // Cebolla (bulbo / cebolla tierna): demanda moderada, K medio.
  cebolla: { N: 2.3, P2O5: 1.2, K2O: 3.4 },
  // Lechuga (peso fresco de la pella): K relativamente alto frente a N.
  lechuga: { N: 2.5, P2O5: 1.1, K2O: 5.3 },
};

// Colchón de N mineral mínimo al final del cultivo (kg N/ha) — Guía MAPA.
// Centro de los rangos oficiales: 30-60 general → 45; cultivos de raíz poco
// eficiente que dejan más N sin usar (cebolla, espinaca, puerro, brócoli,
// coliflor) 60-90 → 75. Sube la dosis de N; no afecta a P₂O₅ ni K₂O.
const COLCHON_N_KG_HA = { tomate: 45, cebolla: 75, lechuga: 45 };
const COLCHON_N_DEFECTO = 45;

function r1(x) { return Math.round((Number(x) || 0) * 10) / 10; }

// Necesidad estacional de abonado para un cultivo.
//   cultivoId       : "tomate" | "cebolla" | "lechuga"
//   rendimientoT    : cosecha esperada en TONELADAS (de la parcela o por ha,
//                     según cómo el llamador exprese la extracción/área).
//   ofertaSuelo     : { N, P2O5, K2O } kg disponibles (de la analítica). Opcional.
//   opts.area_m2    : superficie de la parcela (m²). Necesaria para escalar los
//                     términos de N de MAPA (kg/ha → kg parcela). Sin ella, esos
//                     términos quedan inactivos (retrocompatible).
//   opts.credito_residuos_n_kg_ha : N (kg/ha) liberado por los residuos del
//                     cultivo anterior si se incorporan. Del onboarding; def. 0.
//   opts.colchon_n_kg_ha : override del colchón de N final (kg/ha). Def. por cultivo.
// Devuelve, por nutriente, la extracción, el aporte del suelo y la necesidad
// neta (nunca negativa). Si no hay analítica, `oferta_conocida: false` y la
// necesidad = extracción bruta (se declara, no se estima el suelo). Para el N,
// suma el colchón final y resta el crédito de residuos (solo si hay area_m2).
function necesidadNutrientes(cultivoId, rendimientoT, ofertaSuelo, opts = {}) {
  const ext = EXTRACCION[cultivoId];
  if (!ext) {
    return { disponible: false, motivo: `Sin coeficientes de extracción para '${cultivoId}'.` };
  }
  const rend = Number(rendimientoT);
  if (!(rend > 0)) {
    return {
      disponible: false,
      motivo: "Falta el rendimiento esperado (t) para calcular la extracción del cultivo.",
    };
  }

  const oferta = ofertaSuelo || null;
  const ofertaConocida = !!(oferta && ["N", "P2O5", "K2O"].some(k => Number(oferta[k]) > 0));

  // Términos de N del balance de MAPA (solo si hay área para escalar kg/ha → kg).
  const areaM2   = Number(opts.area_m2);
  const escalaHa = areaM2 > 0 ? areaM2 / 10000 : null;   // kg/ha → kg de la parcela
  const balanceNCompleto = escalaHa != null;
  const colchonHa  = Number(opts.colchon_n_kg_ha) > 0
    ? Number(opts.colchon_n_kg_ha)
    : (COLCHON_N_KG_HA[cultivoId] ?? COLCHON_N_DEFECTO);
  const creditoHa  = Number(opts.credito_residuos_n_kg_ha) > 0 ? Number(opts.credito_residuos_n_kg_ha) : 0;
  const colchonN   = balanceNCompleto ? colchonHa * escalaHa : 0;
  const creditoN   = balanceNCompleto ? creditoHa * escalaHa : 0;

  const porNutriente = {};
  for (const n of ["N", "P2O5", "K2O"]) {
    const extraccion = ext[n] * rend;
    const aporte     = ofertaConocida ? (Number(oferta[n]) || 0) : 0;
    // Colchón y crédito de residuos son términos de nitrógeno; P₂O₅/K₂O no los llevan.
    const colchon    = n === "N" ? colchonN : 0;
    const credito    = n === "N" ? creditoN : 0;
    const necesidad  = Math.max(0, extraccion + colchon - aporte - credito);
    porNutriente[n] = {
      extraccion_kg: r1(extraccion),
      aporte_suelo_kg: ofertaConocida ? r1(aporte) : null,
      necesidad_kg: r1(necesidad),
    };
    if (n === "N" && balanceNCompleto) {
      porNutriente[n].colchon_final_kg    = r1(colchon);
      porNutriente[n].credito_residuos_kg = r1(credito);
    }
  }

  const notaBase = ofertaConocida
    ? "Necesidad neta = extracción del cultivo − aporte estimado del suelo."
    : "Sin analítica de suelo: se muestra la extracción bruta del cultivo. " +
      "El aporte del suelo (oferta) necesita un análisis; no se estima por satélite.";
  const notaN = balanceNCompleto
    ? ` N: + colchón final de MAPA (${colchonHa} kg/ha, reserva a cosecha)` +
      (creditoHa > 0 ? ` − crédito de residuos del cultivo anterior (${creditoHa} kg/ha).` : ".")
    : "";

  return {
    disponible: true,
    cultivo: cultivoId,
    rendimiento_t: rend,
    oferta_conocida: ofertaConocida,
    balance_n_completo: balanceNCompleto,
    nutrientes: porNutriente,
    nota: notaBase + notaN,
    validacion: "Coeficientes = centro de rangos de extracción de guías españolas (agroes.es); afinables por zona.",
  };
}

module.exports = {
  EXTRACCION,
  COLCHON_N_KG_HA,
  necesidadNutrientes,
};
