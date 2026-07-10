// ─────────────────────────────────────────────────────────────────
// Motor de riego FAO-56 — núcleo PURO y compartido
// ─────────────────────────────────────────────────────────────────
// Portado fiel del frontend (app/index.html: FAO_KC, kcDelDia, aguaSuelo,
// calcularBalanceHidrico). Aquí vive sin estado: recibe todo por parámetros
// para poder usarse desde el servidor (cron Diario B) y decidir EXACTAMENTE
// igual que la app, sin que los dos motores deriven.
//
// FAO-56 (Allen et al., 1998), método del coeficiente único de cultivo.
// Todo en mm (= L/m²). Ver docs/tecnico/motor-de-decision.md §3.

// zr = [mín al trasplante, máx del cultivo] (m) y p = fracción de agotamiento
// sin estrés, ambos de FAO-56 Tabla 22 (Zr_max: cota INFERIOR del rango de la
// tabla — conservador para huerta pequeña sobre suelos someros). La raíz crece
// de zr[0] a zr[1] durante inicial+desarrollo (§8.3, aproximación estándar).
const FAO_KC = {
  lechuga:   { ini: 0.70, med: 1.00, fin: 0.95, L: [20, 30, 15, 10], zr: [0.20, 0.30], p: 0.30 },
  espinaca:  { ini: 0.70, med: 1.00, fin: 0.95, L: [20, 20, 15,  5], zr: [0.20, 0.30], p: 0.20 },
  brassica:  { ini: 0.70, med: 1.05, fin: 0.95, L: [30, 35, 50, 15], zr: [0.20, 0.50], p: 0.45 },
  tomate:    { ini: 0.60, med: 1.15, fin: 0.80, L: [30, 40, 45, 30], zr: [0.20, 0.70], p: 0.40 },
  pimiento:  { ini: 0.60, med: 1.05, fin: 0.90, L: [30, 35, 40, 20], zr: [0.20, 0.50], p: 0.30 },
  berenjena: { ini: 0.60, med: 1.05, fin: 0.90, L: [30, 40, 40, 20], zr: [0.20, 0.70], p: 0.45 },
  calabacin: { ini: 0.50, med: 0.95, fin: 0.75, L: [25, 35, 25, 15], zr: [0.20, 0.60], p: 0.50 },
  // Cebolla tierna / cebolleta (green onion, FAO-56 Tablas 11-12), TRASPLANTADA
  // y cosechada verde (no bulbifica ni se seca → fin sigue ~1.00). Raíz super-
  // ficial. Adaptado a La Selva en pleno verano (plantada 24-jun): ciclo ~70 d
  // comprimido y adelantado por el calor, arranque corto por ir de plantel, kc
  // med subido a 1.05 por clima seco interior (RHmin~35%, FAO-56 ec. 70) y kc
  // ini a 0.75 por la aspersión frecuente que moja la superficie (más Es).
  cebolla:   { ini: 0.75, med: 1.05, fin: 1.00, L: [15, 25, 20, 10], zr: [0.20, 0.30], p: 0.30 },
};
const SUELO_AWC = { arenoso: 0.08, franco: 0.15, arcilloso: 0.16 }; // θFC−θWP, FAO-56 Tabla 19
const SUELO_AWC_DEFAULT = 0.15;   // franco
const ZR_M          = 0.30;       // profundidad radicular (m) — fallback sin cultivo conocido
const P_AGOTAMIENTO = 0.45;       // fracción de agotamiento — fallback sin cultivo conocido
const PE_MIN_MM     = 2;          // lluvia diaria < 2 mm: se intercepta/evapora sin infiltrar
                                  // (precipitación efectiva, criterio conservador FAO-56 cap. 8)
const EFIC_RIEGO    = { goteo: 0.90, aspersion: 0.75, manguera: 0.70, surco: 0.60, regadera: 0.85 };
const EFIC_DEFAULT  = 0.85;

// Pluviometría/caudal por defecto del sistema (mm/hora = L/m² por hora), para
// convertir la lámina a minutos cuando el agricultor no declara el suyo.
// Orientativos; cada piloto puede afinar el suyo en onboarding.
const CAUDAL_DEFAULT_MMH = { goteo: 4, aspersion: 10, manguera: 20 };

// Kc del día por interpolación lineal entre fases (inicial→desarrollo→media→final).
function kcDelDia(cultivoId, diasDesdePlantacion) {
  const k = FAO_KC[cultivoId];
  if (!k || diasDesdePlantacion == null) return 1; // fallback: ETc = ET₀
  const [Li, Ld, Lm, Lf] = k.L;
  const d = Math.max(0, diasDesdePlantacion);
  if (d < Li)                return k.ini;
  if (d < Li + Ld)           return k.ini + (k.med - k.ini) * (d - Li) / Ld;
  if (d < Li + Ld + Lm)      return k.med;
  if (d < Li + Ld + Lm + Lf) return k.med + (k.fin - k.med) * (d - Li - Ld - Lm) / Lf;
  return k.fin;
}

// Nombre de la fase fenológica del día (inicial→desarrollo→media→final), para
// explicar en pantalla por qué el Kc es el que es. Misma partición que kcDelDia.
function faseDelDia(cultivoId, dias) {
  const k = FAO_KC[cultivoId];
  if (!k || dias == null) return null;
  const [Li, Ld, Lm] = k.L;
  const d = Math.max(0, dias);
  if (d < Li)           return "inicial";
  if (d < Li + Ld)      return "desarrollo";
  if (d < Li + Ld + Lm) return "media";
  return "final";
}

// Profundidad radicular efectiva (m) del día: crece linealmente de zr[0] al
// trasplante hasta zr[1] al inicio de la fase media (FAO-56 §8.3). Sin cultivo
// o sin fecha → ZR_M fijo (comportamiento legacy).
function zrDelDia(cultivoId, dias) {
  const k = FAO_KC[cultivoId];
  if (!k || !k.zr || dias == null) return ZR_M;
  const diasCrec = k.L[0] + k.L[1];
  const f = Math.min(1, Math.max(0, dias) / diasCrec);
  return k.zr[0] + (k.zr[1] - k.zr[0]) * f;
}

// Agua total (TAW) y fácilmente disponible (RAW), en mm, según textura, cultivo
// y día del ciclo (la raíz crece → el depósito crece). Compatible hacia atrás:
// sin cultivo/día usa los fallbacks fijos (ZR_M, P_AGOTAMIENTO).
function aguaSuelo(suelo, cultivoId = null, dias = null) {
  const awc = SUELO_AWC[suelo] ?? SUELO_AWC_DEFAULT;
  const zr  = zrDelDia(cultivoId, dias);
  const p   = FAO_KC[cultivoId]?.p ?? P_AGOTAMIENTO;
  const taw = 1000 * awc * zr;
  return { taw, raw: p * taw, awc };
}

function diasEntre(fechaIso, hasta) {
  if (!fechaIso) return null;
  return Math.round((hasta - new Date(`${fechaIso}T12:00:00`)) / 86400000);
}

// Balance hídrico FAO-56 sobre una serie diaria. Réplica del bucle del frontend:
// recarga por riego neto (litros × eficiencia), ETc = Kc×ET₀, resta lluvia
// efectiva, acota Dr a [0, TAW].
//   serie:   [{date:'YYYY-MM-DD', et0:Number, lluvia:Number}]  (ordenada o no)
//   riegos:  [{date:'YYYY-MM-DD', litros:Number|null}]          (null = recarga completa)
//   opts:    { suelo, cultivoId, metodoRiego, fechaPlantacion }
// Devuelve { Dr, taw, raw, efic, kcActual, etcAcum, et0Acum, lluviaAcum, sinFenologia }.
function balanceHidrico(serie, riegos, opts = {}) {
  const { suelo, cultivoId = null, metodoRiego, fechaPlantacion = null } = opts;
  const efic = EFIC_RIEGO[metodoRiego] ?? EFIC_DEFAULT;

  const riegoNeto = {};
  (riegos || []).forEach(r => {
    riegoNeto[r.date] = r.litros != null
      ? (riegoNeto[r.date] || 0) + r.litros * efic
      : null;
  });

  const orden = [...(serie || [])].sort((a, b) => a.date.localeCompare(b.date));
  let Dr = 0, etcAcum = 0, et0Acum = 0, lluviaAcum = 0;
  let taw = aguaSuelo(suelo).taw, raw = aguaSuelo(suelo).raw;
  for (const dia of orden) {
    const dias = diasEntre(fechaPlantacion, new Date(`${dia.date}T12:00:00`));
    ({ taw, raw } = aguaSuelo(suelo, cultivoId, dias));   // la raíz crece día a día
    if (dia.date in riegoNeto) {
      const r = riegoNeto[dia.date];
      Dr = r === null ? 0 : Math.max(0, Dr - r);
    }
    const kc  = kcDelDia(cultivoId, dias);
    const etc = kc * (dia.et0 ?? 0);
    const pll = Math.max(0, dia.lluvia ?? 0);
    const pe  = pll >= PE_MIN_MM ? pll : 0;               // lluvia efectiva
    Dr = Math.min(taw, Math.max(0, Dr + etc - pe));
    etcAcum += etc; et0Acum += (dia.et0 ?? 0); lluviaAcum += pe;
  }

  const ultima = orden.length ? new Date(`${orden[orden.length - 1].date}T12:00:00`) : new Date();
  return {
    Dr, taw, raw, efic,
    kcActual: kcDelDia(cultivoId, diasEntre(fechaPlantacion, ultima)),
    etcAcum, et0Acum, lluviaAcum,
    sinFenologia: !fechaPlantacion,
  };
}

// Regla de decisión de la card-hoy (idéntica al frontend / motor-de-decision.md §3.2d).
//   Dr ≥ RAW        → regar (alta), cantidad bruta = Dr/eficiencia
//   0.75·RAW ≤ Dr   → vigilar (media)
//   Dr < 0.75·RAW   → todo en orden (baja)
function decisionRiego(bal) {
  const { Dr, raw, efic } = bal;
  const r0 = (x) => Math.round(x);
  if (Dr >= raw) {
    const bruto = Math.round((Dr / efic) * 10) / 10;
    return {
      nivel: "alta",
      cantidad_l_m2: bruto,
      texto: `Regar hoy ~${r0(bruto)} L/m² · déficit ${r0(Dr)} mm ≥ umbral ${r0(raw)}`,
    };
  }
  if (Dr >= 0.75 * raw) {
    return { nivel: "media", cantidad_l_m2: null,
             texto: `Vigilar el riego · déficit ${r0(Dr)} mm, cerca del umbral ${r0(raw)}` };
  }
  return { nivel: "baja", cantidad_l_m2: null,
           texto: `Todo en orden · déficit ${r0(Dr)} mm < umbral ${r0(raw)}` };
}

// Convierte la lámina BRUTA (mm = L/m²) a la unidad del sistema del agricultor.
//   regadera → nº de regaderas (= mm × área ÷ capacidad) + litros totales
//   goteo/aspersión/manguera → minutos (= mm ÷ caudal mm/h × 60)
//   surco / sin datos → L/m² (no hay modelo de caudal fiable)
// Siempre devuelve también `mm` para trazabilidad (todo el motor habla en mm).
function presentarRiego(mmBruto, opts = {}) {
  const { metodoRiego, caudalMmh, areaM2, capacidadRegaderaL } = opts;
  const mm = Math.max(0, Number(mmBruto) || 0);
  const r0 = (x) => Math.round(x);
  const r1 = (x) => Math.round(x * 10) / 10;

  if (metodoRiego === "regadera") {
    if (areaM2 > 0 && capacidadRegaderaL > 0) {
      const litros = mm * areaM2;                       // L para todo el bancal
      const n = litros / capacidadRegaderaL;
      const nTxt = n >= 10 ? r0(n) : r1(n);
      return { unidad: "regaderas", valor: nTxt, mm: r1(mm),
               litrosTotales: r0(litros),
               texto: `${nTxt} regadera${nTxt === 1 ? "" : "s"} (${r0(litros)} L)` };
    }
    return { unidad: "l_m2", valor: r0(mm), mm: r1(mm), texto: `${r0(mm)} L/m²` };
  }

  const caudal = Number(caudalMmh) || CAUDAL_DEFAULT_MMH[metodoRiego];
  if (caudal > 0) {
    const min = (mm / caudal) * 60;
    return { unidad: "min", valor: r0(min), mm: r1(mm), texto: `${r0(min)} min` };
  }
  return { unidad: "l_m2", valor: r0(mm), mm: r1(mm), texto: `${r0(mm)} L/m²` };
}

// Simula el manejo del riego "según Kylia" sobre una serie climática: cada día,
// si el déficit acumulado alcanza el umbral RAW, riega la lámina BRUTA que
// recomienda la regla (Dr/eficiencia) y repone el suelo; si no, no riega. Es la
// rama contrafactual del campo del padre: "lo que habría hecho si hubiera
// seguido a Kylia", para contrastarla con lo que aplicó de verdad.
//   serie: [{date, et0, lluvia}]   opts: { suelo, cultivoId, metodoRiego, fechaPlantacion }
// Devuelve { puntos:[{date, acum_l_m2}], total, taw, raw, efic } — todo BRUTO (L/m²),
// para comparar manzanas con manzanas contra el agua realmente vertida (que también
// es bruta: lo que sale del aspersor/regadera, antes de pérdidas).
function simularKylia(serie, opts = {}) {
  const { suelo, cultivoId = null, metodoRiego, fechaPlantacion = null } = opts;
  const efic = EFIC_RIEGO[metodoRiego] ?? EFIC_DEFAULT;

  const orden = [...(serie || [])].sort((a, b) => a.date.localeCompare(b.date));
  let Dr = 0, acum = 0;
  let taw = aguaSuelo(suelo).taw, raw = aguaSuelo(suelo).raw;
  const puntos = [];
  for (const dia of orden) {
    const dias = diasEntre(fechaPlantacion, new Date(`${dia.date}T12:00:00`));
    ({ taw, raw } = aguaSuelo(suelo, cultivoId, dias));   // la raíz crece día a día
    // Decisión de la mañana: con el déficit que arrastra de ayer (misma regla que decisionRiego).
    if (Dr >= raw) { acum += Dr / efic; Dr = 0; }   // riego bruto = Dr/efic → repone Dr neto
    const kc  = kcDelDia(cultivoId, dias);
    const etc = kc * (dia.et0 ?? 0);
    const pll = Math.max(0, dia.lluvia ?? 0);
    const pe  = pll >= PE_MIN_MM ? pll : 0;               // lluvia efectiva
    Dr = Math.min(taw, Math.max(0, Dr + etc - pe));
    puntos.push({ date: dia.date, acum_l_m2: Math.round(acum * 10) / 10 });
  }
  // deficitFinal: agua que Kylia tenía "en cola" al corte (aún no regada porque
  // el depósito no llegó al umbral). Honestidad del reveal: comparar acumulados
  // a igual fecha favorece al que riega menos a menudo; este dato lo explicita.
  return { puntos, total: Math.round(acum * 10) / 10, taw, raw, efic,
           deficitFinal: Math.round((Dr / efic) * 10) / 10 };
}

module.exports = {
  FAO_KC, SUELO_AWC, ZR_M, P_AGOTAMIENTO, PE_MIN_MM, EFIC_RIEGO, EFIC_DEFAULT, CAUDAL_DEFAULT_MMH,
  kcDelDia, faseDelDia, zrDelDia, aguaSuelo, diasEntre, balanceHidrico, decisionRiego, presentarRiego, simularKylia,
};
