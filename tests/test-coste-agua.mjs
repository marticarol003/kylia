// El exceso de agua traducido a euros.
//   node tests/test-coste-agua.mjs
//
// La cuenta ya estaba hecha en _reveal.js (dimCoste) y devolvía null con el
// motivo "falta la tarifa del agua": el reveal sabía traducir, pero nadie
// preguntaba el precio. Aquí se cierra ese hueco y se fija la frontera de lo
// que NO se puede afirmar.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const app = leer("app", "index.html");
const REVEAL = require(join(RAIZ, "api", "_reveal.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

console.log("── la tarifa por fin se pregunta ──");
ok(/id="input-tarifa"/.test(app), "hay un campo para el precio del agua");
ok(/tarifaAgua:\s+null,/.test(app), "y su sitio en la config");
ok(/tarifa_agua:\s+nuevoCfg\.tarifaAgua/.test(app), "que viaja al servidor con el nombre de la columna");
ok(/setNum\("input-tarifa",\s+cfgFinca\.tarifaAgua\)/.test(app), "y se relee al abrir los ajustes");

console.log("\n── dimCoste no inventa nada: comprobado con el módulo real ──");
const aguaConExceso = { disponible: true, exceso_l_m2: 121.5 };
const sinTarifa = REVEAL.dimCoste(aguaConExceso, { area_m2: 380, tarifa_agua: null });
ok(sinTarifa.agua_eur === null && /tarifa del agua/.test(sinTarifa.motivo),
   "sin tarifa devuelve null y dice por qué");
const sinArea = REVEAL.dimCoste(aguaConExceso, { area_m2: null, tarifa_agua: 0.2 });
ok(sinArea.agua_eur === null && /área/.test(sinArea.motivo), "sin superficie, igual");

console.log("\n── y con los dos, la cuenta es la de Oriol ──");
const oriol = REVEAL.dimCoste(aguaConExceso, { area_m2: 380, tarifa_agua: 0.2 });
ok(oriol.base.exceso_m3 === 46.2, `46,2 m³ de exceso (${oriol.base.exceso_m3})`);
ok(oriol.agua_eur === 9.23, `9,23 € a 0,20 €/m³ (${oriol.agua_eur})`);

console.log("\n── sin exceso NO hay euros que enseñar ──");
// Es el caso de Ferran: aplicó 412 L/m² contra 422 recomendados. Regó por
// DEBAJO. Poner ahí un ahorro en euros sería inventarlo.
const ferran = REVEAL.dimCoste({ disponible: true, exceso_l_m2: -9.5 },
                               { area_m2: 88, tarifa_agua: 0.2 });
ok(ferran.agua_eur === null && /No hubo exceso/.test(ferran.motivo),
   "con exceso negativo se dice que no hay coste que traducir");
const ferranJson = JSON.parse(leer("docs", "pilotos", "reveal-ferran-2026-09-10.json"));
ok(ferranJson.informe.dimensiones.agua.exceso_l_m2 < 0,
   "y el reveal real de Ferran confirma que no hubo exceso");

console.log("\n── el informe de Oriol dice de dónde sale cada euro ──");
for (const f of ["informe-oriol-2026-08.html", "informe-oriol-2026-08-ca.html"]) {
  const inf = leer("docs", "pilotos", f);
  ok(/46,2 m³/.test(inf), `${f}: parte de los m³ medidos`);
  ok(/0,20 €\/m³/.test(inf) && /9,20 €/.test(inf), `${f}: la tabla por tarifa`);
  ok(/1\.215 m³/.test(inf), `${f}: y la proporción por hectárea, que es la que se mantiene`);
  ok(/no sabemos qué pagas|no sabem què pagues/i.test(inf),
     `${f}: se dice que el precio no lo sabemos, en vez de poner uno`);
}
const esp = leer("docs", "pilotos", "informe-oriol-2026-08.html");
ok(/sería deshonesto vendértelo como argumento/.test(esp),
   "y que en 380 m² el dinero no es el argumento: 9 € harían parecer que Kylia no vale la pena");

console.log("\n── el informe de Ferran NO lleva euros ──");
const ferranHtml = leer("docs", "pilotos", "informe-ferran-2026-09-ca.html");
ok(!/€\/m³/.test(ferranHtml), "no hay tabla de tarifas donde no hubo ahorro");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
