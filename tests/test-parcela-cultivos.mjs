// Un terreno, los cultivos que el agricultor quiera llevar con Kylia.
//   node tests/test-parcela-cultivos.mjs
//
// ⚠️ YA NO SE PREGUNTA "¿CUÁNTOS CULTIVOS TIENES?". Obligaba a contarse el campo
// antes de entender qué le íbamos a pedir, y además no es lo que queremos
// saber: Kylia no gestiona su terreno entero, gestiona lo que él elija traer
// aquí. Se añade uno, y luego otro si quiere.
//
// Se prueba EJECUTANDO los módulos reales: la geometría, el catálogo, el flujo
// y el contrato de riego. El terreno de prueba mide de verdad lo que declara —
// un cuadrado de 100 m de lado son 10.000 m²—, porque toda la superficie sale
// del polígono y un fixture incoherente esconde fallos.
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

const Y0 = 41.3, dLat = 100 / 111320, dLon = 100 / 83600;
const pt = (x, y) => [x * dLon, Y0 + y * dLat];
const poly = (...ps) => ({ type: "Polygon", coordinates: [[...ps.map(([x, y]) => pt(x, y)), pt(ps[0][0], ps[0][1])]] });
const rect = (x0, y0, x1, y1) => poly([x0, y0], [x1, y0], [x1, y1], [x0, y1]);
const GEOM = rect(0, 0, 1, 1);
const TERRENO = { referencia: "R1", nombre: "El bancal de arriba",
                  superficie_m2: G.areaDePolygon(GEOM), geometria: GEOM };

function almacen() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null),
           setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

// Recorre el mini-flujo de un cultivo con las funciones REALES. La fecha y el
// riego pueden quedarse pendientes: eso es una respuesta válida, no un hueco.
function anadir(flujo, o = {}) {
  const c = C.desdeTexto(o.cultivo);
  let f = { ...flujo, borrador: { ...flujo.borrador, cultivoId: c.id, cultivo: c.nombre,
                                  soportado: C.soportado(c) } };
  f = P.avanzar(f, G);
  // La variedad SIEMPRE se contesta: o la sabe, o dice que no. Por defecto en
  // las pruebas se contesta "no la sé", que es una respuesta, no un hueco.
  f = { ...f, borrador: { ...f.borrador,
        variedad: o.variedad ?? null,
        variedadDesconocida: o.variedad ? false : true } };
  f = P.avanzar(f, G);
  f = { ...f, borrador: { ...f.borrador, geometria: o.geometria || null } };
  f = P.avanzar(f, G);
  f = { ...f, borrador: { ...f.borrador, fechaPlantacion: o.sinFecha ? null : o.fecha,
        fechaPrecision: o.sinFecha ? null : (o.precision || "exacta"), fechaPendiente: !!o.sinFecha } };
  f = P.avanzar(f, G);
  f = { ...f, borrador: { ...f.borrador, metodoRiego: o.sinRiego ? null : o.metodo,
        riegoPendiente: !!o.sinRiego, caudal: o.caudal ?? null, riego: o.riego || null,
        capacidadRegaderaL: o.regadera ?? null } };
  f = P.avanzar(f, G);                                  // riego → revisar
  // Identificado: `avanzar` cierra el cultivo sin pasar por la pantalla del
  // correo. Es el mismo camino que sigue quien ya tiene su correo guardado.
  return P.avanzar(f, G, { identificado: true });       // revisar → guardado
}

// ══════════════════════════════════════════════════════════════════
console.log("── el flujo ya no pregunta cuántos cultivos ──");
{
  ok(typeof P.responderCuantos === "undefined", "la pregunta ha desaparecido del módulo");
  ok(P.nuevoFlujo().paso === "terreno", "sin terreno, se arranca pidiéndolo");
  const f = P.elegirParcela(P.nuevoFlujo(), TERRENO);
  ok(f.paso === "cultivo", "y elegir terreno lleva DIRECTO al primer cultivo");
  ok(!!f.borrador && f.borrador.paso === "cultivo", "con su borrador listo");
  ok(JSON.stringify(P.PASOS) === JSON.stringify(
       ["terreno", "cultivo", "variedad", "superficie", "fecha", "riego",
        "revisar", "identificacion", "guardado"]),
     "el recorrido: terreno → cultivo → variedad → zona → fecha → riego → repaso → identificarse");
}

console.log("\n── §5 · la variedad se contesta, no se omite ──");
{
  const base = P.elegirParcela(P.nuevoFlujo(), TERRENO);
  const conCultivo = P.avanzar({ ...base, borrador: { ...base.borrador,
    cultivoId: "lechuga", cultivo: "Lechuga", soportado: true } }, G);
  ok(conCultivo.borrador.paso === "variedad", "después del cultivo se pregunta la variedad");
  ok(conCultivo.borrador.variedad === null && conCultivo.borrador.variedadDesconocida === null,
     "y nace SIN CONTESTAR: ni escrita ni declarada desconocida");
  ok(P.completo(conCultivo.borrador, "variedad") === false,
     "dejarla en blanco NO deja seguir: la omisión silenciosa no es una respuesta");
  ok(P.completo({ ...conCultivo.borrador, variedad: "   " }, "variedad") === false,
     "ni escribir espacios");
  ok(P.completo({ ...conCultivo.borrador, variedad: "Romana" }, "variedad") === true,
     "escribirla deja seguir");
  ok(P.completo({ ...conCultivo.borrador, variedadDesconocida: true }, "variedad") === true,
     "y decir que no se sabe, también: es una respuesta");
  // Se guarda como DESCONOCIDA, no como una variedad que se llame "No sé".
  let f = anadir(base, { cultivo: "Lechuga", geometria: GEOM, fecha: "2026-09-02",
                         metodo: "goteo", caudal: 6.7 });
  ok(f.cultivos[0].variedad === null && f.cultivos[0].variedadDesconocida === true,
     "\"no la sé\" se persiste como estado desconocido, no como nombre literal");
  let g = anadir(base, { cultivo: "Lechuga", variedad: "Romana", geometria: GEOM,
                         fecha: "2026-09-02", metodo: "goteo", caudal: 6.7 });
  ok(g.cultivos[0].variedad === "Romana" && g.cultivos[0].variedadDesconocida === false,
     "y la que sí sabe se conserva tal cual");
  // Volver atrás no la borra.
  const atras = P.atras({ ...conCultivo, borrador: { ...conCultivo.borrador,
    variedad: "Romana", variedadDesconocida: false, paso: "superficie" } });
  ok(atras.borrador.variedad === "Romana", "y volver atrás la conserva");
}

console.log("\n── §1 · identificarse: solo quien no lo está ──");
{
  ok(P.siguientePaso("revisar", { identificado: false }) === "identificacion",
     "sin identificar, después del repaso se pide el correo");
  ok(P.siguientePaso("revisar", { identificado: true }) === "hecho",
     "y quien ya tiene sesión NO vuelve a identificarse");
  ok(P.PASOS.indexOf("identificacion") > P.PASOS.indexOf("revisar"),
     "el correo se pide DESPUÉS de enseñar lo que se va a guardar, no antes");
}

console.log("\n── §9 · el resumen es editable y distingue lo desconocido ──");
{
  let f = P.elegirParcela(P.nuevoFlujo(), TERRENO);
  f = { ...f, borrador: { ...f.borrador, cultivoId: "lechuga", cultivo: "Lechuga",
        soportado: true, variedadDesconocida: true, geometria: GEOM,
        area_m2: G.areaDePolygon(GEOM), fechaPlantacion: null, fechaPendiente: true,
        metodoRiego: "goteo", riego: { capacidad_mmh: null }, paso: "revisar" } };
  const r = P.resumen(f, (id) => (id === "lechuga" ? "Lechuga" : id));
  const por = (k) => r.find(x => x.clave === k);
  ok(por("cultivo").valor === "Lechuga", "el resumen nombra el cultivo");
  ok(por("variedad").valor === "No la sabe" && por("variedad").conocido === false,
     "la variedad desconocida se DICE, y se marca como no conocida");
  ok(por("fecha").valor === "Lo dirá después" && por("fecha").conocido === false,
     "la fecha pendiente igual: no se inventa un día");
  ok(por("instalacion").valor === "Sin medir" && por("instalacion").conocido === false,
     "y la instalación sin medir se distingue del método declarado");
  ok(r.filter(x => x.paso).length >= 5, "cada línea corregible lleva a su pantalla");
  // Corregir una cosa desde el resumen y volver AL RESUMEN.
  const editando = P.irAPaso(f, "variedad");
  ok(editando.borrador.paso === "variedad" && editando.borrador.volverARevisar === true,
     "tocar una línea abre esa pantalla");
  const vuelta = P.avanzar({ ...editando, borrador: { ...editando.borrador, variedad: "Romana" } }, G);
  ok(vuelta.borrador.paso === "revisar",
     "y al confirmarla se vuelve al repaso, no se recorre todo otra vez");
  ok(vuelta.borrador.variedad === "Romana", "con el cambio hecho");
}

console.log("\n── un cultivo que ocupa todo el terreno ──");
{
  let f = P.elegirParcela(P.nuevoFlujo(), TERRENO);
  ok(P.puedeUsarTodo(f) === true, "con el terreno vacío se puede usar entero");
  f = P.usarTodoElTerreno(f);
  ok(JSON.stringify(f.borrador.geometria) === JSON.stringify(GEOM),
     "y copia su contorno EXACTO, sin dibujar de cero");
  ok(f.borrador.area_m2 === null, "sin superficie declarada: esa sale del polígono");
  f = anadir(f, { cultivo: "Lechuga", geometria: GEOM, fecha: "2026-09-02", metodo: "goteo", caudal: 6.7 });
  ok(f.cultivos[0].area_m2 === G.areaDePolygon(GEOM),
     `el área guardada sale del GeoJSON (${f.cultivos[0].area_m2} m²)`);
  ok(P.reparto(TERRENO, f.cultivos).sin_configurar === 0, "nada sin configurar");
  ok(f.paso === "guardado", "y se va a la pantalla de guardado");
}

console.log("\n── un terreno parcialmente gestionado (caso D) ──");
{
  let f = P.elegirParcela(P.nuevoFlujo(), TERRENO);
  f = anadir(f, { cultivo: "Lechuga", geometria: rect(0, 0, .4, .4), fecha: "2026-09-02", metodo: "goteo", caudal: 6.7 });
  const r = P.reparto(TERRENO, f.cultivos);
  ok(r.asignado > 0 && r.sin_configurar > 0,
     `${r.asignado} m² configurados y ${r.sin_configurar} m² sin configurar en Kylia`);
  ok(r.excedido === 0, "nada excedido");
  ok(f.paso === "guardado", "y el alta TERMINA igual: no se obliga a llenar el terreno");
  ok(P.puedeUsarTodo(f) === false, "con un cultivo dentro ya no se ofrece usarlo entero");
  const i = P.usarTodoElTerreno(P.anadirOtro(f));
  ok(i.borrador.geometria === null && i.borrador.area_m2 === null,
     "y si alguien llama la función igual, no asigna metros sin polígono");
}

console.log("\n── varios cultivos, cada uno con LO SUYO (caso B) ──");
{
  let f = P.elegirParcela(P.nuevoFlujo(), TERRENO);
  f = anadir(f, { cultivo: "Lechuga", geometria: rect(0, 0, .4, .5), fecha: "2026-09-02",
                  precision: "aproximada", metodo: "goteo", caudal: 6.7,
                  riego: { capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "alta" } });
  f = anadir(P.anadirOtro(f), { cultivo: "tomàquet", geometria: rect(.4, 0, .8, .5), fecha: "2026-09-08",
                  metodo: "aspersion", caudal: 11.2,
                  riego: { capacidad_mmh: 11.2, fuente: "medido_vaso", confianza: "alta" } });
  const [a, b] = f.cultivos;
  ok(b.cultivo === "tomate", "un sinónimo en catalán lleva al identificador canónico");
  ok(a.fechaPlantacion !== b.fechaPlantacion, "fechas propias");
  ok(a.metodoRiego !== b.metodoRiego, "métodos propios");
  ok(a.caudal !== b.caudal, `caudales propios (${a.caudal} / ${b.caudal})`);
  ok(a.riego.fuente === "derivado_goteo" && b.riego.fuente === "medido_vaso", "procedencias propias");
  ok(a.area_m2 !== b.area_m2 || a.geometria !== b.geometria, "geometrías propias");
  ok(!G.seSolapan(a.geometria, b.geometria), "y no se pisan: están pegados por la linde");
  ok(R.caudalMotor(a, {}) === 6.7 && R.caudalMotor(b, {}) === 11.2,
     "al motor le llega el de cada uno, sin heredar del vecino");
}

console.log("\n── la fecha aproximada SIGUE siendo aproximada ──");
{
  let f = P.elegirParcela(P.nuevoFlujo(), TERRENO);
  f = anadir(f, { cultivo: "Lechuga", geometria: rect(0, 0, .4, .4),
                  fecha: "2026-09-03", precision: "aproximada", metodo: "surco" });
  ok(f.cultivos[0].fechaPrecision === "aproximada",
     "\"hace unas dos semanas\" no se guarda como un día declarado por él");
  let g = P.elegirParcela(P.nuevoFlujo(), TERRENO);
  g = anadir(g, { cultivo: "Lechuga", geometria: rect(0, 0, .4, .4),
                  fecha: "2026-09-03", precision: "exacta", metodo: "surco" });
  ok(g.cultivos[0].fechaPrecision === "exacta", "y elegir fecha en el calendario, sí");
}

console.log("\n── datos pendientes: se registra igual (caso C) ──");
{
  let f = P.elegirParcela(P.nuevoFlujo(), TERRENO);
  f = anadir(f, { cultivo: "Lechuga", geometria: rect(0, 0, .4, .4), sinFecha: true, sinRiego: true });
  const c = f.cultivos[0];
  ok(f.paso === "guardado" && f.cultivos.length === 1, "el cultivo queda REGISTRADO");
  ok(c.fechaPlantacion === null && c.fechaPrecision === null, "sin fecha inventada");
  ok(c.metodoRiego === null, "y sin método inventado");
  ok(c.area_m2 > 0 && !!c.geometria, "pero con su superficie y su contorno, que sí dijo");
  const p = P.pendientesDe(c, R);
  ok(p.some(x => x.clave === "fecha") && p.some(x => x.clave === "metodo"),
     "y los pendientes se expresan como acción concreta");
  ok(/Falta decirnos cuándo/.test(p[0].texto), `"${p[0].texto}"`);
  // Sin método no hay minutos, ni fiables ni de ningún tipo.
  ok(R.evaluarCapacidadRiego(c.riego, c.metodoRiego).puede_ejecutar === false,
     "sin método, cero minutos");
}

console.log("\n── los TRES estados no son el mismo ──");
{
  const base = { lat: 41.3, lon: 2.0, area_m2: 1000, cultivo: "lechuga" };
  const CUL = Object.keys(MOTOR.FAO_KC), HOY = "2026-09-17";
  const est = (s) => R.estadoSiembra({ ...base, ...s }, { suelo: "franco" }, { cultivosSoportados: CUL, hoy: HOY });
  const sinFecha = est({ fechaPlantacion: null, metodoRiego: "goteo" });
  ok(sinFecha.lista_para_calcular_agua === false, "1 · registrado pero sin fecha: no se puede calcular agua");
  const conAgua = est({ fechaPlantacion: "2026-09-02", metodoRiego: "goteo" });
  ok(conAgua.lista_para_calcular_agua === true, "2 · con fecha y método: ya se puede calcular el agua");
  ok(conAgua.lista_para_ejecutar_riego === false, "   pero no los minutos: falta medir la instalación");
  const conTodo = est({ fechaPlantacion: "2026-09-02", metodoRiego: "goteo",
    riego: { capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "alta" } });
  ok(conTodo.lista_para_ejecutar_riego === true, "3 · con la instalación medida: minutos fiables");
  // Una caída de clima NO devuelve al agricultor al onboarding.
  const d = R.estadoDecision(conTodo, { coberturaClima: 0.3 });
  ok(conTodo.estado_configuracion === "completa" && d.estado_decision === "esperando_datos",
     "y una caída del clima no convierte su configuración en incompleta");
}

console.log("\n── cultivo libre: se registra, no entra al motor (caso E) ──");
{
  let f = P.elegirParcela(P.nuevoFlujo(), TERRENO);
  f = anadir(f, { cultivo: "quinoa", geometria: rect(0, 0, .3, .3), fecha: "2026-08-20", metodo: "surco" });
  const c = f.cultivos[0];
  ok(c.cultivo === "otro:quinoa", "conserva su identidad");
  ok(C.porId(c.cultivo).kcId === null, "con kcId null: no se le presta el Kc de otro");
  ok(MOTOR.FAO_KC[c.cultivo] === undefined, "y el motor no lo conoce");
  ok(c.soportado === false, "queda marcado como no soportado");
  ok(P.pendientesDe(c, R).some(x => x.clave === "sin_motor"), "y se dice en sus pendientes");
}

console.log("\n── volver atrás no pierde nada ──");
{
  let f = P.elegirParcela(P.nuevoFlujo(), TERRENO);
  f = { ...f, borrador: { ...f.borrador, cultivoId: "lechuga", cultivo: "Lechuga", soportado: true } };
  f = P.avanzar(f, G);
  f = { ...f, borrador: { ...f.borrador, variedad: "Romana", variedadDesconocida: false } };
  f = P.avanzar(f, G);
  f = { ...f, borrador: { ...f.borrador, geometria: rect(0, 0, .4, .4) } };
  f = P.avanzar(f, G);
  f = { ...f, borrador: { ...f.borrador, fechaPlantacion: "2026-09-02", fechaPrecision: "exacta" } };
  f = P.avanzar(f, G);
  ok(f.borrador.paso === "riego", "estamos en el riego");
  const atras = P.atras(f);
  ok(atras.borrador.paso === "fecha", "atrás vuelve a la fecha");
  ok(atras.borrador.cultivoId === "lechuga" && !!atras.borrador.geometria
     && atras.borrador.fechaPlantacion === "2026-09-02"
     && atras.borrador.variedad === "Romana",
     "y CONSERVA cultivo, variedad, contorno y fecha: retroceder no borra");
}

console.log("\n── el borrador se guarda y se retoma (caso G) ──");
{
  const ls = almacen();
  let f = P.elegirParcela(P.nuevoFlujo(), TERRENO);
  f = { ...f, borrador: { ...f.borrador, cultivoId: "lechuga", paso: "fecha",
                          geometria: rect(0, 0, .4, .4) } };
  ok(P.guardarBorrador(ls, f) === true, "se guarda");
  const r = P.leerBorrador(ls);
  ok(!!r && r.parcela.referencia === "R1" && r.borrador.paso === "fecha",
     "y se recupera en el mismo paso");
  ok(r.borrador.cultivoId === "lechuga" && !!r.borrador.geometria, "con lo contestado intacto");
  // ⚠️ UN BORRADOR NO ES UNA SIEMBRA: recuperarlo no crea nada.
  ok(r.cultivos.length === 0, "y no ha creado ningún cultivo por el camino");
  ok(P.borrarBorrador(ls) === true && P.leerBorrador(ls) === null, "y se puede borrar");
  ok(P.leerBorrador(almacen()) === null, "sin borrador guardado, no hay nada que retomar");
}

console.log("\n── guardar dos veces no duplica ──");
{
  let f = P.elegirParcela(P.nuevoFlujo(), TERRENO);
  f = anadir(f, { cultivo: "Lechuga", geometria: rect(0, 0, .4, .4), fecha: "2026-09-02", metodo: "surco" });
  ok(f.cultivos.length === 1, "un cultivo");
  const otra = P.guardarCultivo(f, G);
  ok(otra.cultivos.length === 1, "y volver a guardar no lo duplica");
}

console.log("\n── reload: se conserva todo ──");
{
  let f = P.elegirParcela(P.nuevoFlujo(), TERRENO);
  f = anadir(f, { cultivo: "Lechuga", geometria: rect(0, 0, .4, .5), fecha: "2026-09-02",
                  precision: "aproximada", metodo: "goteo", caudal: 6.7,
                  riego: { capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "alta" } });
  f = anadir(P.anadirOtro(f), { cultivo: "Col o coliflor", geometria: rect(.4, 0, .8, .5),
                  sinFecha: true, metodo: "aspersion", caudal: 11.2,
                  riego: { capacidad_mmh: 11.2, fuente: "medido_vaso", confianza: "alta" } });
  const zona = { referencia: TERRENO.referencia, superficie_m2: TERRENO.superficie_m2,
                 geometria: TERRENO.geometria, siembras: f.cultivos };
  const releida = JSON.parse(JSON.stringify(zona));
  const [a, b] = releida.siembras;
  ok(a.area_m2 === G.areaDePolygon(a.geometria) && b.area_m2 === G.areaDePolygon(b.geometria),
     "las áreas siguen coincidiendo con su GeoJSON");
  ok(a.fechaPrecision === "aproximada" && b.fechaPlantacion === null,
     "la precisión de la fecha y el pendiente sobreviven");
  ok(a.caudal !== b.caudal && a.riego.fuente !== b.riego.fuente, "los riegos siguen separados");
  const r = P.reparto(releida, releida.siembras);
  ok(r.asignado === a.area_m2 + b.area_m2, "y el reparto se recalcula solo");
}

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
