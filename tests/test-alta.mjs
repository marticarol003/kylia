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
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const leer = (...q) => readFileSync(join(RAIZ, ...q), "utf8");
const app = leer("app", "index.html");
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
// Sigue siendo el respaldo cuando no hay caudal; con caudal se calcula (ver más
// abajo, "con caudal no se supone"). Antes era la única vía.
ok(/i === fechas\.length - 1 \? null : lamina/.test(alta),
   "sin caudal, el último riego sembrado entra como recarga completa: es la premisa que dice el comentario");
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
ok(/alta-email/.test(paso(7)), "y el correo al 7 (el 6 es el del abonado, añadido después)");
// (el recuento definitivo se comprueba más abajo, con el paso del abonado ya dentro)

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
// Nació sin preguntas, y ahora tiene exactamente UNA: la de la superficie
// cultivada, que es la que evita multiplicar los kg de abonado. Cualquier otra
// que aparezca aquí es alcance colándose.
const chips2 = (paso(2).match(/class="alta-chips" id="([\w-]+)"/g) || []);
ok(chips2.length === 1 && /alta-cultivada/.test(chips2[0]),
   "una sola pregunta, y es la de la superficie cultivada");
ok(/if \(n === 2\) pintarDescubrimiento\(\);/.test(alta), "se pinta al entrar");
ok(/\.finally\(pintarDescubrimiento\)/.test(alta),
   "y también cuando responde cada consulta, así que da igual el orden de llegada");
ok(/A\.descSuelo = A\.descClima = A\.descRecinto = null;/.test(alta),
   "al cambiar de punto se limpia lo anterior: no se enseña el suelo ni el recinto del pueblo de al lado");

console.log("\n── y no rellena huecos con valores plausibles ──");
ok(/if \(!d\?\.ok \|\| !d\.textura\) return;/.test(alta),
   "sin textura no se guarda nada");
ok(/if \(et0 == null\) return;/.test(alta), "sin ET₀ tampoco");
ok(/No hemos podido consultar tu zona ahora mismo/.test(alta),
   "si no llega nada se dice, y se deja seguir");
ok(/se usarán valores medios y se afinan después/.test(alta),
   "diciendo qué pasa entonces");

console.log("\n── V1 · SIGPAC da el recinto, NO la superficie cultivada ──");
// Es la corrección grave de la propuesta. En horticultura pequeña un bancal de
// 440 m² vive dentro de un recinto que puede tener hectáreas, y el plan de
// abonado escala LINEALMENTE con la superficie: dar el recinto por cultivado
// multiplica los kg de nitrógeno por el mismo factor que te has equivocado.
ok(/\/api\/sigpac\?lat=\$\{A\.lat/.test(alta), "el alta pide el recinto en cuanto tiene el punto");
ok(/A\.descRecinto = \{ geometria: d\.parcela, superficie_m2: d\.superficie_m2/.test(alta),
   "y lo guarda aparte, sin tocar la superficie de la parcela");
ok(/superficie oficial/.test(app) && /Recinto de \$\{A\.descRecinto\.superficie_m2/.test(alta),
   "se enseña etiquetado como recinto, no como 'tu campo'");
ok(/id="alta-cultivada"/.test(app) && /¿Cultivas todo el recinto o solo una parte\?/.test(app),
   "y SIEMPRE se pregunta si cultiva todo o una parte");
ok(/\$\("alta-q-cultivada"\)\.hidden = !A\.descRecinto;/.test(alta),
   "la pregunta solo sale si hay recinto: sin él no hay nada que confirmar");

console.log("\n── lo que se guarda es la superficie CULTIVADA ──");
ok(/areaParcela: A\.areaCultivada \?\? cfg\.areaParcela \?\? null/.test(alta),
   "areaParcela sale de lo confirmado, nunca del recinto directamente");
ok(/parcela: A\.descRecinto\?\.geometria/.test(alta),
   "la geometría del recinto sí se usa: es la que hace que el satélite mida dentro y no en un punto");
ok(/A\.areaCultivada = A\.descRecinto\?\.superficie_m2 \?\? null;/.test(alta),
   "'todo' toma la superficie oficial");
ok(/A\.areaCultivada = null;/.test(alta) && /\$\("alta-parte"\)\.hidden = todo;/.test(alta),
   "'una parte' la borra y pide los metros");
ok(/const pasa = v > 0 && \(!techo \|\| v <= techo\);/.test(alta),
   "no se acepta cultivar más metros que el recinto entero");
ok(/No puedes cultivar más que eso/.test(alta), "y se dice, en vez de guardarlo callando");

console.log("\n── la regla dura, comprobada contra el motor real ──");
// Sin superficie confirmada NO debe salir plan de abonado. No hace falta añadir
// ninguna comprobación nueva: el motor ya se comporta así, y esto lo fija para
// que nadie lo 'arregle' poniendo un área por defecto.
const NUTRI = require(join(RAIZ, "api", "_motor-nutricion.js"));
const REND  = require(join(RAIZ, "api", "_rendimiento.js"));
const oferta = { N: 30, P2O5: null, K2O: null };
const sinArea = NUTRI.necesidadNutrientes("lechuga",
  REND.rendimientoEsperadoT("lechuga", null, {})?.rendimiento_t, oferta, { area_m2: null });
ok(!!sinArea.motivo && /rendimiento esperado/i.test(sinArea.motivo),
   "sin superficie no hay rendimiento y por tanto no hay plan de abonado");
const conArea = NUTRI.necesidadNutrientes("lechuga",
  REND.rendimientoEsperadoT("lechuga", 440, {})?.rendimiento_t, oferta, { area_m2: 440 });
ok(!conArea.motivo && conArea.nutrientes?.N != null,
   "y con ella sí, sin haber cambiado nada del motor");

console.log("\n── V1 · con caudal no se supone: se calcula ──");
// "Recarga completa" es razonable en superficie y aspersión, pero en GOTEO es
// falsa: el goteo repone poco y a menudo, y un riego típico no llena la zona
// radicular. Suponer que sí infravalora el déficit y retrasa el primer aviso.
ok(/const mmPorRiego = \(caudal > 0 && Number\(A\.minutos\) > 0\)/.test(alta),
   "con caudal y rato se calculan los milímetros de cada riego");
ok(/Math\.round\(caudal \* \(Number\(A\.minutos\) \/ 60\) \* 10\) \/ 10/.test(alta),
   "caudal × rato, sin más magia");
ok(/litros: mmPorRiego != null/.test(alta) && /: \(i === fechas\.length - 1 \? null : lamina\)/.test(alta),
   "y la recarga completa queda como respaldo de cuando NO se sabe el caudal");
ok(/en goteo es FALSA/.test(alta),
   "el sesgo de esa suposición queda escrito donde se toma, no en un documento aparte");

console.log("\n── el caudal se ofrece, nunca se exige ──");
// Condición del usuario: no puede bloquear el alta. Quien lo sepa lo pone,
// quien no, sigue y lo mide luego.
ok(/id="alta-q-caudal" hidden/.test(app), "nace oculto");
ok(/¿Sabes cuánta agua echa tu riego\?/.test(app), "y se pregunta antes de pedir el número");
ok(/No, ya lo mediré/.test(app), "con salida explícita");
const rev3 = alta.slice(alta.indexOf("function revisar3()"), alta.indexOf("function revisar3()") + 220);
ok(!/caudal/i.test(rev3),
   "revisar3 NO mira el caudal: el botón de seguir se enciende sin él");
ok(/const pasa = v > 0\.5 && v < 80;/.test(alta),
   "mismo rango de credibilidad que el cálculo por geometría");
ok(/Ese número no es creíble para un riego/.test(alta),
   "un disparate se rechaza y se dice");
ok(/caudal: A\.caudal \?\? cfg\.caudal \?\? null/.test(alta),
   "solo se guarda si lo ha declarado él");

console.log("\n── la aritmética del sembrado, con el motor real ──");
// Réplica: lechuga de 21 días en franco, goteo cada 2 días, 30 min.
// Con 10,9 mm/h son 5,45 mm por riego contra una ETc que pide más: el balance
// tiene que ENSEÑAR ese déficit, no taparlo.
const MOT = require(join(RAIZ, "assets", "js", "motor-riego.js"));
const hoyD = new Date();
const isoD = d => new Date(hoyD.getTime() - d * 86400000).toISOString().slice(0, 10);
const clima = []; for (let d = 21; d >= 0; d--) clima.push({ date: isoD(d), et0: 4.6, lluvia: 0, tmax: 28, tmin: 16 });
const fechas = []; for (let d = 21; d >= 3; d -= 2) fechas.push(isoD(d));
const balanceCon = (litros) => MOT.balanceHidrico(clima, fechas.map(f => ({ date: f, litros })),
  { suelo: "franco", cultivoId: "lechuga", metodoRiego: "goteo", fechaPlantacion: isoD(21) });
const real = balanceCon(10.9 * 0.5);
ok(real.Dr > real.raw,
   `con 5,5 mm por riego el déficit (${real.Dr.toFixed(1)}) supera el umbral (${real.raw.toFixed(1)}): la rutina se queda corta y se ve`);
const supuesto = MOT.balanceHidrico(clima,
  fechas.map((f, i) => ({ date: f, litros: i === fechas.length - 1 ? null : 6.8 })),
  { suelo: "franco", cultivoId: "lechuga", metodoRiego: "goteo", fechaPlantacion: isoD(21) });
ok(supuesto.Dr < real.Dr,
   `y la suposición de recarga completa da menos déficit (${supuesto.Dr.toFixed(1)}): por eso conviene medir`);

console.log("\n── V1 · las dos preguntas que le faltan al abonado ──");
// Sin ellas el crédito de residuos del método MAPA es 0 y se abona de más.
// Van DESPUÉS del primer aviso a propósito: ahí ya ha visto para qué sirve
// Kylia, así que dos preguntas más se las ha ganado.
ok(/data-paso="6"/.test(app) && /¿Qué había plantado antes en este campo\?/.test(app),
   "se pregunta el cultivo anterior");
ok(/Cuando lo quitaste, ¿los restos se quedaron en la tierra\?/.test(app),
   "y si los restos se incorporaron, que es lo que condiciona el crédito");
ok(/id="alta-saltar-abonado"/.test(app) && /No me acuerdo, seguir/.test(app),
   "con salida: no bloquea el alta");
ok(/\[0,1,2,3,4,5,6,7\]/.test(alta), "los puntos cuentan ocho pantallas");

console.log("\n── los ocho cultivos coinciden con la tabla del motor ──");
// Si el alta ofreciera uno que el motor no conoce, el crédito saldría 0 sin
// que nadie se entere. Se comparan las dos listas de verdad.
const NUTRI2 = require(join(RAIZ, "api", "_motor-nutricion.js"));
const ofrecidos = [...app.matchAll(/data-ant="(\w+)"/g)].map(m => m[1]);
const conocidos = Object.keys(NUTRI2.N_RESIDUOS_KG_HA);
ok(ofrecidos.length === conocidos.length,
   `se ofrecen ${ofrecidos.length} cultivos y el motor conoce ${conocidos.length}`);
ok(ofrecidos.every(c => conocidos.includes(c)),
   "y todos los ofrecidos están en N_RESIDUOS_KG_HA: ninguno daría crédito 0 por despiste");

console.log("\n── viaja por la ruta que ya existía ──");
// Descubrimiento al implementarlo: campo.js YA llamaba a creditoResiduosN con
// esas dos columnas, y /api/log ya las validaba. No faltaba backend — faltaba
// que alguien las preguntara desde /app.
const log = leer("api", "log.js");
ok(/cultivo_anterior:\s+siViene\("cultivo_anterior", CULTIVOS_ANT\.has/.test(log),
   "/api/log ya valida el cultivo anterior contra su lista");
ok(/restos_incorporados:\s+siViene\("restos_incorporados"/.test(log),
   "y ya acepta los restos");
const campoJs = leer("api", "campo.js");
ok(/creditoResiduosN\(u\.cultivo_anterior \|\| null, !!u\.restos_incorporados\)/.test(campoJs),
   "y campo.js ya calcula el crédito con ellas: no ha hecho falta tocarlo");
ok(/registroUsuario\(\{\n\s+cultivo_anterior:\s+A\.cultivoAnterior/.test(alta),
   "el alta las manda por registroUsuario, que es lo que escribe las COLUMNAS");
ok(/restos_incorporados: A\.restos === "1"/.test(alta),
   "los restos van como booleano, que es lo que espera el motor");
ok(/if \(!A\.cultivoAnterior \|\| A\.restos == null\) return;/.test(alta),
   "y si las saltó no se manda nada: mejor sin crédito que con uno inventado");

console.log("\n── el crédito, con el motor real ──");
const credito = NUTRI2.creditoResiduosN("pimiento", true);
ok(credito > 0, `un pimiento anterior con restos enterrados da ${credito} kg N/ha de crédito`);
ok(NUTRI2.creditoResiduosN("pimiento", false) === 0,
   "y retirados no da ninguno, que es la condición que pone MAPA");
ok(NUTRI2.creditoResiduosN(null, true) === 0,
   "sin cultivo anterior tampoco se inventa");

console.log("\n── V1 · el perfil dice lo que Kylia SABE, no lo que acierta ──");
// Condición del usuario: el porcentaje no puede leerse como precisión.
ok(/Lo que Kylia sabe de tu campo/.test(alta), "el título habla de saber, no de acertar");
ok(/No es un porcentaje de acierto/.test(alta), "y se desmiente explícitamente");
ok(!/precisi[óo]n/i.test(alta.slice(alta.indexOf("function pintarPerfil"), alta.indexOf("// ── paso 6"))),
   "la palabra 'precisión' no aparece en ninguna parte del perfil");
// El CSS del perfil, solo. Las barras son sobrias a propósito: un "78%" en
// tamaño titular se lee como precisión por mucho que la nota lo desmienta.
const cssPerfil = app.slice(app.indexOf(".alta-perfil {"), app.indexOf(".perfil-nota"));
ok(/\.perfil-pct[^}]*font-size: \.9rem/.test(cssPerfil),
   "el porcentaje va al tamaño del texto, no de titular");
ok(!/font-size: *[2-9](\.\d+)?rem/.test(cssPerfil), "no hay ningún número gigante en el perfil");
ok(/Es cuánto conoce Kylia de tu campo/.test(alta), "se explica qué significa de verdad");

console.log("\n── por pilares, no un número global ──");
ok(/completitud\("riego"\)/.test(alta) && /completitud\("abonado"\)/.test(alta),
   "riego y abonado van por separado: quien solo quiere riego puede estar completo con el abonado a cero");
ok(/const BLOQUEANTES = new Set/.test(alta) && /falta lo esencial/.test(alta),
   "sin un dato bloqueante no se da porcentaje: un número alto con un agujero crítico invita a confiar");
ok(/\(y\.peso \* y\.hueco\) - \(x\.peso \* x\.hueco\)/.test(alta),
   "el 'siguiente dato' es el que más desbloquea, no el que más pesa en abstracto");

console.log("\n── el peso del caudal, corregido con medidas ──");
// En la propuesta le puse 5 diciendo que "solo sirve para pasar de milímetros a
// minutos". Es falso: sin él el último riego se supone recarga completa, y esa
// suposición cambia el veredicto en 16 de 48 combinaciones probadas (33%).
const pesos = alta.slice(alta.indexOf("const PESOS = {"), alta.indexOf("const TIENE_EXTRA"));
const pesoDe = k => Number((pesos.match(new RegExp(`\\["${k}",\\s*(\\d+)`)) || [])[1]);
ok(pesoDe("caudal") === 15, `el caudal pesa ${pesoDe("caudal")}, no 5`);
ok(pesoDe("caudal") >= pesoDe("metodoRiego") + pesoDe("riegoMinutos"),
   "y pesa más que el método y el rato juntos");
ok(/flipa el veredicto en 16 de 48 casos probados/.test(pesos),
   "con la medida al lado, no 'porque sí'");
ok(/criterio:/.test(pesos),
   "y lo que NO se ha podido medir va marcado como criterio, para que se note la diferencia");

console.log("\n── los pesos suman 100 en los dos pilares ──");
// Si no suman, el porcentaje deja de ser interpretable.
for (const pilar of ["riego", "abonado"]) {
  const ini = pesos.indexOf(pilar + ": [");
  const bloque = pesos.slice(ini, pesos.indexOf("\n          ]", ini));
  const suma = [...bloque.matchAll(/",\s*(\d+),/g)].reduce((t, m) => t + Number(m[1]), 0);
  ok(suma === 100, `${pilar}: los pesos suman ${suma}`);
}

console.log("\n── la comprobación que respalda ese 15 ──");
// Se rehace aquí con el motor: sembrar con el agua REAL (caudal × rato) frente
// a suponer recarga completa cambia el veredicto en un tercio de los casos.
const MOT2 = require(join(RAIZ, "assets", "js", "motor-riego.js"));
const h2 = new Date(), i2 = d => new Date(h2.getTime() - d * 86400000).toISOString().slice(0, 10);
let distintos = 0, casos = 0;
for (const [cult, edad, et0] of [["lechuga", 21, 4.6], ["tomate", 45, 5.2], ["cebolla", 60, 4.2], ["pimiento", 50, 5.0]])
  for (const cada of [2, 3]) for (const cau of [5.4, 10.9, 15]) for (const min of [30, 60]) {
    const cl = []; for (let d = edad; d >= 0; d--) cl.push({ date: i2(d), et0, lluvia: 0, tmax: 28, tmin: 16 });
    const fs2 = []; for (let d = edad; d >= cada; d -= cada) fs2.push(i2(d));
    const o = { suelo: "franco", cultivoId: cult, metodoRiego: "goteo", fechaPlantacion: i2(edad) };
    const con = MOT2.balanceHidrico(cl, fs2.map(f => ({ date: f, litros: Math.round(cau * (min / 60) * 10) / 10 })), o);
    let neto = 0; for (const d of cl) neto += MOT2.kcDelDia(cult, MOT2.diasEntre(i2(edad), new Date(`${d.date}T12:00:00`))) * d.et0;
    const lam = Math.max(1, Math.round((neto / fs2.length / MOT2.EFIC_RIEGO.goteo) * 10) / 10);
    const sin = MOT2.balanceHidrico(cl, fs2.map((f, k) => ({ date: f, litros: k === fs2.length - 1 ? null : lam })), o);
    casos++; if ((con.Dr > con.raw) !== (sin.Dr > sin.raw)) distintos++;
  }
ok(distintos / casos > 0.25,
   `conocer el caudal cambia el veredicto en ${distintos} de ${casos} casos (${Math.round(100 * distintos / casos)}%): no es solo pasar mm a minutos`);

console.log("\n── el punto exacto del campo, no el del pueblo ──");
// Buscar por municipio deja el punto en el centro del pueblo, y el GPS dice
// dónde ESTÁ él, que en un alta suele ser su casa. Con cualquiera de los dos,
// el recinto de SIGPAC que sale puede ser de otro y el satélite mide tejados.
ok(/id="alta-mapa"/.test(app) && /Toca dónde está tu campo/.test(app),
   "hay un mapa para tocar la parcela");
ok(/cargarLeaflet\(\)\.then/.test(alta),
   "reutiliza el cargador de Leaflet que ya existía, con su SRI");
ok(/World_Imagery/.test(alta) && /openstreetmap/.test(alta),
   "y el mismo tile de satélite con su caída a OSM");
ok(/mapaAlta\.on\("click", ev => fijarPunto\(ev\.latlng\.lat, ev\.latlng\.lng\)\)/.test(alta),
   "tocar el mapa fija el punto");
ok(/A\.puntoExacto = true;/.test(alta), "y lo marca como exacto");
ok(/invalidateSize/.test(alta),
   "se invalida el tamaño: Leaflet mide mal si el contenedor estaba oculto al crearse");
ok(/No hemos podido cargar el mapa/.test(alta) && /el riego funciona igual/.test(alta),
   "si Leaflet no carga no se bloquea a nadie, y se dice qué se pierde");

console.log("\n── el recinto SOLO con el punto tocado ──");
ok(/function pedirRecinto\(\) \{\n\s+if \(!A\.puntoExacto\) return;/.test(alta),
   "sin punto exacto no se pide SIGPAC: con el centro del pueblo saldría un recinto que no es suyo");
ok(/A\.descRecinto = null;\n\s+A\.areaCultivada = null;/.test(alta),
   "y al mover el punto se tira el recinto anterior Y su superficie: son de otra parcela");
ok(/if \(recintoPedido === clave\) return;/.test(alta),
   "no se repite la consulta si el punto no ha cambiado");

console.log("\n── el avance se ve durante todo el alta ──");
ok(/id="alta-avance"/.test(app), "hay una línea de avance");
ok(/Kylia ya sabe el <b>\$\{c\.pct\}%<\/b> de tu campo/.test(alta),
   "dice lo que Kylia SABE, con el mismo lenguaje que el perfil final");
ok(/if \(paso === 0\) \{ el\.hidden = true; return; \}/.test(alta),
   "en la bienvenida no sale: todavía no hay nada que contar");
ok(/Aquí NO se aplica la regla de "sin dato bloqueante no hay número"/.test(alta),
   "y no se aplica la regla del perfil final: durante el alta faltan cosas por definición");

console.log("\n── y no cuenta los valores por defecto como sabidos ──");
// cfg arranca con Barcelona y "lechuga" puestos. Caer a cfg sin más daba un 40%
// a quien no había contestado nada.
ok(/const previo = localStorage\.getItem\(STORAGE_KEY\) \? cfg : \{\};/.test(alta),
   "solo se hereda de cfg si alguna vez se guardó algo");
const defs = app.slice(app.indexOf("const DEFAULTS = {"), app.indexOf("const NDVI_HISTORY_DAYS"));
ok(/ciudad:\s+"Barcelona"/.test(defs) && /cultivos:\s+\["lechuga"\]/.test(defs),
   "(los defaults que lo provocaban siguen ahí, así que el guard hace falta)");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
