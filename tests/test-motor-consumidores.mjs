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
ok(/forecast_days=1/.test(diarioB),
   "y su serie pide forecast_days=1, que es 'hoy incluido': no hay futuro que recortar");
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

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
