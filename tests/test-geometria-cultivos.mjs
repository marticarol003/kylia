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
import { readFileSync } from "fs";
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

console.log("\n── AGUJEROS · un anillo interior no es superficie del agricultor ──");
{
  // Parcela de 100×100 con un hueco de 25×25 en el centro: una caseta, una
  // balsa, un poste. 625 m² que no son suyos.
  const hueco = [pt(.375, .375), pt(.375, .625), pt(.625, .625), pt(.625, .375), pt(.375, .375)];
  const P = { type: "Polygon", coordinates: [PARCELA.coordinates[0], hueco] };
  const v = G.validarPolygonGeoJSON(P);
  ok(v.ok === true && v.agujeros.length === 1, "un Polygon con anillo interior es válido y conserva sus 2 anillos");
  ok(v.area_m2 < 9500 && v.area_m2 > 9300,
     `el área DESCUENTA el hueco: ${v.area_m2} m² (10.004 − 625)`);
  ok(G.areaDePolygon(P) === v.area_m2, "y areaDePolygon dice lo mismo");

  console.log("\n  ── contención: los tres casos que los vértices no ven ──");
  ok(G.contenidoEn(rect(.05, .05, .3, .3), P) === true, "cultivo en zona útil → válido");
  ok(G.contenidoEn(rect(.45, .45, .55, .55), P) === false, "cultivo DENTRO del hueco → inválido");
  // A · ningún vértice dentro del hueco, pero una arista lo atraviesa.
  ok(G.contenidoEn(rect(.2, .45, .8, .55), P) === false, "cultivo que ATRAVIESA el hueco → inválido");
  // B · todos los vértices fuera, ninguna arista cruza, y contiene el hueco entero.
  ok(G.contenidoEn(rect(.2, .2, .8, .8), P) === false, "cultivo que ENVUELVE el hueco → inválido");
  ok(G.contenidoEn(rect(.1, .375, .375, .625), P) === true,
     "cultivo PEGADO al borde del hueco → válido (no ocupa su interior)");
  ok(G.contenidoEn(rect(.1, .1, .375, .375), P) === true, "y tocándolo por una esquina, también");

  console.log("\n  ── point-in-polygon con la MISMA semántica en un solo sitio ──");
  ok(G.situarEnPoligono(P, pt(.1, .1)) === "dentro", "punto en zona útil → dentro");
  ok(G.situarEnPoligono(P, pt(.5, .5)) === "fuera", "punto en el hueco → FUERA de la parcela");
  ok(G.situarEnPoligono(P, pt(.375, .5)) === "borde", "punto en el borde del hueco → borde");
  ok(G.situarEnPoligono(P, pt(0, .5)) === "borde", "punto en el borde exterior → borde");
  ok(G.situarEnPoligono(P, pt(3, 3)) === "fuera", "punto lejos → fuera");

  console.log("\n  ── solapamiento entre cultivos ≠ contención en la parcela (§6) ──");
  const B = rect(.45, .45, .55, .55);
  ok(G.seSolapan(P, B) === false, "B dentro del hueco de A → NO se solapan: el hueco no es superficie de A");
  ok(G.contenidoEn(B, P) === false, "pero B tampoco es un cultivo válido: está fuera de la superficie de parcela");
  ok(G.seSolapan(rect(0, 0, .5, .5), rect(.3, .3, .8, .8)) === true, "y dos cultivos normales que se pisan, sí");

  console.log("\n  ── \"usar toda la parcela\" conserva los anillos ──");
  const todo = JSON.parse(JSON.stringify(P));
  ok(todo.coordinates.length === 2, "el cultivo copia el GeoJSON COMPLETO, no solo el exterior");
  ok(G.contenidoEn(todo, P) === true,
     "y es válido: declara el mismo hueco, así que no ocupa su interior");
  ok(G.areaDePolygon(todo) === G.areaDePolygon(P), "con el área ya descontada");
  const releido = JSON.parse(JSON.stringify(todo));
  ok(releido.coordinates.length === 2 && G.areaDePolygon(releido) === G.areaDePolygon(todo),
     "y sobrevive a guardar y releer sin perder anillos ni superficie");
}

console.log("\n── MULTIPOLYGON · rechazo explícito, nunca a medias ──");
{
  const M = { type: "MultiPolygon", coordinates: [
    [[pt(0, 0), pt(.4, 0), pt(.4, .4), pt(0, .4), pt(0, 0)]],
    [[pt(.6, .6), pt(1, .6), pt(1, 1), pt(.6, 1), pt(.6, .6)]]] };
  const v = G.validarPolygonGeoJSON(M);
  ok(v.ok === false && v.motivo === "multipolygon_no_soportado",
     "se rechaza con su motivo, no se coge el primer trozo");
  ok(G.areaDePolygon(M) === null, "sin área: no se inventa la de un pedazo");
  ok(G.contenidoEn(rect(.1, .1, .2, .2), M) === false, "nada se da por contenido en él");
  ok(G.seSolapan(M, rect(.1, .1, .2, .2)) === false, "ni por solapado");
  ok(G.validarCultivo(rect(.1, .1, .2, .2), M, []).motivo === "multipolygon_no_soportado",
     "y validarCultivo lo nombra, para poder decírselo al agricultor");
  ok(G.situarEnPoligono(M, pt(.1, .1)) === "fuera", "situarEnPoligono tampoco lo interpreta");
}

console.log("\n── ANILLOS ABIERTOS · se cierran en la frontera y solo ahí ──");
{
  const abierto = { type: "Polygon", coordinates: [[pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1)]] };
  ok(G.validarPolygonGeoJSON(abierto).motivo === "anillo_abierto",
     "dentro del modelo, un anillo sin cerrar es INVÁLIDO");
  const norm = G.normalizarGeometriaExterna(abierto);
  ok(G.validarPolygonGeoJSON(norm).ok === true, "normalizado en la frontera → válido");
  ok(G.areaDePolygon(norm) === G.areaDePolygon(PARCELA), "y mide lo mismo que el cerrado");

  const conHuecoAbierto = { type: "Polygon", coordinates: [
    [pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1)],
    [pt(.4, .4), pt(.6, .4), pt(.6, .6), pt(.4, .6)]] };
  ok(G.validarPolygonGeoJSON(conHuecoAbierto).motivo === "anillo_abierto",
     "y un anillo INTERIOR sin cerrar, también");
  const norm2 = G.normalizarGeometriaExterna(conHuecoAbierto);
  const v2 = G.validarPolygonGeoJSON(norm2);
  ok(v2.ok === true && v2.agujeros.length === 1, "normalizado, válido y con su agujero");
  ok(JSON.stringify(G.normalizarGeometriaExterna(norm)) === JSON.stringify(norm),
     "normalizar dos veces no cambia nada");
  ok(G.normalizarGeometriaExterna(null) === null, "y con basura no lanza");
}

console.log("\n── FIXTURES DE SIGPAC REAL · anonimizados, forma conservada ──");
{
  // Sacados de la respuesta real de /api/sigpac el 17-sep sobre el tile que
  // cubre el campo del piloto: 2 de sus 135 recintos tienen anillo interior.
  // Se han trasladado al origen y se les ha quitado la referencia catastral.
  const fixtures = JSON.parse(readFileSync(join(RAIZ, "tests", "fixtures-sigpac.json"), "utf8"));
  ok(fixtures.length >= 2, `${fixtures.length} recintos reales con agujeros`);
  for (const f of fixtures) {
    const v = G.validarPolygonGeoJSON(f.geometria);
    ok(v.ok === true, `${f.id}: válido`);
    ok(v.agujeros.length >= 1, `${f.id}: conserva ${v.agujeros.length} anillo(s) interior(es)`);
    const soloExterior = G.areaDePolygon({ type: "Polygon", coordinates: [f.geometria.coordinates[0]] });
    ok(v.area_m2 < soloExterior,
       `${f.id}: ${v.area_m2} m² con el hueco descontado, frente a ${soloExterior} del exterior pelado`);
    // Y un cultivo metido en su hueco tiene que rechazarse.
    const h = f.geometria.coordinates[1];
    const cx = h.reduce((s, p) => s + p[0], 0) / h.length, cy = h.reduce((s, p) => s + p[1], 0) / h.length;
    const dentroDelHueco = { type: "Polygon", coordinates: [[[cx, cy], [cx + 1e-6, cy], [cx + 1e-6, cy + 1e-6], [cx, cy + 1e-6], [cx, cy]]] };
    ok(G.situarEnPoligono(f.geometria, [cx, cy]) === "fuera",
       `${f.id}: el centro de su hueco cae FUERA de la superficie`);
    void dentroDelHueco;
  }
}

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
