// Partir un recinto por una línea recta (assets/js/geo-parcela.js).
//   node tests/test-geo-parcela.mjs
//
// En parcelas pequeñas los cultivos se separan repartiendo METROS: la geometría
// solo la necesita el satélite y una subzona pequeña no llega a las 0,5 ha. Pero
// en una finca GRANDE, 5 ha partidas en 3 + 2 dejan las dos partes por encima
// del umbral y cada una puede tener su propia medida. Por eso hay que cortar
// bien: si el reparto de superficie sale mal, el plan de abonado de cada cultivo
// sale mal (los kg escalan con el área).
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const G = require("../assets/js/geo-parcela.js");
const { aplicaSatelite } = require("../api/_satelite.js");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };
const aprox = (a, b, tol) => Math.abs(a - b) <= tol;

// Cuadrado de ~200 m de lado en Palafolls (41,67°N) → ~4 ha.
const LAT = 41.67, LON = 2.74;
const mLon = 200 / (111320 * Math.cos(LAT * Math.PI / 180));
const mLat = 200 / 110540;
const cuadrado = {
  type: "Polygon",
  coordinates: [[[LON, LAT], [LON + mLon, LAT], [LON + mLon, LAT + mLat], [LON, LAT + mLat], [LON, LAT]]],
};

console.log("── área: el cuadrado de 200×200 m ──");
const areaTotal = G.areaM2(G.anilloExterior(cuadrado));
ok(aprox(areaTotal, 40000, 400), `≈4 ha (${Math.round(areaTotal)} m², esperado 40.000 ±400)`);

console.log("── corte por la mitad: dos partes iguales ──");
const mitad = G.partirPorLinea(cuadrado, [LON - 0.001, LAT + mLat / 2], [LON + mLon + 0.001, LAT + mLat / 2]);
ok(mitad.ok, "el corte horizontal por el centro funciona");
ok(mitad.partes.length === 2, "salen 2 partes");
const [p1, p2] = mitad.partes;
ok(aprox(p1.area_m2, p2.area_m2, 300), `mitades parecidas (${p1.area_m2} y ${p2.area_m2} m²)`);
ok(aprox(p1.area_m2 + p2.area_m2, areaTotal, 500),
   `las partes suman el total (${p1.area_m2 + p2.area_m2} vs ${Math.round(areaTotal)} m²) — sin esto el abonado de cada cultivo saldría mal`);

console.log("── corte descentrado: 3/4 y 1/4 ──");
const desc = G.partirPorLinea(cuadrado, [LON - 0.001, LAT + mLat * 0.75], [LON + mLon + 0.001, LAT + mLat * 0.75]);
ok(desc.ok, "corte al 75% funciona");
ok(desc.partes[0].area_m2 > desc.partes[1].area_m2, "la parte MAYOR va primero");
ok(aprox(desc.partes[0].area_m2 / areaTotal, 0.75, 0.03),
   `la mayor es ~75% del total (${(100 * desc.partes[0].area_m2 / areaTotal).toFixed(0)}%)`);

console.log("── corte en diagonal ──");
const diag = G.partirPorLinea(cuadrado, [LON - 0.0005, LAT - 0.0005], [LON + mLon + 0.0005, LAT + mLat + 0.0005]);
ok(diag.ok, "la diagonal parte la parcela");
ok(aprox(diag.partes[0].area_m2 + diag.partes[1].area_m2, areaTotal, 500), "la diagonal también conserva el área");

console.log("── la recta se prolonga: no hay que acertar en el borde ──");
const corto = G.partirPorLinea(cuadrado, [LON + mLon * 0.4, LAT + mLat / 2], [LON + mLon * 0.6, LAT + mLat / 2]);
ok(corto.ok, "dos toques CENTRO de la parcela bastan (la recta se extiende sola)");
ok(aprox(corto.partes[0].area_m2, mitad.partes[0].area_m2, 300),
   "y da el mismo reparto que marcando de borde a borde");

console.log("── casos que hay que rechazar, no adivinar ──");
const fuera = G.partirPorLinea(cuadrado, [LON - 0.01, LAT - 0.01], [LON + mLon + 0.01, LAT - 0.01]);
ok(!fuera.ok && fuera.motivo === "no_cruza", "una recta que pasa por fuera → no_cruza");
ok(!G.partirPorLinea(cuadrado, [LON, LAT], [LON, LAT]).ok, "dos toques en el mismo punto → se rechaza");
ok(!G.partirPorLinea(null, [LON, LAT], [LON + 1, LAT]).ok, "sin geometría → se rechaza");

// Parcela en U: una recta horizontal por el hueco la cruza 4 veces. Devolver
// dos trozos ahí sería inventarse qué va con qué.
const enU = { type: "Polygon", coordinates: [[
  [LON, LAT], [LON + mLon, LAT], [LON + mLon, LAT + mLat], [LON + mLon * 0.7, LAT + mLat],
  [LON + mLon * 0.7, LAT + mLat * 0.4], [LON + mLon * 0.3, LAT + mLat * 0.4],
  [LON + mLon * 0.3, LAT + mLat], [LON, LAT + mLat], [LON, LAT],
]] };
const mult = G.partirPorLinea(enU, [LON - 0.001, LAT + mLat * 0.7], [LON + mLon + 0.001, LAT + mLat * 0.7]);
ok(!mult.ok && mult.motivo === "corte_multiple",
   `parcela en U cortada por el hueco → corte_multiple (${mult.cruces} cruces), se avisa en vez de inventar`);

console.log("── la superficie oficial manda sobre la geométrica ──");
// Un recinto con huecos (caseta, balsa, arbolado) mide MENOS de lo que dice su
// contorno exterior. Como los kg de abono escalan con el área, hay que repartir
// la cifra certificada de SIGPAC, no la que sale de dibujar el borde.
const conOficial = G.partirPorLinea(cuadrado, [LON - 0.001, LAT + mLat / 2], [LON + mLon + 0.001, LAT + mLat / 2],
                                    { superficieOficialM2: 36000 });   // 4 ha de contorno, 3,6 oficiales
ok(conOficial.ok && conOficial.superficie_oficial_usada, "se aplica la superficie oficial cuando se pasa");
ok(aprox(conOficial.partes[0].area_m2 + conOficial.partes[1].area_m2, 36000, 2),
   `las partes suman los 36.000 oficiales, no los ${Math.round(areaTotal)} del contorno`);
ok(aprox(conOficial.partes[0].fraccion, 0.5, 0.02), "y el REPARTO lo sigue decidiendo la geometría (~50/50)");
ok(!mitad.superficie_oficial_usada, "sin superficie oficial se usa la geométrica (y se dice)");

console.log("── el sentido de todo esto: cada parte con su satélite ──");
// 4 ha partidas por la mitad → 2 ha cada una, las dos siguen por encima de 0,5.
ok(mitad.partes.every(p => aplicaSatelite(p.area_m2)),
   "4 ha partidas en 2 + 2 → LAS DOS mantienen satélite (el caso de la finca grande)");
// 8.000 m² (0,8 ha) partidos por la mitad → 0,4 ha cada uno, ninguna llega.
const chico = {
  type: "Polygon",
  coordinates: [[[LON, LAT], [LON + mLon * 0.45, LAT], [LON + mLon * 0.45, LAT + mLat * 0.45], [LON, LAT + mLat * 0.45], [LON, LAT]]],
};
const areaChico = G.areaM2(G.anilloExterior(chico));
const chicoPart = G.partirPorLinea(chico, [LON - 0.001, LAT + mLat * 0.225], [LON + mLon + 0.001, LAT + mLat * 0.225]);
ok(aplicaSatelite(areaChico) && chicoPart.partes.every(p => !aplicaSatelite(p.area_m2)),
   `0,8 ha con satélite, pero partida en dos ninguna mitad llega (${chicoPart.partes.map(p=>p.area_m2).join(" y ")} m²) — ahí NO compensa cortar`);

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
