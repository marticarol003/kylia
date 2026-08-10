// Editar el contorno de un cultivo vértice a vértice (assets/js/geo-parcela.js).
//   node tests/test-editor-contorno.mjs
//
// SIGPAC da el recinto oficial, pero en una misma finca hay varios cultivos con
// varios riegos, y ninguno ocupa el recinto entero ni tiene su forma. Esto deja
// ajustar el contorno de cada uno arrastrando sus esquinas.
//
// Lo que se ata aquí es que la SUPERFICIE que sale de ese arrastre sea correcta,
// porque no es decorativa: escala los kg del plan de abonado y los litros
// totales. Y en particular el caso que rompe todo sin avisar — arrastrar un
// vértice hasta cruzar un lado. El polígono queda en "pajarita", la fórmula del
// área suma un trozo en negativo, y el número queda mal para siempre mientras el
// mapa solo se ve raro un instante.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const G = require("../assets/js/geo-parcela.js");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

// Cuadrado de ~100 × 100 m a 41,4°N (Barcelona), en grados.
const LAT = 41.4, LON = 2.15;
const mLat = 100 / 111320;
const mLon = 100 / (111320 * Math.cos(LAT * Math.PI / 180));
const cuadrado = { type: "Polygon", coordinates: [[
  [LON, LAT], [LON + mLon, LAT], [LON + mLon, LAT + mLat], [LON, LAT + mLat], [LON, LAT],
]] };

console.log("── el punto de partida: un rectángulo con la superficie asignada ──");
const rect = G.rectanguloCentrado(cuadrado, 2500);
ok(rect !== null, "se puede crear sobre el recinto");
ok(Math.abs(rect.area_m2 - 2500) / 2500 < 0.02,
   `sale con los metros pedidos: ${rect.area_m2} m² para 2.500 pedidos (±2%)`);
ok(G.anilloExterior(rect.geometria).length === 4, "cuatro esquinas para empezar a arrastrar");
ok(G.rectanguloCentrado(cuadrado, 0) === null && G.rectanguloCentrado(null, 500) === null,
   "sin superficie o sin recinto no se inventa nada");

console.log("── mover una esquina recalcula la superficie ──");
const medio = G.moverVertice(cuadrado, 2, [LON + mLon / 2, LAT + mLat]);
ok(medio.ok, "se puede mover una esquina");
ok(medio.area_m2 < 10000 && medio.area_m2 > 6000,
   `el cuadrado de 10.000 m² pasa a ${medio.area_m2} m² al meter una esquina hacia dentro`);
const fuera = G.moverVertice(cuadrado, 2, [LON + mLon * 2, LAT + mLat * 2]);
ok(fuera.ok && fuera.area_m2 > 10000, `y crece al sacarla: ${fuera.area_m2} m²`);
ok(!G.moverVertice(cuadrado, 9, [LON, LAT]).ok, "un índice que no existe no mueve nada");

console.log("── el caso que rompe en silencio: la pajarita ──");
// Llevar la esquina 2 al otro lado del lado izquierdo cruza el lado 1-2 con el
// 3-0. (Meterla hacia dentro NO es una pajarita, solo un polígono cóncavo, y esos
// son perfectamente válidos: un bancal en L existe.)
const lazo = G.moverVertice(cuadrado, 2, [LON - mLon, LAT + mLat]);
ok(!lazo.ok && lazo.motivo === "se_cruza",
   "arrastrar una esquina hasta cruzar un lado se RECHAZA, no se corrige por detrás");
ok(lazo.area_m2 === undefined, "y no devuelve superficie: quien llama deja el vértice donde estaba");
ok(G.esSimple(G.anilloExterior(cuadrado)), "un cuadrado es simple");
ok(G.moverVertice(cuadrado, 2, [LON + mLon / 2, LAT + mLat / 2]).ok,
   "un contorno CÓNCAVO sí se acepta: un bancal en L es una forma real, no un error");
ok(!G.esSimple([[0, 0], [1, 1], [1, 0], [0, 1]]), "una pajarita no lo es");
ok(!G.esSimple([[0, 0], [1, 0]]) && !G.esSimple(null), "dos puntos o nada tampoco");
// La prueba de que esto importa: el área de la pajarita miente.
const areaPajarita = G.areaM2([[0, 0], [1, 1], [1, 0], [0, 1]]);
const areaCuadrada = G.areaM2([[0, 0], [1, 0], [1, 1], [0, 1]]);
ok(areaPajarita < areaCuadrada * 0.1,
   `y por eso: la pajarita da ${areaPajarita.toFixed(0)} m² donde el cuadrado da ${areaCuadrada.toFixed(0)} — se anula sola`);

console.log("── añadir y quitar esquinas para seguir la forma real ──");
const mas = G.insertarVertice(cuadrado, 0);
ok(mas.ok && G.anilloExterior(mas.geometria).length === 5, "insertar parte un lado y deja 5 vértices");
ok(Math.abs(mas.area_m2 - 10000) < 50,
   `partir un lado por el medio NO cambia la superficie (${mas.area_m2} m²)`);
ok(mas.indice === 1, "devuelve dónde quedó el vértice nuevo, para poder seleccionarlo");

const menos = G.quitarVertice(mas.geometria, 1);
ok(menos.ok && G.anilloExterior(menos.geometria).length === 4, "y se puede volver a quitar");
ok(Math.abs(menos.area_m2 - 10000) < 50, "recuperando la superficie de partida");
const triangulo = { type: "Polygon", coordinates: [[[0, 0], [0.001, 0], [0, 0.001], [0, 0]]] };
ok(!G.quitarVertice(triangulo, 0).ok && G.quitarVertice(triangulo, 0).motivo === "minimo_3",
   "no se puede bajar de 3 vértices: dejaría de haber polígono");

console.log("── la geometría que sale es válida para todo lo demás ──");
ok(medio.geometria.type === "Polygon", "sigue siendo un Polygon GeoJSON");
const anillo = medio.geometria.coordinates[0];
ok(anillo[0][0] === anillo[anillo.length - 1][0] && anillo[0][1] === anillo[anillo.length - 1][1],
   "cerrado (el satélite y SIGPAC lo exigen)");
ok(G.areaM2(G.anilloExterior(medio.geometria)) > 0, "y con área medible");

console.log("── conectado al mapa de la app ──");
const { readFileSync } = await import("fs");
const { fileURLToPath } = await import("url");
const { dirname, join } = await import("path");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
ok(/rectanguloCentrado\(z\.geometria, s\.area_m2\)/.test(app),
   "un cultivo sin contorno arranca de un rectángulo con SUS metros, no de cero");
ok(/if \(!r\.ok\) return;/.test(app),
   "un arrastre que cruzaría un lado no se aplica: el vértice se queda donde estaba");
ok(/s\.geometria = c\.geometria; s\.area_m2 = c\.area_m2;/.test(app),
   "al guardar, el contorno Y su superficie pasan a ser los del cultivo");
ok(/insertarVertice/.test(app) && /quitarVertice/.test(app),
   "se pueden añadir y quitar esquinas desde el mapa");
ok(/mapaLeaflet\.dragging\.disable\(\)/.test(app),
   "arrastrar una esquina no arrastra el mapa por debajo");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
