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

console.log("── y cada tratamiento dice en qué situación legal está ──");
// Revisado el 8-sep-2026. El catálogo decía "curado, verificado contra MAPA" y
// llevaba mancozeb con dosis: el TJUE anuló su prohibición en 2025, pero NO hay
// ningún producto con registro en España, así que no se puede comprar ni aplicar.
// Que la sustancia esté aprobada en la UE y que exista un producto autorizado en
// España son dos cosas distintas, y la segunda es la que manda.
ok(catalogo.tratamientos.every(t => t.registro && typeof t.registro.estado === "string"),
   "todos los tratamientos llevan estado regulatorio, no solo los que alguien recordó mirar");
ok(catalogo.tratamientos.every(t => ["autorizado", "sin_producto_autorizado_es", "por_verificar"].includes(t.registro.estado)),
   "y el estado es uno de los tres previstos");
ok(catalogo.tratamientos.every(t => t.registro.estado === "por_verificar" ? true : !!t.registro.comprobado),
   "lo que se declara comprobado lleva fecha de comprobación");
const mancozeb = catalogo.tratamientos.find(t => t.id === "mancozeb");
ok(mancozeb && mancozeb.registro.estado === "sin_producto_autorizado_es",
   "mancozeb está marcado como lo que es: sin producto que se pueda comprar en España");
ok(/data\/productos\.json/.test(app) && /registro\?\.estado !== "sin_producto_autorizado_es"/.test(app),
   "y la app no lo ofrece: lo que no se puede comprar no se enseña como opción");
ok(mancozeb && /identificar/i.test(mancozeb.registro.nota || ""),
   "pero sigue en el catálogo para IDENTIFICAR una aplicación antigua — el cuaderno registra lo que pasó, no lo que debería haber pasado");

// Verificado el 10-sep contra la lista oficial del MAPA (Reg. 2021/155, edición
// del 1-jul-2026): las 10 restantes figuran en la lista de APROBADAS y ninguna
// aparece en el índice de excluidas / no renovadas; mancozeb sí, como
// «Mancoceb (no renov)» — y esa edición es POSTERIOR a la sentencia del TJUE.
ok(catalogo.tratamientos.every(t => t.registro.comprobado),
   "ya no queda ninguna materia activa sin comprobar contra fuente oficial");
ok(catalogo.tratamientos.every(t => t.registro.estado !== "por_verificar"),
   "y ninguna se queda en 'por_verificar'");
ok(/Mancoceb \(no renov\)/.test(mancozeb.registro.ue),
   "la nota de mancozeb cita el término literal de la lista oficial, no un resumen");
const cobre = catalogo.tratamientos.find(t => t.id === "oxicloruro-cobre");
ok(/28 kg/.test(cobre.registro.nota) && /cuaderno/i.test(cobre.registro.nota),
   "el cobre arrastra su tope de 28 kg/ha en 7 años, que es un límite de cuaderno entre campañas");
ok(/NO se ha leído/.test(cobre.registro.nota),
   "y se dice qué NO se comprobó (la fecha de caducidad) en vez de ponerla a ojo");
const parafina = catalogo.tratamientos.find(t => t.id === "aceite-parafinico");
ok(/CAS/.test(parafina.registro.nota) && /64742-54-7/.test(parafina.registro.nota),
   "el aceite de parafina avisa de que una variante por nº CAS SÍ está excluida: no todas son la misma sustancia");

console.log("── la tarjeta de recomendaciones no miente cuando está vacía ──");
const render = app.slice(app.indexOf("function renderRecomendaciones"), app.indexOf("const ICONOS_REC"));
ok(!/El cultivo está bien/.test(render),
   "ya no dice 'el cultivo está bien': desde que no hay vigilancia de plagas, eso no lo sabe nadie");
ok(/if \(textoIA\) container\.appendChild\(section\);/.test(render),
   "sin nada que decir no se pinta la tarjeta, en vez de tranquilizar en falso");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
