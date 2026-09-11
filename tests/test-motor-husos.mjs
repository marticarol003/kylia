// El mismo dato tiene que dar el mismo resultado mire quien lo mire.
//   node tests/test-motor-husos.mjs
//
// Ciclo 6 de la auditoría del 11-sep-2026, paso de "audítalo como si no lo
// hubieras escrito tú". El motor corre EN EL NAVEGADOR del agricultor, así que
// el huso horario es de él, no del servidor. Y el motor mezclaba las dos
// convenciones: construía fechas en hora LOCAL y las imprimía con toISOString(),
// que es UTC.
//
// Encontrado así: la ventana de madurez salía DOS DÍAS antes en UTC+14. En
// España no se nota —el mediodía local sigue siendo el mismo día en UTC— y por
// eso ningún caso escrito a mano lo habría cazado nunca.
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

// Se ejecuta en un proceso aparte por cada huso: TZ solo se lee al arrancar.
const SONDA = `
const M = require(${JSON.stringify(join(RAIZ, "assets", "js", "motor-riego.js"))});
const dia = (p, i) => new Date(new Date(p + "T12:00:00Z").getTime() + i * 86400000).toISOString().slice(0, 10);
const s = []; for (let i = 0; i < 60; i++) s.push({ date: dia("2026-05-01", i), et0: 5, lluvia: i % 7 === 0 ? 6 : 0, tmax: 29, tmin: 17 });
const r = [{ date: dia("2026-05-01", 20), litros: 20 }, { date: dia("2026-05-01", 40), litros: null }];
const o = { suelo: "franco", cultivoId: "tomate", metodoRiego: "goteo", fechaPlantacion: "2026-05-01" };
const b = M.balanceHidrico(s, r, o), sim = M.simularKylia(s, o);
const c = M.curvaFenologica("tomate", s, "2026-05-01");
const nm = {}; for (let m = 1; m <= 12; m++) nm[m] = { tmax: 28, tmin: 17 };
const v = M.ventanaMadurez("tomate", { gddAcum: c.gddEn(dia("2026-05-01", 59)), desdeISO: dia("2026-05-01", 59), normales: nm });
process.stdout.write(JSON.stringify({
  Dr: b.Dr, taw: b.taw, etc: b.etcAcum, diasFen: b.diasFenologicos, gdd: b.gddAcum,
  fase: b.faseActual, estres: b.diasEstres, lluviaUtil: b.lluviaUtilAcum,
  ciclo: b.cicloCompletado, tras: b.diasTrasCiclo, cobertura: b.coberturaClima,
  sim: sim.total, gddCurva: Math.round(c.gddAcum), diaDe: c.diaDe(dia("2026-05-01", 30)),
  ventana: v && [v.desde, v.probable, v.hasta, v.dias_restantes].join("|"),
}));
`;

// De UTC−11 a UTC+14, que es el rango entero del planeta.
const HUSOS = ["UTC", "Europe/Madrid", "Atlantic/Azores", "America/Santiago", "Pacific/Midway",
               "Asia/Kathmandu", "Australia/Sydney", "Pacific/Kiritimati", "Pacific/Chatham"];
const salidas = HUSOS.map(tz => [tz, execFileSync(process.execPath, ["-e", SONDA],
  { env: { ...process.env, TZ: tz }, encoding: "utf8" })]);

const ref = salidas[0][1];
console.log("── el mismo escenario, en nueve husos de UTC−11 a UTC+14 ──");
for (const [tz, out] of salidas) ok(out === ref, `${tz}: resultado idéntico`);
if (salidas.some(([, o]) => o !== ref)) {
  console.log("\n  referencia:", ref);
  for (const [tz, o] of salidas) if (o !== ref) console.log(`  ${tz}:`, o);
}

const r0 = JSON.parse(ref);
console.log("\n── y el escenario de verdad calcula algo ──");
ok(r0.Dr > 0 && r0.taw > 0, `déficit ${r0.Dr.toFixed(1)} de ${r0.taw.toFixed(0)} mm`);
ok(r0.ventana && /\d{4}-\d{2}-\d{2}\|/.test(r0.ventana), `ventana de madurez: ${r0.ventana}`);
ok(r0.gdd > 0 && r0.diasFen > 0, `reloj térmico activo: ${r0.gdd} °C·día = día ${r0.diasFen} del eje`);
ok(r0.estres > 0, `y con estrés real (${r0.estres} días), que es donde el modelo hace algo`);

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
