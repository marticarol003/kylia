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
ok(/parcelasDisponibles\(\)\.filter\(p => p\.geometria\)/.test(app),
   "la lista de parcelas que ya calculaba el selector");
ok(/cambiarZona\(p\.id \|\| null\)/.test(app),
   "y el mismo cambiarZona: el mapa no es un segundo selector, es el mismo");

console.log("── la parcela principal no se pinta encima de sus propios trozos ──");
// Es la finca entera. Con siembras dibujadas, pintarla además mete un polígono
// que se superpone a los otros y se lleva todos los toques.
ok(/const conTrozos = todas\.some\(p => p\.id\);/.test(app),
   "se detecta si hay siembras con contorno propio");
ok(/const lista = conTrozos \? todas\.filter\(p => p\.id\) : todas;/.test(app),
   "y entonces la principal se cae del mapa");
ok(/en las pestañas se queda/.test(app),
   "pero NO de las pestañas: eso es otra cosa y no se toca");

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

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
