// Un reveal no puede publicar un porcentaje que no se sostiene.
//   node tests/test-reveal-publicable.mjs
//
// Ciclo 4 de la auditoría del 11-sep-2026, y el más caro de todos: este es el
// fallo que YA OCURRIÓ. El 10-sep salieron dos informes de piloto con cifras
// inventadas —Oriol con un "ahorro del 34%" que en realidad era −1%— porque el
// contrafactual se calculó sobre una serie de clima con el 39% y el 29% de la
// campaña a cero, y NADA en el resultado lo decía.
//
// La regla que sale de ahí: si el número no se sostiene, el número NO EXISTE.
// No se marca como poco fiable y se deja en el objeto para que alguien lo copie.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const RV = require(join(RAIZ, "api", "_reveal.js"));
const M = require(join(RAIZ, "assets", "js", "motor-riego.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

const dia = i => new Date(new Date("2026-06-13T12:00:00Z").getTime() + i * 86400000).toISOString().slice(0, 10);
const OPT = { suelo: "franco", cultivoId: "tomate", metodoRiego: "goteo", fechaPlantacion: "2026-05-30" };
const serieCompleta = [];
for (let i = 0; i < 88; i++) serieCompleta.push({ date: dia(i), et0: 5.5, lluvia: 0, tmax: 29, tmin: 17 });
const ventana = { desde: dia(0), hasta: dia(87) };
const riegos = [];
for (let i = 0; i < 88; i++) riegos.push({ dia: dia(i), l_m2: 4.7 });

console.log("── EL CASO REAL · el clima que rompió los dos informes ──");
// La API de pronóstico solo guarda ~64 días de pasado: con past_days=92 devolvía
// null en los días MÁS ANTIGUOS, y el código hacía `?? 0`.
const serieRota = serieCompleta.map((d, i) => i < 29 ? { ...d, et0: null } : d);
const cfRoto = M.simularKylia(serieRota, { ...OPT, ventana });
const cfBien = M.simularKylia(serieCompleta, { ...OPT, ventana });
ok(cfRoto.diasSinClima === 29, `el motor cuenta los 29 días sin clima (${cfRoto.diasSinClima})`);
ok(cfRoto.coberturaClima < 0.7, `y la cobertura baja a ${cfRoto.coberturaClima}`);
ok(cfBien.coberturaClima === 1, "con el clima entero, cobertura 1");

const dRoto = RV.dimAguaDesdeContrafactual(riegos, cfRoto);
ok(dRoto.publicable === false, "el informe se declara NO publicable");
ok(dRoto.ahorro_pct === null && dRoto.exceso_pct === null, "y el porcentaje NO EXISTE, no es que esté marcado");
ok(dRoto.aplicada_l_m2 === null && dRoto.recomendada_l_m2 === null,
   "tampoco las cifras comparadas: dejarlas invita a copiarlas sin leer el motivo");
ok(/67% del clima/.test(dRoto.motivo_no_publicable), `se dice cuánto clima faltaba: "${dRoto.motivo_no_publicable}"`);
ok(/No se puede comparar/.test(dRoto.veredicto), "y el veredicto lo dice en la lengua del informe");

const dBien = RV.dimAguaDesdeContrafactual(riegos, cfBien);
ok(dBien.publicable === true && dBien.ahorro_pct != null, "con el clima entero sí se publica");

console.log("\n── la cobertura se mide contra la ventana ESPERADA ──");
// Este es el segundo fallo, y era MÍO: la primera versión medía la serie contra
// sí misma (primer día → último), así que los huecos del principio y del final
// eran invisibles. Con los 29 días ausentes por delante, la serie simplemente
// empezaba más tarde: cobertura 1,000 y la guarda no paraba nada. Justo el caso
// que venía a impedir.
const sinVentana = M.simularKylia(serieRota, OPT);
ok(sinVentana.coberturaClima === 1,
   "sin declarar la ventana, la cobertura da 1 aunque falten 29 días por delante");
ok(cfRoto.coberturaClima < 1,
   "declarándola, se ve el agujero — por eso campo.js la pasa");
const huecoEnMedio = serieCompleta.filter((d, i) => !(i >= 30 && i < 50));
ok(M.simularKylia(huecoEnMedio, OPT).coberturaClima < 1,
   "los huecos de EN MEDIO sí se ven sin ventana (pero no son el caso real)");

console.log("\n── un riego sin cantidad no son cero litros ──");
// suma() hacía Number(null) || 0: el agricultor regaba cuatro veces y el informe
// contaba dos.
const mezcla = [{ dia: dia(0), l_m2: 18 }, { dia: dia(3), l_m2: null },
                { dia: dia(6), l_m2: null }, { dia: dia(9), l_m2: 18 }];
const dMezcla = RV.dimAguaDesdeContrafactual(mezcla, cfBien);
ok(dMezcla.riegos_sin_cantidad?.n === 2, "se cuentan los riegos sin cifra");
ok(dMezcla.riegos_sin_cantidad?.de === 4, "y sobre cuántos son");
ok(/NO cuentan como 0/.test(dMezcla.riegos_sin_cantidad.nota), "y se dice explícitamente que no son ceros");
ok(dMezcla.publicable === false, "con la mitad sin cuantificar, no se publica porcentaje");
const pocos = [{ dia: dia(0), l_m2: 18 }, { dia: dia(3), l_m2: 18 }, { dia: dia(6), l_m2: 18 },
               { dia: dia(9), l_m2: 18 }, { dia: dia(12), l_m2: 18 }, { dia: dia(15), l_m2: null }];
ok(RV.dimAguaDesdeContrafactual(pocos, cfBien).publicable === true,
   "pero uno suelto de seis no tumba el informe");

console.log("\n── porcentajes que no significan nada ──");
const cfMini = { puntos: [{ date: dia(0), acum_l_m2: 0 }, { date: dia(30), acum_l_m2: 0.1 }],
                 total: 0.1, deficitFinal: 0, coberturaClima: 1 };
const dMini = RV.dimAguaDesdeContrafactual([{ dia: dia(1), l_m2: 400 }], cfMini);
ok(dMini.exceso_pct === null, "400 L/m² contra 0,1 no da 'exceso del 399.900%': no da nada");
const cfGrande = { puntos: [{ date: dia(0), acum_l_m2: 0 }, { date: dia(30), acum_l_m2: 400 }],
                   total: 400, deficitFinal: 0, coberturaClima: 1 };
ok(RV.dimAguaDesdeContrafactual([{ dia: dia(1), l_m2: 0.5 }], cfGrande).ahorro_pct === null,
   "ni 0,5 contra 400 da 'ahorro del −79.900%'");

console.log("\n── entradas rotas no producen números ──");
for (const [t, r] of [["fecha nula", [{ dia: null, l_m2: 10 }]],
                      ["cantidad NaN", [{ dia: dia(1), l_m2: NaN }]],
                      ["cantidad negativa", [{ dia: dia(1), l_m2: -500 }]],
                      ["cantidad de texto", [{ dia: dia(1), l_m2: "mucho" }]],
                      ["sin riegos", []]]) {
  const d = RV.dimAguaDesdeContrafactual(r, cfBien);
  ok(d.aplicada_l_m2 === null || d.aplicada_l_m2 >= 0, `${t} → nunca agua aplicada negativa`);
  ok(!/NaN|Infinity|undefined/.test(d.veredicto || ""), `${t} → el veredicto no enseña basura`);
}

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
