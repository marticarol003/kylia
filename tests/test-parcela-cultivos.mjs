// Una parcela, varios cultivos, y cada uno con lo suyo.
//   node tests/test-parcela-cultivos.mjs
//
// El alta anterior preguntaba "¿cultivas todo el recinto o solo una parte?" y
// esa pregunta ya decidía por el agricultor: induce a pensar en UN cultivo. Un
// recinto con lechuga, col y un pasillo sin plantar no cabía en ella.
//
// Se prueba EJECUTANDO los módulos reales: la geometría (assets/js/geo-parcela.js),
// el catálogo (assets/js/cultivos.js) y el flujo (assets/js/parcela-cultivos.js).
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const G = require(join(RAIZ, "assets", "js", "geo-parcela.js"));
const C = require(join(RAIZ, "assets", "js", "cultivos.js"));
const P = require(join(RAIZ, "assets", "js", "parcela-cultivos.js"));
const R = require(join(RAIZ, "assets", "js", "riego-capacidad.js"));
const MOTOR = require(join(RAIZ, "assets", "js", "motor-riego.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

// Una parcela cuadrada de 10×10 unidades. Las áreas reales las calcula areaM2;
// aquí lo que importa es el reparto y las reglas, así que la superficie oficial
// se declara aparte, como hace SIGPAC.
const cuad = (x0, y0, x1, y1) => ({ type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
const PARCELA = { referencia: "R1", nombre: "El bancal de arriba",
                  superficie_m2: 5226, geometria: cuad(0, 0, 10, 10) };

// Recorre el mini-flujo de un cultivo con las funciones reales.
function anadir(flujo, { cultivo, area, geometria, fecha, metodo, caudal, riego }) {
  const c = C.desdeTexto(cultivo);
  let f = { ...flujo, borrador: { ...flujo.borrador, cultivoId: c.id, soportado: C.soportado(c) } };
  f = P.avanzar(f);
  f = { ...f, borrador: { ...f.borrador, area_m2: area, geometria: geometria || null } };
  f = P.avanzar(f);
  f = { ...f, borrador: { ...f.borrador, fechaPlantacion: fecha } };
  f = P.avanzar(f);
  f = { ...f, borrador: { ...f.borrador, metodoRiego: metodo, caudal: caudal ?? null, riego: riego || null } };
  return P.avanzar(f);
}

// ══════════════════════════════════════════════════════════════════
console.log("── 1 parcela + 1 cultivo ocupando TODO ──");
{
  let f = P.responderCuantos(P.elegirParcela(P.nuevoFlujo(), PARCELA), "uno");
  ok(f.borrador.ocupaTodo === true, "con un solo cultivo se propone que ocupe la parcela entera");
  ok(f.borrador.area_m2 === 5226, `y su superficie viene puesta (${f.borrador.area_m2} m²)`);
  ok(f.borrador.geometria === PARCELA.geometria, "sin obligarle a dibujar de cero");
  f = anadir(f, { cultivo: "Lechuga", area: 5226, geometria: PARCELA.geometria,
                  fecha: "2026-09-02", metodo: "goteo", caudal: 6.7 });
  const r = P.reparto(PARCELA, f.cultivos);
  ok(r.asignado === 5226 && r.sin_asignar === 0, "todo asignado, nada libre");
  ok(f.paso === "resumen", "y se va al resumen");
  // Ocupar la parcela entera es válido: comparte los cuatro lados con ella.
  ok(G.contenidoEn(PARCELA.geometria, PARCELA.geometria) === true,
     "un cultivo que ocupa toda la parcela NO se considera fuera de ella");
}

console.log("\n── 1 parcela + 1 cultivo ocupando SOLO UNA PARTE ──");
{
  let f = P.responderCuantos(P.elegirParcela(P.nuevoFlujo(), PARCELA), "uno");
  f = anadir(f, { cultivo: "Lechuga", area: 2000, geometria: cuad(0, 0, 5, 5),
                  fecha: "2026-09-02", metodo: "goteo", caudal: 6.7 });
  const r = P.reparto(PARCELA, f.cultivos);
  ok(r.asignado === 2000 && r.sin_asignar === 3226, `quedan ${r.sin_asignar} m² sin asignar`);
  ok(r.excedido === 0, "y nada excedido");
}

console.log("\n── 1 parcela + 3 cultivos, con superficie restante ──");
{
  let f = P.responderCuantos(P.elegirParcela(P.nuevoFlujo(), PARCELA), "varios");
  f = anadir(f, { cultivo: "Lechuga", area: 2174, geometria: cuad(0, 0, 4, 5), fecha: "2026-09-02", metodo: "goteo", caudal: 6.7 });
  f = P.anadirOtro(f);
  f = anadir(f, { cultivo: "Col o coliflor", area: 1880, geometria: cuad(4, 0, 8, 5), fecha: "2026-09-08", metodo: "aspersion", caudal: 11.2 });
  f = P.anadirOtro(f);
  f = anadir(f, { cultivo: "Alcachofa", area: 1000, geometria: cuad(0, 5, 4, 9), fecha: "2026-08-20", metodo: "surco" });
  ok(f.cultivos.length === 3, "tres cultivos en la misma parcela");
  const r = P.reparto(PARCELA, f.cultivos);
  ok(r.asignado === 5054, `asignado ${r.asignado} m²`);
  ok(r.sin_asignar === 172, `sin asignar ${r.sin_asignar} m² — el pasillo, y NO es un error`);
  ok(r.excedido === 0, "nada excedido");

  console.log("\n── cada cultivo con SU fecha y SU riego ──");
  const [a, b, c] = f.cultivos;
  ok(a.fechaPlantacion === "2026-09-02" && b.fechaPlantacion === "2026-09-08" && c.fechaPlantacion === "2026-08-20",
     "tres fechas distintas, ninguna a nivel de parcela");
  ok(a.metodoRiego === "goteo" && b.metodoRiego === "aspersion" && c.metodoRiego === "surco",
     "tres métodos distintos");
  ok(a.caudal === 6.7 && b.caudal === 11.2 && c.caudal === null,
     `tres caudales independientes (${a.caudal} / ${b.caudal} / ${c.caudal})`);
  ok(new Set(f.cultivos.map(x => x.cultivo)).size === 3, "y tres cultivos distintos");

  console.log("\n── cultivo soportado vs NO soportado ──");
  ok(a.soportado === true && b.soportado === true, "lechuga y col: el motor los conoce");
  ok(c.soportado === false, "alcachofa: se REGISTRA, pero el motor no la calcula");
  ok(MOTOR.FAO_KC[c.cultivo] === undefined, "y efectivamente no tiene curva de Kc");
  ok(C.porId(c.cultivo).kcId === null, "sin kcId: no se le asigna el de un cultivo parecido");
  ok(C.soportado(C.desdeTexto("Alcachofa")) === false, "el catálogo lo dice claramente");
}

console.log("\n── se impide lo imposible, no lo incompleto ──");
{
  let f = P.responderCuantos(P.elegirParcela(P.nuevoFlujo(), PARCELA), "varios");
  f = anadir(f, { cultivo: "Lechuga", area: 2174, geometria: cuad(0, 0, 5, 5), fecha: "2026-09-02", metodo: "goteo", caudal: 6.7 });

  const solapa = P.cabe(G, { area_m2: 1000, geometria: cuad(3, 3, 8, 8) }, PARCELA, f.cultivos);
  ok(solapa.ok === false && solapa.motivo === "se_solapa", "un cultivo que pisa a otro se rechaza");
  ok(/pisa con otro cultivo/.test(P.explicar("se_solapa")), "y se dice en cristiano");

  const fuera = P.cabe(G, { area_m2: 1000, geometria: cuad(8, 8, 14, 14) }, PARCELA, f.cultivos);
  ok(fuera.ok === false && fuera.motivo === "fuera_de_la_parcela", "y uno que se sale de la parcela, también");

  const pegado = P.cabe(G, { area_m2: 1000, geometria: cuad(5, 0, 9, 5) }, PARCELA, f.cultivos);
  ok(pegado.ok === true, "pero dos bancales PEGADOS por la linde valen: es lo normal en un campo");

  const pasa = P.cabe(G, { area_m2: 1000, geometria: cuad(0, 6, 4, 9) }, PARCELA, f.cultivos);
  ok(pasa.ok === true, "y uno que cabe, pasa");

  // Lo que NO se exige: llenar la parcela.
  const r = P.reparto(PARCELA, f.cultivos);
  ok(r.sin_asignar > 0, "queda superficie sin asignar y el flujo sigue: nadie obliga a llenarla");
}

console.log("\n── \"usar toda la superficie disponible\" ──");
{
  let f = P.responderCuantos(P.elegirParcela(P.nuevoFlujo(), PARCELA), "varios");
  f = anadir(f, { cultivo: "Lechuga", area: 2000, geometria: cuad(0, 0, 5, 5), fecha: "2026-09-02", metodo: "goteo", caudal: 6.7 });
  f = P.usarTodoLoLibre(P.anadirOtro(f));
  ok(f.borrador.area_m2 === 3226, `el segundo cultivo coge los ${f.borrador.area_m2} m² que quedaban`);
  ok(f.borrador.geometria === null,
     "pero sin heredar el contorno de la parcela: con un vecino dentro, ese trozo no lo sabemos dibujar solos");
  // Con la parcela vacía sí puede heredarlo.
  let g = P.usarTodoLoLibre(P.responderCuantos(P.elegirParcela(P.nuevoFlujo(), PARCELA), "varios"));
  ok(g.borrador.geometria === PARCELA.geometria, "con la parcela vacía, sí hereda el contorno entero");
}

console.log("\n── añadir un cultivo DESPUÉS, sobre una parcela ya hecha ──");
{
  let f = P.responderCuantos(P.elegirParcela(P.nuevoFlujo(), PARCELA), "uno");
  f = anadir(f, { cultivo: "Lechuga", area: 2000, geometria: cuad(0, 0, 5, 5), fecha: "2026-09-02", metodo: "goteo", caudal: 6.7 });
  ok(f.paso === "resumen", "el primero queda guardado");
  const antes = f.cultivos.length;
  f = P.anadirOtro(f);
  ok(f.paso === "cultivo" && f.borrador.cultivo === null,
     "añadir otro vuelve al flujo del cultivo, con el borrador limpio");
  ok(f.parcela === PARCELA, "y SIN volver a preguntar la parcela");
  f = anadir(f, { cultivo: "Espinaca", area: 1200, geometria: cuad(5, 0, 9, 4), fecha: "2026-09-10", metodo: "goteo", caudal: 4.5 });
  ok(f.cultivos.length === antes + 1, "el segundo se añade al mismo sitio");
  ok(f.cultivos[0].fechaPlantacion !== f.cultivos[1].fechaPlantacion, "sin contagiarle la fecha del primero");
  ok(f.cultivos[0].caudal !== f.cultivos[1].caudal, "ni el caudal");
}

console.log("\n── añadir una PARCELA después: el mismo flujo ──");
{
  // "+ Añadir parcela" no puede ser otro formulario: es el mismo flujo,
  // empezando por elegir parcela. Si fueran dos implementaciones, divergirían.
  const f1 = P.nuevoFlujo();
  ok(f1.paso === "parcela", "sin parcela, el flujo arranca pidiéndola");
  const f2 = P.nuevoFlujo(PARCELA);
  ok(f2.paso === "cuantos", "con parcela ya elegida, arranca en \"¿cuántos cultivos?\"");
  // Y una parcela nueva no arrastra los cultivos de la anterior.
  let f = P.responderCuantos(P.elegirParcela(P.nuevoFlujo(), PARCELA), "uno");
  f = anadir(f, { cultivo: "Lechuga", area: 2000, fecha: "2026-09-02", metodo: "goteo", caudal: 6.7 });
  const otra = P.elegirParcela(f, { referencia: "R2", superficie_m2: 900, geometria: cuad(20, 20, 24, 24) });
  ok(otra.cultivos.length === 0, "elegir otra parcela empieza de cero");
  ok(otra.parcela.referencia === "R2", "y con la parcela nueva");
}

console.log("\n── \"ahora mismo ninguno\" ──");
{
  const f = P.responderCuantos(P.elegirParcela(P.nuevoFlujo(), PARCELA), "ninguno");
  ok(f.paso === "resumen" && f.cultivos.length === 0,
     "una parcela puede quedarse registrada sin cultivos");
  ok(P.reparto(PARCELA, f.cultivos).sin_asignar === 5226, "con toda su superficie sin asignar");
}

console.log("\n── no se puede saltar una pregunta ──");
{
  let f = P.responderCuantos(P.elegirParcela(P.nuevoFlujo(), PARCELA), "varios");
  const igual = P.avanzar(f);
  ok(igual.borrador.paso === "cultivo", "sin cultivo no se pasa de pantalla");
  f = { ...f, borrador: { ...f.borrador, cultivoId: "lechuga", soportado: true } };
  f = P.avanzar(f);
  ok(f.borrador.paso === "superficie", "con cultivo, sí");
  ok(P.avanzar(f).borrador.paso === "superficie", "y sin superficie no se sigue");
  ok(P.completo({ metodoRiego: null }, "riego") === false, "ni sin método de riego");
}

console.log("\n── el autocompletado ──");
{
  ok(C.buscar("le")[0].nombre === "Lechuga", "escribir \"le\" propone Lechuga la primera");
  ok(C.buscar("alca").some(c => c.nombre === "Alcachofa"), "\"alca\" encuentra Alcachofa");
  ok(C.buscar("col").some(c => c.nombre === "Col o coliflor"), "\"col\" encuentra la col");
  ok(C.desdeTexto("enciam").id === "lechuga", "un sinónimo lleva al identificador canónico");
  ok(C.desdeTexto("Tomàquet").id === "tomate", "también con acentos y en catalán");
  const raro = C.desdeTexto("quinoa");
  ok(raro.id.startsWith("otro:") && raro.kcId === null,
     "un cultivo que no está en la lista SE REGISTRA igual, sin motor");
  ok(C.buscar("")[0] && C.SOPORTADOS.includes(C.buscar("")[0]),
     "con el campo vacío se proponen los que el motor sí sabe calcular");
  // Ni un solo Kc prestado.
  const sinMotor = C.CATALOGO.filter(c => !C.soportado(c));
  ok(sinMotor.every(c => c.kcId === null), `los ${sinMotor.length} no soportados no tienen kcId`);
  ok(C.SOPORTADOS.every(c => MOTOR.FAO_KC[c.kcId]), "y los 8 soportados sí tienen curva en el motor");
}

console.log("\n── el riego de cada cultivo respeta el contrato desplegado ──");
{
  // No se reabre la semántica de 74260fe: se usa tal cual.
  let f = P.responderCuantos(P.elegirParcela(P.nuevoFlujo(), PARCELA), "varios");
  const cap = R.capacidadGoteo({ l_h_gotero: 2, sep_goteros_m: 0.30, sep_lineas_m: 1 });
  f = anadir(f, { cultivo: "Lechuga", area: 2000, geometria: cuad(0, 0, 5, 5), fecha: "2026-09-02",
                  metodo: "goteo", caudal: cap.valor,
                  riego: { capacidad_mmh: cap.valor, fuente: cap.fuente, confianza: cap.confianza } });
  f = P.anadirOtro(f);
  f = anadir(f, { cultivo: "Alcachofa", area: 1000, geometria: cuad(5, 0, 9, 4), fecha: "2026-08-20",
                  metodo: "goteo", caudal: null,
                  riego: { capacidad_mmh: null, fuente: "no_lo_se", confianza: "baja" } });
  const [a, b] = f.cultivos;
  ok(R.evaluarCapacidadRiego(a.riego, a.metodoRiego).clase === "fiable", "el derivado sale fiable");
  ok(R.evaluarCapacidadRiego(b.riego, b.metodoRiego).clase === "no_ejecutable", "el \"no lo sé\", no ejecutable");
  ok(R.caudalMotor(a, {}) === 6.7 && R.caudalMotor(b, {}) === null,
     "y al motor va el de cada uno, sin heredar del vecino");
}

console.log("\n── reload: se conserva todo ──");
{
  let f = P.responderCuantos(P.elegirParcela(P.nuevoFlujo(), PARCELA), "varios");
  f = anadir(f, { cultivo: "Lechuga", area: 2174, geometria: cuad(0, 0, 4, 5), fecha: "2026-09-02", metodo: "goteo", caudal: 6.7,
                  riego: { capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "alta" } });
  f = P.anadirOtro(f);
  f = anadir(f, { cultivo: "Col o coliflor", area: 1880, geometria: cuad(4, 0, 8, 5), fecha: "2026-09-08", metodo: "aspersion", caudal: 11.2,
                  riego: { capacidad_mmh: 11.2, fuente: "medido_vaso", confianza: "alta" } });

  // Se serializa como se guardará en kylia_zonas y se vuelve a leer.
  const zona = { referencia: PARCELA.referencia, nombre: PARCELA.nombre,
                 superficie_m2: PARCELA.superficie_m2, geometria: PARCELA.geometria,
                 siembras: f.cultivos };
  const releido = JSON.parse(JSON.stringify([zona]))[0];
  const [a, b] = releido.siembras;
  ok(a.geometria && b.geometria && a.geometria.type === "Polygon", "las geometrías sobreviven");
  ok(a.area_m2 === 2174 && b.area_m2 === 1880, "las superficies");
  ok(a.fechaPlantacion === "2026-09-02" && b.fechaPlantacion === "2026-09-08", "las fechas, distintas");
  ok(a.caudal === 6.7 && b.caudal === 11.2, "los caudales, distintos");
  ok(a.riego.fuente === "derivado_goteo" && b.riego.fuente === "medido_vaso", "y su procedencia");
  const r = P.reparto(releido, releido.siembras);
  ok(r.asignado === 4054 && r.sin_asignar === 1172,
     `y el reparto se recalcula solo: ${r.asignado} asignados, ${r.sin_asignar} sin asignar`);
}

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
