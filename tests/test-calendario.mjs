// El calendario de la parcela: registro y campaña en la misma rejilla.
//   node tests/test-calendario.mjs
//
// QUÉ ES. Una vista de mes en /app donde se ven tres capas sobre los mismos
// días: lo que el agricultor APUNTÓ (riegos, aplicaciones), lo que KYLIA DECÍA
// (los días en que el suelo bajaba del umbral) y dónde está el CULTIVO dentro
// de su ciclo (plantación, ventana de madurez, cosecha).
//
// Y una cosa que parece de detalle y es la que decide si esto sirve: tocar un
// día pasado abre el registro CON ESA FECHA. Apuntar lo de ayer no puede costar
// más que apuntar lo de hoy — si cuesta más, no se apunta, y un registro con
// huecos no vale para nada.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(RAIZ, "app", "index.html"), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

console.log("── no se enseña una rejilla que no dice nada ──");
ok(/id="card-calendario"[^>]*hidden/.test(app),
   "nace oculto en el HTML");
ok(/if \(!cfg\.fechaPlantacion\) \{ caja\.hidden = true; return; \}/.test(app),
   "y sin fecha de plantación se queda oculto: sin ciclo no hay ni madurez ni contrafactual");

console.log("\n── las tres capas salen de donde tienen que salir ──");
ok(/function diasQueKyliaPedia/.test(app) && /MOTOR\.simularKylia/.test(app),
   "los días que el cultivo pedía agua usan el MISMO contrafactual que el reveal");
ok(/const dias = new Set\(\);[\s\S]{0,200}p\.acum_l_m2 > previo/.test(app),
   "y se deducen de los saltos del acumulado, no de una regla escrita aparte");
ok(/riegos\.map\(r => r\.date\)/.test(app) && /aplicaciones\.map\(a => a\.date\)/.test(app),
   "los riegos y las aplicaciones vienen del estado que ya lleva la app");
ok(/window\.__madurez/.test(app) && /renderCalendario\(\)/.test(app.slice(app.indexOf("window.__madurez"))),
   "la ventana de madurez se reaprovecha de la consulta que ya hace la tarjeta, sin pedirla otra vez");

console.log("\n── apuntar lo de ayer cuesta lo mismo que lo de hoy ──");
ok(/function abrirModalRiego\(fecha = null\)/.test(app),
   "el modal de riego acepta una fecha");
ok(/data-cal-dia="\$\{f\}"/.test(app),
   "cada día tocable lleva su fecha en el propio botón");
ok(/abrirModalRiego\(btn\.dataset\.calDia\)/.test(app),
   "y al tocarlo se abre el registro con esa fecha");
ok(/riegoPendiente = fecha && fecha <= hoy \? fecha : hoy/.test(app),
   "nunca por delante de hoy: esto registra lo que pasó, no lo que va a pasar");
// Apuntar un riego es el gesto MÁS FRECUENTE de la app y pedía tres cosas: la
// cantidad en L/m² (justo el número que nadie sabe), la franja del día (que no
// decide nada) y la duración. Ahora es un toque, y lo que se apunta sale de lo
// que ya sabemos.
ok(!/modal-riego-litros/.test(app) && !/modal-riego-franja/.test(app),
   "el formulario de cantidad y franja ya no existe");
ok(/¿Regaste \$\{cuando\}\?/.test(app),
   "queda una confirmación de un toque, para que un roce en el calendario no invente un riego");
ok(/el \$\{formatearFechaCorta\(riegoPendiente\)\}/.test(app),
   "y en un día pasado dice qué día está apuntando, para no equivocarse");

console.log("\n── detalles que se rompen solos si no se fijan ──");
ok(/rej\.dataset\.enganchado/.test(app),
   "los manejadores se enganchan UNA vez por delegación: la rejilla se repinta entera en cada refresco");
ok(/getElementById\("cal-sig"\)\.disabled = futuroMes\(\)/.test(app),
   "el botón de mes siguiente se apaga en el mes actual");
ok(/\(d\.getDay\(\) \+ 6\) % 7/.test(app),
   "la semana empieza en lunes, no en domingo");
const refr = app.slice(app.indexOf("function refrescarTrasCambioRiego"));
ok(/renderCalendario\(\)/.test(refr.slice(0, 400)),
   "se repinta al registrar o borrar un riego");
ok((app.match(/renderCalendario\(\)/g) || []).length >= 5,
   `y en los demás puntos donde cambian los datos (${(app.match(/renderCalendario\(\)/g) || []).length} llamadas)`);

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
