// Los dos lados de Kylia tienen que decidir lo mismo.
//   node tests/test-motor-consumidores.mjs
//
// Ciclo 7 de la auditoría del 11-sep-2026.
//
// El motor vive en UN SOLO FICHERO desde el 28-jul, precisamente para que la app
// y el servidor no puedan derivar. Y habían derivado igual — por los ARGUMENTOS,
// que era la puerta que quedaba abierta. Lo que el Diario B congelaba como
// "decisión de Kylia" no era lo que la app le enseñaba al agricultor, y el
// Diario B es la fuente del reveal.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const M = require(join(RAIZ, "assets", "js", "motor-riego.js"));
const diarioB = readFileSync(join(RAIZ, "api", "diario-b.js"), "utf8");
const campo   = readFileSync(join(RAIZ, "api", "campo.js"), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };
const dia = (p, i) => new Date(new Date(`${p}T12:00:00Z`).getTime() + i * 86400000).toISOString().slice(0, 10);

console.log("── el pronóstico NO se mira en el Diario B, y es deliberado ──");
// Lo di por defecto en la primera pasada de este ciclo y me equivoqué: iba a
// "arreglarlo" pasándole lluviaPrevista. El Diario B congela lo que Kylia habría
// decidido, y el reveal compara contra un contrafactual (simularKylia) que NO
// puede ver el futuro. Dárselo a un lado y no al otro inflaría el ahorro
// publicado. La asimetría está razonada en tests/test-riego-pronostico.mjs.
ok(!/lluviaPrevista/.test(diarioB), "diario-b no consulta el pronóstico");
ok(/climaSerie\(u\.lat, u\.lon, u\.fecha_plantacion, \{ futuro: 1 \}\)/.test(diarioB),
   "y su serie pide `futuro: 1`, que es 'hoy incluido': no hay futuro que recortar");
ok(/climaSerie\(u\.lat, u\.lon, u\.fecha_plantacion, \{ futuro: 7 \}\)/.test(campo),
   "mientras campo.js sí pide 7 días: ahí se aconseja hoy, no se congela nada");
ok(/AQUÍ NO SE MIRA EL PRONÓSTICO, Y ES A PROPÓSITO/.test(diarioB),
   "con el porqué escrito al lado, para que no lo 'arregle' el siguiente");
ok(/decisionRiego\(balHoy, \{ lluviaPrevista: serie\.slice\(corte \+ 1\) \}\)/.test(campo),
   "campo.js sí lo mira: ahí no se está congelando nada, se está aconsejando hoy");

console.log("\n── el mismo reloj en los dos sitios ──");
// climaSerie corta a 92 días de pasado. En un ciclo más largo la serie no llega
// a la plantación, curvaFenologica devuelve null y el reloj cae a calendario —
// mientras campo.js seguía en térmico porque usa serieTermica(), que sí baja al
// archivo hasta el día de plantar.
const OPT = { suelo: "franco", cultivoId: "tomate", metodoRiego: "goteo", fechaPlantacion: "2026-05-01" };
const recortada = []; for (let i = 0; i < 92; i++) recortada.push({ date: dia("2026-06-10", i), et0: 5.5, lluvia: 0, tmax: 29, tmin: 17 });
const completa  = []; for (let i = 0; i < 103; i++) completa.push({ date: dia("2026-05-30", i), et0: 5.5, lluvia: 0, tmax: 29, tmin: 17 });
const LARGO = { ...OPT, fechaPlantacion: "2026-05-30" };
ok(M.balanceHidrico(recortada, [], LARGO).modoFenologia === "calendario",
   "con la serie recortada el reloj cae a calendario");
ok(M.balanceHidrico(recortada, [], { ...LARGO, serieTermica: completa }).modoFenologia === "termico",
   "y con la serie térmica completa sigue siendo térmico");
ok(/serieTermica:\s+termica/.test(diarioB), "diario-b pasa la serie térmica");
ok(/await serieTermica\(u\.lat, u\.lon, u\.fecha_plantacion\)/.test(diarioB),
   "sacándola del mismo sitio que campo.js");

console.log("\n── y la cobertura de clima se declara en los dos ──");
ok(/ventana:\s+\{ desde: serie\[0\]\?\.date, hasta: hoy \}/.test(diarioB),
   "diario-b declara la ventana que esperaba cubrir");
ok(/ventana: \{ desde: dias\[0\]\.date, hasta: corte \}/.test(campo),
   "y campo.js también, en el contrafactual del reveal");

console.log("\n── y lo declarado LLEGA al que lo tiene que mirar ──");
// El 13-sep salió que declararla no bastaba: campo.js armaba el objeto
// contrafactual con {puntos, total, deficitFinal} y la cobertura se quedaba por
// el camino. En _reveal.js llegaba `cf.coberturaClima === undefined`, el umbral
// del 95% no se evaluaba y el informe decía `publicable: true` sin que nadie
// hubiera mirado el clima. En producción, con los dos pilotos ya retirados por
// exactamente eso. El motor lo declaraba, el reveal lo exigía, y entre los dos
// se perdía.
//
// Este test no mira una clave concreta: compara lo que _reveal.js LEE del
// contrafactual contra lo que campo.js le PASA, así que la próxima clave que se
// añada al consumidor y se olvide aquí también salta.
const reveal = readFileSync(join(RAIZ, "api", "_reveal.js"), "utf8");
const leidas = new Set([...reveal.matchAll(/\bcf\.([a-zA-Z_$][\w$]*)/g)].map(m => m[1]));
const literal = campo.match(/contrafactual = \{([\s\S]*?)\};/);
ok(!!literal, "campo.js arma el objeto contrafactual en un literal localizable");
const pasadas = new Set([...(literal?.[1] || "").matchAll(/(?:^|[{,\s])([a-zA-Z_$][\w$]*)\s*:/g)].map(m => m[1]));
const huerfanas = [...leidas].filter(k => !pasadas.has(k));
ok(leidas.has("coberturaClima"), "_reveal.js lee cf.coberturaClima (la guardia del 95%)");
ok(huerfanas.length === 0,
   huerfanas.length
     ? `campo.js no le pasa al reveal: ${huerfanas.join(", ")}`
     : `campo.js le pasa las ${leidas.size} claves que _reveal.js lee del contrafactual`);

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
