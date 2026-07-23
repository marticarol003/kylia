// ─────────────────────────────────────────────────────────────────
// Motor de cuaderno de fertilización — € y plan de abonado (pilar fertilizantes)
// ─────────────────────────────────────────────────────────────────
// Traduce la necesidad de nutrientes (salida de _motor-nutricion.js) a coste (€)
// y a las líneas del cuaderno / plan de abonado — el gancho regulatorio del
// RD 1051/2022. Núcleo PURO (sin red ni estado), testeable.
//
// HONESTIDAD:
// - Los precios son de REFERENCIA (€/kg de nutriente), volátiles y editables:
//   igual que el reveal del agua usa la tarifa del agricultor, aquí el agricultor
//   puede sobrescribir el precio. Si usa los de referencia, se marca.
// - Si no hay analítica de suelo, la necesidad viene sobre extracción BRUTA
//   (sobrestima): se declara en la nota, no se disimula.
// - No mapea a productos comerciales concretos (eso era el catálogo eco/conv que
//   quitamos por lioso): el plan es a nivel de NUTRIENTE, que es lo que exige el
//   cuaderno y lo que el balance puede sostener con honestidad.

// €/kg de nutriente. Derivados de productos comunes en España (~2025):
//   N    → urea 46% / nitrato amónico cálcico 27%   (~1,1-1,4 €/kg N)
//   P2O5 → superfosfato triple 46%                   (~1,2-1,6 €/kg P2O5)
//   K2O  → sulfato / cloruro potásico 50-60%         (~0,7-1,3 €/kg K2O)
// MARCADOS PARA ACTUALIZAR (precios muy volátiles: N +46%, P +77%, K +23% desde
// la crisis energética). El agricultor puede pasar los suyos en opts.precios.
const PRECIO_REF_EUR_KG = { N: 1.2, P2O5: 1.4, K2O: 0.9 };

// Reparto temporal del abonado (fraccionamiento) — MAPA Parte II, pág. 189-190.
// Fraccionar aumenta la eficiencia del fertilizante al acompasar el aporte con la
// absorción del cultivo. La pauta depende de cómo se aplique el abono:
//
//  - FERTIRRIGACIÓN (goteo): el abono va disuelto en el agua → muy fraccionado, en
//    tercios del ciclo. MAPA: 20-30% / 50-60% / 10-30% (usamos los centros
//    25/55/20). Igual para N, P₂O₅ y K₂O.
//  - RIEGO TRADICIONAL (surco / aspersión / manguera / regadera): abono sólido →
//    N: fondo 20-40% (centro 30) + cobertera 60-80% (centro 70), evitando el final
//    del ciclo; P₂O₅ y K₂O: 100% en fondo (poco móviles, se incorporan al plantar).
const FRACCION_FERTIRRIGACION = [
  { momento: "1er tercio del ciclo", pct: 0.25 },
  { momento: "2º tercio del ciclo",  pct: 0.55 },
  { momento: "3er tercio del ciclo", pct: 0.20 },
];
const FRACCION_TRADICIONAL = {
  N:    [{ momento: "fondo (antes de plantar)", pct: 0.30 }, { momento: "cobertera (en cultivo)", pct: 0.70 }],
  P2O5: [{ momento: "fondo (antes de plantar)", pct: 1.00 }],
  K2O:  [{ momento: "fondo (antes de plantar)", pct: 1.00 }],
};

function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

// Reparte los kg de un nutriente en los momentos de aplicación según el método
// de riego. Devuelve [] si no hay nada que repartir (kg 0).
function repartoNutriente(nutriente, kg, metodoRiego) {
  if (!(kg > 0)) return [];
  const tramos = metodoRiego === "goteo"
    ? FRACCION_FERTIRRIGACION
    : FRACCION_TRADICIONAL[nutriente];
  return tramos.map(t => ({ momento: t.momento, pct: Math.round(t.pct * 100), kg: r2(kg * t.pct) }));
}

// Genera el coste y las líneas del cuaderno de fertilización.
//   necesidad = salida de necesidadNutrientes(cultivoId, rendimientoT, ofertaSuelo)
//   opts = {
//     precios?:       { N, P2O5, K2O },   // €/kg de nutriente (sobrescribe referencia)
//     fecha?:         "YYYY-MM-DD",        // fecha del plan (por defecto hoy)
//     superficie_m2?: number,             // para el encabezado del cuaderno
//     metodo_riego?:  string,             // "goteo" → fertirrigación en tercios;
//                                         // resto → fondo/cobertera (MAPA)
//   }
function cuadernoFertilizacion(necesidad, opts = {}) {
  if (!necesidad || !necesidad.disponible) {
    return {
      disponible: false,
      motivo: (necesidad && necesidad.motivo) || "Sin necesidad de nutrientes calculada.",
    };
  }

  const precios = { ...PRECIO_REF_EUR_KG, ...(opts.precios || {}) };
  const usaReferencia = !opts.precios;

  const metodoRiego = opts.metodo_riego || null;
  const esFertirriego = metodoRiego === "goteo";

  const lineas = [];
  let costeTotal = 0;
  for (const n of ["N", "P2O5", "K2O"]) {
    const kg    = Number(necesidad.nutrientes[n].necesidad_kg) || 0;
    const coste = r2(kg * precios[n]);
    costeTotal += coste;
    lineas.push({
      nutriente: n, necesidad_kg: kg, precio_eur_kg: precios[n], coste_eur: coste,
      // Reparto temporal (fondo/cobertera o tercios), MAPA Parte II.
      reparto: repartoNutriente(n, kg, metodoRiego),
    });
  }

  return {
    disponible: true,
    cultivo: necesidad.cultivo,
    fecha: opts.fecha || new Date().toISOString().slice(0, 10),
    superficie_m2: opts.superficie_m2 ?? null,
    oferta_conocida: necesidad.oferta_conocida,
    lineas,
    // Cómo repartir el abonado en el tiempo (aumenta la eficiencia, MAPA).
    fraccionamiento: {
      modelo: esFertirriego ? "fertirrigacion_tercios" : "fondo_cobertera",
      nota: esFertirriego
        ? "Goteo (fertirrigación): reparte cada nutriente en tercios del ciclo " +
          "(≈25% / 55% / 20%), sin cargar el final del ciclo."
        : "Riego tradicional: N en fondo (30%) + cobertera (70%, en una o varias " +
          "veces evitando el final del ciclo); P₂O₅ y K₂O al 100% en fondo, antes de plantar.",
    },
    coste_total_eur: r2(costeTotal),
    precios_referencia: usaReferencia,
    nota: necesidad.oferta_conocida
      ? "Plan sobre necesidad neta (extracción del cultivo − aporte del suelo)."
      : "Sin analítica de suelo: plan sobre extracción bruta (sobrestima el abono). " +
        "Añade una analítica para ajustar y bajar el coste.",
    validacion: "Precios de referencia €/kg de nutriente, volátiles y editables; marcados para actualizar.",
  };
}

module.exports = {
  PRECIO_REF_EUR_KG,
  FRACCION_FERTIRRIGACION,
  FRACCION_TRADICIONAL,
  repartoNutriente,
  cuadernoFertilizacion,
};
