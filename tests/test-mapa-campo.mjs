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
ok(/btn\.disabled = !cabe;/.test(app), "con el botón de guardar apagado mientras no cabe");

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

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
