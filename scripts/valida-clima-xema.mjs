// ─────────────────────────────────────────────────────────────────
// ¿Qué fuente de clima se acerca más a lo que MIDIÓ una estación oficial?
//   node scripts/valida-clima-xema.mjs [--dias 90] [--json salida.json]
// ─────────────────────────────────────────────────────────────────
// Contrasta las dos fuentes de Open-Meteo que usa Kylia —el ARCHIVO (reanálisis)
// y el PRONÓSTICO con past_days— contra las estaciones de la XEMA (Meteocat),
// que publican ET₀ de referencia y precipitación diaria en datos abiertos.
//
// POR QUÉ ESTÁ EN EL REPOSITORIO. Las cifras que salen de aquí se han usado para
// decidir sobre el motor (qué fuente manda en el pasado, si acercar la fuente de
// ET₀ es una palanca, y si la lluvia de rejilla es utilizable). Una cifra que
// decide sobre el motor y no se puede reproducir no es evidencia, es una
// anécdota — lo señaló Codex al auditar y tenía razón.
//
// ── Fuentes ──────────────────────────────────────────────────────
//   Estaciones (verdad de referencia):
//     datos      https://analisi.transparenciacatalunya.cat/resource/7bvh-jvq2.json
//     metadatos  https://analisi.transparenciacatalunya.cat/resource/yqwd-vj5e.json
//     variables  1300 = precipitación acumulada diaria (mm)
//                1700 = evapotranspiración de referencia diaria (mm)
//     Socrata, sin token. Generalitat de Catalunya, Meteocat.
//   Modelos:
//     archivo    https://archive-api.open-meteo.com/v1/archive   (ERA5)
//     pronóstico https://api.open-meteo.com/v1/forecast?past_days=…
//
// ── Método ───────────────────────────────────────────────────────
//   · Todo en Europe/Madrid (las tres fuentes se piden en esa zona; el día civil
//     de la XEMA es el día natural local).
//   · Unidades: mm/día en las tres. No hay conversión.
//   · MISSING: un día entra en la comparación SOLO si las tres fuentes lo tienen.
//     Los huecos no se rellenan con cero — es justo el error que costó dos
//     informes de piloto. Se reporta cuántos días se han descartado y por qué.
//   · Métricas: sesgo medio (modelo − observado), RMSE diario, y diferencia del
//     ACUMULADO del periodo en %. El acumulado es lo que entra en el balance.
//   · La estación NO es la parcela: la comparación mide "modelo vs estación a N
//     km", no "modelo vs parcela". Por eso se imprime la distancia.
import { writeFileSync } from "fs";

const XEMA_DATOS = "https://analisi.transparenciacatalunya.cat/resource/7bvh-jvq2.json";
const XEMA_META  = "https://analisi.transparenciacatalunya.cat/resource/yqwd-vj5e.json";
const ARCHIVE    = "https://archive-api.open-meteo.com/v1/archive";
const FORECAST   = "https://api.open-meteo.com/v1/forecast";
const TZ         = "Europe%2FMadrid";
const VAR = { lluvia: 1300, et0: 1700 };

const arg = (n, def) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : def; };
const DIAS = Number(arg("--dias", 90));
const SALIDA = arg("--json", null);

const j = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status} · ${u.slice(0, 90)}`); return r.json(); };
const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const DESDE = new Date(Date.now() - DIAS * 86400000).toISOString().slice(0, 10);
const km = (a, b, c, d) => { const R = 6371, t = x => x * Math.PI / 180;
  const h = Math.sin(t(c - a) / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(t(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)); };

// Parcelas de Kylia y la estación operativa más cercana a cada una.
const PARCELAS = [
  { n: "Ferran · Breda",   lat: 41.749, lon: 2.556 },
  { n: "Oriol · La Selva", lat: 41.668, lon: 2.750 },
  { n: "Padre · Sant Boi", lat: 41.343, lon: 2.037 },
  { n: "Lleida (validación del motor)", lat: 41.620, lon: 0.620 },
  { n: "Amposta · delta",  lat: 40.710, lon: 0.580 },
];

async function serieXema(est, variable) {
  const w = encodeURIComponent(`data_lectura between '${DESDE}T00:00:00' and '${hoy}T23:59:59'`);
  const filas = await j(`${XEMA_DATOS}?codi_estacio=${est}&codi_variable=${variable}&$where=${w}&$limit=400`);
  const m = new Map();
  for (const f of filas) {
    const v = Number(f.valor);
    if (Number.isFinite(v)) m.set(f.data_lectura.slice(0, 10), v);   // un valor no numérico es un hueco, no un 0
  }
  return m;
}
const aMapa = (o, campo) => new Map((o.daily?.time || [])
  .map((t, i) => [t, o.daily[campo]?.[i]])
  .filter(([, v]) => v != null));       // null = hueco declarado, NO se rellena

function metricas(dias, modelo, obs) {
  const e = dias.map(d => modelo.get(d) - obs.get(d));
  const n = e.length;
  const sm = dias.reduce((s, d) => s + modelo.get(d), 0);
  const so = dias.reduce((s, d) => s + obs.get(d), 0);
  return {
    n,
    sesgo_medio_dia: +(e.reduce((s, x) => s + x, 0) / n).toFixed(3),
    rmse_dia: +Math.sqrt(e.reduce((s, x) => s + x * x, 0) / n).toFixed(3),
    acum_modelo: +sm.toFixed(1), acum_observado: +so.toFixed(1),
    acum_dif_pct: so === 0 ? null : +(((sm - so) / so) * 100).toFixed(1),
  };
}

const estaciones = await j(`${XEMA_META}?$limit=500&nom_estat_ema=Operativa`);
const salida = { generado: new Date().toISOString(), periodo: { desde: DESDE, hasta: hoy, dias_pedidos: DIAS },
                 zona_horaria: "Europe/Madrid", unidades: "mm/día",
                 fuentes: { estaciones: XEMA_DATOS, archivo: ARCHIVE, pronostico: FORECAST },
                 tratamiento_missing: "un día entra solo si las TRES fuentes lo tienen; los huecos no se rellenan",
                 parcelas: [] };

for (const p of PARCELAS) {
  const est = estaciones
    .map(e => ({ ...e, km: km(p.lat, p.lon, +e.latitud, +e.longitud) }))
    .sort((a, b) => a.km - b.km)[0];
  const [oEt0, oLl, arch, pron] = await Promise.all([
    serieXema(est.codi_estacio, VAR.et0),
    serieXema(est.codi_estacio, VAR.lluvia),
    j(`${ARCHIVE}?latitude=${p.lat}&longitude=${p.lon}&daily=et0_fao_evapotranspiration,precipitation_sum&start_date=${DESDE}&end_date=${hoy}&timezone=${TZ}`),
    j(`${FORECAST}?latitude=${p.lat}&longitude=${p.lon}&daily=et0_fao_evapotranspiration,precipitation_sum&past_days=92&forecast_days=1&timezone=${TZ}`),
  ]);
  const fuentes = {
    et0:    { obs: oEt0, arch: aMapa(arch, "et0_fao_evapotranspiration"), pron: aMapa(pron, "et0_fao_evapotranspiration") },
    lluvia: { obs: oLl,  arch: aMapa(arch, "precipitation_sum"),          pron: aMapa(pron, "precipitation_sum") },
  };
  const r = { parcela: p.n, lat: p.lat, lon: p.lon,
              estacion: { codi: est.codi_estacio, nombre: est.nom_estacio, km: +est.km.toFixed(1),
                          lat: +est.latitud, lon: +est.longitud, altitud_m: +est.altitud },
              variables: {} };
  console.log(`\n═══ ${p.n} → estación ${est.nom_estacio} (${est.codi_estacio}), ${est.km.toFixed(1)} km, ${est.altitud} m ═══`);
  for (const [nombre, f] of Object.entries(fuentes)) {
    const dias = [...f.obs.keys()].filter(d => f.arch.has(d) && f.pron.has(d)).sort();
    const descartados = { sin_observacion: 0, sin_archivo: [...f.obs.keys()].filter(d => !f.arch.has(d)).length,
                          sin_pronostico: [...f.obs.keys()].filter(d => !f.pron.has(d)).length };
    if (dias.length < 20) {
      console.log(`  ${nombre}: la estación no lo publica o hay muy pocos días comunes (${dias.length})`);
      r.variables[nombre] = { dias_comunes: dias.length, descartados, nota: "insuficiente" };
      continue;
    }
    const mA = metricas(dias, f.arch, f.obs), mP = metricas(dias, f.pron, f.obs);
    r.variables[nombre] = { dias_comunes: dias.length, desde: dias[0], hasta: dias[dias.length - 1],
                            descartados, archivo: mA, pronostico: mP,
                            mas_cercano_a_lo_medido: mA.rmse_dia <= mP.rmse_dia ? "archivo" : "pronostico" };
    console.log(`  ${nombre} · ${dias.length} días comunes (${dias[0]} → ${dias[dias.length - 1]}) · observado ${mA.acum_observado} mm`);
    console.log(`     ARCHIVO    acum ${String(mA.acum_modelo).padStart(6)} mm (${mA.acum_dif_pct >= 0 ? "+" : ""}${mA.acum_dif_pct}%)  sesgo/día ${mA.sesgo_medio_dia}  RMSE ${mA.rmse_dia}`);
    console.log(`     PRONÓSTICO acum ${String(mP.acum_modelo).padStart(6)} mm (${mP.acum_dif_pct >= 0 ? "+" : ""}${mP.acum_dif_pct}%)  sesgo/día ${mP.sesgo_medio_dia}  RMSE ${mP.rmse_dia}`);
    console.log(`     → más cerca de lo medido: ${r.variables[nombre].mas_cercano_a_lo_medido}`);
  }
  salida.parcelas.push(r);
}

// Representatividad: dos estaciones separadas N km son el proxy de "parcela a N
// km de su estación". Es lo que dice si usar la estación vecina sería una mejora.
console.log("\n═══ ¿cuánta señal se pierde por la DISTANCIA a la estación? ═══");
salida.representatividad = [];
for (const [a, b] of [["XL", "YY"], ["XL", "X8"], ["UU", "U9"], ["UU", "UW"], ["KP", "DJ"]]) {
  const ea = estaciones.find(e => e.codi_estacio === a), eb = estaciones.find(e => e.codi_estacio === b);
  if (!ea || !eb) continue;
  const d = km(+ea.latitud, +ea.longitud, +eb.latitud, +eb.longitud);
  for (const [nombre, v] of Object.entries(VAR)) {
    const [sa, sb] = await Promise.all([serieXema(a, v), serieXema(b, v)]);
    const dias = [...sa.keys()].filter(x => sb.has(x)).sort();
    if (dias.length < 20) continue;
    const A = dias.map(x => sa.get(x)), B = dias.map(x => sb.get(x));
    const mA = A.reduce((s, x) => s + x, 0) / A.length, mB = B.reduce((s, x) => s + x, 0) / B.length;
    const cov = dias.reduce((s, x, i) => s + (A[i] - mA) * (B[i] - mB), 0);
    const vA = Math.sqrt(dias.reduce((s, x, i) => s + (A[i] - mA) ** 2, 0));
    const vB = Math.sqrt(dias.reduce((s, x, i) => s + (B[i] - mB) ** 2, 0));
    const r = cov / (vA * vB || 1);
    const fila = { a: ea.nom_estacio, b: eb.nom_estacio, km: +d.toFixed(1), variable: nombre,
                   n: dias.length, correlacion: +r.toFixed(2),
                   acum_a: +A.reduce((s, x) => s + x, 0).toFixed(1), acum_b: +B.reduce((s, x) => s + x, 0).toFixed(1) };
    salida.representatividad.push(fila);
    console.log(`  ${(ea.nom_estacio + " ↔ " + eb.nom_estacio).slice(0, 40).padEnd(40)} ${String(fila.km).padStart(5)} km · ${nombre.padEnd(6)} r=${fila.correlacion.toFixed(2)} · acum ${fila.acum_a} vs ${fila.acum_b} mm (n=${fila.n})`);
  }
}

if (SALIDA) { writeFileSync(SALIDA, JSON.stringify(salida, null, 2)); console.log(`\nJSON en ${SALIDA}`); }
