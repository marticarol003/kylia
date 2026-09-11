// El dashboard dice qué HAY QUE HACER, y el calendario cuándo tocará.
//   node tests/test-acciones-y-plan.mjs
//
// Antes lo alto de la pantalla era una tarjeta que hablaba TODOS los días, y
// cuando no tenía nada que decir decía "Todo en orden". Eso no es información:
// es ruido que enseña a ignorar la tarjeta, y el día que sí importa ya nadie
// la mira.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const MOTOR = require(join(RAIZ, "assets", "js", "motor-riego.js"));
const app = readFileSync(join(RAIZ, "app", "index.html"), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

console.log("── cuando no hay nada que hacer, no hay tarjeta ──");
// Solo quedan las dos menciones en comentarios que explican por qué se fue.
ok(!/hoy-accion">Todo en orden|"Todo en orden"<\/div>|>Todo en orden</.test(app),
   "'Todo en orden' ya no se pinta en ninguna parte");
ok(/if \(!acc\.length\) \{ card\.hidden = true;/.test(app),
   "sin acciones la tarjeta se oculta entera, no se rellena con algo simpático");
ok(/function accionesDeHoy\(\)/.test(app), "hay una función que decide qué toca");

console.log("\n── las acciones son verbos, y solo salen si tocan ──");
ok(/verbo: "Regar"/.test(app), "Regar");
ok(/verbo: "Abonar"/.test(app), "Abonar");
ok(/onClick: \(\) => abrirModalRiego\(\)/.test(app),
   "tocar Regar lleva al registro de un toque, no a otro formulario");

console.log("\n── fitosanitarios: se vigila, NO se receta ──");
// Es la línea del consejo del 24-jul, refijada el 13-ago. Un botón que dijera
// "toca tratar" es una prescripción, y sin el reconocimiento del DARP (art. 20
// RD 1051/2022) Kylia tampoco puede darla.
const acciones = app.slice(app.indexOf("function accionesDeHoy()"), app.indexOf("function tramoDeAbonadoPendiente"));
ok(!/verbo: "Tratar"|verbo: "Aplicar"|toca tratar/i.test(acciones),
   "no hay ninguna acción que mande tratar");
ok(/verbo: "No recolectar todavía"/.test(acciones),
   "lo que sí sale es el plazo de seguridad, que es una restricción legal, no un consejo");
ok(/bloqueo: true/.test(acciones), "y va marcado como bloqueo, no como tarea");

console.log("\n── el abonado sale del plan del servidor, no de una regla nueva ──");
ok(/window\.__planAbonado/.test(app), "reutiliza el plan que ya se pide para la tarjeta de abonado");
ok(/if \(!l \|\| !\(l\.pendiente_kg > 0\)/.test(app),
   "si no queda nada pendiente no se propone abonar (el motor ya descuenta lo aplicado)");
ok(/window\.__madurez\?\.fraccion/.test(app),
   "y el tramo que toca se decide por dónde va el ciclo, que ya lo calcula la vista de madurez");

console.log("\n── la previsión no contamina el déficit de hoy ──");
// `ultimoET0` alimenta acumuladores que suman TODA la serie ("ET₀ desde el
// último riego"). Meter días futuros ahí inflaría el déficit de hoy con agua
// que aún no se ha evaporado.
ok(/let pronosticoET0 = null;/.test(app), "el pronóstico vive en su propia variable");
const cargar = app.slice(app.indexOf("async function cargarET0()"), app.indexOf("function calcularAlertaRiego"));
ok(!/pronosticoET0/.test(cargar), "cargarET0 no lo toca");
ok(/forecast_days=1/.test(cargar), "y sigue pidiendo solo hoy, como estaba");
ok(/forecast_days=8/.test(app), "el pronóstico son 8 días: más allá la lluvia no se acierta");

console.log("\n── el plan de riego previsto ──");
ok(/function planRiegoPrevisto\(\)/.test(app), "existe");
ok(/let Dr = b\.Dr > b\.raw \? 0 : b\.Dr;/.test(app),
   "parte de que hoy hace lo que se le pide: si no, el primer 'previsto' sería mañana y repetiría la alerta");
ok(/if \(ll >= MOTOR\.PE_MIN_MM\) Dr = Math\.max\(0, Dr - ll\);/.test(app),
   "descuenta la lluvia prevista con el mismo criterio de infiltración que el motor");
ok(/se recalcula cada día/.test(app),
   "y se declara como previsión, no como cita: sin eso un punto en el jueves se lee como una promesa");
ok(/\.cal-pt\.previsto \{ background: transparent;/.test(app),
   "en el calendario va hueco, no macizo: lo que no ha pasado no se pinta con el mismo peso");

console.log("\n── la aritmética de la previsión ──");
// Réplica del bucle con el motor real: lechuga en franco, ET0 4,6, sin lluvia.
const hoy = new Date();
const iso = d => new Date(hoy.getTime() - d * 86400000).toISOString().slice(0, 10);
const clima = []; for (let d = 28; d >= -8; d--) clima.push({ date: iso(d), et0: 4.6, lluvia: 0, tmax: 28, tmin: 16 });
const pasado = clima.filter(c => c.date <= iso(0));
const b = MOTOR.balanceHidrico(pasado, [{ date: iso(0), litros: null }],
  { suelo: "franco", cultivoId: "lechuga", metodoRiego: "goteo", fechaPlantacion: iso(28) });
let Dr = b.Dr > b.raw ? 0 : b.Dr;
const dias = [];
for (const d of clima.filter(c => c.date > iso(0))) {
  Dr += MOTOR.kcDelDia("lechuga", MOTOR.diasEntre(iso(28), new Date(`${d.date}T12:00:00`))) * d.et0;
  if (Dr > b.raw) { dias.push(d.date); Dr = 0; }
}
ok(dias.length >= 1 && dias.length <= 3,
   `con ET₀ 4,6 y umbral ${b.raw.toFixed(1)} mm salen ${dias.length} riegos en 8 días (esperado 1-3)`);
const hueco = dias.length > 1
  ? Math.round((new Date(dias[1]) - new Date(dias[0])) / 86400000) : null;
ok(hueco === null || (hueco >= 2 && hueco <= 5),
   `y el hueco entre ellos es de ${hueco} días, coherente con una lechuga en franco`);

console.log("\n── el caudal se pide cuando es gratis pedirlo ──");
// En el alta, "¿cuál es tu caudal?" es un "no lo sé". Aquí está de pie al lado
// del riego y a punto de abrirlo: medirlo no le cuesta ni un viaje.
ok(/pon una botella bajo un gotero diez minutos/.test(app),
   "la acción de regar invita a medir el caudal");
ok(/\(Number\(cfg\.caudal\) > 0\) \? null/.test(app),
   "y solo a quien no lo tiene: al que ya lo midió no se le vuelve a pedir");
ok(/accion-pie/.test(app) && /border-top: 1px dashed/.test(app),
   "va un escalón por debajo de la razón: es una oferta, no una tarea");
ok(/cambia el\n *\/\/ veredicto en 16 de 48 casos probados/.test(app),
   "y queda escrito por qué importa, que no es solo hablarle en minutos");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
