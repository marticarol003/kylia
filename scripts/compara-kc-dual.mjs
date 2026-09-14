// ─────────────────────────────────────────────────────────────────
// Kc ÚNICO (el motor) vs Kc DUAL (referencia FAO-56 cap. 7)
//   node scripts/compara-kc-dual.mjs [--validar]
// ─────────────────────────────────────────────────────────────────
// NO toca el motor. Implementa el dual aparte, alimentado con EXACTAMENTE la
// misma serie de clima, el mismo reloj térmico y las mismas longitudes de fase,
// para que la única diferencia entre los dos sea el método.
//
// La pregunta no es "¿se parece más a pyfao56?" — eso sería converger con otro
// modelo. La pregunta es: ¿cambia las DECISIONES, el agua recomendada y los
// ahorros lo bastante como para justificar tocar el motor?
//
// `--validar` contrasta esta implementación contra pyfao56 ANTES de creerse
// nada, con inputs idénticos y riego fijo. Necesita python3 con pyfao56 y pandas
// instalados; si no están, lo dice y sale sin fingir que ha validado.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const require = createRequire(import.meta.url);
// Relativo al propio fichero: una ruta absoluta con el home de quien lo escribió
// hace que el script solo funcione en un portátil. Lo cazó Codex al intentar
// reproducir los resultados.
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const M = require(join(RAIZ, "assets", "js", "motor-riego.js"));
const { climaSerie } = require(join(RAIZ, "api", "_clima.js"));

// ── Kcb basal, FAO-56 Tabla 17 ──────────────────────────────────
// El motor lleva Kc ÚNICO (Tabla 12), que incluye la evaporación media del
// suelo. El dual lo separa: Kcb (transpiración) + Ke (evaporación real de la
// superficie, que se seca). Estos Kcb son los de la misma tabla y cultivo.
const KCB = {
  lechuga:   { ini: 0.15, med: 0.90, fin: 0.90 },
  tomate:    { ini: 0.15, med: 1.10, fin: 0.70 },
  cebolla:   { ini: 0.15, med: 0.95, fin: 0.90 },   // cebolla verde
  pimiento:  { ini: 0.15, med: 1.00, fin: 0.80 },
  berenjena: { ini: 0.15, med: 1.00, fin: 0.80 },
  calabacin: { ini: 0.15, med: 0.90, fin: 0.70 },
  brassica:  { ini: 0.15, med: 1.00, fin: 0.90 },
  espinaca:  { ini: 0.15, med: 0.90, fin: 0.85 },
};

// Parámetros de la capa evaporativa (FAO-56 Tabla 19), por textura.
//   Ze = profundidad de la capa que evapora (0,10-0,15 m)
//   REW = agua fácilmente evaporable · TEW = total evaporable
const CAPA = {
  arenoso:   { Ze: 0.10, REW: 4,  thFC: 0.17, thWP: 0.06 },
  franco:    { Ze: 0.10, REW: 8,  thFC: 0.29, thWP: 0.14 },
  arcilloso: { Ze: 0.10, REW: 10, thFC: 0.38, thWP: 0.22 },
};

// Fracción del suelo mojada por el método de riego (FAO-56 Tabla 20).
const FW = { goteo: 0.35, aspersion: 1.0, manguera: 1.0, surco: 0.5, regadera: 0.8 };

function interpFase(tabla, L, dias) {
  const [Li, Ld, Lm] = L;
  if (dias < Li)           return tabla.ini;
  if (dias < Li + Ld)      return tabla.ini + (tabla.med - tabla.ini) * (dias - Li) / Ld;
  if (dias < Li + Ld + Lm) return tabla.med;
  const Lf = L[3];
  const t = Math.min(1, (dias - Li - Ld - Lm) / (Lf || 1));
  return tabla.med + (tabla.fin - tabla.med) * t;
}

/**
 * Balance FAO-56 con Kc DUAL. Misma estructura que simularKylia: riega cuando
 * Dr ≥ RAW y repone. Devuelve lo mismo para poder comparar uno a uno.
 */
function simularDual(serie, opts = {}) {
  const { suelo = "franco", cultivoId, metodoRiego, fechaPlantacion, serieTermica = null,
          termico = true, riegosFijos = null, riegoFijoMm = 0 } = opts;
  const efic  = M.EFIC_RIEGO[metodoRiego] ?? M.EFIC_DEFAULT;
  const curva = termico ? M.curvaFenologica(cultivoId, serieTermica || serie, fechaPlantacion) : null;
  const kcbT  = KCB[cultivoId] || KCB.lechuga;
  const L     = (M.FAO_KC[cultivoId] || M.FAO_KC.lechuga).L;
  const capa  = CAPA[suelo] || CAPA.franco;
  const fw    = FW[metodoRiego] ?? 1.0;

  // TEW = 1000 (θFC − 0,5 θWP) Ze   (FAO-56 ec. 73)
  const TEW = 1000 * (capa.thFC - 0.5 * capa.thWP) * capa.Ze;
  const REW = Math.min(capa.REW, TEW);

  const orden = M.sanearSerie(serie);
  // ⚠️ La capa evaporativa arranca SECA (De = TEW), no húmeda. Es lo que hace
  // pyfao56 y es lo razonable: nadie sabe si llovió el día antes de plantar.
  // Arrancarla en REW daba Kr = 1 desde el día 1 y una evaporación inicial que
  // no existe — con ese error la lechuga en aspersión salía con 147 mm de
  // evaporación de suelo en 55 días.
  let Dr = 0, De = TEW, acum = 0, etcAcum = 0, keAcum = 0, kcbAcum = 0;
  const puntos = [], diario = [];

  for (const dia of orden) {
    const tf   = curva ? curva.diaDe(dia.date) : null;
    const dias = tf == null ? M.diasEntre(fechaPlantacion, new Date(`${dia.date}T12:00:00`)) : tf;
    const kcb  = interpFase(kcbT, L, dias);
    const { taw, raw } = M.aguaSuelo(suelo, cultivoId, dias, kcb * dia.et0);

    // ── riego de la mañana, igual que el motor ──
    // OJO: aquí NO se toca De. El riego moja la capa evaporativa, sí, pero eso
    // se contabiliza abajo en su propio balance (De −= riego/fw). Ponerlo a 0
    // aquí Y restarlo abajo era contarlo dos veces: De se quedaba clavado en 0,
    // Kr valía 1 todos los días y Ke salía siempre al máximo. Con ese bug la
    // lechuga en aspersión daba 170 mm de evaporación de suelo en 55 días —3,1
    // mm/día sostenidos— y el dual salía un 57% POR ENCIMA del único, que es lo
    // contrario de lo que dice la teoría.
    let riegoHoy = 0;
    if (riegosFijos) {                       // modo validación: riego impuesto
      if (riegosFijos.has(dia.date)) { riegoHoy = riegoFijoMm; acum += riegoHoy; Dr = Math.max(0, Dr - riegoHoy); }
    } else if (Dr >= raw) { riegoHoy = Dr / efic; acum += riegoHoy; Dr = 0; }

    // ── Ke: evaporación de la superficie (FAO-56 ec. 71-74) ──
    // Kcmax: techo de la energía disponible. fc: fracción cubierta por el
    // cultivo, derivada de Kcb (ec. 76). few: suelo mojado Y expuesto.
    const Kcmax = Math.max(1.2, kcb + 0.05);
    const fc    = Math.min(0.99, Math.max(0, Math.pow(Math.max(0, (kcb - 0.15)) / Math.max(0.01, (Kcmax - 0.15)), 1 + 0.5 * 0.3)));
    const few   = Math.max(0.01, Math.min(1 - fc, fw));
    const Kr    = De <= REW ? 1 : Math.max(0, (TEW - De) / Math.max(0.01, TEW - REW));
    const Ke    = Math.min(Kr * (Kcmax - kcb), few * Kcmax);

    const ks  = M.ksEstres(Dr, taw, raw);
    const T   = kcb * dia.et0 * ks;        // transpiración, frenada por el suelo
    const E   = Ke * dia.et0;              // evaporación de la superficie
    const etc = T + E;

    const pe = dia.lluvia >= M.PE_MIN_MM ? dia.lluvia : 0;

    // Balance de la capa evaporativa: la moja la lluvia y el riego (este último
    // repartido sobre fw), y la seca E.
    De = Math.min(TEW, Math.max(0, De - pe - (riegoHoy * efic) / Math.max(0.01, fw) + E / few));
    // Balance de la zona radicular.
    Dr = Math.min(taw, Math.max(0, Dr + etc - pe));

    etcAcum += etc; keAcum += E; kcbAcum += T;
    puntos.push({ date: dia.date, acum_l_m2: Math.round(acum * 10) / 10 });
    diario.push({ date: dia.date, dias, kcb, Ke, Kr, fc, few, etc, E, T, De, Dr, raw, et0: dia.et0, riego: riegoHoy > 0 });
  }
  return { puntos, diario, total: Math.round(acum * 10) / 10,
           etcAcum: Math.round(etcAcum * 100) / 100,
           evaporacion: Math.round(keAcum * 10) / 10,
           transpiracion: Math.round(kcbAcum * 10) / 10,
           deficitFinal: Math.round(Dr * 10) / 10 };
}

export { simularDual, KCB, CAPA, FW };

// ── Validación contra pyfao56 ───────────────────────────────────
// Esto es lo que hace creíble todo lo de abajo. Sin ello, la comparación sería
// "mi dual contra el motor", y un error mío parecería un hallazgo: en la primera
// pasada la capa evaporativa arrancaba húmeda y el riego se descontaba dos veces
// de De, y el dual salía un 57% por encima del único. Los dos errores los cazó
// esta validación, no la lectura del código.
async function validar() {
  const { execFileSync } = await import("child_process");
  const fs = await import("fs");
  const os = await import("os");
  const script = join(RAIZ, "scripts", "valida_kc_dual.py");
  if (!fs.existsSync(script)) { console.error(`falta ${script}`); process.exit(1); }
  let crudo;
  try {
    crudo = execFileSync("python3", [script], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    console.error("No se pudo ejecutar la referencia pyfao56.");
    console.error("Necesita:  pip install pyfao56 pandas");
    console.error(String(e.stderr || e.message).split("\n").slice(-5).join("\n"));
    process.exit(1);
  }
  const ref = JSON.parse(crudo);
  const serie = ref.dias.map(d => ({ date: d.date, et0: d.et0, lluvia: d.rain, tmax: 30, tmin: 16 }));
  const fijos = new Set(serie.filter((_, i) => i % ref.cada === 0 && i > 0).map(d => d.date));
  const r = simularDual(serie, {
    suelo: ref.suelo, cultivoId: ref.cultivo, metodoRiego: ref.metodo,
    fechaPlantacion: serie[0].date, termico: false,
    riegosFijos: fijos, riegoFijoMm: ref.riego_mm,
  });
  const n = Math.min(r.diario.length, ref.dias.length);
  const mias = r.diario.slice(0, n), suyas = ref.dias.slice(0, n);
  const rmse = (a, b) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0) / a.length);
  const suma = (a) => a.reduce((s, x) => s + x, 0);
  const rKcb = rmse(mias.map(x => x.kcb), suyas.map(x => x.Kcb));
  const rKe  = rmse(mias.map(x => x.Ke),  suyas.map(x => x.Ke));
  const rETa = rmse(mias.map(x => x.etc), suyas.map(x => x.ETa));
  const rDr  = rmse(mias.map(x => x.Dr),  suyas.map(x => x.Dr));
  const etaMia = suma(mias.map(x => x.etc)), etaRef = suma(suyas.map(x => x.ETa));
  console.log(`Validación contra pyfao56 · ${ref.cultivo}, ${ref.suelo}, ${n} días desde ${ref.dias[0].date}`);
  console.log(`  (${ref.lat}, ${ref.lon}) · riego fijo ${ref.riego_mm} mm cada ${ref.cada} d · clima: ${ref.fuente}`);
  console.log(`  RMSE Kcb ${rKcb.toFixed(4)}  ·  Ke ${rKe.toFixed(3)}  ·  ETa ${rETa.toFixed(3)} mm/d  ·  Dr ${rDr.toFixed(2)} mm`);
  console.log(`  ETa acumulada: pyfao56 ${etaRef.toFixed(1)} · esta implementación ${etaMia.toFixed(1)} (${((etaMia / etaRef - 1) * 100).toFixed(1)}%)`);
  // Umbrales: lo bastante fiel para responder "¿merece la pena el dual?", no
  // para sustituir a pyfao56.
  const fallos = [];
  if (rKcb > 0.001) fallos.push(`Kcb RMSE ${rKcb.toFixed(4)} > 0,001`);
  if (Math.abs(etaMia / etaRef - 1) > 0.03) fallos.push(`ETa acumulada difiere más del 3%`);
  if (rDr > 6) fallos.push(`Dr RMSE ${rDr.toFixed(2)} mm > 6`);
  if (fallos.length) { console.error("\n❌ NO VALIDADA: " + fallos.join(" · ")); process.exit(1); }
  console.log("\n✅ Referencia validada: los resultados de la comparación son creíbles dentro de esos márgenes.");
}

// ── Ejecución ───────────────────────────────────────────────────
if (process.argv[1]?.endsWith("compara-kc-dual.mjs")) {
  if (process.argv.includes("--validar")) { await validar(); process.exit(0); }
  const PIL = [
    { n: "Ferran · tomate · goteo",      lat: 41.749, lon: 2.556, plant: "2026-05-30", desde: "2026-06-13", hasta: "2026-09-08", cul: "tomate",  met: "goteo",     aplico: 412.3 },
    { n: "Oriol · cebolla · aspersión",  lat: 41.668, lon: 2.750, plant: "2026-06-24", desde: "2026-06-24", hasta: "2026-08-12", cul: "cebolla", met: "aspersion", aplico: 360.0 },
    { n: "Padre · lechuga · aspersión",  lat: 41.343, lon: 2.037, plant: "2026-06-05", desde: "2026-06-06", hasta: "2026-07-30", cul: "lechuga", met: "aspersion", aplico: 410.0 },
  ];
  console.log("═══ Kc ÚNICO (motor) vs Kc DUAL (referencia), sobre los pilotos reales ═══\n");
  console.log("piloto                      | suelo     | único  | dual   | dif     | decisiones que cambian | ahorro único → dual");
  console.log("----------------------------|-----------|--------|--------|---------|------------------------|--------------------");
  for (const p of PIL) {
    const serie = await climaSerie(p.lat, p.lon, p.plant, { futuro: 0 });
    const dias  = serie.filter(d => d.date >= p.desde && d.date <= p.hasta);
    for (const suelo of ["arenoso", "franco", "arcilloso"]) {
      const OPT = { suelo, cultivoId: p.cul, metodoRiego: p.met, fechaPlantacion: p.plant, serieTermica: serie };
      const uni = M.simularKylia(dias, { ...OPT, ventana: { desde: dias[0].date, hasta: p.hasta } });
      const dua = simularDual(dias, OPT);
      // Decisiones: días en que uno riega y el otro no
      const rUni = new Set(); let prev = 0;
      uni.puntos.forEach(x => { if (x.acum_l_m2 > prev) rUni.add(x.date); prev = x.acum_l_m2; });
      const rDua = new Set(dua.diario.filter(d => d.riego).map(d => d.date));
      const union = new Set([...rUni, ...rDua]);
      const distintos = [...union].filter(d => rUni.has(d) !== rDua.has(d)).length;
      const ahU = (p.aplico - uni.total) / p.aplico * 100, ahD = (p.aplico - dua.total) / p.aplico * 100;
      console.log(`${(suelo === "franco" ? p.n : "").padEnd(27)} | ${suelo.padEnd(9)} | ${uni.total.toFixed(1).padStart(6)} | ${dua.total.toFixed(1).padStart(6)} | ${((dua.total/uni.total-1)*100).toFixed(1).padStart(6)}% | ${String(distintos).padStart(3)} de ${String(union.size).padStart(3)} días de riego  | ${ahU.toFixed(0).padStart(4)}% → ${ahD.toFixed(0).padStart(4)}%`);
    }
    const s2 = serie.filter(d => d.date >= p.desde && d.date <= p.hasta);
    const d2 = simularDual(s2, { suelo: "franco", cultivoId: p.cul, metodoRiego: p.met, fechaPlantacion: p.plant, serieTermica: serie });
    console.log(`${"".padEnd(27)} |   └ del total del dual, evaporación de suelo ${d2.evaporacion} mm y transpiración ${d2.transpiracion} mm`);
  }
}
