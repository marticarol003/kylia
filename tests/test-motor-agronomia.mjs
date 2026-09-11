// Decisiones agronómicamente coherentes, no solo números finitos.
//   node tests/test-motor-agronomia.mjs
//
// Ciclo 5 de la auditoría del 11-sep-2026. Los ciclos anteriores buscaban NaN y
// entradas rotas; este busca lo contrario: cuentas que salen, números que se
// enseñan, y que un agrónomo miraría y diría que no.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const M = require(join(RAIZ, "assets", "js", "motor-riego.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };
const dia = (p, i) => new Date(new Date(`${p}T12:00:00Z`).getTime() + i * 86400000).toISOString().slice(0, 10);
const mk = (p, n, f) => { const s = []; for (let i = 0; i < n; i++) s.push({ date: dia(p, i), ...f(i) }); return s; };
const PLANT = "2026-05-01";

console.log("── ALTO · una planta con el suelo vacío no transpira a pleno ritmo ──");
// FAO-56 ec. 84: Ks = (TAW − Dr)/(TAW − RAW) por encima del umbral. El motor
// calculaba ETc = Kc·ET₀ SIEMPRE. Medido en un tomate regado 10 mm cada 7 días:
// ETc 416 mm sin Ks contra 200 con Ks. Y ese número se le enseña al agricultor
// en pantalla: "el cultivo ha consumido unos X mm".
ok(M.ksEstres(10, 100, 40) === 1, "por debajo del umbral, Ks = 1: no cambia nada");
ok(M.ksEstres(40, 100, 40) === 1, "justo en el umbral, Ks = 1");
ok(Math.abs(M.ksEstres(70, 100, 40) - 0.5) < 1e-9, "a mitad de camino del agotamiento, Ks = 0,5");
ok(M.ksEstres(100, 100, 40) === 0, "en el punto de marchitez, Ks = 0");
ok(M.ksEstres(120, 100, 40) === 0, "y no baja de 0");
for (const v of [NaN, null, undefined, "x"]) ok(M.ksEstres(v, 100, 40) === 1, `Ks con Dr=${JSON.stringify(v)} → 1 (no rompe)`);

const serie = mk(PLANT, 90, () => ({ et0: 5.5, lluvia: 0, tmax: 29, tmin: 17 }));
const OPT = { suelo: "franco", cultivoId: "tomate", metodoRiego: "goteo", fechaPlantacion: PLANT };
const poco = []; for (let i = 0; i < 90; i += 7) poco.push({ date: dia(PLANT, i), litros: 10 });
const bPoco = M.balanceHidrico(serie, poco, OPT);
ok(bPoco.diasEstres > 50, `regando 10 mm cada 7 días el cultivo pasa ${bPoco.diasEstres} de 90 días en estrés`);
ok(bPoco.etcAcum < 260, `y su ETc real baja a ${bPoco.etcAcum.toFixed(0)} mm (antes se le enseñaban 416)`);

// LA VALIDACIÓN CONTRA pyfao56 SIGUE EN PIE: se hizo en condiciones bien
// regadas, donde Ks = 1 y el motor se comporta exactamente igual que antes.
const bienRegado = []; for (let i = 0; i < 90; i++) bienRegado.push({ date: dia(PLANT, i), litros: null });
const bBien = M.balanceHidrico(serie, bienRegado, OPT);
ok(bBien.diasEstres === 0, "con el suelo siempre lleno no hay ni un día de estrés");
// Con el MISMO reloj en los dos lados: el balance usa el térmico si tiene
// temperaturas, así que compararlo contra un potencial de calendario sería medir
// otra cosa. Se fuerza calendario en ambos.
const bCal = M.balanceHidrico(serie, bienRegado, { ...OPT, termico: false });
const etcPot = serie.reduce((t, d) =>
  t + M.kcDelDia("tomate", M.diasEntre(PLANT, new Date(`${d.date}T12:00:00`))) * d.et0, 0);
ok(Math.abs(bCal.etcAcum - etcPot) < 0.01,
   "y entonces la ETc es exactamente la potencial: el motor no cambia donde se validó");

console.log("\n── ALTO · de una tormenta no se aprovecha todo ──");
// Contar los 180 mm de un día como agua aprovechada sobre un suelo de 86 mm de
// capacidad es falso, y ese número sale en los informes.
const conTormenta = mk(PLANT, 40, i => ({ et0: 5, lluvia: i === 35 ? 180 : 0, tmax: 28, tmin: 16 }));
const bT = M.balanceHidrico(conTormenta, [], OPT);
ok(bT.lluviaAcum === 180, "la lluvia caída se sigue contando entera (es un dato medido)");
ok(bT.lluviaUtilAcum < bT.taw + 1,
   `pero la que se QUEDÓ en la zona radicular son ${bT.lluviaUtilAcum} mm, no más que la capacidad del suelo (${bT.taw.toFixed(0)})`);
ok(bT.lluviaUtilAcum < bT.lluviaAcum, "el resto percoló por debajo de la raíz");
// Lluvia pequeña sobre un suelo que YA tiene déficit: cabe entera. (Si cayera
// sobre suelo lleno percolaría, que es lo correcto y lo que pasaba en el primer
// intento de este test: el día 0 el suelo está a tope.)
const suave = mk(PLANT, 40, i => ({ et0: 5, lluvia: i >= 20 && i % 5 === 0 ? 8 : 0, tmax: 28, tmin: 16 }));
const bS = M.balanceHidrico(suave, [], OPT);
ok(Math.abs(bS.lluviaUtilAcum - bS.lluviaAcum) < 0.01,
   `con lluvia repartida sobre suelo con déficit, útil = caída (${bS.lluviaUtilAcum} de ${bS.lluviaAcum} mm)`);
const dia0 = M.balanceHidrico(mk(PLANT, 3, i => ({ et0: 5, lluvia: i === 0 ? 30 : 0, tmax: 28, tmin: 16 })), [], OPT);
ok(dia0.lluviaUtilAcum < dia0.lluviaAcum,
   "y sobre suelo lleno se pierde lo que no cabe, que es lo que tiene que pasar");

console.log("\n── ALTO · no se riega un ciclo que ya terminó ──");
// El balance no sabe de cosechas: sigue acumulando déficit sobre tierra vacía.
// Pasó en producción — el campo de 440 m² recibió órdenes de riego un mes
// después de arrancarlo.
const lechuga = { suelo: "franco", cultivoId: "lechuga", metodoRiego: "goteo", fechaPlantacion: PLANT };
const cicloL = M.FAO_KC.lechuga.L.reduce((a, b) => a + b, 0);
ok(M.balanceHidrico(mk(PLANT, 30, () => ({ et0: 5, lluvia: 0, tmax: 28, tmin: 16 })), [], lechuga).cicloCompletado === false,
   `a 30 días (ciclo ${cicloL}) el ciclo NO está completado`);
const tarde = M.balanceHidrico(mk(PLANT, 120, () => ({ et0: 5, lluvia: 0, tmax: 28, tmin: 16 })), [], lechuga);
ok(tarde.cicloCompletado === true, "a 120 días sí");
ok(tarde.diasTrasCiclo > 30, `y se dice cuánto se ha pasado: ${tarde.diasTrasCiclo} días`);
// El motor NO decide dejar de regar —no sabe si el cultivo sigue ahí— pero lo
// declara para que quien enseña el aviso no lo descubra por su cuenta.
const app = readApp();
ok(/bal\?\.cicloCompletado && bal\.diasTrasCiclo >= 21/.test(app),
   "y la app lo usa: pasadas tres semanas del ciclo pregunta en vez de mandar regar");
ok(/¿Sigue ahí/.test(app), "preguntando si el cultivo sigue ahí");
ok(/return acc;   \/\/ y no se manda regar mientras no se sepa/.test(app),
   "y mientras no se sepa, no se manda regar");

console.log("\n── coherencia entre cultivos y suelos ──");
// Un suelo arenoso guarda menos agua: el umbral tiene que llegar antes.
const s60 = mk(PLANT, 60, () => ({ et0: 5, lluvia: 0, tmax: 28, tmin: 16 }));
const taws = Object.keys(M.SUELO_AWC).map(su => ({
  su, taw: M.balanceHidrico(s60, [], { ...OPT, suelo: su }).taw }));
ok(taws.find(x => x.su === "arenoso").taw < taws.find(x => x.su === "franco").taw,
   "arenoso guarda menos agua que franco");
ok(taws.find(x => x.su === "franco").taw < taws.find(x => x.su === "arcilloso").taw,
   "y franco menos que arcilloso");
// Una raíz profunda tiene más depósito que una superficial en el mismo suelo.
const tawTomate = M.balanceHidrico(s60, [], OPT).taw;
const tawLechuga = M.balanceHidrico(s60, [], lechuga).taw;
ok(tawTomate > tawLechuga,
   `el tomate (raíz profunda) tiene más depósito que la lechuga: ${tawTomate.toFixed(0)} vs ${tawLechuga.toFixed(0)} mm`);

console.log("\n── el umbral p se mueve con la demanda, como dice FAO-56 ──");
const pSeco = M.aguaSuelo("franco", "tomate", 60, 9).p;
const pSuave = M.aguaSuelo("franco", "tomate", 60, 1).p;
ok(pSeco < pSuave, `con más demanda evaporativa el cultivo sufre antes: p ${pSeco.toFixed(2)} vs ${pSuave.toFixed(2)}`);
ok(pSeco >= 0.1 && pSuave <= 0.8, "y p se queda dentro del rango de la Tabla 22 de FAO-56");

function readApp() {
  return require("fs").readFileSync(join(RAIZ, "app", "index.html"), "utf8");
}

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
