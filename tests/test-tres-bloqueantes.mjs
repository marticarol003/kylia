// Los tres que reprodujo la auditoría de 8e01c67, fijados.
//   node tests/test-tres-bloqueantes.mjs
//
// 1 · El editor NORMAL perdía los agujeros. La protección del asistente nuevo no
//     protegía al viejo: abrir "Ajustar contorno" sobre un recinto con caseta y
//     guardar SIN MOVER NADA subía el área de 4.598 a 4.998 m², y las tres
//     operaciones de vértice devolvían un Polygon de un solo anillo.
// 2 · "Lo indicaré después" se leía como legacy y HEREDABA el riego de la finca:
//     con la finca a aspersión/11,2, una lechuga recién dada de alta salía
//     regando 43 minutos sin que nadie hubiera declarado su riego.
// 3 · Un historial vacío se tomaba por "no ha regado": una lechuga plantada hace
//     dos semanas y dada de alta hoy daba `confianzaBalance: "conocido"` y una
//     necesidad de 32 L/m² presentada como un déficit medido.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const G = require(join(RAIZ, "assets", "js", "geo-parcela.js"));
const R = require(join(RAIZ, "assets", "js", "riego-capacidad.js"));
const M = require(join(RAIZ, "assets", "js", "motor-riego.js"));
const FUENTE = readFileSync(join(RAIZ, "app", "index.html"), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

function recorta(marca) {
  const i = FUENTE.indexOf(marca);
  if (i < 0) throw new Error(`no encuentro: ${marca}`);
  let k = FUENTE.indexOf("(", i), p = 0;
  for (; k < FUENTE.length; k++) { if (FUENTE[k] === "(") p++; else if (FUENTE[k] === ")" && --p === 0) { k++; break; } }
  while (k < FUENTE.length && FUENTE[k] !== "{") k++;
  p = 0;
  for (let j = k; j < FUENTE.length; j++) { if (FUENTE[j] === "{") p++; else if (FUENTE[j] === "}" && --p === 0) return FUENTE.slice(i, j + 1); }
  throw new Error("llaves sin cerrar");
}
const almacen = (ini = {}) => {
  const m = new Map(Object.entries(ini).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};

const Y0 = 41.3, dLat = 100 / 111320, dLon = 100 / 83600;
const pt = (x, y) => [x * dLon, Y0 + y * dLat];
const an = (...ps) => [...ps.map(([x, y]) => pt(x, y)), pt(ps[0][0], ps[0][1])];
const rect = (x0, y0, x1, y1) => ({ type: "Polygon", coordinates: [an([x0, y0], [x1, y0], [x1, y1], [x0, y1])] });

// ══════════════════════════════════════════════════════════════════
console.log("── 1 · AGUJEROS: ninguna operación los pierde ──");
{
  const hueco = an([.375, .375], [.375, .625], [.625, .625], [.625, .375]);
  const P = { type: "Polygon", coordinates: [an([0, 0], [1, 0], [1, 1], [0, 1]), hueco] };
  const antes = JSON.stringify(P), areaAntes = G.areaDePolygon(P);

  for (const [n, f] of [["moverVertice", () => G.moverVertice(P, 0, [0.0001, 41.3001])],
                        ["insertarVertice", () => G.insertarVertice(P, 0)],
                        ["quitarVertice", () => G.quitarVertice(P, 0)]]) {
    const r = f();
    ok(r.ok === false && r.motivo === "con_agujeros_no_editable",
       `${n} rechaza la operación en vez de tirar el agujero`);
    ok(r.geometria === undefined, `${n} no devuelve una geometría mutilada`);
  }
  ok(JSON.stringify(P) === antes, "y la geometría original queda INTACTA: no se muta nada");
  ok(G.areaDePolygon(P) === areaAntes, `su área tampoco se mueve (${areaAntes} m²)`);

  // Sin agujeros se sigue editando igual: no se ha roto lo que funcionaba.
  const SIN = rect(0, 0, 1, 1);
  for (const [n, f] of [["moverVertice", () => G.moverVertice(SIN, 0, [0.0001, 41.3001])],
                        ["insertarVertice", () => G.insertarVertice(SIN, 0)],
                        ["quitarVertice", () => G.quitarVertice(SIN, 0)]]) {
    const r = f();
    ok(r.ok === true && r.geometria.coordinates.length === 1, `${n} sigue funcionando sin agujeros`);
  }

  console.log("\n  ── abrir y guardar sin tocar nada no cambia nada ──");
  // La cadena real del editor: iniciarContorno → guardarContorno.
  const cuerpo = `
    const KyliaGeo = G;
    const L = { layerGroup: () => ({ clearLayers(){}, addTo(){ return this; } }) };
    // Solo el mapa: la lógica del editor es la real.
    let mapaLeaflet = { removeLayer() {}, addLayer() {} };
    let contornoEnCurso = null, corteEnCurso = null;
    const document = { getElementById: () => ({ set textContent(v){ aviso.v = v; }, get textContent(){ return aviso.v; } }) };
    const cancelarCorte = () => {}, renderZonas = () => {}, saveZonas = () => { guardadas.push(JSON.parse(JSON.stringify([...zonasSel.values()]))); };
    const pintarContorno = () => {};
    const zonasSel = mapa;
    ${recorta("function iniciarContorno(")}
    ${recorta("function cancelarContorno(")}
    ${recorta("function guardarContorno(")}
    return { iniciarContorno, guardarContorno, enCurso: () => contornoEnCurso };
  `;
  const mapa = new Map();
  const siembra = { id: "S1", cultivo: "lechuga", geometria: P, area_m2: G.areaDePolygon(P) };
  mapa.set("R1", { referencia: "R1", geometria: P, siembras: [siembra] });
  const aviso = { v: "" }, guardadas = [];
  const ed = new Function("G", "mapa", "aviso", "guardadas", cuerpo)(G, mapa, aviso, guardadas);

  ed.iniciarContorno("R1", "S1");
  ok(ed.enCurso() === null, "el editor NO se abre sobre una geometría con agujeros");
  ok(/huecos que no se cultivan/.test(aviso.v), `y se dice por qué: "${aviso.v.slice(0, 60)}…"`);
  ok(siembra.area_m2 === areaAntes && siembra.geometria.coordinates.length === 2,
     "el cultivo conserva su área y sus dos anillos");

  // Y sobre una geometría SIN agujeros el editor sí abre, y el área sale del polígono.
  const siembra2 = { id: "S2", cultivo: "lechuga", geometria: rect(0, 0, .5, .5), area_m2: 1 };
  mapa.set("R2", { referencia: "R2", geometria: rect(0, 0, 1, 1), siembras: [siembra2] });
  ed.iniciarContorno("R2", "S2");
  ok(ed.enCurso() !== null, "sin agujeros el editor abre normalmente");
  ok(ed.enCurso().area_m2 === G.areaDePolygon(siembra2.geometria),
     "y su área sale del GeoJSON completo, no del anillo pelado");
  ed.guardarContorno();
  ok(siembra2.area_m2 === G.areaDePolygon(siembra2.geometria),
     `guardar sin mover nada deja el área igual a la del contorno (${siembra2.area_m2} m²)`);
}

console.log("\n── 2 · \"LO INDICARÉ DESPUÉS\" no hereda el riego de la finca ──");
{
  const CUERPO = `
    const window = { KyliaRiego: R };
    let cfgFinca = JSON.parse(localStorage.getItem("kylia_config") || "{}");
    let zonaActiva = localStorage.getItem("kylia_zona_activa") || null;
    const nombreCultivo = (c) => c;
    ${recorta("function zonasGuardadas(")}
    ${recorta("function parcelasDisponibles(")}
    ${recorta("function parcelaActiva(")}
    ${recorta("function configEfectiva(")}
    ${recorta("function payloadSiembra(")}
    ${recorta("function estable(")}
    return { parcelasDisponibles, payloadSiembra, ver: (id) => { zonaActiva = id; return configEfectiva(); } };
  `;
  const arrancar = (ls) => new Function("R", "localStorage", CUERPO)(R, ls);

  // Finca con aspersión y 11,2 — el riego que NO debe prestarse.
  const FINCA = { lat: 41.3, lon: 2.0, suelo: "franco", metodoRiego: "aspersion", caudal: 11.2 };
  const geom = rect(0, 0, .4, .4);
  const pendiente = {
    id: "N1", cultivo: "lechuga", area_m2: G.areaDePolygon(geom), fechaPlantacion: "2026-09-03",
    geometria: geom, metodoRiego: null, caudal: null, riegoPendiente: true,
    riego: { capacidad_mmh: null, unidad: "mm/h", fuente: "pendiente", confianza: "baja", datos: null },
    sync: { nueva: true, vista: null, confirmada: null, token: "t1" },
  };
  const ZONAS = [{ referencia: "R1", superficie_m2: 10004, geometria: rect(0, 0, 1, 1), siembras: [pendiente] }];
  // ← reload de verdad: instancia NUEVA leyendo del almacén.
  const app = arrancar(almacen({ kylia_config: FINCA, kylia_zonas: ZONAS }));

  const p = app.parcelasDisponibles().find(x => x.id === "N1");
  ok(p.riegoPendiente === true, "la marca sobrevive a parcelasDisponibles");
  const c = app.ver("N1");
  ok(c.metodoRiego === null, `configEfectiva NO hereda el método (${c.metodoRiego})`);
  ok(c.caudal === null, `ni el caudal (${c.caudal})`);
  const cap = R.capacidadVigente(pendiente, FINCA);
  ok(cap.motor === null && cap.operativo === null, "capacidadVigente no deja cruzar nada al motor");
  ok(cap.motivo === "riego_pendiente", `y dice por qué: ${cap.motivo}`);
  const est = R.estadoSiembra({ ...pendiente, lat: 41.3, lon: 2.0 }, FINCA,
    { cultivosSoportados: Object.keys(M.FAO_KC), hoy: "2026-09-17" });
  ok(est.lista_para_ejecutar_riego === false, "lista_para_ejecutar_riego = false");
  const pay = app.payloadSiembra(ZONAS[0], pendiente, FINCA, "dueno");
  ok(pay.metodo_riego === null && pay.caudal === null,
     "y el payload no manda método ni capacidad prestados");
  const pres = R.presentarRiegoSeguro(M.presentarRiego, 8,
    { metodoRiego: c.metodoRiego, caudalMmh: c.caudal, clase: c.capacidadRiego?.clase });
  ok(pres.unidad === "l_m2", `nada de minutos: "${pres.texto}"`);

  console.log("\n  ── método conocido, capacidad desconocida ──");
  const sinCap = { ...pendiente, id: "N2", metodoRiego: "goteo", riegoPendiente: false,
                   riego: { capacidad_mmh: null, fuente: "no_lo_se", confianza: "baja" } };
  const app2 = arrancar(almacen({ kylia_config: FINCA,
    kylia_zonas: [{ ...ZONAS[0], siembras: [sinCap] }] }));
  const c2 = app2.ver("N2");
  ok(c2.metodoRiego === "goteo", "el método que SÍ declaró se respeta");
  ok(c2.caudal === null, "y la capacidad sigue sin heredarse de la finca");

  console.log("\n  ── dos cultivos con capacidades propias ──");
  const A = { ...pendiente, id: "A", metodoRiego: "goteo", riegoPendiente: false, caudal: 6.7,
              riego: { capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "alta" } };
  const B = { ...pendiente, id: "B", metodoRiego: "aspersion", riegoPendiente: false, caudal: 20,
              geometria: rect(.5, 0, .9, .4),
              riego: { capacidad_mmh: 20, fuente: "medido_vaso", confianza: "alta" } };
  const app3 = arrancar(almacen({ kylia_config: FINCA, kylia_zonas: [{ ...ZONAS[0], siembras: [A, B] }] }));
  ok(app3.ver("A").caudal === 6.7 && app3.ver("B").caudal === 20, "cada uno con el suyo");
  ok(app3.ver("A").caudal !== 11.2 && app3.ver("B").caudal !== 11.2, "ninguno con el de la finca");

  console.log("\n  ── legacy sin el contrato nuevo: hereda, como siempre ──");
  const vieja = { id: "V", cultivo: "cebolla", area_m2: 440, fechaPlantacion: "2026-06-01", geometria: geom };
  const app4 = arrancar(almacen({ kylia_config: FINCA, kylia_zonas: [{ ...ZONAS[0], siembras: [vieja] }] }));
  const cv = app4.ver("V");
  ok(cv.metodoRiego === "aspersion" && cv.caudal === 11.2,
     "una histórica sin la marca sigue heredando método y caudal");
  const payV = app4.payloadSiembra(ZONAS[0], vieja, FINCA, "dueno");
  ok(payV.metodo_riego === "aspersion" && payV.caudal === 11.2,
     "y manda al servidor exactamente lo mismo que antes: su huella no se mueve");
}

console.log("\n── 3 · UN HISTORIAL VACÍO NO ES \"NO HA REGADO\" ──");
{
  // Clima controlado: 15 días, ET₀ 4 mm/día, sin lluvia.
  const dias = [];
  const base = new Date("2026-09-03T12:00:00Z");
  for (let i = 0; i < 15; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    dias.push({ date: d.toISOString().slice(0, 10), et0: 4, lluvia: 0, tmax: 26, tmin: 15 });
  }
  const o = { suelo: "franco", cultivoId: "lechuga", metodoRiego: "goteo",
              fechaPlantacion: "2026-09-03", termico: false,
              ventana: { desde: "2026-09-03", hasta: "2026-09-17" } };

  const desconocido = M.balanceHidrico(dias, [], { ...o, historialDesde: "2026-09-17" });
  ok(desconocido.aportesPreviosDesconocidos === 14,
     `plantada hace 14 días y dada de alta hoy: 14 días sin registro (${desconocido.aportesPreviosDesconocidos})`);
  ok(desconocido.confianzaBalance === "incierto",
     `el balance NO se declara conocido (${desconocido.confianzaBalance})`);

  // Y NO se suprime la recomendación: se sigue calculando, pero sin afirmarla.
  const dec = M.decisionRiego(desconocido, { lluviaPrevista: [] });
  ok(dec.nivel === "alta" && dec.cantidad_l_m2 > 0,
     `la lámina se sigue calculando (${dec.cantidad_l_m2} L/m²): no se suprime nada`);

  console.log("\n  ── se sale de la incertidumbre por EVIDENCIA, no por el tiempo ──");
  const mismoDia = M.balanceHidrico(dias, [], { ...o, historialDesde: "2026-09-03" });
  ok(mismoDia.aportesPreviosDesconocidos === 0 && mismoDia.confianzaBalance === "conocido",
     "plantada y dada de alta el mismo día: llevamos apuntando desde el día cero");
  const conRiegoPrevio = M.balanceHidrico(dias, [{ date: "2026-09-08", litros: 20 }],
    { ...o, historialDesde: "2026-09-17" });
  ok(conRiegoPrevio.aportesPreviosDesconocidos === 0 && conRiegoPrevio.confianzaBalance === "conocido",
     "un riego apuntado DENTRO del tramo previo cierra el hueco");
  const riegoPosterior = M.balanceHidrico(dias, [{ date: "2026-09-17", litros: 20 }],
    { ...o, historialDesde: "2026-09-17" });
  ok(riegoPosterior.aportesPreviosDesconocidos === 14,
     "pero un riego POSTERIOR no: no dice nada de lo que pasó antes");

  console.log("\n  ── no se toca lo que ya funcionaba ──");
  const legacy = M.balanceHidrico(dias, [], o);        // sin historialDesde
  ok(legacy.aportesPreviosDesconocidos === 0 && legacy.confianzaBalance === "conocido",
     "sin `historialDesde` el balance se comporta EXACTAMENTE como antes");
  const sinCifra = M.balanceHidrico(dias, [{ date: "2026-09-10", litros: null }],
    { ...o, historialDesde: "2026-09-03" });
  ok(sinCifra.riegosSinCantidad === 1 && sinCifra.confianzaBalance !== "conocido",
     "y el aviso de riego sin cifra sigue funcionando");

  console.log("\n  ── capacidad medida ≠ balance conocido ──");
  // Son condiciones distintas: se puede saber perfectamente a qué ritmo riega y
  // no tener ni idea de cuánto regó antes de darlo de alta.
  const cap = R.evaluarCapacidadRiego({ capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "alta" }, "goteo");
  ok(cap.puede_ejecutar === true, "la instalación está medida y da minutos fiables");
  ok(desconocido.confianzaBalance === "incierto",
     "y aun así el balance sigue siendo incierto: no se confunden las dos cosas");

  console.log("\n  ── y llega a la pantalla ──");
  ok(/aportesPreviosDesconocidos: bal\.aportesPreviosDesconocidos/.test(FUENTE),
     "el campo viaja del motor al adaptador");
  ok(/No sabemos cuánto regaste en los \$\{bal\.aportesPreviosDesconocidos\} días/.test(FUENTE),
     "y la tarjeta de riego lo dice con sus días");
  ok(/b\.aportesPreviosDesconocidos > 0/.test(FUENTE),
     "también cuando hoy no toca regar: tampoco eso se puede afirmar");
  ok(/historialDesde:  cfg\.registradoEl/.test(FUENTE), "la app le pasa desde cuándo hay registro");
  ok(/registradoEl: \(\(\) => \{ try \{ return KyliaClima\.hoyISO\(\)/.test(FUENTE),
     "y `nuevaSiembra` lo sella al crear el cultivo");
}

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
