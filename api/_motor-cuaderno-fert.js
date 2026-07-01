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

function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

// Genera el coste y las líneas del cuaderno de fertilización.
//   necesidad = salida de necesidadNutrientes(cultivoId, rendimientoT, ofertaSuelo)
//   opts = {
//     precios?:       { N, P2O5, K2O },   // €/kg de nutriente (sobrescribe referencia)
//     fecha?:         "YYYY-MM-DD",        // fecha del plan (por defecto hoy)
//     superficie_m2?: number,             // para el encabezado del cuaderno
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

  const lineas = [];
  let costeTotal = 0;
  for (const n of ["N", "P2O5", "K2O"]) {
    const kg    = Number(necesidad.nutrientes[n].necesidad_kg) || 0;
    const coste = r2(kg * precios[n]);
    costeTotal += coste;
    lineas.push({ nutriente: n, necesidad_kg: kg, precio_eur_kg: precios[n], coste_eur: coste });
  }

  return {
    disponible: true,
    cultivo: necesidad.cultivo,
    fecha: opts.fecha || new Date().toISOString().slice(0, 10),
    superficie_m2: opts.superficie_m2 ?? null,
    oferta_conocida: necesidad.oferta_conocida,
    lineas,
    coste_total_eur: r2(costeTotal),
    precios_referencia: usaReferencia,
    nota: necesidad.oferta_conocida
      ? "Plan sobre necesidad neta (extracción del cultivo − aporte del suelo)."
      : "Sin analítica de suelo: plan sobre extracción bruta (sobrestima el abono). " +
        "Añade una analítica para ajustar y bajar el coste.",
    validacion: "Precios de referencia €/kg de nutriente, volátiles y editables; marcados para actualizar.",
  };
}

module.exports = { PRECIO_REF_EUR_KG, cuadernoFertilizacion };
