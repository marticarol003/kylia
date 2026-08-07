// La cantidad de riego mira 48 h de pronóstico de lluvia.
//   node tests/test-riego-pronostico.mjs
//
// Antes, la regla llenaba el depósito hasta capacidad de campo y punto. Si al día
// siguiente llovía, el sobrante se perdía por debajo de la raíz llevándose
// nitrógeno — se ve en el propio balance, donde Dr = min(taw, …) recorta el
// exceso y lo tira. Ahora la lluvia que viene se descuenta de la lámina.
//
// El error es ASIMÉTRICO y el diseño lo refleja: retrasar un riego por una lluvia
// que no cae se corrige al día siguiente; regar de menos en agosto con el suelo en
// el umbral, no. Por eso la ventana es de 48 h (no la semana), solo cuenta la
// lluvia (nunca la ET₀ prevista, que sería adelantar agua sobre un pronóstico) y
// hay una guarda que desactiva todo con el suelo casi vacío.
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const MOTOR = require("../assets/js/motor-riego.js");
const { decisionRiego, simularKylia, PE_MIN_MM, VENTANA_PRONOSTICO_DIAS } = MOTOR;
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

// Balance tipo de la cebolleta en agosto: TAW 45, RAW 13, aspersión (efic 0,75).
const bal = (Dr) => ({ Dr, raw: 13, taw: 45, efic: 0.75 });
const lluvia = (...mm) => mm.map(x => ({ lluvia: x }));

console.log("── sin pronóstico, la regla es la de siempre ──");
const sinNada = decisionRiego(bal(22));
ok(sinNada.nivel === "alta" && Math.abs(sinNada.cantidad_l_m2 - 29.3) < 0.1,
   `déficit 22 mm → regar 29,3 L/m² (22 / 0,75)  [${sinNada.cantidad_l_m2}]`);
ok(!/lluvia/.test(sinNada.texto), "y el texto no menciona lluvia que no hay");
ok(decisionRiego(bal(10)).nivel === "media", "por debajo del umbral sigue siendo 'vigilar'");
ok(decisionRiego(bal(2)).nivel === "baja",   "y con el suelo lleno, 'todo en orden'");

console.log("── la lluvia prevista RECORTA la lámina ──");
const recorte = decisionRiego(bal(22), { lluviaPrevista: lluvia(8, 0) });
ok(recorte.nivel === "alta", "sigue tocando regar (8 mm no cubren 22)");
ok(Math.abs(recorte.cantidad_l_m2 - 18.7) < 0.1,
   `pero solo (22 − 8) / 0,75 = 18,7 L/m²  [${recorte.cantidad_l_m2}]`);
ok(/8 mm de lluvia prevista/.test(recorte.texto), "y el texto dice POR QUÉ es menos que ayer");
ok(recorte.lluvia_prevista_mm === 8, "la cifra viaja en la respuesta, no solo en el texto");

console.log("── si la lluvia cubre el déficit, no se riega ──");
const espera = decisionRiego(bal(22), { lluviaPrevista: lluvia(25, 0) });
ok(espera.nivel === "media", "25 mm > 22 mm de déficit → esperar, no regar");
ok(espera.cantidad_l_m2 === null, "sin cantidad: no es un riego pequeño, es ninguno");
ok(/Esperar a la lluvia/.test(espera.texto), "y se dice claramente");

console.log("── guarda 1: con el suelo casi vacío NO se apuesta al pronóstico ──");
// Dr 43 de TAW 45 = el cultivo al límite. Aunque den 50 mm, se riega igual.
const critico = decisionRiego(bal(43), { lluviaPrevista: lluvia(50, 0) });
ok(critico.nivel === "alta", "déficit 43/45 mm: riega aunque el modelo prometa 50 mm");
ok(Math.abs(critico.cantidad_l_m2 - 57.3) < 0.1,
   `y riega el déficit ENTERO, sin descontar  [${critico.cantidad_l_m2}]`);
ok(critico.lluvia_prevista_mm === 0, "el descuento queda anulado, no a medias");

console.log("── guarda 2: la ventana es de 48 h, no la semana ──");
ok(VENTANA_PRONOSTICO_DIAS === 2, "la constante dice 2 días");
const lejos = decisionRiego(bal(22), { lluviaPrevista: lluvia(0, 0, 30, 30) });
ok(lejos.nivel === "alta" && Math.abs(lejos.cantidad_l_m2 - 29.3) < 0.1,
   "30 mm al tercer y cuarto día NO cuentan: se riega entero");

console.log("── guarda 3: la lluvia que no infiltra no cuenta ──");
const chispas = decisionRiego(bal(22), { lluviaPrevista: lluvia(1.5, 1.5) });
ok(Math.abs(chispas.cantidad_l_m2 - 29.3) < 0.1,
   `3 mm en dos chispas de 1,5 (< PE_MIN_MM ${PE_MIN_MM}) no descuentan nada  [${chispas.cantidad_l_m2}]`);
const justo = decisionRiego(bal(22), { lluviaPrevista: lluvia(2, 0) });
ok(Math.abs(justo.cantidad_l_m2 - 26.7) < 0.1, "2 mm clavados sí infiltran (el umbral es >=)");

console.log("── el pronóstico NO entra en el contrafactual del reveal ──");
// simularKylia reconstruye lo que Kylia habría dicho cada día del piloto. Si le
// diéramos la lluvia YA OBSERVADA de los días siguientes, no sería un pronóstico:
// sería adivinar el futuro. El ahorro publicado saldría inflado y no sería
// defendible. Se queda con la regla de siempre, a propósito.
const serie = Array.from({ length: 10 }, (_, i) => ({
  date: `2026-08-${String(i + 1).padStart(2, "0")}`, et0: 5, lluvia: i === 5 ? 30 : 0,
}));
const sim = simularKylia(serie, { suelo: "franco", cultivoId: "cebolla",
                                  metodoRiego: "aspersion", fechaPlantacion: "2026-06-24" });
ok(sim.total > 0, "simularKylia sigue funcionando");
const fuente = readFileSync(join(RAIZ, "assets", "js", "motor-riego.js"), "utf8");
const cuerpoSim = fuente.slice(fuente.indexOf("function simularKylia"));
ok(!/lluviaPrevista/.test(cuerpoSim.slice(0, cuerpoSim.indexOf("return {"))),
   "y NO consulta lluviaPrevista: el reveal no puede ver el futuro");

console.log("── quién pasa el pronóstico y quién no ──");
const campo = readFileSync(join(RAIZ, "api", "campo.js"), "utf8");
ok(/decisionRiego\(balHoy, \{ lluviaPrevista: serie\.slice\(corte \+ 1\) \}\)/.test(campo),
   "campo.js (vista de hoy, y el correo del padre) sí lo pasa");
const diarioB = readFileSync(join(RAIZ, "api", "diario-b.js"), "utf8");
ok(/forecast_days=1/.test(diarioB) && !/lluviaPrevista/.test(diarioB),
   "diario-b NO: congela la decisión del piloto con la misma regla con la que se publicó el reveal");

console.log("── la app mira la misma ventana que el servidor ──");
const app = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
ok(/past_days=\$\{past\}&forecast_days=1/.test(app),
   "app/index.html incluye HOY en el balance (con forecast_days=0 se dejaba ~5 mm)");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
