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

// €/kg de nutriente, A GRANEL. Derivados de productos comunes en España (~2025):
//   N    → urea 46% / nitrato amónico cálcico 27%   (~1,1-1,4 €/kg N)
//   P2O5 → superfosfato triple 46%                   (~1,2-1,6 €/kg P2O5)
//   K2O  → sulfato / cloruro potásico 50-60%         (~0,7-1,3 €/kg K2O)
// MARCADOS PARA ACTUALIZAR (precios muy volátiles: N +46%, P +77%, K +23% desde
// la crisis energética). El agricultor puede pasar los suyos en opts.precios.
const PRECIO_REF_CONVENCIONAL = { N: 1.2, P2O5: 1.4, K2O: 0.9 };

// El MISMO nitrógeno en ecológico cuesta otro orden de magnitud, y hasta ahora
// el plan le enseñaba a un agricultor ecológico el precio del producto que NO
// puede usar. Medido el 2026-08-09 sobre listados reales españoles:
//   · harina de sangre 15% N, saco de 25 kg a 95,90 €  → 25,6 €/kg de N
//   · la misma harina en envase de 1 kg a 19,90 €      → 132,7 €/kg de N
//   · guano 8% N                                       → 124,9 €/kg de N
// Se toma el precio A GRANEL (26) para que sea comparable con la tabla de
// arriba, que también es a granel. Quien compre en envase de 1 kg —un huerto
// pequeño, que es justo quien no puede con un saco de 25— paga unas 5 veces
// más; eso lo avisa la búsqueda de producto real, que sí ve el envase.
//
// P₂O₅ y K₂O van a null A PROPÓSITO: no se han medido en ecológico y aquí no se
// inventa un número. Una línea sin precio se enseña sin coste y el total se
// declara PARCIAL, que es la verdad. Ver _ia-producto-fertilizante.js.
const PRECIO_REF_ECOLOGICO = { N: 26, P2O5: null, K2O: null };

// Compatibilidad: había código y tests apuntando al nombre viejo.
const PRECIO_REF_EUR_KG = PRECIO_REF_CONVENCIONAL;

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
// Los kg de un tramo del reparto llegan a gramos: con r2, la cobertera del bancal
// de 5 m² (40 g) se redondeaba a 0,04 kg y el fondo (17 g) a 0,02 — cerca del
// error de la propia báscula. Ver r1 en _motor-nutricion.js.
function r3(x) { return Math.round((Number(x) || 0) * 1000) / 1000; }

// Reparte los kg de un nutriente en los momentos de aplicación según el método
// de riego. Devuelve [] si no hay nada que repartir (kg 0).
function repartoNutriente(nutriente, kg, metodoRiego, opts = {}) {
  if (!(kg > 0)) return [];
  let tramos = metodoRiego === "goteo"
    ? FRACCION_FERTIRRIGACION
    : FRACCION_TRADICIONAL[nutriente];

  // Con abono ya echado, el fondo (antes de plantar) es agua pasada: no se puede
  // volver atrás a aplicarlo. Lo pendiente se reparte entre los momentos que
  // QUEDAN, renormalizando; si no quedaba ninguno, va todo en cobertera.
  if (opts.fondoHecho) {
    const quedan = tramos.filter(t => !/fondo/i.test(t.momento));
    const suma = quedan.reduce((s, t) => s + t.pct, 0);
    tramos = quedan.length && suma > 0
      ? quedan.map(t => ({ ...t, pct: t.pct / suma }))
      : [{ momento: "cobertera (en cultivo)", pct: 1 }];
  }
  return tramos.map(t => ({ momento: t.momento, pct: Math.round(t.pct * 100), kg: r3(kg * t.pct) }));
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

  // El manejo elige la tabla: al ecológico no le sirve el precio de la urea.
  const esEco   = opts.manejo === "ecologico";
  const precios = { ...(esEco ? PRECIO_REF_ECOLOGICO : PRECIO_REF_CONVENCIONAL), ...(opts.precios || {}) };
  const usaReferencia = !opts.precios;

  const metodoRiego = opts.metodo_riego || null;
  const esFertirriego = metodoRiego === "goteo";

  const lineas = [];
  let costeTotal = 0;
  // Lo que YA se ha echado en este ciclo, en kg de nutriente. Sin esto el plan
  // pide la necesidad entera aunque el abonado de fondo esté hecho — en 5 m² es
  // un despiste, en hectáreas es sobrefertilizar por diseño.
  const yaAplicado = (opts.ya_aplicado && typeof opts.ya_aplicado === "object") ? opts.ya_aplicado : {};

  for (const n of ["N", "P2O5", "K2O"]) {
    const kg     = Number(necesidad.nutrientes[n].necesidad_kg) || 0;
    // Sin precio conocido para ese nutriente no se inventa uno: la línea va sin
    // coste y el total queda declarado como parcial más abajo.
    const puesto    = Math.max(0, Number(yaAplicado[n]) || 0);
    // Lo que queda por echar. Nunca negativo: si se pasó, el plan dice 0 y el
    // exceso se declara aparte — un "necesita −20 g" no se puede ejecutar.
    const pendiente = r3(Math.max(0, kg - puesto));
    const exceso    = puesto > kg ? r3(puesto - kg) : 0;

    const precio = precios[n] == null ? null : Number(precios[n]);
    // El coste es el de lo que FALTA, no el de la necesidad total: lo ya echado
    // ya está pagado.
    const coste  = precio == null ? null : r2(pendiente * precio);
    if (coste != null) costeTotal += coste;
    lineas.push({
      nutriente: n, necesidad_kg: kg, precio_eur_kg: precio, coste_eur: coste,
      ya_aplicado_kg: puesto, pendiente_kg: pendiente, exceso_kg: exceso,
      // El reparto se hace sobre lo PENDIENTE: si el fondo ya está echado, lo
      // que queda es cobertera, y ofrecer otra vez el fondo sería doblarlo.
      reparto: repartoNutriente(n, pendiente, metodoRiego, { fondoHecho: puesto > 0 }),
      // Los sumandos que dan ese kg. Se calculaban y se tiraban, así que la
      // cifra llegaba al agricultor sin poder explicarse: "58 g" y punto. Con
      // esto la pantalla puede enseñar de dónde sale cada término y de qué
      // fuente — que es la diferencia entre un número y una recomendación.
      desglose: {
        extraccion_kg:       necesidad.nutrientes[n].extraccion_kg ?? null,
        colchon_final_kg:    necesidad.nutrientes[n].colchon_final_kg ?? null,
        aporte_suelo_kg:     necesidad.nutrientes[n].aporte_suelo_kg ?? null,
        credito_residuos_kg: necesidad.nutrientes[n].credito_residuos_kg ?? null,
      },
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
    // Si algún nutriente se ha quedado sin precio, el total NO es el coste del
    // plan: es el de las líneas que sí se pudieron valorar. Decirlo evita que
    // alguien presupueste con un número que le falta un trozo.
    coste_parcial: lineas.some(l => l.pendiente_kg > 0 && l.coste_eur == null),
    // ¿Se ha descontado algo? La pantalla tiene que poder decirlo: un plan que
    // ha bajado porque ya abonaste no es lo mismo que un plan que pide poco.
    hay_aplicado: lineas.some(l => l.ya_aplicado_kg > 0),
    hay_exceso:   lineas.some(l => l.exceso_kg > 0),
    manejo: opts.manejo || null,
    precios_referencia: usaReferencia,
    nota: necesidad.oferta_conocida
      ? "Plan sobre necesidad neta (extracción del cultivo − aporte del suelo)."
      : "Sin analítica de suelo: plan sobre extracción bruta (sobrestima el abono). " +
        "Añade una analítica para ajustar y bajar el coste.",
    validacion: opts.manejo === "ecologico"
      ? "Precios de referencia en ECOLÓGICO y a granel (N medido sobre listados reales; P₂O₅ y K₂O sin medir, por eso van sin coste). En envase pequeño se paga unas 5 veces más."
      : "Precios de referencia €/kg de nutriente en convencional y a granel, volátiles y editables; marcados para actualizar.",
  };
}

module.exports = {
  PRECIO_REF_EUR_KG,
  FRACCION_FERTIRRIGACION,
  FRACCION_TRADICIONAL,
  repartoNutriente,
  cuadernoFertilizacion,
};
