// El campo visto desde arriba, en la pantalla principal.
//   node tests/test-mapa-campo.mjs
//
// Hasta ahora la parcela solo se veía dentro de Ajustes, que es donde se
// CONFIGURA, no donde se mira. Y con varios cultivos el selector de pestañas
// obliga a acordarse de cuál es cuál por el nombre: "Lechuga · 400 m²" no dice
// cuál de los dos bancales es.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(RAIZ, "app", "index.html"), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

console.log("── la tarjeta existe y no aparece vacía ──");
ok(/id="card-mapa"[^>]*hidden/.test(app), "nace oculta");
ok(/if \(!lista\.length\) \{ caja\.hidden = true; return; \}/.test(app),
   "sin ningún contorno guardado no se enseña un mapa vacío");
ok(/\.catch\(\(\) => \{ caja\.hidden = true; \}\)/.test(app),
   "y si Leaflet no carga, tampoco: se esconde en vez de dejar un hueco gris");

console.log("── reutiliza lo que ya había ──");
ok(/cargarLeaflet\(\)\.then/.test(app.slice(app.indexOf("function pintarMapaCampo"))),
   "el cargador de Leaflet con su SRI");
ok(/parcelasReales\(\)\.filter\(p => p\.geometria\)/.test(app),
   "la lista de parcelas que ya calculaba el selector");
ok(/cambiarZona\(p\.id \|\| null\)/.test(app),
   "y el mismo cambiarZona: el mapa no es un segundo selector, es el mismo");

console.log("── la parcela principal no se pinta encima de sus propios trozos ──");
// Es la finca entera. Con siembras dibujadas, pintarla además mete un polígono
// que se superpone a los otros y se lleva todos los toques.
// La regla vive en parcelasReales() y la comparten el mapa y las acciones del
// día, para que no puedan separarse.
ok(/const conTrozos = todas\.some\(p => p\.id\);/.test(app),
   "se detecta si hay siembras con contorno propio");
ok(/return conTrozos \? todas\.filter\(p => p\.id\) : todas;/.test(app),
   "y entonces la principal se cae");
ok(/En las PESTAÑAS se\n\s+\/\/ queda/.test(app),
   "pero NO de las pestañas: eso es navegación y no se toca");

console.log("── se ve cuál estás mirando sin leer nada ──");
const fn = app.slice(app.indexOf("function pintarMapaCampo"), app.indexOf("function cambiarZona"));
ok(/fillOpacity: esActiva \? 0\.35 : 0\.08/.test(fn), "la activa va rellena y las demás en contorno");
ok(/dashArray: esActiva \? null : "4 4"/.test(fn), "con línea discontinua las inactivas");
ok(/weight: esActiva \? 3 : 2/.test(fn), "y el borde más grueso");
ok(/COLOR_ZONA\[i % COLOR_ZONA\.length\]/.test(fn), "cada cultivo con su color, reutilizable sin desbordar");
ok(/bindTooltip\(p\.etiqueta/.test(fn), "y al tocar dice cuál es");

console.log("── encuadre y tamaño ──");
ok(/fitBounds\(bounds, \{ padding: \[18, 18\] \}\)/.test(fn),
   "encuadra todas las parcelas juntas, no una sola");
ok(/invalidateSize/.test(fn),
   "invalida el tamaño: Leaflet mide mal si el contenedor estaba oculto al crearse");
ok(/scrollWheelZoom: false/.test(fn),
   "el zoom con rueda va apagado: si no, hacer scroll por la pantalla se queda atrapado en el mapa");
ok(/capasCampo\.forEach\(c => mapaCampo\.removeLayer\(c\)\)/.test(fn),
   "al repintar se quitan las capas viejas, o se acumularían en cada cambio de zona");

console.log("── se repinta cuando toca ──");
ok(/pintarMapaCampo\(\);   \/\/ el mapa y las pestañas enseñan lo mismo/.test(app),
   "va enganchado al mismo sitio que el selector: los dos enseñan lo mismo");

console.log("\n── añadir un cultivo arrastrando cuatro esquinas ──");
// No se dibuja de cero: nace un cuadrilátero dentro del recinto y se arrastran
// las esquinas. Arrastrar cuatro puntos se puede hacer con un dedo al sol;
// trazar un contorno cerrado, no.
ok(/id="btn-anadir-cultivo"/.test(app) && /id="editor-cultivo"/.test(app), "hay editor y su botón");
ok(/KyliaGeo\?\.rectanguloCentrado/.test(app),
   "el punto de partida sale de rectanguloCentrado, que ya existía y nace con la forma del recinto");
ok(/KyliaGeo\.moverVertice\(ecGeom, i, \[latlng\.lng, latlng\.lat\]\)/.test(app),
   "cada arrastre pasa por moverVertice, que es quien valida");
ok(/KyliaGeo\.areaM2/.test(app), "y el área sale de areaM2, no de una cuenta nueva");

console.log("\n── el contorno no puede cruzarse consigo mismo ──");
// Una \"pajarita\" tiene un área que NO es la del terreno, y esa cifra acaba en
// los kg de abono. Se rechaza el movimiento; no se corrige por detrás.
ok(/tirador\.setLatLng\(\[a\[1\], a\[0\]\]\)/.test(app),
   "si el vértice cruza un lado, vuelve donde estaba");
ok(/Ese punto cruza otro lado/.test(app), "y se dice, en vez de dejarlo pasar");

console.log("\n── lo que sabemos manda: el trozo cabe o no se guarda ──");
ok(/function metrosLibres/.test(app), "se calculan los metros del recinto sin repartir");
ok(/const cabe = area > 0 && area <= libres;/.test(app),
   "el trozo no puede pasarse de lo que queda libre");
ok(/Te has pasado: /.test(app), "y si se pasa se dice, no se recorta en silencio");
// Desde que además se pregunta la rutina, el botón lo decide revisarEditor()
// mirando las dos cosas: que el trozo quepa Y que la rutina esté contestada.
ok(/ecCabe = cabe;\n\s+revisarEditor\(\);/.test(app),
   "con el botón de guardar apagado mientras no cabe");

console.log("\n── el ancla del tirador se le dice a Leaflet ──");
ok(/iconAnchor: \[10, 10\]/.test(app),
   "iconAnchor, no un margen de CSS: si no, la zona que responde al dedo queda desplazada del círculo");
ok(/anilloExterior YA devuelve el anillo SIN el punto de cierre/.test(app),
   "y no se recorta el anillo: recortando salían tres esquinas de cuatro");

console.log("\n── y no se aplana el z-index de Leaflet ──");
// Lo hice \"por si acaso\" y rompió el mapa: el pane del polígono (400) pasaba por
// encima del de los marcadores (600) y los tiradores dejaban de responder.
ok(!/leaflet-pane[^}]*z-index: auto/.test(app),
   "ningún pane de Leaflet con z-index aplanado");
ok(/su propio contexto de apilado/.test(app), "y queda escrito por qué no hacía falta");

console.log("\n── la geometría, con el módulo real ──");
const GEO = (await import("../assets/js/geo-parcela.js")).default
  || (await import("module")).createRequire(import.meta.url)(join(RAIZ, "assets", "js", "geo-parcela.js"));
const cuad = { type: "Polygon", coordinates: [[[0,0],[0.001,0],[0.001,0.001],[0,0.001],[0,0]]] };
ok(GEO.moverVertice(cuad, 1, [0, 0.001]).ok === false,
   "arrastrar una esquina encima de otra se rechaza (sería una pajarita)");
ok(GEO.moverVertice(cuad, 1, [0.002, 0]).ok === true,
   "y hacia fuera se acepta");
ok(GEO.anilloExterior(cuad).length === 4,
   "un cuadrilátero da CUATRO esquinas, no cinco: anilloExterior ya quita el cierre");
ok(GEO.rectanguloCentrado(cuad, 5000)?.area_m2 === 5000,
   "rectanguloCentrado nace con los metros que se le piden");

console.log("\n── un cultivo nuevo se da de alta como en el onboarding ──");
// Sin su rutina, un cultivo recién añadido no tiene historial, y sin historial
// no hay balance: su primer aviso no diría nada. Las preguntas son las mismas
// que las del alta, y por el mismo motivo.
for (const [id, q] of [["ec-metodo", "cómo riega"], ["ec-cada", "cada cuánto"],
                       ["ec-rato", "cuánto rato"], ["ec-ultimo", "cuándo regó por última vez"]])
  ok(new RegExp(`id="${id}"`).test(app), `pregunta ${q}`);
ok(/ecR\.metodo && ecR\.cada && ecR\.minutos && ecR\.ultimo != null/.test(app),
   "y no se guarda sin ellas: el área sola ya no basta");
ok(/ecRevelar\("ec-q-cada"\)/.test(app) && /ecRevelar\("ec-q-rato"\)/.test(app),
   "una pregunta cada vez, igual que en el alta");

console.log("\n── y siembra con la MISMA función que el alta ──");
// Estaba dentro del alta; se sacó fuera para que las dos puertas no se separen.
ok(/function reconstruirRiegos\(r, clima\)/.test(app), "la función vive fuera del alta");
ok((app.match(/reconstruirRiegos\(\{/g) || []).length === 2,
   "y la llaman exactamente dos sitios: el alta y añadir cultivo");
ok(/localStorage\.setItem\(`kylia_riegos_\$\{id\}`/.test(app),
   "el historial va a la clave de ESA parcela");

console.log("\n── cada cultivo con su propio riego ──");
// Un bancal a manta y otro a goteo no se riegan igual, y el método decide la
// eficiencia de aplicación: de 0,60 a 0,90.
ok(/metodoRiego: ecR\.metodo,/.test(app), "el método se guarda en la siembra");
ok(/metodoRiego:     p\.metodoRiego  \|\| cfgFinca\.metodoRiego/.test(app),
   "configEfectiva usa el suyo, y cae al de la finca si no lo tiene");
ok(/metodoRiego: parcela\.metodoRiego \|\| cfgFinca\.metodoRiego/.test(app),
   "y ctxDe igual, para las acciones de todas las parcelas");
ok(/metodo_riego:     s\.metodoRiego \|\| base\.metodoRiego/.test(app),
   "también viaja al servidor: allí se calcula su propio balance");
ok(/siguen heredando\n\s+\/\/ el de la finca/.test(app),
   "los cultivos de antes no tienen el campo y siguen como estaban");

console.log("\n── la eficiencia de cada método, con el motor real ──");
const MOT = (await import("module")).createRequire(import.meta.url)(join(RAIZ, "assets", "js", "motor-riego.js"));
const ofrecidos = [...app.matchAll(/id="ec-metodo"[\s\S]{0,600}?<\/div>/g)][0][0]
  .match(/data-metodo="(\w+)"/g).map(m => m.replace(/data-metodo="|"/g, ""));
ok(ofrecidos.every(m => MOT.EFIC_RIEGO[m] != null),
   `los ${ofrecidos.length} métodos que se ofrecen tienen eficiencia en el motor (${ofrecidos.join(", ")})`);
ok(MOT.EFIC_RIEGO.surco < MOT.EFIC_RIEGO.goteo,
   `y no dan igual: surco ${MOT.EFIC_RIEGO.surco} contra goteo ${MOT.EFIC_RIEGO.goteo}`);

console.log("\n── segunda parcela: finca → parcelas → cultivos ──");
// El modelo de dos niveles ya existía (las zonas son recintos de SIGPAC y cada
// una lleva sus siembras). Lo que faltaba era la puerta desde la pantalla
// principal.
ok(/id="btn-anadir-parcela"[^>]*hidden/.test(app), "el botón nace oculto");
ok(/btnP\.hidden = !zonasGuardadas\(\)\.some\(z => z\.referencia\)/.test(app),
   "y solo aparece si ya hay un recinto: a quien tiene una finca no se le enseña el concepto");
ok(/if \(esperandoParcela\) nuevaParcelaEn\(ev\.latlng\.lat, ev\.latlng\.lng\)/.test(app),
   "tocar fuera de los contornos solo hace algo mientras se busca parcela");
ok(/mapaCampo\.setZoom\(Math\.max\(13, mapaCampo\.getZoom\(\) - 3\)\)/.test(app),
   "y se aleja el mapa: la otra finca puede estar a un kilómetro");

console.log("\n── no se duplica ni se inventa ──");
ok(/if \(zonas\.some\(z => z\.referencia === d\.referencia\)\)/.test(app),
   "la misma parcela dos veces se avisa, no se duplica");
ok(/Ahí no hay ningún recinto registrado/.test(app),
   "tocar donde no hay recinto se dice");
ok(/siembras: \[\],/.test(app) && /Meter uno por defecto sería inventarle un\n\s+\/\/ cultivo/.test(app),
   "la parcela nueva nace SIN cultivo: meter uno por defecto lo metería en el balance");
ok(/abrirEditorCultivo\(d\.referencia\)/.test(app),
   "y se lleva directo a ponerle cultivo, porque sin él no calcula nada");

console.log("\n── el cultivo nuevo cae en la parcela que se está mirando ──");
// zonaConRecinto devolvía siempre la PRIMERA: con dos parcelas, el cultivo
// nuevo caía en la equivocada sin avisar.
ok(/const suya = zonas\.find\(z => \(z\.siembras \|\| \[\]\)\.some\(s => s\.id === zonaActiva\)\)/.test(app),
   "se busca la parcela del cultivo activo");
ok(/function abrirEditorCultivo\(refForzada = null\)/.test(app),
   "y se puede forzar una, que es lo que hace la parcela recién creada");

console.log("\n── detalles de lengua ──");
ok(/hace \$\{dias\} día\$\{dias === 1 \? "" : "s"\}/.test(app), "no dice 'hace 1 días'");

console.log("\n── primero se pregunta cuánto ocupa, y solo se dibuja quien lo necesita ──");
// Lo corriente es que un cultivo ocupe la parcela entera. Sacar el polígono de
// entrada cobraba a todos el precio del caso raro.
ok(/id="ec-cuanto"/.test(app) && /¿Cuánto de la parcela ocupa\?/.test(app), "se pregunta");
ok(/data-cuanto="todo"/.test(app) && /data-cuanto="parte"/.test(app), "toda o una parte");
ok(/function elegirCuanto\(modo\)/.test(app), "y cada opción hace algo distinto");
const abrir = app.slice(app.indexOf("function abrirEditorCultivo"), app.indexOf("function pintarEditor"));
ok(!/pintarEditor\(\);/.test(abrir),
   "al abrir el editor NO se dibuja nada: el cuadrilátero espera a que lo pida");
ok(/btn\.disabled = !\(ecR\.cuanto && ecCabe/.test(app),
   "y no se guarda sin contestar cuánto ocupa");

console.log("\n── 'toda la parcela' usa la superficie OFICIAL, no la del polígono ──");
// El recinto trae huecos (caseta, balsa, arbolado) y su geometría llegó a dar un
// 8% de más en un caso medido de Palafolls. Ese 8% serían 8% de abono de más.
ok(/ecAreaFijada = libres;/.test(app), "'toda' fija los metros libres del recinto");
ok(/const area = ecAreaFijada != null\n\s+\? ecAreaFijada/.test(app),
   "y al guardar se usa esa cifra, no se recalcula del contorno");
ok(/no se\n\s+\/\/ recalcula del polígono, que traería los huecos de SIGPAC dentro/.test(app),
   "con el porqué escrito al lado");
ok(/ecAreaFijada = null;\n\s+\/\/ Nace ocupando la mitad/.test(app),
   "'una parte' la suelta: ahí manda lo que dibuje");

console.log("\n── moverse por el mapa ──");
ok(/zoomControl: true/.test(app), "hay botones de zoom");
ok(/touchZoom: true, doubleClickZoom: true/.test(app), "y pellizco y doble toque");
ok(/scrollWheelZoom: false,/.test(app),
   "la rueda apagada en la tarjeta: si no, bajar por la pantalla se queda atrapado en el mapa");

console.log("\n── pantalla completa ──");
ok(/id="btn-mapa-pantalla"/.test(app), "hay botón");
ok(/function alternarPantallaMapa\(\)/.test(app), "y su función");
ok(/mapaCampo\.scrollWheelZoom\.enable\(\)/.test(app),
   "en pantalla completa la rueda SÍ se enciende: allí el mapa es lo único que hay");
ok(/setTimeout\(\(\) => mapaCampo\.invalidateSize\(\), 80\)/.test(app),
   "y se le avisa del cambio de tamaño, o se queda con el encuadre viejo");
ok(/if \(mapaLleno\) alternarPantallaMapa\(\);/.test(app), "Escape lo cierra");
ok(/body\.mapa-lleno \{ overflow: hidden; \}/.test(app),
   "y el fondo no se puede desplazar por detrás");

console.log("\n── nombre, y SOLO para las parcelas ──");
ok(/nombre: `Parcela \$\{zonas\.filter\(z => z\.geometria\)\.length \+ 1\}`/.test(app),
   "la parcela nueva nace con un nombre por defecto");
// Solo queda la mención en el comentario que explica por qué no se usa.
ok(!/=\s*prompt\(|\bprompt\([^)]*\)\s*\|\|/.test(app),
   "sin prompt(): bloquea y en el móvil sale como una alerta del sistema");
ok(/function abrirRenombrar\(\)/.test(app) && /id="mapa-titulo"/.test(app),
   "se renombra tocando el título");
ok(/tit\.disabled = !varias;/.test(app),
   "y con una sola parcela no se puede: 'Tu campo' ya la nombra");
ok(/etiqueta: variasParcelas && z\.nombre/.test(app),
   "el nombre entra en la pestaña, que es donde distingue 'tomate' de 'tomate'");
ok(/Los cultivos no lo llevan: ya se llaman\n\s+\/\/ por lo que son/.test(app),
   "los cultivos NO llevan nombre, y queda dicho por qué");
ok(/if \(ev\.key === "Enter"\) ev\.target\.blur\(\);/.test(app), "intro confirma");
ok(/if \(ev\.key === "Escape"\) \{ ev\.target\.value = ""; ev\.target\.blur\(\); \}/.test(app),
   "y escape cancela sin guardar");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
