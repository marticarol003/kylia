// Kylia NO recomienda fitosanitarios. Registrarlos, sí.
//   node tests/test-sin-recomendar-fitosanitarios.mjs
//
// El 24-jul el consejo congeló el pilar anti-plagas, pero la v0 que esa decisión
// descartó siguió viva en producción hasta el 13-ago: cinco heurísticas de clima
// diario y un catálogo de fitosanitarios CABLEADO con nombres comerciales y
// dosis, que se le enseñaban a agricultores sin asesor. Entre ellos imidacloprid
// (Confidor), cuyos usos en exterior están retirados en la UE desde 2018, y un
// "plazo de seguridad: 7-14 días según cultivo" — aproximación en el único dato
// del cuaderno que no admite aproximarse.
//
// Este test existe para que no vuelva. La línea que separa lo retirado de lo que
// se queda es RECOMENDAR vs REGISTRAR: apuntar lo que el agricultor ya aplicó es
// el cuaderno del RD 1051/2022 y no prescribe nada.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const app = leer("app", "index.html");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

console.log("── no queda catálogo de fitosanitarios cableado en la app ──");
ok(!/const PRODUCTOS_PLAGA\s*=/.test(app), "PRODUCTOS_PLAGA no existe");
ok(!/const ALERTAS\s*=/.test(app), "el índice ALERTAS de heurísticas tampoco");
for (const s of ["Imidacloprid", "Confidor", "Metalaxil", "Ridomil", "Vertimec", "Abamectina 1.8"]) {
  ok(!app.includes(s), `ningún rastro de "${s}" en la app`);
}
ok(!/function calcularRiesgo(Pulgon|Mildiu|OrugaCol|MoscaBlanca|AranaRoja)/.test(app),
   "los cinco modelos de riesgo por clima diario están fuera");
ok(!/function renderizarAlertas/.test(app), "y el render de niveles de riesgo");

console.log("── ni código que dependiera de ellos ──");
ok(!/renderizarAlertas\(/.test(app), "no queda ninguna llamada suelta a renderizarAlertas");
ok(!/alertas-container/.test(app), "ni el contenedor ni su regla de CSS");
ok(!/alertas: \[/.test(app), "ni el campo `alertas` de CULTIVOS, que era su índice");
ok(!/function aplicacionReciente/.test(app),
   "ni aplicacionReciente, que solo servía para silenciar avisos de plaga");
ok(!/productoCriterio: \{ tipo: "plaga"/.test(app),
   "y ya nada genera una recomendación con criterio de plaga");

console.log("── lo que SÍ se queda: registrar lo aplicado ──");
ok(/data-tipo="plaga"/.test(app),
   "el agricultor puede seguir apuntando que ha visto una plaga (observación, no receta)");
ok(/modal-aplicacion|registrarAplicacion|aplicaciones/.test(app),
   "y registrar una aplicación: es la base del cuaderno RD 1051/2022");
const catalogo = require(join(RAIZ, "data", "productos.json"));
ok(Array.isArray(catalogo.tratamientos) && catalogo.tratamientos.length > 0,
   "data/productos.json sigue teniendo tratamientos: sirven para IDENTIFICAR lo aplicado");
ok(catalogo.tratamientos.every(t => typeof t.plazoSeguridad === "number"),
   "y cada uno con plazo de seguridad NUMÉRICO, que es lo que el cuaderno necesita");
ok(!catalogo.tratamientos.some(t => /imidacloprid/i.test(t.sustanciaActiva || "")),
   "en el catálogo no hay imidacloprid");

console.log("── la tarjeta de recomendaciones no miente cuando está vacía ──");
const render = app.slice(app.indexOf("function renderRecomendaciones"), app.indexOf("const ICONOS_REC"));
ok(!/El cultivo está bien/.test(render),
   "ya no dice 'el cultivo está bien': desde que no hay vigilancia de plagas, eso no lo sabe nadie");
ok(/if \(textoIA\) container\.appendChild\(section\);/.test(render),
   "sin nada que decir no se pinta la tarjeta, en vez de tranquilizar en falso");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
