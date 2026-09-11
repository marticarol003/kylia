// Propiedades que el motor debe cumplir SIEMPRE, contra escenarios generados.
//   node tests/test-motor-invariantes.mjs
//
// Ciclo 3 de la auditoría del 11-sep-2026. A diferencia de los otros tests, aquí
// no se comprueban casos elegidos a mano: se generan decenas de miles de
// combinaciones —incluidas basura y valores imposibles— y se exige que ciertas
// propiedades no se rompan en ninguna.
//
// Es lo que encontró los dos defectos del ciclo 3, que ningún caso escrito a
// mano había tocado: una fecha de plantación malformada convertía TODO el
// balance en NaN (el 7,4% de los escenarios adversariales), y presentarRiego
// llegaba a escribir "Infinity min · mejor en Infinity tandas de NaN min".
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const M = require(join(RAIZ, "assets", "js", "motor-riego.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

// Generador determinista: el mismo fallo se reproduce siempre igual.
let sem = 20260911;
const rnd = () => (sem = (sem * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = a => a[Math.floor(rnd() * a.length)];
const CULT = Object.keys(M.FAO_KC), SUE = Object.keys(M.SUELO_AWC), MET = Object.keys(M.EFIC_RIEGO);
const BASURA = [null, undefined, "", NaN, Infinity, -Infinity, "abc", {}, [], true, false, -1, 1e9];
const dia = (plant, i) => new Date(new Date(`${plant}T12:00:00Z`).getTime() + i * 86400000).toISOString().slice(0, 10);

function escenario(adversarial) {
  const n = 5 + Math.floor(rnd() * 60);
  const plant = adversarial && rnd() < 0.15
    ? pick([null, "", "no-es-fecha", "2026-13-45", "2026-05-01T00:00:00Z", "2027-01-01"])
    : "2026-05-01";
  const serie = [];
  for (let i = 0; i < n; i++) {
    const roto = adversarial && rnd() < 0.25;
    serie.push({
      date: adversarial && rnd() < 0.05 ? pick(["ayer", null, "2026-13-45"]) : dia("2026-05-01", i),
      et0:    roto ? pick(BASURA) : rnd() * 9,
      lluvia: roto ? pick(BASURA) : (rnd() < 0.25 ? rnd() * 40 : 0),
      tmax:   roto ? pick(BASURA) : 10 + rnd() * 28,
      tmin:   roto ? pick(BASURA) : 2 + rnd() * 18,
    });
  }
  const riegos = [];
  for (let i = 0; i < Math.floor(rnd() * 8); i++)
    riegos.push({ date: serie[Math.floor(rnd() * serie.length)]?.date,
                  litros: adversarial && rnd() < 0.3 ? pick(BASURA) : (rnd() < 0.15 ? null : rnd() * 45) });
  return { serie, riegos, opt: {
    suelo: adversarial ? pick([...SUE, null, "Franco"]) : pick(SUE),
    cultivoId: adversarial ? pick([...CULT, null, "marciano"]) : pick(CULT),
    metodoRiego: adversarial ? pick([...MET, null, "dron"]) : pick(MET),
    fechaPlantacion: plant } };
}

function ronda(nombre, n, adversarial) {
  const rotas = {};
  const chk = (k, c) => { if (!c) rotas[k] = (rotas[k] || 0) + 1; };
  for (let i = 0; i < n; i++) {
    const { serie, riegos, opt } = escenario(adversarial);
    let b, d, s, p;
    try {
      b = M.balanceHidrico(serie, riegos, opt);
      d = M.decisionRiego(b, { lluviaPrevista: [{ lluvia: adversarial ? pick(BASURA) : rnd() * 30 }] });
      s = M.simularKylia(serie, opt);
      p = M.presentarRiego(adversarial ? pick([...BASURA, rnd() * 80]) : rnd() * 80,
            { metodoRiego: opt.metodoRiego, caudalMmh: adversarial ? pick([...BASURA, rnd() * 20]) : 1 + rnd() * 20,
              areaM2: adversarial ? pick([...BASURA, rnd() * 1000]) : 100 + rnd() * 900, capacidadRegaderaL: 10 });
    } catch (e) { chk(`nada lanza excepción (${e.message})`, false); continue; }

    // ── Nada físicamente imposible ──
    chk("el déficit es un número finito", Number.isFinite(b.Dr));
    chk("el déficit nunca es negativo", b.Dr >= -1e-9);
    chk("el déficit nunca pasa del agua total del suelo", b.Dr <= b.taw + 1e-9);
    chk("TAW y RAW son finitos y positivos", Number.isFinite(b.taw) && Number.isFinite(b.raw) && b.taw > 0 && b.raw > 0);
    chk("el agua fácilmente disponible no supera la total", b.raw <= b.taw + 1e-9);
    chk("la ETc nunca es negativa", b.etcAcum >= -1e-9);
    chk("la ETc no supera 1,2 veces la ET₀ (Kc máximo de la tabla)", b.etcAcum <= b.et0Acum * 1.2 + 1e-6);
    chk("el Kc se queda dentro del rango de FAO-56", b.kcActual > 0 && b.kcActual <= 1.3);
    chk("la cobertura de clima es una fracción", b.coberturaClima >= 0 && b.coberturaClima <= 1);

    // ── La recomendación no se contradice ──
    chk("el nivel es uno de los previstos", ["alta", "media", "baja", "desconocido"].includes(d.nivel));
    // Salía "Regar hoy ~0 L/m²" cuando la lluvia prevista casi cubría el déficit:
    // una orden de abrir el riego para echar nada.
    chk("si manda regar, manda una cantidad positiva", d.nivel !== "alta" || d.cantidad_l_m2 > 0);
    chk("y nunca por debajo de lo que el propio motor considera que infiltra",
        d.nivel !== "alta" || d.cantidad_l_m2 * b.efic >= M.PE_MIN_MM - 1e-9);
    // OJO: "alta ⟺ Dr ≥ raw" NO es invariante, y escribirlo así fue un error mío
    // en el primer intento. Hay una tercera rama legítima: si se prevé lluvia
    // que cubre el déficit, la decisión es esperar. Lo que sí es invariante es
    // la implicación en un solo sentido.
    chk("por debajo del umbral NUNCA manda regar", b.Dr >= b.raw || d.nivel !== "alta");
    chk("si manda regar es porque se ha alcanzado el umbral", d.nivel !== "alta" || b.Dr >= b.raw);
    // Y la cantidad tampoco cubre el déficit entero cuando parte lo pone la
    // lluvia. Lo que tiene que cuadrar es la SUMA: riego neto + lluvia prevista.
    chk("el agua contada (riego neto + lluvia prevista) cubre el déficit",
        d.nivel !== "alta" || d.cantidad_l_m2 * b.efic + (d.lluvia_prevista_mm || 0) >= b.Dr - 0.2);

    // ── Nunca se le enseña un número roto al agricultor ──
    chk("el texto de la decisión no contiene NaN ni Infinity", !/NaN|undefined|Infinity/.test(d.texto));
    chk("el texto del riego tampoco", !/NaN|undefined|Infinity/.test(p.texto));
    chk("los milímetros presentados son finitos y no negativos", Number.isFinite(p.mm) && p.mm >= 0);

    // ── La simulación ──
    chk("el agua simulada es finita y no negativa", Number.isFinite(s.total) && s.total >= 0);
    chk("el acumulado de la simulación nunca baja",
        s.puntos.every((x, j) => j === 0 || x.acum_l_m2 >= s.puntos[j - 1].acum_l_m2 - 1e-9));
  }
  console.log(`\n── ${nombre} · ${n} escenarios ──`);
  const nombres = new Set();
  for (let i = 0; i < 1; i++) void i;
  // Se reporta cada invariante por separado para que el fallo diga cuál es.
  const todas = ["el déficit es un número finito","el déficit nunca es negativo",
    "el déficit nunca pasa del agua total del suelo","TAW y RAW son finitos y positivos",
    "el agua fácilmente disponible no supera la total","la ETc nunca es negativa",
    "la ETc no supera 1,2 veces la ET₀ (Kc máximo de la tabla)","el Kc se queda dentro del rango de FAO-56",
    "la cobertura de clima es una fracción","el nivel es uno de los previstos",
    "si manda regar, manda una cantidad positiva",
    "y nunca por debajo de lo que el propio motor considera que infiltra",
    "por debajo del umbral NUNCA manda regar","si manda regar es porque se ha alcanzado el umbral",
    "el agua contada (riego neto + lluvia prevista) cubre el déficit",
    "el texto de la decisión no contiene NaN ni Infinity","el texto del riego tampoco",
    "los milímetros presentados son finitos y no negativos",
    "el agua simulada es finita y no negativa","el acumulado de la simulación nunca baja"];
  for (const k of todas) ok(!rotas[k], `${k}${rotas[k] ? ` — rota en ${rotas[k]} de ${n}` : ""}`);
  for (const k of Object.keys(rotas)) if (!todas.includes(k)) ok(false, k);
}

ronda("entradas válidas", 8000, false);
ronda("entradas adversariales (basura, fechas rotas, tipos imposibles)", 8000, true);

console.log("\n── coherencia de unidades: mm ↔ minutos ↔ regaderas ──");
let idaVuelta = true, peor = 0;
for (let i = 0; i < 4000; i++) {
  const mm = rnd() * 120, caudal = 0.5 + rnd() * 30;
  const p = M.presentarRiego(mm, { metodoRiego: "goteo", caudalMmh: caudal });
  if (p.unidad !== "min") continue;
  const vuelta = M.laminaRiego(null, p.valor, caudal);
  peor = Math.max(peor, Math.abs(vuelta - mm));
  if (Math.abs(vuelta - mm) > 0.6) idaVuelta = false;
}
ok(idaVuelta, `mm → minutos → mm recupera la lámina (error máximo ${peor.toFixed(3)} mm, solo redondeo)`);
const reg = M.presentarRiego(10, { metodoRiego: "regadera", areaM2: 100, capacidadRegaderaL: 10 });
ok(reg.valor === 100 && reg.litrosTotales === 1000, "10 mm sobre 100 m² con regadera de 10 L = 100 regaderas (1.000 L)");
ok(M.presentarRiego(10, { metodoRiego: "regadera", areaM2: 200, capacidadRegaderaL: 10 }).valor === 200,
   "el doble de superficie, el doble de regaderas");

console.log("\n── situaciones equivalentes dan resultados equivalentes ──");
const plant = "2026-05-01";
const S = []; for (let i = 0; i < 40; i++) S.push({ date: dia(plant, i), et0: 4.5, lluvia: 0, tmax: 27, tmin: 15 });
const O = { suelo: "franco", cultivoId: "tomate", metodoRiego: "goteo", fechaPlantacion: plant };
ok(M.balanceHidrico(S, [{ date: dia(plant, 20), litros: 20 }], O).Dr
   === M.balanceHidrico(S, [{ date: dia(plant, 20), litros: 12 }, { date: dia(plant, 20), litros: 8 }], O).Dr,
   "dos riegos el mismo día equivalen a uno de la suma");
ok(Math.abs(M.balanceHidrico([...S].reverse(), [], O).Dr - M.balanceHidrico(S, [], O).Dr) < 1e-9,
   "el orden en que llega la serie no cambia el resultado");

console.log("\n── monotonía: la física no se invierte ──");
const base = M.balanceHidrico(S, [], O).Dr;
ok(M.balanceHidrico(S.map(x => ({ ...x, et0: x.et0 * 1.5 })), [], O).Dr >= base - 1e-9, "más ET₀ ⇒ más déficit (o igual)");
ok(M.balanceHidrico(S.map(x => ({ ...x, lluvia: x.lluvia + 10 })), [], O).Dr <= base + 1e-9, "más lluvia ⇒ menos déficit (o igual)");
ok(M.balanceHidrico(S, [{ date: dia(plant, 39), litros: 30 }], O).Dr <= base + 1e-9, "más riego ⇒ menos déficit (o igual)");
ok(M.simularKylia(S, { ...O, metodoRiego: "surco" }).total >= M.simularKylia(S, { ...O, metodoRiego: "goteo" }).total - 1e-9,
   "un método menos eficiente gasta más agua bruta para el mismo cultivo");

console.log("\n── y una que NO se cumple sobre el total, y está bien que no ──");
// Con más ET₀ el umbral baja (p se ajusta por demanda), el calendario de riegos
// se desplaza y al cerrar la ventana puede quedar MÁS agua pendiente. Comparar
// acumulados a fecha fija favorece a quien riega menos a menudo: por eso el
// motor devuelve deficitFinal, y por eso el reveal lo declara.
let contraejemplo = null;
for (let i = 0; i < 3000 && !contraejemplo; i++) {
  const { serie, opt } = escenario(false);
  const a = M.simularKylia(serie, opt), b = M.simularKylia(serie.map(x => ({ ...x, et0: x.et0 * 1.5 })), opt);
  if (b.total < a.total - 1e-9) contraejemplo = { a, b, serie, opt };
}
ok(contraejemplo !== null, "existe al menos un caso en que más ET₀ da MENOS agua regada");

// ⚠️ AQUÍ ESTABA MAL EL TEST, NO EL MOTOR. Hasta el ciclo 14 esto exigía que
// sumando el déficit en cola la monotonía volviera, y a 40.000 escenarios dos
// semillas de cinco lo rompían. El motor tiene razón: en un suelo que rebosa, la
// demanda extra ABRE HUECO que atrapa lluvia que antes se perdía por debajo de
// la raíz. Contraejemplo mínimo, berenjena sobre arenoso (TAW 21,7 mm) con 68,3
// mm de lluvia en diez días:
//
//   con lluvia → 11,8 mm de riego con la ET₀ base, 10,9 con la ET₀ ×1,5
//   sin lluvia → 23,8 y 33,1: la monotonía vuelve, intacta
//
// Es FAO-56 haciendo lo que debe: `Dr = min(taw, …)` es percolación profunda, y
// el agua que percola no vuelve. Escribir "más calor ⇒ más riego" como ley es
// olvidarse de que el suelo tiene fondo.
if (contraejemplo) {
  const { a, b, serie, opt } = contraejemplo;
  const sinLluvia = s => s.map(x => ({ ...x, lluvia: 0 }));
  const seca = M.simularKylia(sinLluvia(serie), opt);
  const secaCaliente = M.simularKylia(sinLluvia(serie).map(x => ({ ...x, et0: x.et0 * 1.5 })), opt);
  ok(secaCaliente.total + secaCaliente.deficitFinal >= seca.total + seca.deficitFinal - 1e-9,
     `el mismo caso SIN lluvia sí es monótono (${(seca.total + seca.deficitFinal).toFixed(1)} → ${(secaCaliente.total + secaCaliente.deficitFinal).toFixed(1)}): la causa es la lluvia que se perdía`);
  // La lluvia es NECESARIA para que el contraejemplo exista. No hace falta que
  // llueva más que el TAW entero —basta con que un día caiga sobre un suelo casi
  // lleno y parte percole—, así que exigir eso era una aserción más fuerte que el
  // mecanismo: a 40.000 escenarios la rompían dos semillas más, y otra vez era el
  // test y no el motor. Lo que sí se sostiene siempre: sin lluvia no hay caso.
  const lluviaBruta = serie.reduce((t, d) => t + (Number(d.lluvia) || 0), 0);
  ok(lluviaBruta > 0,
     `el contraejemplo tiene lluvia (${lluviaBruta.toFixed(0)} mm): es condición necesaria, quitarla lo deshace`);
  ok(M.simularKylia(sinLluvia(serie), opt).total <= secaCaliente.total + 1e-9,
     "y sin ella el orden se respeta también en el agua regada, no solo en la suma");
}

// La ley que SÍ se sostiene siempre, y es más fuerte: no se puede regar más agua
// de la que el cultivo ha evaporado. El riego solo repone lo que la ETc se llevó;
// la lluvia únicamente resta.
console.log("\n── el riego nunca supera lo que el cultivo ha gastado ──");
// El riego solo repone lo que la ETc se llevó; la lluvia únicamente resta. Así
// que el agua NETA regada no puede pasar de la ETc acumulada, nunca.
//
// Ojo con la referencia, que es donde me equivoqué al escribirlo: hay que usar
// la ETc DE LA PROPIA SIMULACIÓN, no la del balance sin riego. Ese suelo pasa
// sed, Ks frena la transpiración y su ETc sale mucho más baja (416 mm contra
// 201 en el caso del ciclo 5), así que la comparación daba falsos positivos.
let excedidos = 0, probados = 0, peorMargen = 0;
for (let i = 0; i < 6000; i++) {
  const { serie, opt } = escenario(false);
  const sim = M.simularKylia(serie, opt);
  if (!Number.isFinite(sim.total) || !Number.isFinite(sim.etcAcum)) continue;
  probados++;
  const margen = sim.total * sim.efic - sim.etcAcum;
  if (margen > 1e-6) excedidos++;
  if (margen > peorMargen) peorMargen = margen;
}
ok(excedidos === 0,
   `riego neto ≤ ETc de la simulación en los ${probados} escenarios (peor margen ${peorMargen.toFixed(6)} mm)`);

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
