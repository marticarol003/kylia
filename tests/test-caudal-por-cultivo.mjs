// Dos cultivos, dos caudales, y ninguna lectura posterior vuelve al global.
//   node tests/test-caudal-por-cultivo.mjs
//
// QUÉ SE PRUEBA Y POR QUÉ ASÍ. La cadena entera, con las funciones REALES de
// app/index.html y sin sustituir ninguna por un doble:
//
//   alta → kylia_zonas → [reload] → parcelasDisponibles → parcelaActiva
//        → configEfectiva → motor
//
// El "reload" es literal: se construye una instancia NUEVA del cliente leyendo
// el mismo localStorage, porque un caudal que solo viva en memoria no sirve de
// nada — el agricultor cierra la app.
//
// ⚠️ ESTE TEST NACIÓ CAZANDO UN FALLO QUE OTRO TEST NO VIO. La primera versión
// sustituía `parcelaActiva` por la siembra directamente y pasaba en verde. Con
// la cadena real salió que `parcelasDisponibles()` NO copiaba `caudal` ni
// `riego` de la siembra: `p.caudal` era siempre undefined y TODOS los cultivos
// volvían a caer al caudal de la finca. El defecto entero, intacto, detrás de
// una `configEfectiva` que parecía arreglada.
//
// MEDIDO EN PRODUCCIÓN el 16-sep, que es de donde sale el caso de prueba: el
// propietario c46e9d6d tiene CUATRO siembras, cada una con su fila en `usuarios`
// (mismo propietario_id, id distinto) — y las cuatro llevan `caudal: 1.8`,
// incluida `eff32768`, que riega por ASPERSIÓN. Un aspersor corriendo al caudal
// de un goteo.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const R = require(join(RAIZ, "assets", "js", "riego-capacidad.js"));
const MOTOR = require(join(RAIZ, "assets", "js", "motor-riego.js"));
const FUENTE = readFileSync(join(RAIZ, "app", "index.html"), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

function recorta(marca) {
  const i = FUENTE.indexOf(marca);
  if (i < 0) throw new Error(`no encuentro: ${marca}`);
  let k = FUENTE.indexOf("(", i), prof = 0;
  for (; k < FUENTE.length; k++) {
    if (FUENTE[k] === "(") prof++;
    else if (FUENTE[k] === ")" && --prof === 0) { k++; break; }
  }
  while (k < FUENTE.length && FUENTE[k] !== "{") k++;
  prof = 0;
  for (let j = k; j < FUENTE.length; j++) {
    if (FUENTE[j] === "{") prof++;
    else if (FUENTE[j] === "}" && --prof === 0) return FUENTE.slice(i, j + 1);
  }
  throw new Error(`llaves sin cerrar: ${marca}`);
}

function almacen(inicial = {}) {
  const m = new Map(Object.entries(inicial).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return { getItem: k => (m.has(k) ? m.get(k) : null),
           setItem: (k, v) => m.set(k, String(v)),
           removeItem: k => m.delete(k) };
}

// UNA INSTANCIA del cliente, con la cadena real de lectura de parcelas. Se le
// pasa el localStorage desde fuera: así "recargar" es construir otra instancia
// sobre el MISMO almacén, que es lo que hace el navegador al abrir la app.
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
  ${recorta("function huellaPayload(")}
  return {
    configEfectiva, payloadSiembra, huellaPayload, parcelasDisponibles,
    verDesde: (id) => { zonaActiva = id; return configEfectiva(); },
    finca: () => cfgFinca,
  };
`;
const arrancar = (ls) => new Function("R", "localStorage", CUERPO)(R, ls);

// ── El alta: dos cultivos con riegos distintos ───────────────────────────
// A: goteo derivado de la cinta. B: aspersión medida con el vaso.
const capA = R.capacidadGoteo({ l_h_gotero: 2, sep_goteros_m: 0.30, sep_lineas_m: 1 });   // 6,7
const capB = R.capacidadVaso({ cm: 1.12, minutos: 60 });                                  // 11,2

const siembra = (id, cultivo, metodo, cap) => ({
  id, cultivo, area_m2: 500, fechaPlantacion: "2026-08-01", metodoRiego: metodo,
  caudal: cap && cap.ok ? cap.valor : null,
  riego: cap && cap.ok
    ? { capacidad_mmh: cap.valor, unidad: cap.unidad, fuente: cap.fuente, confianza: cap.confianza }
    : { capacidad_mmh: null, unidad: "mm/h", fuente: "no_lo_se", confianza: "baja",
        estimacion_mmh: R.POR_DEFECTO_MMH[metodo] ?? null },
});

// El caudal de la FINCA es 11: si aparece en algún sitio, es que algo lo heredó.
const FINCA = { lat: 41.3, lon: 2.0, suelo: "franco", metodoRiego: "goteo", caudal: 11,
                cultivos: [], areaParcela: null };
const ZONAS = [{ referencia: "R1", nombre: "Recinto", geometria: { type: "Polygon", coordinates: [[[0, 0]]] },
                 siembras: [siembra("A", "lechuga", "goteo", capA),
                            siembra("B", "tomate", "aspersion", capB)] }];

console.log("── el alta deriva dos capacidades distintas ──");
ok(capA.ok && capA.valor === 6.7, `A (goteo, 2 L/h a 30 cm × 1 m) → 6,7 mm/h (${capA.valor})`);
ok(capB.ok && capB.valor === 11.2, `B (aspersión, 1,12 cm acumulados en 60 min) → 11,2 mm/h (${capB.valor})`);

console.log("\n── se persiste y se RECARGA (instancia nueva, mismo almacén) ──");
const ls = almacen({ kylia_config: FINCA, kylia_zonas: ZONAS });
const app = arrancar(ls);                       // primera carga
const app2 = arrancar(ls);                      // ← el reload: otra instancia
ok(app2.parcelasDisponibles().length === 3, "tras recargar hay principal + 2 cultivos");

const pa = app2.parcelasDisponibles().find(x => x.id === "A");
const pb = app2.parcelasDisponibles().find(x => x.id === "B");
// Esto es lo que faltaba y dejaba el defecto intacto.
ok(pa.caudal === 6.7 && pb.caudal === 11.2,
   `parcelasDisponibles ARRASTRA el caudal de cada siembra (${pa.caudal} / ${pb.caudal})`);
ok(!!pa.riego && !!pb.riego, "y su procedencia");

console.log("\n── configEfectiva da a cada cultivo el suyo ──");
const cA = app2.verDesde("A"), cB = app2.verDesde("B");
ok(cA.caudal === 6.7,  `cultivo A → 6,7 mm/h (${cA.caudal})`);
ok(cB.caudal === 11.2, `cultivo B → 11,2 mm/h (${cB.caudal})`);
ok(cA.caudal !== cB.caudal, "no comparten caudal");
ok(cA.caudal !== 11 && cB.caudal !== 11,
   "y NINGUNO es el 11 de la finca: no queda ninguna lectura que reaplique el global");
ok(cA.metodoRiego === "goteo" && cB.metodoRiego === "aspersion", "cada uno con su método");
ok(cA.capacidadRiego.fuente === "derivado_goteo" && cB.capacidadRiego.fuente === "medido_vaso",
   "y con su procedencia, que es lo que distingue medido de supuesto");

console.log("\n── lo que se manda al servidor, que es donde vive la fila ──");
const zonas = JSON.parse(ls.getItem("kylia_zonas"));
const payA = app2.payloadSiembra(zonas[0], zonas[0].siembras[0], FINCA, "dueno-1");
const payB = app2.payloadSiembra(zonas[0], zonas[0].siembras[1], FINCA, "dueno-1");
ok(payA.caudal === 6.7 && payB.caudal === 11.2,
   `dos filas, dos caudales (${payA.caudal} / ${payB.caudal})`);
ok(payA.id !== payB.id && payA.propietario_id === payB.propietario_id,
   "filas distintas bajo el mismo propietario: UNA SIEMBRA ES UNA PARCELA");
ok(payA.metodo_riego === "goteo" && payB.metodo_riego === "aspersion", "y su método");
ok(app2.huellaPayload(payA) !== app2.huellaPayload(payB), "huellas distintas");

console.log("\n── y el motor recibe números distintos ──");
const minA = R.presentarRiegoSeguro(MOTOR.presentarRiego, 8, { metodoRiego: cA.metodoRiego, caudalMmh: cA.caudal });
const minB = R.presentarRiegoSeguro(MOTOR.presentarRiego, 8, { metodoRiego: cB.metodoRiego, caudalMmh: cB.caudal });
ok(minA.unidad === "min" && minB.unidad === "min", "los dos pueden darse en minutos");
ok(minA.valor !== minB.valor, `8 mm son ${minA.valor} min en A y ${minB.valor} min en B`);
const conGlobal = MOTOR.presentarRiego(8, { metodoRiego: "aspersion", caudalMmh: 11 });
ok(conGlobal.valor !== minB.valor,
   `con el caudal global B habría recibido ${conGlobal.valor} min en vez de ${minB.valor}`);

console.log("\n── \"no lo sé\": sin caudal operativo y SIN minutos ──");
const ls2 = almacen({ kylia_config: FINCA, kylia_zonas: [{ ...ZONAS[0],
  siembras: [siembra("C", "pimiento", "goteo", null)] }] });
const app3 = arrancar(ls2);
const cC = app3.verDesde("C");
ok(cC.caudal === null,
   `el caudal operativo es null, NO el 11 de la finca ni el 4 de la tabla (${cC.caudal})`);
ok(cC.capacidadRiego.estimacion_mmh === 4,
   "la estimación se conserva aparte, para orientar (4 mm/h en goteo)");
ok(cC.capacidadRiego.operativo === null,
   "pero NUNCA como operativo: son dos campos distintos a propósito");
const presC = R.presentarRiegoSeguro(MOTOR.presentarRiego, 8, { metodoRiego: "goteo", caudalMmh: cC.caudal });
ok(presC.unidad === "l_m2" && presC.sinCapacidad === true,
   `no se dan minutos: sale "${presC.texto}"`);
// Lo que pasaría sin la puerta, que es el motivo de que exista.
const sinPuerta = MOTOR.presentarRiego(8, { metodoRiego: "goteo", caudalMmh: null });
ok(sinPuerta.unidad === "min",
   `sin la puerta el motor habría dicho "${sinPuerta.texto}" con su tabla por defecto`);
const payC = app3.payloadSiembra(JSON.parse(ls2.getItem("kylia_zonas"))[0],
                                 JSON.parse(ls2.getItem("kylia_zonas"))[0].siembras[0], FINCA, "dueno-1");
ok(payC.caudal === null, "y al servidor se le manda null, no el 11 de la finca");

console.log("\n── legacy: un cultivo antiguo no cambia de comportamiento ──");
const vieja = { id: "V", cultivo: "cebolla", area_m2: 440, fechaPlantacion: "2026-06-01" };
const ls3 = almacen({ kylia_config: FINCA, kylia_zonas: [{ ...ZONAS[0], siembras: [vieja] }] });
const app4 = arrancar(ls3);
const cV = app4.verDesde("V");
ok(cV.caudal === 11, `hereda el caudal de la finca, como siempre hizo (${cV.caudal})`);
ok(cV.capacidadRiego.declarada === false, "y queda marcado que no declaró su riego");
ok(cV.capacidadRiego.fuente === "heredado_finca", "con la fuente dicha, no disfrazada de dato suyo");
const payV = app4.payloadSiembra(JSON.parse(ls3.getItem("kylia_zonas"))[0], vieja, FINCA, "dueno-1");
ok(payV.caudal === 11, "y manda al servidor exactamente lo mismo que antes del cambio");
// Un caudal heredado sigue dando minutos —es lo que hacían las siembras
// antiguas— pero NO cuenta como fiable.
const estV = R.estadoSiembra({ ...vieja, lat: 41, lon: 2 }, FINCA,
  { cultivosSoportados: Object.keys(MOTOR.FAO_KC), hoy: "2026-09-16" });
ok(estV.lista_para_calcular_agua === true, "puede calcular agua");
ok(estV.lista_para_ejecutar_riego === false, "pero sus minutos no se declaran fiables");
ok(estV.estado_configuracion === "pendiente_validacion", "estado: pendiente_validacion");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
