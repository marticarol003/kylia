// Dentro, fuera y encima: decidido con topología, no con un margen.
//   node tests/test-geometria-cultivos.mjs
//
// LA PRIMERA VERSIÓN ENCOGÍA LOS POLÍGONOS un 0,5% hacia su centro para que
// "compartir borde" no contase como "compartir área". Resolvía la linde y
// rompía todo lo demás: en una parcela de 100×100 m dejaba pasar un solape de
// 10 m² y una salida de 20 m², porque los dos caben dentro de ese 0,5%. Un
// margen RELATIVO aplicado a una pregunta topológica da respuestas falsas en
// proporción al tamaño del campo — cuanto más grande la finca, más se cuela.
//
// Ahora no se encoge nada y tampoco hace falta recortar polígonos: para
// polígonos simples, "¿el área compartida es cero o positiva?" se decide EXACTO
// con dos predicados —cruce propio de bordes y punto estrictamente interior—.
// La única tolerancia que queda es el epsilon de la coma flotante.
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const G = createRequire(import.meta.url)(join(RAIZ, "assets", "js", "geo-parcela.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

// Un lienzo de 100 × 100 m a 41,3 °N, para poder hablar en metros de verdad.
const LADO = 100, Y0 = 41.3;
const dLat = LADO / 111320, dLon = LADO / 83600;
const pt = (x, y) => [x * dLon, Y0 + y * dLat];          // x,y en fracción del lado
const poly = (...ps) => ({ type: "Polygon", coordinates: [[...ps.map(([x, y]) => pt(x, y)), pt(ps[0][0], ps[0][1])]] });
const rect = (x0, y0, x1, y1) => poly([x0, y0], [x1, y0], [x1, y1], [x0, y1]);
const PARCELA = rect(0, 0, 1, 1);

console.log("── el lienzo ──");
ok(Math.abs(G.areaDePolygon(PARCELA) - 10000) < 20,
   `la parcela mide ${G.areaDePolygon(PARCELA)} m² (100 × 100)`);

console.log("\n── CONTENCIÓN ──");
{
  ok(G.contenidoEn(PARCELA, PARCELA) === true, "cultivo == parcela → válido");
  ok(G.contenidoEn(rect(0.2, 0.2, 0.6, 0.6), PARCELA) === true, "cultivo totalmente dentro → válido");
  ok(G.contenidoEn(rect(0, 0, 0.5, 1), PARCELA) === true, "cultivo que comparte borde → válido");
  ok(G.contenidoEn(rect(0.25, 0, 0.75, 1), PARCELA) === true, "cultivo que comparte DOS bordes → válido");

  // 20 m² fuera: una franja de 0,2 × 100 m. Es el caso que Codex reprodujo.
  const sale20 = rect(0.5, 0, 1.002, 1);
  const fuera20 = G.areaDePolygon(sale20) - G.areaDePolygon(rect(0.5, 0, 1, 1));
  ok(G.contenidoEn(sale20, PARCELA) === false,
     `sale ${Math.round(fuera20)} m² fuera → inválido (antes se ACEPTABA)`);

  // Y una franja mucho más estrecha todavía: 2 cm × 100 m ≈ 2 m².
  const sale2 = rect(0.5, 0, 1.0002, 1);
  ok(G.contenidoEn(sale2, PARCELA) === false, "sale una franja muy estrecha (~2 m²) → inválido");

  // Un solo vértice fuera: un triángulo asomando por la esquina.
  const vertice = poly([0.6, 0.6], [1.05, 0.9], [0.6, 0.95]);
  ok(G.contenidoEn(vertice, PARCELA) === false, "sale solo un vértice → inválido");

  console.log("\n  ── parcela cóncava en L, sin asumir convexidad ──");
  const L = poly([0, 0], [1, 0], [1, 0.5], [0.5, 0.5], [0.5, 1], [0, 1]);
  ok(Math.abs(G.areaDePolygon(L) - 7500) < 20, `la L mide ${G.areaDePolygon(L)} m²`);
  ok(G.contenidoEn(rect(0.05, 0.05, 0.45, 0.9), L) === true, "cultivo en el brazo de la L → válido");
  ok(G.contenidoEn(rect(0.05, 0.05, 0.9, 0.45), L) === true, "cultivo en el pie de la L → válido");
  ok(G.contenidoEn(rect(0.6, 0.6, 0.9, 0.9), L) === false, "cultivo en el HUECO de la L → inválido");
  ok(G.contenidoEn(rect(0.4, 0.4, 0.9, 0.9), L) === false, "cultivo que atraviesa la muesca → inválido");
  ok(G.contenidoEn(rect(0.45, 0.45, 0.55, 0.55), L) === false,
     "y uno que asoma por el vértice reflejo, también");
}

console.log("\n── SOLAPAMIENTO ──");
{
  ok(G.seSolapan(rect(0, 0, 0.2, 0.2), rect(0.6, 0.6, 0.8, 0.8)) === false, "separados → válido");
  ok(G.seSolapan(rect(0, 0, 0.5, 1), rect(0.5, 0, 1, 1)) === false,
     "comparten borde entero → válido (dos bancales pegados es lo normal)");
  ok(G.seSolapan(rect(0, 0, 0.5, 0.5), rect(0.5, 0, 1, 0.3)) === false,
     "comparten un TRAMO de borde → válido");
  ok(G.seSolapan(rect(0, 0, 0.5, 0.5), rect(0.5, 0.5, 1, 1)) === false,
     "comparten un punto → válido");

  // 10 m²: dos rectángulos que se pisan 0,1 × 100 m. El caso de Codex.
  const A = rect(0, 0, 0.5, 1), B = rect(0.499, 0, 1, 1);
  const pisado = G.areaDePolygon(rect(0.499, 0, 0.5, 1));
  ok(G.seSolapan(A, B) === true,
     `solape de ${Math.round(pisado)} m² → inválido (antes se ACEPTABA)`);

  ok(G.seSolapan(rect(0, 0, 0.5, 1), rect(0.4999, 0, 1, 1)) === true,
     "solape pequeño pero REAL (~1 m²) → inválido");
  ok(G.seSolapan(rect(0.2, 0.2, 0.4, 0.4), rect(0.1, 0.1, 0.8, 0.8)) === true,
     "A contenido completamente en B → inválido");
  ok(G.seSolapan(rect(0.1, 0.1, 0.8, 0.8), rect(0.2, 0.2, 0.4, 0.4)) === true, "y al revés");
  // ⚠️ EL CASO DEGENERADO que se escapó. Con dos polígonos IDÉNTICOS no hay
  // cruces propios —los lados son colineales— y ningún vértice cae "dentro" del
  // otro: todos caen en el borde. Arrastrar un cultivo exactamente encima de
  // otro se daba por bueno. Lo cazó el test de navegador, no este.
  const mismo = rect(0.2, 0.2, 0.6, 0.6);
  ok(G.seSolapan(mismo, JSON.parse(JSON.stringify(mismo))) === true,
     "dos polígonos IDÉNTICOS → inválido");
  ok(G.seSolapan(rect(0, 0, 1, 1), rect(0, 0, 1, 1)) === true,
     "y dos parcelas enteras idénticas, también");
  // Cruz: se pisan sin que ningún vértice de uno caiga dentro del otro.
  ok(G.seSolapan(rect(0.2, 0.45, 0.8, 0.55), rect(0.45, 0.2, 0.55, 0.8)) === true,
     "dos franjas en cruz → inválido, aunque ningún vértice caiga dentro del otro");
}

console.log("\n── GEOMETRÍAS INVÁLIDAS · nada lanza ──");
{
  const casos = [
    ["pajarita simétrica",  poly([0, 0], [1, 1], [1, 0], [0, 1]),                    "se_cruza_consigo_mismo"],
    ["pajarita asimétrica", poly([0, 0], [1, 1], [1, 0], [0, 0.7]),                  "se_cruza_consigo_mismo"],
    ["área cero",           { type: "Polygon", coordinates: [[pt(0, 0), pt(1, 0), pt(2, 0), pt(0, 0)]] }, "area_nula"],
    ["vacío",               { type: "Polygon", coordinates: [[]] },                  "pocos_vertices"],
    ["sin coordinates",     { type: "Polygon" },                                     "sin_coordenadas"],
    ["null",                null,                                                    "sin_geometria"],
    ["no es objeto",        "un polígono",                                           "sin_geometria"],
    ["NaN",                 { type: "Polygon", coordinates: [[[NaN, 0], [1, 0], [1, 1], [NaN, 0]]] }, "coordenada_no_finita"],
    ["Infinity",            { type: "Polygon", coordinates: [[[Infinity, 0], [1, 0], [1, 1], [Infinity, 0]]] }, "coordenada_no_finita"],
    ["dos vértices",        { type: "Polygon", coordinates: [[pt(0, 0), pt(1, 0), pt(0, 0)]] }, "pocos_vertices"],
    ["tipo no soportado",   { type: "LineString", coordinates: [[0, 0], [1, 1]] },   "tipo_no_soportado"],
  ];
  let lanzo = 0;
  for (const [nombre, geom, motivo] of casos) {
    let v = null;
    try { v = G.validarPolygonGeoJSON(geom); } catch (e) { lanzo++; console.log("    ↳ LANZÓ:", nombre, e.message); }
    ok(v && v.ok === false && v.motivo === motivo, `${nombre} → inválida (${v?.motivo})`);
  }
  ok(lanzo === 0, "y NINGUNA lanza excepción");

  // Las tres puertas tampoco lanzan con basura.
  let lanzo2 = 0;
  for (const [, geom] of casos) {
    try { G.contenidoEn(geom, PARCELA); G.seSolapan(geom, PARCELA); G.validarCultivo(geom, PARCELA, [PARCELA]); }
    catch (_) { lanzo2++; }
  }
  ok(lanzo2 === 0, "contenidoEn, seSolapan y validarCultivo tampoco lanzan con geometría rota");
  ok(G.areaDePolygon(null) === null, "y areaDePolygon devuelve null en vez de un número inventado");

  // El contrato del tipo: validarPolygonGeoJSON recibe GeoJSON, no un anillo.
  // Antes se le pasaba GeoJSON a `esSimple`, que espera un ANILLO, así que decía
  // que sí a cualquier cosa y las pajaritas se colaban.
  ok(G.validarPolygonGeoJSON(G.anilloExterior(PARCELA)).ok === false,
     "pasarle un ANILLO donde espera GeoJSON se rechaza, no se interpreta a medias");
}

console.log("\n── validarCultivo · el motivo que se enseña es el de verdad ──");
{
  const v1 = G.validarCultivo(poly([0, 0], [1, 1], [1, 0], [0, 1]), PARCELA, []);
  ok(v1.ok === false && v1.motivo === "se_cruza_consigo_mismo",
     `una pajarita se llama pajarita, no "fuera de la parcela" (${v1.motivo})`);
  const v2 = G.validarCultivo(rect(0.2, 0.2, 0.5, 0.5), rect(0, 0, 0.1, 0.1), []);
  ok(v2.ok === false, "un cultivo fuera de su parcela se rechaza");
  const v3 = G.validarCultivo(rect(0.2, 0.2, 0.5, 0.5), PARCELA, [rect(0.4, 0.4, 0.7, 0.7)]);
  ok(v3.ok === false && v3.motivo === "se_solapa" && v3.con === 0, "y uno que pisa a otro, con cuál");
  const v4 = G.validarCultivo(rect(0.2, 0.2, 0.5, 0.5), PARCELA, [rect(0.5, 0.2, 0.7, 0.5)]);
  ok(v4.ok === true && v4.area_m2 > 0, `uno que cabe pasa, con su área (${v4.area_m2} m²)`);
  ok(v4.area_m2 === G.areaDePolygon(rect(0.2, 0.2, 0.5, 0.5)),
     "y esa área es EXACTAMENTE la del polígono");
  const v5 = G.validarCultivo(rect(0.2, 0.2, 0.5, 0.5), { type: "Polygon", coordinates: [[]] }, []);
  ok(v5.ok === false && v5.motivo === "parcela_invalida", "una parcela rota se dice como tal");
}

console.log("\n── ÁREA ↔ GEOJSON · la superficie sale del polígono, siempre ──");
{
  // Se guardan tres cultivos, se serializa como en kylia_zonas, se relee y se
  // recalcula el área desde el GeoJSON. Tiene que cuadrar.
  const cultivos = [
    { id: "a", geometria: rect(0, 0, 0.4, 0.5) },
    { id: "b", geometria: rect(0.4, 0, 0.7, 0.5) },
    { id: "c", geometria: poly([0, 0.5], [0.6, 0.5], [0.6, 0.9], [0.3, 1], [0, 1]) },
  ].map(c => ({ ...c, area_m2: G.areaDePolygon(c.geometria) }));

  const releidos = JSON.parse(JSON.stringify(cultivos));
  let descuadres = 0;
  for (const c of releidos) {
    const recalculada = G.areaDePolygon(c.geometria);
    if (recalculada !== c.area_m2) { descuadres++; console.log(`    ↳ ${c.id}: ${c.area_m2} vs ${recalculada}`); }
  }
  ok(descuadres === 0, `las ${releidos.length} áreas persistidas coinciden con su GeoJSON tras recargar`);
  ok(releidos.every(c => c.area_m2 > 0), "y todas son positivas");
  // Y ninguna se pisa: es un reparto real.
  let choques = 0;
  for (let i = 0; i < releidos.length; i++)
    for (let j = i + 1; j < releidos.length; j++)
      if (G.seSolapan(releidos[i].geometria, releidos[j].geometria)) choques++;
  ok(choques === 0, "los tres conviven sin pisarse, pegados por las lindes");
  ok(releidos.every(c => G.contenidoEn(c.geometria, PARCELA)), "y los tres dentro de la parcela");
}

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
