// El motor y su especificación no pueden separarse.
//   node tests/test-motor-vs-spec.mjs
//
// Ciclo 10 de la auditoría del 11-sep-2026. Los nueve ciclos anteriores miraron
// el código; este lo contrasta con lo que docs/tecnico/motor-de-decision.md dice
// que hace. Y se habían separado en cuatro sitios:
//
//   · la cebolla tierna —uno de los pilotos reales— no estaba en la tabla de Kc
//   · el ajuste de p por demanda evaporativa se implementó el 30-jul y la doc
//     seguía diciendo "queda como refinamiento futuro"
//   · el reloj térmico (8-sep) no aparecía
//   · el coeficiente de estrés Ks (11-sep) tampoco
//
// Este test lee las TABLAS DEL DOCUMENTO y las compara con el motor, así que a
// partir de ahora separarse rompe la suite.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const M = require(join(RAIZ, "assets", "js", "motor-riego.js"));
const doc = readFileSync(join(RAIZ, "docs", "tecnico", "motor-de-decision.md"), "utf8");

// Las tablas del documento viven dentro de listas, así que algunas filas van
// indentadas. Comparar sin trim daba un falso rojo en la tabla de suelos.
const LINEAS = doc.split("\n").map(l => l.trim());
const filaDe = nombre => LINEAS.find(l => l.startsWith(`| ${nombre} |`));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

// El nombre con el que cada cultivo aparece en las tablas del documento.
const EN_DOC = {
  lechuga: "Lechuga", espinaca: "Espinaca", brassica: "Col/coliflor (brassica)",
  tomate: "Tomate", pimiento: "Pimiento", berenjena: "Berenjena",
  calabacin: "Calabacín", cebolla: "Cebolla tierna",
};

console.log("── la tabla de Kc del documento es la del motor ──");
for (const [id, nombre] of Object.entries(EN_DOC)) {
  const fila = filaDe(nombre);
  ok(!!fila, `${id}: está en la tabla del documento`);
  if (!fila) continue;
  const c = fila.split("|").map(x => x.trim());
  const k = M.FAO_KC[id];
  ok(Number(c[2]) === k.ini && Number(c[3]) === k.med && Number(c[4]) === k.fin,
     `${id}: Kc ${c[2]}/${c[3]}/${c[4]} coincide con el motor`);
  const L = c[5].split("/").map(x => Number(x.trim()));
  ok(L.length === 4 && L.every((v, i) => v === k.L[i]),
     `${id}: longitudes ${L.join("/")} coinciden`);
}
ok(Object.keys(EN_DOC).length === Object.keys(M.FAO_KC).length,
   `el documento lista los ${Object.keys(M.FAO_KC).length} cultivos que conoce el motor, ni uno menos`);

console.log("\n── la tabla de suelos ──");
for (const [id, nombre] of [["arenoso", "Arenoso"], ["franco", "Franco"], ["arcilloso", "Arcilloso"]]) {
  const fila = filaDe(nombre);
  ok(fila && Number(fila.split("|")[2].trim()) === M.SUELO_AWC[id],
     `${id}: ${M.SUELO_AWC[id]} m³/m³ coincide`);
}

console.log("\n── las fracciones de agotamiento ──");
const lineaP = doc.split("\n").find(l => /espinaca 0\.20, lechuga\/cebolla\/pimiento/.test(l));
ok(!!lineaP, "el documento declara p por cultivo");
ok(M.FAO_KC.espinaca.p === 0.20 && M.FAO_KC.lechuga.p === 0.30 && M.FAO_KC.cebolla.p === 0.30
   && M.FAO_KC.pimiento.p === 0.30 && M.FAO_KC.tomate.p === 0.40 && M.FAO_KC.brassica.p === 0.45
   && M.FAO_KC.berenjena.p === 0.45 && M.FAO_KC.calabacin.p === 0.50,
   "y los ocho valores son los del motor");
ok(M.P_AGOTAMIENTO === 0.45, "el fallback sin cultivo es 0.45, como dice el documento");

console.log("\n── las profundidades de raíz ──");
const zr = { lechuga: 0.30, espinaca: 0.30, cebolla: 0.30, brassica: 0.50, pimiento: 0.50,
             calabacin: 0.60, tomate: 0.70, berenjena: 0.70 };
for (const [id, max] of Object.entries(zr))
  ok(M.FAO_KC[id].zr[1] === max, `${id}: zr_max ${max} m`);
ok(new Set(Object.values(M.FAO_KC).map(k => k.zr[0])).size === 1 && M.FAO_KC.tomate.zr[0] === 0.20,
   "y todas arrancan en 0,20 m al trasplante");
ok(M.ZR_M === 0.30, "fallback sin cultivo: 0,30 m");

console.log("\n── las eficiencias de riego ──");
const lineaE = doc.split("\n").find(l => /goteo 0\.90, aspersión 0\.75/.test(l));
ok(!!lineaE, "el documento las lista");
for (const [m, v] of Object.entries({ goteo: 0.90, aspersion: 0.75, regadera: 0.85, manguera: 0.70, surco: 0.60 }))
  ok(M.EFIC_RIEGO[m] === v, `${m}: ${v}`);

console.log("\n── la regla de decisión ──");
ok(/Dr ≥ RAW \| "Regar hoy"/.test(doc), "el documento fija el umbral en RAW");
ok(/0\.75·RAW ≤ Dr < RAW \| "Revisar el riego"/.test(doc), "y el aviso en 0,75·RAW");
const bal = (Dr) => ({ Dr, raw: 20, taw: 100, efic: 0.9 });
ok(M.decisionRiego(bal(20), {}).nivel === "alta", "Dr = RAW → regar");
ok(M.decisionRiego(bal(19.9), {}).nivel === "media", "justo por debajo → vigilar");
ok(M.decisionRiego(bal(15), {}).nivel === "media", "0,75·RAW → vigilar");
ok(M.decisionRiego(bal(14.9), {}).nivel === "baja", "por debajo → todo en orden");
ok(Math.abs(M.decisionRiego(bal(30), {}).cantidad_l_m2 - 30 / 0.9) < 0.05,
   "y la cantidad bruta es Dr/eficiencia, como dice el documento");

console.log("\n── el ajuste por lluvia prevista ──");
// Aquí es donde la doc y el motor decían cosas distintas: la doc se conformaba
// con que la lluvia devolviera el suelo a RAW, y el motor exige el déficit
// entero. Gana el motor (posponer dejando el suelo en RAW es posponer un día).
ok(/prevista ≥ Dr\s+→ esperar a la lluvia/.test(doc),
   "el documento pide que la lluvia cubra el déficit ENTERO");
ok(!/cubre el déficit hasta RAW → posponer/.test(doc), "y ya no dice 'hasta RAW'");
ok(/0\.9 · TAW/.test(doc), "y documenta el corte de 0,9·TAW");
const conLluvia = (Dr, mm) => M.decisionRiego({ Dr, raw: 20, taw: 100, efic: 0.9 },
                                              { lluviaPrevista: [{ lluvia: mm }] });
ok(conLluvia(30, 30).cantidad_l_m2 === null, "lluvia = déficit → esperar, no regar");
ok(conLluvia(30, 25).cantidad_l_m2 > 0, "lluvia por debajo del déficit → riego reducido");
ok(Math.abs(conLluvia(30, 20).cantidad_l_m2 - 10 / 0.9) < 0.05,
   "y lo reducido es (Dr − prevista)/eficiencia");
ok(conLluvia(30, 29).cantidad_l_m2 === null,
   "si lo que queda no llega a PE_MIN_MM (2 mm), no se manda regar 1 mm");
ok(conLluvia(95, 95).cantidad_l_m2 > 0,
   "con Dr ≥ 0,9·TAW el motor NO se fía del pronóstico y riega igual");

console.log("\n── lo que el documento decía y ya no era verdad ──");
ok(!/queda como refinamiento futuro/.test(doc),
   "el ajuste de p por ETc ya no figura como 'futuro': se implementó el 30-jul");
ok(/p_aj = p_tabla \+ 0\.04 × \(5 − ETc\)/.test(doc), "y su fórmula está escrita");
const a = M.aguaSuelo("franco", "tomate", 60, 1), b = M.aguaSuelo("franco", "tomate", 60, 9);
ok(Math.abs(a.p - Math.min(0.8, 0.40 + 0.04 * 4)) < 1e-9, "que es exactamente lo que aplica el motor (ETc 1)");
ok(Math.abs(b.p - Math.max(0.1, 0.40 + 0.04 * -4)) < 1e-9, "y con ETc 9");

console.log("\n── y lo que el documento no decía todavía ──");
ok(/Ks = \(TAW − Dr\) \/ \(TAW − RAW\)/.test(doc), "el coeficiente de estrés está documentado");
ok(Math.abs(M.ksEstres(70, 100, 40) - 0.5) < 1e-9, "con la fórmula que aplica el motor");
ok(/GDD del día = max\(0, \(Tmax \+ Tmin\)\/2 − Tbase\)/.test(doc), "el reloj térmico también");
ok(/`coberturaClima`/.test(doc) && /`diasEstres`/.test(doc) && /`lluviaUtilAcum`/.test(doc),
   "y los campos que el balance declara además del número");
// Que la tabla de campos declarados no se quede corta: si el motor añade uno
// nuevo y nadie lo documenta, esto lo caza.
const CAMPOS = ["coberturaClima", "diasSinClima", "desdeSerie", "hastaSerie", "diasEstres",
                "lluviaUtilAcum", "cicloCompletado", "diasTrasCiclo", "sinPlantar",
                "sinAcumularCalor", "modoFenologia"];
const serie = []; for (let i = 0; i < 30; i++)
  serie.push({ date: `2026-05-${String(i + 1).padStart(2, "0")}`, et0: 5, lluvia: 0, tmax: 28, tmin: 16 });
const salida = M.balanceHidrico(serie, [], { suelo: "franco", cultivoId: "tomate",
                                             metodoRiego: "goteo", fechaPlantacion: "2026-05-01" });
for (const c of CAMPOS) {
  ok(c in salida, `el balance devuelve ${c}`);
  ok(doc.includes(`\`${c}\``), `   ...y el documento lo explica`);
}

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
