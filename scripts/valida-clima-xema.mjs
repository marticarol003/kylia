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
// ⚠️ UNA CIFRA MÍA, DESCARTADA. El 14-sep reporté un RMSE de ET₀ de 0,46-1,43
// mm/día. Ese 1,43 salía de este mismo script cuando el selector cogía la
// estación más cercana SIN mirar la altitud: para Breda elegía Puig Sesolles, una
// cumbre del Montseny a 1.666 m, contra una parcela de valle a 167. Con el
// selector corregido —altitud parecida, y que publique la variable— el rango
// reproducible sobre 2026-06-15 → 2026-09-12 es **0,456-0,992 mm/día**. Esa es
// la evidencia válida; el 1,43 queda descartado por no ser reproducible.
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
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const XEMA_DATOS = "https://analisi.transparenciacatalunya.cat/resource/7bvh-jvq2.json";
const XEMA_META  = "https://analisi.transparenciacatalunya.cat/resource/yqwd-vj5e.json";
const ARCHIVE    = "https://archive-api.open-meteo.com/v1/archive";
const FORECAST   = "https://api.open-meteo.com/v1/forecast";
const TZ         = "Europe%2FMadrid";
const VAR = { lluvia: 1300, et0: 1700 };

const arg = (n, def) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : def; };
const SALIDA = arg("--json", null);
const CRUDO  = arg("--crudo", null);      // carpeta donde congelar las respuestas
const DESDE_ARG = arg("--desde", null);   // YYYY-MM-DD
const HASTA_ARG = arg("--hasta", null);
const DIAS = Number(arg("--dias", 90));
if ((DESDE_ARG && !HASTA_ARG) || (!DESDE_ARG && HASTA_ARG)) {
  console.error("--desde y --hasta van juntos. Sin ellos se usa una ventana relativa a hoy (--dias).");
  process.exit(2);
}

let nPeticiones = 0;
// Reintento con espera creciente: estas APIs son públicas y gratuitas, y se caen.
// Un script de validación que revienta con un stack trace en el primer timeout no
// es reproducible por otra persona, que es justo lo que se le pide.
const dormir = (ms) => new Promise(r => setTimeout(r, ms));
const j = async (u, intentos = 3) => {
  let ultimo;
  let r;
  for (let i = 0; i < intentos; i++) {
    try {
      r = await fetch(u, { signal: AbortSignal.timeout(30000) });
      if (r.ok) break;
      ultimo = new Error(`HTTP ${r.status}`);
    } catch (e) { ultimo = e; }
    if (i < intentos - 1) await dormir(2000 * (i + 1));
  }
  if (!r || !r.ok) {
    const host = new URL(u).host;
    throw new Error(`no se pudo leer ${host} tras ${intentos} intentos (${ultimo?.message || "sin detalle"}).\n` +
                    `  URL: ${u}\n  Si el servicio está caído, reintenta más tarde: el periodo es fijo y el resultado no cambia.`);
  }
  const cuerpo = await r.text();
  if (CRUDO) {                      // congela la respuesta tal como llegó
    mkdirSync(CRUDO, { recursive: true });
    const nombre = String(++nPeticiones).padStart(3, "0") + "-" + u.replace(/[^a-z0-9]+/gi, "_").slice(0, 110) + ".json";
    writeFileSync(join(CRUDO, nombre), JSON.stringify({ url: u, obtenido: new Date().toISOString(), cuerpo: JSON.parse(cuerpo) }, null, 1));
  }
  return JSON.parse(cuerpo);
};
// ⚠️ UNA VENTANA RELATIVA A "HOY" NO ES REPRODUCIBLE: el mismo comando da otras
// cifras la semana que viene, y una cifra que decide sobre el motor tiene que
// poder recalcularse dentro de un año. Con --desde/--hasta el periodo queda
// fijo; sin ellos se usa la ventana relativa y el JSON deja constancia de cuál
// fue. Y `--crudo <dir>` guarda las respuestas tal como llegaron, que es la
// única forma de congelar el dataset: las APIs reescriben su pasado (el propio
// pronóstico de Open-Meteo olvida más allá de ~64 días).
const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const DESDE = DESDE_ARG || new Date(Date.now() - DIAS * 86400000).toISOString().slice(0, 10);
const HASTA = HASTA_ARG || hoy;
const VENTANA_FIJA = Boolean(DESDE_ARG);
const diasEsperados = Math.round((new Date(`${HASTA}T12:00:00Z`) - new Date(`${DESDE}T12:00:00Z`)) / 86400000) + 1;
const sumarDia = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
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
  const w = encodeURIComponent(`data_lectura between '${DESDE}T00:00:00' and '${HASTA}T23:59:59'`);
  const filas = await j(`${XEMA_DATOS}?codi_estacio=${est}&codi_variable=${variable}&$where=${w}&$limit=400`);
  const m = new Map();
  for (const f of filas) {
    // ⚠️ Number(null) es 0 y Number("") también, así que un valor ausente se
    // colaba como "ese día midió 0 mm" — en la fuente que hace de VERDAD de
    // referencia, que es donde más daño hace. Un missing tiene que seguir siendo
    // un missing: el día no entra y se cuenta en `descartados.sin_observacion`.
    if (f.valor == null || f.valor === "") continue;
    const v = Number(f.valor);
    if (!Number.isFinite(v)) continue;
    m.set(f.data_lectura.slice(0, 10), v);
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

try {
const estaciones = await j(`${XEMA_META}?$limit=500&nom_estat_ema=Operativa`);
const salida = { generado: new Date().toISOString(),
                 periodo: { desde: DESDE, hasta: HASTA, dias_esperados: diasEsperados,
                            ventana: VENTANA_FIJA ? "fija (--desde/--hasta): reproducible"
                                                  : `relativa a hoy (--dias ${DIAS}): NO reproducible más adelante` },
                 reproducir: `node scripts/valida-clima-xema.mjs --desde ${DESDE} --hasta ${HASTA}`,
                 respuestas_crudas: CRUDO || "no guardadas (usar --crudo <dir> para congelar el dataset)",
                 zona_horaria: "Europe/Madrid", unidades: "mm/día",
                 fuentes: { estaciones: XEMA_DATOS, archivo: ARCHIVE, pronostico: FORECAST },
                 tratamiento_missing: "un día entra solo si las TRES fuentes lo tienen; los huecos no se rellenan",
                 parcelas: [] };

for (const p of PARCELAS) {
  const [arch, pron] = await Promise.all([
    j(`${ARCHIVE}?latitude=${p.lat}&longitude=${p.lon}&daily=et0_fao_evapotranspiration,precipitation_sum&start_date=${DESDE}&end_date=${HASTA}&timezone=${TZ}`),
    j(`${FORECAST}?latitude=${p.lat}&longitude=${p.lon}&daily=et0_fao_evapotranspiration,precipitation_sum&past_days=92&forecast_days=1&timezone=${TZ}`),
  ]);
  // ⚠️ LA MÁS CERCANA NO ES LA MÁS PARECIDA. Para Breda, la estación a menos km
  // es Puig Sesolles, en el Montseny a 1.666 m: una cumbre no representa una
  // parcela de valle ni en ET₀ ni en lluvia. Se exige que la altitud se parezca
  // a la del punto (la da Open-Meteo) y, si ninguna cumple, se coge la más
  // cercana y SE DECLARA que el criterio de altitud no se pudo aplicar.
  const elev = Number(arch.elevation ?? pron.elevation);
  const TOLERANCIA_M = 300;
  const cercanas = estaciones
    .map(e => ({ ...e, km: km(p.lat, p.lon, +e.latitud, +e.longitud), dAlt: Math.abs(+e.altitud - elev) }))
    .sort((a, b) => a.km - b.km);
  const parecidas = Number.isFinite(elev) ? cercanas.filter(e => e.dAlt <= TOLERANCIA_M) : [];
  const orden = parecidas.length ? parecidas : cercanas;

  // ⚠️ NO TODAS LAS ESTACIONES PUBLICAN ET₀. Se elegía la más cercana y, si esa
  // no tenía la variable 1700, la comparación de ET₀ se quedaba vacía y la
  // parcela desaparecía de la evidencia — sin que nada lo dijera. Ahora se busca
  // POR VARIABLE la primera que publique datos suficientes, y se declara cuál se
  // ha usado para cada una: pueden ser distintas, y eso hay que poder verlo.
  const MIN_DIAS = 20;
  const elegir = async (variable) => {
    for (const cand of orden.slice(0, 8)) {
      const serie = await serieXema(cand.codi_estacio, variable);
      if (serie.size >= MIN_DIAS) return { est: cand, serie, intentos: orden.indexOf(cand) + 1 };
    }
    return { est: orden[0], serie: new Map(), intentos: Math.min(8, orden.length) };
  };
  const [selEt0, selLl] = await Promise.all([elegir(VAR.et0), elegir(VAR.lluvia)]);
  const oEt0 = selEt0.serie, oLl = selLl.serie;
  const est = selLl.est;          // la de lluvia manda para la cabecera
  const criterio = (parecidas.length
    ? `altitud dentro de ±${TOLERANCIA_M} m del punto (${Math.round(elev)} m)`
    : `SIN filtro de altitud (no se pudo aplicar)`)
    + `, y la primera que publique ≥${MIN_DIAS} días de cada variable`;
  const fuentes = {
    et0:    { obs: oEt0, arch: aMapa(arch, "et0_fao_evapotranspiration"), pron: aMapa(pron, "et0_fao_evapotranspiration") },
    lluvia: { obs: oLl,  arch: aMapa(arch, "precipitation_sum"),          pron: aMapa(pron, "precipitation_sum") },
  };
  const r = { parcela: p.n, lat: p.lat, lon: p.lon,
              elevacion_punto_m: Number.isFinite(elev) ? Math.round(elev) : null,
              estacion_por_variable: {
                et0:    { codi: selEt0.est.codi_estacio, nombre: selEt0.est.nom_estacio,
                          km: +selEt0.est.km.toFixed(1), dias_publicados: selEt0.serie.size },
                lluvia: { codi: selLl.est.codi_estacio, nombre: selLl.est.nom_estacio,
                          km: +selLl.est.km.toFixed(1), dias_publicados: selLl.serie.size },
              },
              estacion: { codi: est.codi_estacio, nombre: est.nom_estacio, km: +est.km.toFixed(1),
                          lat: +est.latitud, lon: +est.longitud, altitud_m: +est.altitud,
                          desnivel_m: Number.isFinite(elev) ? Math.round(est.dAlt) : null,
                          criterio_seleccion: criterio },
              variables: {} };
  console.log(`\n═══ ${p.n} → estación ${est.nom_estacio} (${est.codi_estacio}), ${est.km.toFixed(1)} km, ${est.altitud} m (punto a ${Number.isFinite(elev) ? Math.round(elev) : "?"} m) ═══`);
  console.log(`  selección: ${criterio}`);
  if (selEt0.est.codi_estacio !== selLl.est.codi_estacio)
    console.log(`  ET₀ desde ${selEt0.est.nom_estacio} (${selEt0.serie.size} días) · lluvia desde ${selLl.est.nom_estacio} (${selLl.serie.size} días)`);
  for (const [nombre, f] of Object.entries(fuentes)) {
    const dias = [...f.obs.keys()].filter(d => f.arch.has(d) && f.pron.has(d)).sort();
    // Días del periodo que NO entran en la comparación, por quién falta. El
    // primero estaba cableado a 0, así que los días que la estación no publicó
    // —justo el hueco que hay que vigilar en una estación de referencia— se
    // contaban como cero descartes.
    const todos = [];
    for (let d = DESDE; d <= HASTA; d = sumarDia(d)) todos.push(d);
    const descartados = {
      sin_observacion: todos.filter(d => !f.obs.has(d)).length,
      sin_archivo:     todos.filter(d => !f.arch.has(d)).length,
      sin_pronostico:  todos.filter(d => !f.pron.has(d)).length,
      dias_periodo:    todos.length,
    };
    if (dias.length < 20) {
      console.log(`  ${nombre}: la estación no lo publica o hay muy pocos días comunes (${dias.length})`);
      r.variables[nombre] = { dias_comunes: dias.length, descartados, nota: "insuficiente" };
      continue;
    }
    const mA = metricas(dias, f.arch, f.obs), mP = metricas(dias, f.pron, f.obs);
    r.variables[nombre] = { dias_comunes: dias.length, dias_esperados: diasEsperados,
                            cobertura_pct: Math.round((dias.length / diasEsperados) * 100),
                            desde: dias[0], hasta: dias[dias.length - 1],
                            observaciones_estacion: f.obs.size,
                            descartados, archivo: mA, pronostico: mP,
                            mas_cercano_a_lo_medido: mA.rmse_dia <= mP.rmse_dia ? "archivo" : "pronostico" };
    console.log(`  ${nombre} · ${dias.length} de ${diasEsperados} días esperados (${Math.round(dias.length / diasEsperados * 100)}%), ${dias[0]} → ${dias[dias.length - 1]} · la estación publicó ${f.obs.size} · observado ${mA.acum_observado} mm`);
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
} catch (e) {
  // Falla claro y accionable, no un volcado de undici.
  console.error("\n✖ " + e.message);
  process.exit(1);
}
