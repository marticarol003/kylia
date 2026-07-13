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

function r1(x) { return Math.round((Number(x) || 0) * 10) / 10; }

// Necesidad estacional de abonado para un cultivo.
//   cultivoId       : "tomate" | "cebolla" | "lechuga"
//   rendimientoT    : cosecha esperada en TONELADAS (de la parcela o por ha,
//                     según cómo el llamador exprese la extracción/área).
//   ofertaSuelo     : { N, P2O5, K2O } kg disponibles (de la analítica). Opcional.
// Devuelve, por nutriente, la extracción, el aporte del suelo y la necesidad
// neta (nunca negativa). Si no hay analítica, `oferta_conocida: false` y la
// necesidad = extracción bruta (se declara, no se estima el suelo).
function necesidadNutrientes(cultivoId, rendimientoT, ofertaSuelo) {
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

  const porNutriente = {};
  for (const n of ["N", "P2O5", "K2O"]) {
    const extraccion = ext[n] * rend;
    const aporte     = ofertaConocida ? (Number(oferta[n]) || 0) : 0;
    const necesidad  = Math.max(0, extraccion - aporte);
    porNutriente[n] = {
      extraccion_kg: r1(extraccion),
      aporte_suelo_kg: ofertaConocida ? r1(aporte) : null,
      necesidad_kg: r1(necesidad),
    };
  }

  return {
    disponible: true,
    cultivo: cultivoId,
    rendimiento_t: rend,
    oferta_conocida: ofertaConocida,
    nutrientes: porNutriente,
    nota: ofertaConocida
      ? "Necesidad neta = extracción del cultivo − aporte estimado del suelo."
      : "Sin analítica de suelo: se muestra la extracción bruta del cultivo. " +
        "El aporte del suelo (oferta) necesita un análisis; no se estima por satélite.",
    validacion: "Coeficientes = centro de rangos de extracción de guías españolas (agroes.es); afinables por zona.",
  };
}

module.exports = {
  EXTRACCION,
  necesidadNutrientes,
};
