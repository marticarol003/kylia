// ─────────────────────────────────────────────────────────────────
// Estimador de rendimiento esperado (pilar fertilizantes) — peldaño 1
// ─────────────────────────────────────────────────────────────────
// El rendimiento MULTIPLICA todo el balance de nutrientes:
//   Necesidad = Extracción × Rendimiento − Oferta_suelo (± términos de N)
// Hoy salía solo del onboarding (?rend_t); sin él, no había plan de abonado.
// Este módulo da un rendimiento por defecto SIN que el agricultor lo teclee:
//
//   Rendimiento(t) = Rinde_referencia(t/ha) × área/10000 × Factor_vigor(NDVI)
//
// FRONTERA HONESTA (declarada, como en _motor-nutricion.js y sentinel.js):
//  · Rinde_referencia: valores CENTRALES de horticultura al aire libre en España,
//    afinables por zona/variedad/manejo — mismo criterio que los coeficientes de
//    extracción antes de validarse contra MAPA. El onboarding SIEMPRE manda: si el
//    agricultor da su rendimiento, se usa el suyo y este módulo no interviene.
//  · Factor_vigor: el NDVI es señal RELATIVA de biomasa, NO un modelo calibrado
//    biomasa→kg (eso es el "B1" futuro, que necesita peso real de cosecha para
//    calibrarse). Aquí el NDVI solo INCLINA el rinde de referencia, ACOTADO a
//    [0,60 · 1,15] para que nunca dispare, y SOLO con canopy formado (NDVI ≥ 0,40):
//    un cultivo recién plantado tiene NDVI bajo por pequeño, no por mal rinde → no
//    se le penaliza (factor 1, se usa el rinde de referencia tal cual).

// Rinde de referencia por cultivo (t/ha, producto fresco, aire libre).
// ✅ VALIDADOS contra la producción comercial de referencia de la Guía MAPA
// (Parte II, Tabla 23.3.1, pág. 184) — 2026-07-23. Se adoptan los valores de MAPA
// porque hacen el balance INTERNAMENTE CONSISTENTE: la extracción de N por hectárea
// (coef. de _motor-nutricion.js × este rinde) cae justo en el centro del rango
// oficial de absorción de N por superficie de esa misma tabla:
//   tomate  3,0 kg/t × 60 = 180 kg/ha  (rango MAPA 150-210) ✅
//   cebolla 2,3 kg/t × 65 = 149 kg/ha  (rango MAPA 140-160) ✅
//   lechuga 2,5 kg/t × 35 =  87 kg/ha  (rango MAPA  80-100) ✅
// (Los valores previos 70/45 descuadraban: tomate 70 → 210 kg/ha, tope del rango;
//  cebolla 45 → 103 kg/ha, POR DEBAJO del rango → infraabonaba.)
const RINDE_REF_T_HA = {
  tomate:  60,  // MAPA producción comercial de referencia (tomate fresco al aire libre)
  cebolla: 65,  // MAPA (cebolla bulbo); antes 45, infraestimaba la extracción de N
  lechuga: 35,  // MAPA (lechuga de pella, peso fresco) — ya coincidía
};

const NDVI_SANO       = 0.80;  // canopy denso y sano → ancla del factor de vigor = 1,0
const NDVI_CANOPY_MIN = 0.40;  // por debajo: no hay canopy (o cultivo joven) → sin ajuste
const FACTOR_MIN      = 0.60;
const FACTOR_MAX      = 1.15;

function r3(x) { return Math.round((Number(x) || 0) * 1000) / 1000; }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

// Factor de vigor a partir del NDVI. Relativo y acotado.
//
// ⚠️ TENÍA UN ESCALÓN, y encima lo hacía NO MONÓTONO. La regla vieja era "por
// debajo de NDVI 0,40 no se ajusta (factor 1); por encima, proporcional". Pero
// 0,40/0,80 = 0,5, que el suelo recorta a 0,60 — así que:
//
//     NDVI 0,39 → 2,64 t      NDVI 0,50 → 1,66 t
//     NDVI 0,40 → 1,58 t      NDVI 0,39 rendía MÁS que 0,50
//
// Un salto del 40% por una centésima, y un cultivo más verde rindiendo menos
// que uno menos verde. Y eso multiplica TODO el plan de abonado.
//
// La causa no era el clamp: era la pregunta. "¿Tiene canopy?" no se contesta con
// un umbral de NDVI, se contesta con la FENOLOGÍA — un cultivo recién plantado
// tiene NDVI bajo por pequeño, no por mal rinde, y eso lo sabe la fase, no el
// índice. Así que la puerta la abre la fase y, una vez abierta, el factor es
// monótono en NDVI de principio a fin.
//
//   fase: "inicial" | "desarrollo" | "media" | "final" (de faseDelDia del motor)
//   Sin fase conocida NO se ajusta: no se penaliza a ciegas.
const FASES_CON_CANOPY = new Set(["media", "final"]);

function factorVigor(ndvi, fase = null) {
  const v = Number(ndvi);
  const valido = ndvi != null && ndvi !== "" && Number.isFinite(v) && v >= -1 && v <= 1;
  if (!valido) return { factor: 1, aplicado: false, motivo: "sin NDVI válido" };
  if (!FASES_CON_CANOPY.has(fase)) {
    return { factor: 1, aplicado: false,
             motivo: fase ? `en fase ${fase} el NDVI mide tamaño, no rinde` : "sin fase conocida" };
  }
  // Sin más puertas por debajo: una segunda condición sobre el NDVI devolvía el
  // escalón por otro lado (0,39 → factor 1, 0,40 → factor 0,60). Y no hace
  // falta, porque el suelo del clamp ya acota lo que puede pasar: por debajo de
  // NDVI 0,48 el factor es 0,60 y no baja más, pase lo que pase. Un cultivo en
  // fase media con el NDVI por los suelos o está fallando o trae una nube — en
  // los dos casos, abonar un 40% menos es el error barato.
  const f = Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, v / NDVI_SANO));
  return { factor: r2(f), aplicado: true, motivo: null };
}

// Rendimiento esperado (t) de la parcela.
//   cultivoId : "tomate" | "cebolla" | "lechuga"
//   areaM2    : superficie de la parcela (m²)
//   opts.ndvi : NDVI más reciente de la parcela (0-1). Opcional.
function rendimientoEsperadoT(cultivoId, areaM2, opts = {}) {
  const ref  = RINDE_REF_T_HA[cultivoId];
  const area = Number(areaM2);
  if (!ref || !Number.isFinite(area) || !(area > 0)) {
    return { disponible: false, motivo: `Sin rinde de referencia para '${cultivoId}' o sin superficie.` };
  }
  // Cien hectáreas no son una huerta. Por encima de ahí hay un error de unidad
  // casi seguro (m² tecleados como ha, o al revés), y el rendimiento multiplica
  // todo el plan de abonado: mejor no dar plan que darlo mil veces más grande.
  const AREA_MAX_M2 = 1e6;
  if (area > AREA_MAX_M2) {
    return { disponible: false,
             motivo: `Superficie de ${Math.round(area)} m² (${r2(area / 10000)} ha): revisa la unidad.` };
  }

  const baseT = ref * (area / 10000);
  const { factor, aplicado, motivo: motivoVigor } = factorVigor(opts.ndvi, opts.fase || null);
  const rendT = baseT * factor;

  return {
    disponible: true,
    cultivo: cultivoId,
    rendimiento_t: r3(rendT),
    base_t: r3(baseT),
    rinde_ref_t_ha: ref,
    factor_vigor: factor,
    vigor_aplicado: aplicado,
    vigor_motivo: motivoVigor || null,
    ndvi: aplicado ? r2(opts.ndvi) : null,
    fuente: aplicado
      ? "Rinde de referencia (afinable) × factor de vigor NDVI (relativo, acotado)"
      : "Rinde de referencia (afinable); sin NDVI de canopy → sin ajuste de vigor",
    frontera: "Peldaño 1: rinde central afinable + NDVI relativo (no es un modelo " +
              "biomasa→kg calibrado). El rendimiento del onboarding, si existe, manda.",
  };
}

module.exports = {
  RINDE_REF_T_HA,
  rendimientoEsperadoT,
  factorVigor,
};
