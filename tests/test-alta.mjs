// Los dos primeros minutos de alguien que no ha visto Kylia nunca.
//   node tests/test-alta.mjs
//
// El onboarding anterior era el panel de configuración: aterrizabas en la app y
// te buscabas la vida. Este pregunta una cosa cada vez, todo a un toque, y no
// menciona caudal, mapa, cuenta ni "configuración" — eso es vocabulario nuestro.
//
// LO QUE HACE QUE FUNCIONE NO ES LA INTERFAZ. Si preguntas "¿cuándo plantaste?"
// y no siembras ningún riego anterior, el balance arranca en la plantación y
// acumula tres semanas de evaporación: el primer aviso diría SIEMPRE "riega".
// Probado. Y usar el caudal por defecto de la tabla tampoco arregla nada: con
// los 4 mm/h del goteo salen 2 mm por riego contra ~87 mm de demanda, y vuelve
// a decir siempre "riega".
//
// Se deduce de un hecho que sí tenemos: SU CULTIVO ESTÁ VIVO. Quien lleva tres
// semanas regando cada dos días y tiene la planta en pie cubre, más o menos, lo
// que la planta gasta. De ahí sale la lámina de los riegos sembrados — y de
// paso, su caudal, sin habérselo preguntado.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
const alta = app.slice(app.indexOf("// ── El alta: los dos primeros minutos"),
                       app.indexOf("// ── Borrar la cuenta ──"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

console.log("── aparece solo para quien no tiene nada ──");
ok(/const sinCampo = !localStorage\.getItem\("kylia_config"\);/.test(alta),
   "el criterio es si se guardó algo ALGUNA VEZ, no lo que diga cfg");
ok(/`cfg` arranca con valores por defecto/.test(alta),
   "y queda escrito el porqué: cfg trae un cultivo por defecto y miraría mal a todo el mundo");
ok(/!params\.has\("acceso"\)/.test(alta),
   "quien viene de su enlace de correo no pasa por el alta");
ok(/const forzada = params\.get\("alta"\) === "1";/.test(alta),
   "?alta=1 la abre siempre: sin eso solo se puede ver una vez por dispositivo, y es la pantalla que más falta hace repasar");

console.log("\n── seis pantallas, una pregunta cada vez ──");
for (const n of [0,1,2,3,4,5]) ok(new RegExp(`data-paso="${n}"`).test(app), `existe la pantalla ${n}`);
// Ojo: la copia SÍ menciona la palabra "caudales", pero para decir que no hacen
// falta. Lo que se comprueba es que no se le PIDA ninguno.
const pantallas = app.slice(app.indexOf('id="alta"'), app.indexOf('id="gate"'));
ok(!/mm\/h/.test(pantallas) && !/data-caudal/.test(pantallas),
   "no se le pide ningún caudal ni se le enseña un mm/h en toda el alta");
ok(/No hace falta que sepas litros ni caudales/.test(pantallas),
   "y se le dice explícitamente que no hace falta que lo sepa");
ok(/data-cultivo="calabacin"/.test(app) && /data-cultivo="brassica"/.test(app),
   '"Otro" no es un callejón sin salida: despliega los cultivos que el motor sí conoce');

console.log("\n── el correo, al final ──");
const iEmail = app.indexOf('id="alta-email"'), iVeredicto = app.indexOf('id="alta-veredicto"');
ok(iEmail > iVeredicto && iVeredicto > 0,
   "se pide DESPUÉS de enseñar el primer aviso, no antes");
ok(/id="alta-saltar"/.test(app), "y se puede saltar: se sigue mirando sin dejarlo");

console.log("\n── la siembra del historial, que es lo que lo hace funcionar ──");
ok(/function sembrarHistorial/.test(alta), "existe");
// Dentro de primerAviso, no en todo el bloque: la función se DEFINE antes, y
// buscarla suelta encontraría la definición en vez de la llamada.
const primer = alta.slice(alta.indexOf("async function primerAviso"));
ok(primer.indexOf("await cargarET0()") < primer.indexOf("sembrarHistorial()"),
   "se siembra DESPUÉS de tener el clima: la lámina sale de la ETc real, no de una tabla");
ok(/SU CULTIVO ESTÁ VIVO/.test(alta),
   "y el razonamiento está escrito donde se usa");
ok(/neto \+= MOTOR\.kcDelDia\(A\.cultivo, dias\) \* \(d\.et0 \?\? 0\)/.test(alta),
   "la ETc se calcula con el mismo motor que todo lo demás");
ok(/if \(ll >= MOTOR\.PE_MIN_MM\) neto -= ll;/.test(alta),
   "y se descuenta la lluvia que llegó a infiltrar");
ok(/estimado: true/.test(alta),
   "los riegos sembrados van marcados: no son un registro real y no se disfrazan de tal");

console.log("\n── el primer aviso sigue a los días desde su último riego, no a una lámina inventada ──");
// Con lámina plana el residuo quedaba por encima del umbral y el primer aviso
// salía "RIEGA" en 14 de 16 casos probados, incluso diciendo que regó HOY: el
// consejo era una constante disfrazada de cálculo.
ok(/litros: i === fechas\.length - 1 \? null : lamina/.test(alta),
   "el último riego sembrado entra como recarga completa, que es la premisa que dice el comentario");
ok(!/saveConfig\(\{ \.\.\.cfg, caudal \}\)/.test(alta),
   "y NO se escribe un caudal deducido: no es una medida, es la suposición despejada");
ok(/se mide con un cubo/.test(alta),
   "queda dicho dónde sale de verdad el caudal");

console.log("\n── se le habla en su unidad, no en la nuestra ──");
ok(/como los que haces normalmente/.test(alta),
   "el consejo es 'un riego como los que haces', no una lámina en mm");
ok(/unos \$\{A\.minutos\} minutos/.test(alta) || /rato/.test(alta),
   "y se expresa en los minutos que él ya usa");
ok(/Calculado con la rutina que nos has contado/.test(alta),
   "con una línea honesta de dónde sale el número");

console.log("\n── una pregunta cada vez, también dentro de un paso ──");
// El primer intento soltaba las cuatro preguntas del riego de golpe: en un móvil
// es un muro que obliga a desplazarse antes de haber contestado nada, y contradice
// lo único que se le prometió al agricultor ("dos minutos, una pregunta cada vez").
for (const id of ["alta-q-cuando", "alta-q-cada", "alta-q-rato", "alta-q-ultimo"])
  ok(new RegExp(`id="${id}" hidden`).test(app), `${id} arranca oculto`);
ok(/const tras1 = \(\) => \{ revelar\("alta-q-cuando"\); revisar1\(\); \};/.test(alta),
   "elegir cultivo destapa el cuándo");
ok(/revelar\("alta-q-cada"\)/.test(alta), "elegir método destapa el cada cuánto");
ok(/grupo\("alta-cada", "cada", "cada", \(\) => \{ revelar\("alta-q-rato"\)/.test(alta),
   "el cada cuánto destapa el rato");
ok(/grupo\("alta-rato", "min", "minutos", \(\) => \{ revelar\("alta-q-ultimo"\)/.test(alta),
   "y el rato destapa el ancla del último riego");
// `hidden` es una regla del navegador con specificity 0: sin esto, .alta-chips
// {display:flex} la pisaba y los cultivos de "Otro" salían sin pulsar nada.
ok(/\.alta \[hidden\] \{ display: none !important; \}/.test(app),
   "[hidden] gana a las clases con display dentro del alta");
ok(/\.alta-paso > \.alta-preg:first-of-type \{ margin-top: 0; \}/.test(app),
   "solo la primera pregunta DEL PASO pierde el margen (si no, cada una se pega a los chips de arriba)");

console.log("\n── el alta se pinta por encima de la app, no debajo ──");
// Con z-index 60 el mapa de Leaflet y los botones flotantes se pintaban encima:
// el gate está en 9999 y los modales en 9998.
ok(/\.alta \{[\s\S]{0,400}z-index: 10000;/.test(app), "el alta está por encima del gate y de los modales");
ok(/body\.alta-abierta \.fab-soporte/.test(app), "y los botones flotantes se esconden mientras está abierta");

console.log("\n── V1 · el lugar va primero, y por un motivo ──");
// El lugar dispara SoilGrids, Open-Meteo y (más adelante) SIGPAC. Pidiéndolo
// antes que el cultivo, esas consultas viajan mientras el agricultor sigue
// contestando y el paso 2 encuentra las respuestas puestas. Al revés, la
// pantalla de descubrimiento sería una pantalla de carga.
const paso = n => {
  const i = app.indexOf(`data-paso="${n}"`);
  const j = app.indexOf("</section>", i);
  return i < 0 ? "" : app.slice(i, j);
};
ok(/¿Dónde está el cultivo\?/.test(paso(1)), "el paso 1 es el lugar");
ok(/¿Qué tienes plantado ahora\?/.test(paso(3)), "y el cultivo baja al 3");
ok(/¿Cómo riegas normalmente\?/.test(paso(4)), "el riego al 4");
ok(/alta-veredicto/.test(paso(5)), "el primer aviso al 5");
ok(/alta-email/.test(paso(6)), "y el correo al 6");
ok(/\[0,1,2,3,4,5,6\]/.test(alta), "los puntos de progreso cuentan siete pantallas");

console.log("\n── ninguna flecha 'atrás' apunta a donde no debe ──");
// Un data-ir mal renumerado no da error: te manda a otra pantalla y parece
// un fallo de diseño. Se comprueba la cadena entera.
for (const [p, atras] of [[1, 0], [2, 1], [3, 2], [4, 3]])
  ok(new RegExp(`class="alta-atras" data-ir="${atras}"`).test(paso(p)),
     `el atrás del paso ${p} vuelve al ${atras}`);
ok(/id="alta-b2" disabled data-ir="2"/.test(app), "el lugar sigue al descubrimiento");
ok(/id="alta-b1" disabled data-ir="4"/.test(app), "el cultivo sigue al riego");
ok(/guardarAlta\(\); ir\(5\)/.test(alta), "el riego lleva al primer aviso");
ok(/\$\("alta-b4"\)\?\.addEventListener\("click", \(\) => ir\(6\)\)/.test(alta),
   "y el 'Entendido' de reserva lleva al correo, no a la pantalla vieja");

console.log("\n── la pantalla de descubrimiento no pregunta nada ──");
ok(/data-paso="2"/.test(app) && /Esto es lo que ya sabemos de tu zona/.test(app),
   "existe y se llama por lo que es");
ok(!/alta-chip/.test(paso(2)), "no tiene ni un chip: no se le pide nada");
ok(/if \(n === 2\) pintarDescubrimiento\(\);/.test(alta), "se pinta al entrar");
ok(/\.finally\(pintarDescubrimiento\)/.test(alta),
   "y también cuando responde cada consulta, así que da igual el orden de llegada");
ok(/A\.descSuelo = A\.descClima = null;/.test(alta),
   "al cambiar de punto se limpia lo anterior: no se enseña el suelo del pueblo de al lado");

console.log("\n── y no rellena huecos con valores plausibles ──");
ok(/if \(!d\?\.ok \|\| !d\.textura\) return;/.test(alta),
   "sin textura no se guarda nada");
ok(/if \(et0 == null\) return;/.test(alta), "sin ET₀ tampoco");
ok(/No hemos podido consultar tu zona ahora mismo/.test(alta),
   "si no llega nada se dice, y se deja seguir");
ok(/se usarán valores medios y se afinan después/.test(alta),
   "diciendo qué pasa entonces");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
