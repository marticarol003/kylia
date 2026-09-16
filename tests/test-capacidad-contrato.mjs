// El contrato de la capacidad de riego: qué cruza al motor y qué no.
//   node tests/test-capacidad-contrato.mjs
//
// Reproduce los tres bloqueantes que encontró Codex sobre d931c07, cada uno con
// el caso EXACTO con el que los reprodujo, y fija las invariantes.
//
// POR QUÉ ESTABAN LOS TRES. La primera versión repartía el criterio entre cuatro
// sitios que decidían parecido pero no igual:
//   · capacidadVigente  → "hay un número" (así cruzaba un 0 y una estimación)
//   · puedeDarMinutos   → ">= 0,1"
//   · estadoSiembra     → 'fuente !== "estimado_metodo"' (lista NEGRA)
//   · la presentación   → lo que dijera el motor
// Con capacidad 0 el estado decía "completa, lista para ejecutar" mientras la
// presentación no podía dar minutos: las dos cosas a la vez, sobre la misma
// siembra. Ahora todo pasa por `capacidadOperativa` y por dos listas BLANCAS.
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
           setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

const CULTIVOS = Object.keys(MOTOR.FAO_KC);
const HOY = "2026-09-16";
const BASE = { cultivo: "lechuga", fechaPlantacion: "2026-08-01", lat: 41, lon: 2,
               area_m2: 100, metodoRiego: "goteo" };
const estado = (s, finca = { suelo: "franco" }) =>
  R.estadoSiembra({ ...BASE, ...s }, finca, { cultivosSoportados: CULTIVOS, hoy: HOY });

// ══════════════════════════════════════════════════════════════════
// El panel real, disponible para todas las secciones.
const dom = (valores = {}) => ({
  getElementById: (id) => (id in valores ? { value: valores[id] } : null),
  querySelector: () => null, querySelectorAll: () => [],
});

// `editado` modela si el agricultor ha TOCADO el campo de caudal después de
// cambiar de método. El input viene precargado con el caudal anterior, así que
// esa distinción es justo el bug: sin ella, el 6,7 de goteo volvía como
// `declarado` en aspersión sin que nadie escribiera nada.
function panel(ls, domValores, editado = false) {
  const cuerpo = `
    const window = { KyliaRiego: R, kyliaSync: { registroUsuario: async () => ({ ok: true }) }, kyliaTrack: () => {} };
    const STORAGE_KEY = "kylia_config";
    let cfgFinca = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    let zonaActiva = null;
    const panel = { classList: { remove: () => {} } };
    let caudalEditado = EDITADO;
    // Solo transporte y pintado. La lógica bajo prueba —el bloque que decide
    // qué pasa con la capacidad al cambiar de método— es la real, recortada
    // de app/index.html sin tocar.
    const actualizarHeader = () => {}, setFeedback = () => {};
    const cargarDatos = async () => {}, cargarNDVI = () => {}, cargarHumedadSuelo = () => {};
    const cargarET0 = () => {}, renderZonas = () => {}, renderZonasTabs = () => {}, renderHoy = () => {};
    const nombreCultivo = (c) => c;
    const subirConfig = () => {};
    let cfg = null;
    ${recorta("function zonasGuardadas(")}
    ${recorta("function parcelasDisponibles(")}
    ${recorta("function parcelaActiva(")}
    ${recorta("function configEfectiva(")}
    function saveConfig(n) { cfgFinca = n; localStorage.setItem(STORAGE_KEY, JSON.stringify(n)); cfg = configEfectiva(); }
    ${recorta("async function guardarYActualizar(")}
    return { guardarYActualizar, leer: () => cfgFinca };
  `;
  return new Function("R", "localStorage", "document", "EDITADO", cuerpo)(R, ls, dom(domValores), editado);
}


console.log("\n── B · una ESTIMACIÓN no cruza, ni al motor ni al estado ──");
{
  // El caso exacto de Codex.
  const s = { riego: { capacidad_mmh: 4, fuente: "estimado_metodo", confianza: "baja" } };
  const e = estado(s);
  ok(R.caudalMotor({ ...BASE, ...s }, {}) === null,
     "un 4 con fuente estimado_metodo NO llega al motor");
  ok(e.capacidad.operativo === null, "ni habilita minutos");
  ok(e.lista_para_ejecutar_riego === false, "lista_para_ejecutar_riego = false");
  ok(e.lista_para_calcular_agua === true, "pero el agua sí se puede calcular");
  ok(e.estado_configuracion === "pendiente_validacion", "estado: pendiente_validacion");
  ok(e.capacidad.estimacion_mmh === 4, "y el 4 se conserva como estimación, en su campo");

  // LISTA BLANCA, no negra. Este es el motivo de que exista: una fuente nueva
  // que nadie ha revisado no puede habilitarse sola por no llamarse
  // "estimado_metodo".
  const inventada = estado({ riego: { capacidad_mmh: 7, fuente: "fuente_que_alguien_añade_mañana", confianza: "alta" } });
  ok(inventada.lista_para_ejecutar_riego === false,
     "una fuente desconocida NO habilita minutos por defecto");
  ok(R.caudalMotor({ ...BASE, riego: { capacidad_mmh: 7, fuente: "fuente_que_alguien_añade_mañana" } }, {}) === null,
     "ni cruza al motor");
  ok(!R.FUENTES_OPERATIVAS.includes("estimado_metodo") && !R.FUENTES_AL_MOTOR.includes("estimado_metodo"),
     "estimado_metodo no está en ninguna de las dos listas");
  ok(R.FUENTES_OPERATIVAS.every(f => R.FUENTES_AL_MOTOR.includes(f)),
     "y todo lo que habilita minutos fiables puede, por fuerza, cruzar al motor");
}

console.log("\n── C · cero y coerciones: NINGUNO es una capacidad ──");
{
  const malos = [0, "0", null, undefined, "", NaN, Infinity, -Infinity, -1, "-1", true, false, "hola", 0.4, 90];
  const nombres = ["0", '"0"', "null", "undefined", '""', "NaN", "Infinity", "-Infinity",
                   "-1", '"-1"', "true", "false", '"hola"', "0.4 (bajo mínimo)", "90 (sobre máximo)"];
  let todosNulos = true;
  malos.forEach((v, i) => { if (R.capacidadOperativa(v) !== null) { todosNulos = false; console.log("    ↳ pasa:", nombres[i]); } });
  ok(todosNulos, `capacidadOperativa los rechaza los ${malos.length}: ${nombres.join(", ")}`);

  // Y la MISMA semántica en todas las puertas, que es lo que fallaba.
  const cero = estado({ riego: { capacidad_mmh: 0, fuente: "derivado_goteo", confianza: "alta" } });
  ok(cero.capacidad.operativo === null, "capacidad 0 → operativo null");
  ok(cero.lista_para_ejecutar_riego === false,
     "capacidad 0 → NO lista para ejecutar (antes decía true)");
  ok(cero.estado_configuracion === "pendiente_validacion",
     `capacidad 0 → pendiente_validacion (antes decía "completa")`);
  ok(R.puedeDarMinutos("goteo", 0) === false, "y puedeDarMinutos coincide, que antes no coincidía");
  ok(R.caudalMotor({ ...BASE, riego: { capacidad_mmh: 0, fuente: "derivado_goteo" } }, {}) === null,
     "y al motor no llega un 0");
  const neg = estado({ riego: { capacidad_mmh: -1, fuente: "derivado_goteo" } });
  ok(neg.lista_para_ejecutar_riego === false, "un negativo tampoco");
}

console.log("\n── D · un valor fiable sí habilita minutos ──");
{
  const s = { riego: { capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "alta" } };
  const e = estado(s);
  ok(e.capacidad.operativo === 6.7, "6,7 derivado_goteo → operativo");
  ok(e.lista_para_ejecutar_riego === true, "lista_para_ejecutar_riego = true");
  ok(e.estado_configuracion === "completa", "estado: completa");
  const pres = R.presentarRiegoSeguro(MOTOR.presentarRiego, 8, { metodoRiego: "goteo", caudalMmh: R.caudalMotor({ ...BASE, ...s }, {}) });
  ok(pres.unidad === "min", `y la presentación da minutos: "${pres.texto}"`);
  // Lo mismo por la otra fuente de la whitelist.
  const vaso = estado({ metodoRiego: "aspersion", riego: { capacidad_mmh: 11.2, fuente: "medido_vaso", confianza: "alta" } });
  ok(vaso.lista_para_ejecutar_riego === true, "y medido_vaso también");
}

console.log("\n── INVARIANTES (barrido, no ejemplos sueltos) ──");
{
  // Se recorre el producto de valores × fuentes × métodos y se exige que las dos
  // invariantes se cumplan SIEMPRE. Un ejemplo suelto no habría visto el 0.
  const valores = [null, 0, -1, 0.4, 0.6, 4, 6.7, 11.2, 79, 90, NaN, Infinity, "0", "6.7", ""];
  const fuentes = ["derivado_goteo", "medido_vaso", "declarado", "heredado_finca",
                   "estimado_metodo", "no_lo_se", "sin_datos", "invalidada_por_cambio_de_metodo", "inventada"];
  const metodos = ["goteo", "aspersion", "manguera"];
  let rotas1 = 0, rotas2 = 0, casos = 0;
  for (const v of valores) for (const f of fuentes) for (const m of metodos) {
    casos++;
    const s = { ...BASE, metodoRiego: m, riego: { capacidad_mmh: v, fuente: f, confianza: "alta" } };
    const e = R.estadoSiembra(s, { suelo: "franco" }, { cultivosSoportados: CULTIVOS, hoy: HOY });
    // 1 · operativo null ⇒ NO ejecutable
    if (e.capacidad.operativo === null && e.lista_para_ejecutar_riego !== false) rotas1++;
    // 2 · ejecutable ⇒ la presentación PUEDE dar minutos
    if (e.lista_para_ejecutar_riego === true) {
      const pres = R.presentarRiegoSeguro(MOTOR.presentarRiego, 8, { metodoRiego: m, caudalMmh: R.caudalMotor(s, {}) });
      if (pres.unidad !== "min") rotas2++;
    }
  }
  ok(rotas1 === 0, `invariante 1 (operativo null ⇒ no ejecutable) en los ${casos} casos`);
  ok(rotas2 === 0, `invariante 2 (ejecutable ⇒ la presentación da minutos) en los ${casos} casos`);
  // Y el control: que el barrido no esté pasando por vacío.
  const algunoEjecutable = valores.some(v => R.estadoSiembra({ ...BASE, riego: { capacidad_mmh: v, fuente: "derivado_goteo", confianza: "alta" } },
    { suelo: "franco" }, { cultivosSoportados: CULTIVOS, hoy: HOY }).lista_para_ejecutar_riego);
  ok(algunoEjecutable === true, "control: en el barrido hay casos que SÍ son ejecutables");
}

console.log("\n── A · PANEL NORMAL: cambiar de método invalida la capacidad ──");
{
  // La cadena real del panel: guardarYActualizar → saveConfig → localStorage,
  // y después una lectura desde cero, como al recargar. Solo se sustituye el
  // DOM y el transporte; la lógica bajo prueba es la de app/index.html.
  // Estado de partida: goteo con 6,7 derivado de la cinta.
  const inicial = { lat: 41.3, lon: 2.0, suelo: "franco", cultivos: ["lechuga"],
                    metodoRiego: "goteo", caudal: 6.7,
                    riego: { capacidad_mmh: 6.7, unidad: "mm/h", fuente: "derivado_goteo",
                             confianza: "alta", datos: { l_h_gotero: 2 }, medido: "2026-09-10" } };
  const ls = almacen({ kylia_config: inicial, kylia_zonas: [] });

  // ⚠️ EL CAMPO VIENE PRECARGADO CON 6,7 y el agricultor NO lo toca. Ese era el
  // bug: se leía el valor precargado y se reescribía como `declarado`, así que
  // el caudal de goteo reaparecía en aspersión con procedencia nueva.
  const p = panel(ls, { "input-caudal": "6.7", "input-tarifa": "", "input-area": "", "input-capacidad-regadera": "" }, false);
  await p.guardarYActualizar({ ...inicial, metodoRiego: "aspersion" });   // ← cambia de método y guarda

  // RELOAD: se lee desde el almacén, con una instancia nueva.
  const tras = JSON.parse(ls.getItem("kylia_config"));
  ok(tras.metodoRiego === "aspersion", "el método nuevo se guarda");
  ok(tras.caudal === null, `la capacidad se invalida: caudal null (era 6,7) → ${tras.caudal}`);
  ok(tras.riego.capacidad_mmh === null, "y riego.capacidad_mmh también");
  ok(tras.riego.fuente === "invalidada_por_cambio_de_metodo",
     `la procedencia de goteo ya no está activa (${tras.riego.fuente})`);
  ok(tras.riego.datos === null, "ni los datos del cálculo anterior");

  // Lo anterior puede conservarse como histórico SIEMPRE que capacidadVigente no
  // lo lea. Se comprueba ejecutándola, no leyendo el código.
  const vig = R.capacidadVigente({ metodoRiego: "aspersion", caudal: tras.caudal, riego: tras.riego }, {});
  ok(vig.operativo === null && vig.motor === null,
     "capacidadVigente NO resucita el 6,7 histórico");
  ok(tras.riego.anterior?.capacidad_mmh === 6.7 && tras.riego.anterior?.metodo === "goteo",
     "aunque quede anotado que en goteo se midieron 6,7 (metadato, nivel anidado)");

  const e = R.estadoSiembra({ ...BASE, metodoRiego: "aspersion", caudal: tras.caudal, riego: tras.riego },
                            { suelo: "franco" }, { cultivosSoportados: CULTIVOS, hoy: HOY });
  ok(e.lista_para_ejecutar_riego === false, "no hay minutos");
  ok(e.estado_configuracion === "pendiente_validacion", "estado: pendiente_validacion");
  const pres = R.presentarRiegoSeguro(MOTOR.presentarRiego, 8, { metodoRiego: "aspersion", caudalMmh: tras.caudal });
  ok(pres.unidad === "l_m2", `y la orden sale en L/m²: "${pres.texto}"`);

  // Las dos direcciones, y la manguera.
  for (const [de, a] of [["goteo", "aspersion"], ["aspersion", "goteo"], ["goteo", "manguera"], ["manguera", "aspersion"]]) {
    const previo = { metodoRiego: de, caudal: 6.7, riego: { capacidad_mmh: 6.7, fuente: "derivado_goteo" } };
    const r = R.riegoTrasCambioDeMetodo(previo, a);
    ok(r.invalidado === true && r.caudal === null, `${de} → ${a} invalida`);
  }
  const igual = R.riegoTrasCambioDeMetodo({ metodoRiego: "goteo", caudal: 6.7, riego: { capacidad_mmh: 6.7, fuente: "derivado_goteo" } }, "goteo");
  ok(igual.invalidado === false && igual.caudal === 6.7,
     "control: guardar SIN cambiar de método no invalida nada");

  // Y si teclea un caudal en el mismo guardado, ese es suyo y para el método nuevo.
  const ls2 = almacen({ kylia_config: inicial, kylia_zonas: [] });
  const p2 = panel(ls2, { "input-caudal": "12", "input-tarifa": "", "input-area": "", "input-capacidad-regadera": "" }, true);
  await p2.guardarYActualizar({ ...inicial, metodoRiego: "aspersion" });
  const tras2 = JSON.parse(ls2.getItem("kylia_config"));
  ok(tras2.caudal === 12, "un caudal tecleado a la vez del cambio SÍ se respeta");
  ok(tras2.riego.fuente === "declarado",
     "pero como `declarado`: da minutos y no se llama validado");
  ok(R.estadoSiembra({ ...BASE, metodoRiego: "aspersion", caudal: 12, riego: tras2.riego },
       { suelo: "franco" }, { cultivosSoportados: CULTIVOS, hoy: HOY }).estado_configuracion === "pendiente_validacion",
     "estado: pendiente_validacion");
}

console.log("\n── LEGACY: las históricas no se mueven ──");
{
  // Sin `riego`: hereda como siempre, recibe minutos como siempre, y lo único
  // que cambia es que su estado ya no miente.
  const vieja = { ...BASE, cultivo: "cebolla", metodoRiego: "goteo" };
  const finca = { suelo: "franco", caudal: 1.8 };      // el valor real de las 4 históricas
  ok(R.caudalMotor(vieja, finca) === 1.8, "hereda 1,8 y llega al motor, como siempre");
  const e = R.estadoSiembra(vieja, finca, { cultivosSoportados: CULTIVOS, hoy: HOY });
  ok(e.capacidad.fuente === "heredado_finca", "marcado como heredado");
  ok(e.lista_para_ejecutar_riego === false, "no se declara validado");
  const pres = R.presentarRiegoSeguro(MOTOR.presentarRiego, 8, { metodoRiego: "goteo", caudalMmh: R.caudalMotor(vieja, finca) });
  ok(pres.unidad === "min", `y SIGUE recibiendo minutos: "${pres.texto}"`);
  ok(R.caudalMotor({ ...BASE, caudal: 9 }, finca) === 9, "un caudal propio legacy también");
}

console.log("\n── MÉTODO NULL · deseleccionar el riego invalida la capacidad ──");
{
  // Reproducido en Chrome por Codex sobre 168e5ce: goteo + 6,7 derivado_goteo
  // con confianza alta, se DESELECCIONA el método, se guarda, se recarga — y la
  // capacidad seguía viva y fiable, con la presentación diciendo "72 min".
  //
  // La causa: `null` se trataba como "no ha habido cambio". Y no lo es: es que
  // ya no hay sistema de riego al que esa capacidad pueda pertenecer.
  const fiable = { capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "alta" };

  // ── A · goteo → null, por la cadena real del panel ──
  const inicial = { lat: 41.3, lon: 2.0, suelo: "franco", cultivos: ["lechuga"],
                    metodoRiego: "goteo", caudal: 6.7,
                    riego: { ...fiable, unidad: "mm/h", datos: { l_h_gotero: 2 }, medido: "2026-09-10" } };
  const ls = almacen({ kylia_config: inicial, kylia_zonas: [] });
  const p = panel(ls, { "input-caudal": "6.7", "input-tarifa": "", "input-area": "", "input-capacidad-regadera": "" }, false);
  await p.guardarYActualizar({ ...inicial, metodoRiego: null });      // ← deselecciona y guarda

  const tras = JSON.parse(ls.getItem("kylia_config"));                 // ← reload
  ok(tras.metodoRiego === null, `A · el método queda en null (${tras.metodoRiego})`);
  ok(tras.caudal === null, `A · la capacidad se invalida: ${tras.caudal} (antes seguía en 6,7)`);
  ok(tras.riego.fuente === "invalidada_por_cambio_de_metodo",
     "A · y la procedencia de goteo deja de estar activa");
  ok(tras.riego.anterior?.capacidad_mmh === 6.7,
     "A · el 6,7 solo queda en riego.anterior, como metadato");
  const capA = R.capacidadVigente({ metodoRiego: tras.metodoRiego, caudal: tras.caudal, riego: tras.riego }, {});
  ok(capA.operativo === null && capA.motor === null, "A · capacidad operativa null tras recargar");
  const eA = R.estadoSiembra({ ...BASE, metodoRiego: null, caudal: tras.caudal, riego: tras.riego },
                             { suelo: "franco" }, { cultivosSoportados: CULTIVOS, hoy: HOY });
  ok(eA.lista_para_ejecutar_riego === false, "A · lista_para_ejecutar_riego = false");
  ok(eA.faltan.includes("metodo_riego"), "A · y el método aparece como lo que falta");
  const presA = R.presentarRiegoSeguro(MOTOR.presentarRiego, 8, { metodoRiego: null, caudalMmh: tras.caudal, clase: capA.clase });
  ok(presA.unidad === "l_m2", `A · sin minutos: "${presA.texto}"`);

  // ── B · lo mismo desde aspersión ──
  const iniB = { ...inicial, metodoRiego: "aspersion", caudal: 11.2,
                 riego: { capacidad_mmh: 11.2, fuente: "medido_vaso", confianza: "alta", unidad: "mm/h" } };
  const lsB = almacen({ kylia_config: iniB, kylia_zonas: [] });
  const pB = panel(lsB, { "input-caudal": "11.2", "input-tarifa": "", "input-area": "", "input-capacidad-regadera": "" }, false);
  await pB.guardarYActualizar({ ...iniB, metodoRiego: null });
  const trasB = JSON.parse(lsB.getItem("kylia_config"));
  ok(trasB.caudal === null && trasB.riego.fuente === "invalidada_por_cambio_de_metodo",
     "B · aspersión → null invalida igual");
  const presB = R.presentarRiegoSeguro(MOTOR.presentarRiego, 8, { metodoRiego: null, caudalMmh: trasB.caudal });
  ok(presB.unidad === "l_m2", `B · sin minutos: "${presB.texto}"`);

  // Todas las direcciones hacia null.
  for (const de of ["goteo", "aspersion", "manguera", "surco", "regadera"]) {
    const r = R.riegoTrasCambioDeMetodo({ metodoRiego: de, caudal: 6.7, riego: fiable }, null);
    ok(r.invalidado === true && r.caudal === null, `${de} → null invalida`);
  }

  // ── C · DEFENSA EN PROFUNDIDAD: estado incoherente construido a mano ──
  // Aunque alguien consiga fabricar "método null + capacidad 6,7 fiable" —una
  // config legacy, una pantalla que pase un `clase` viejo—, ninguna de las dos
  // puertas puede dejarlo pasar. No se confía en quien llama.
  ok(R.evaluarCapacidadRiego(fiable, null).puede_ejecutar === false,
     "C · evaluarCapacidadRiego con método null → NO ejecutable");
  ok(R.evaluarCapacidadRiego(fiable, null).capacidad_mmh === null,
     "C · y sin capacidad, aunque el número sea válido y la fuente fiable");
  ok(R.evaluarCapacidadRiego(fiable, null).motivo === "sin_metodo", "C · con el motivo dicho");
  const forzado = R.presentarRiegoSeguro(MOTOR.presentarRiego, 8,
    { metodoRiego: null, caudalMmh: 6.7, clase: "fiable" });   // ← se le MIENTE a la función
  ok(forzado.unidad === "l_m2" && forzado.clase === "no_ejecutable",
     `C · presentarRiegoSeguro ignora un "fiable" falso: "${forzado.texto}"`);
  ok(/cómo riegas/.test(forzado.aviso || ""), "C · y dice qué falta");
  ok(R.puedeDarMinutos(null, 6.7) === false, "C · puedeDarMinutos con método null → false");
  // Y con un método inventado, igual.
  ok(R.evaluarCapacidadRiego(fiable, "teletransporte").puede_ejecutar === false,
     "C · un método desconocido tampoco habilita nada");

  // El invariante que pedía el encargo, sobre el barrido de métodos.
  let rotas = 0;
  for (const m of [null, undefined, "", "goteo", "aspersion", "manguera", "surco", "regadera", "inventado"]) {
    const e = R.estadoSiembra({ ...BASE, metodoRiego: m, riego: fiable },
                              { suelo: "franco" }, { cultivosSoportados: CULTIVOS, hoy: HOY });
    const pres = R.presentarRiegoSeguro(MOTOR.presentarRiego, 8,
      { metodoRiego: m, caudalMmh: R.caudalMotor({ ...BASE, metodoRiego: m, riego: fiable }, {}), clase: e.capacidad?.clase });
    // minutos fiables ⇒ lista_para_ejecutar_riego
    if (pres.unidad === "min" && pres.clase === "fiable" && e.lista_para_ejecutar_riego !== true) rotas++;
  }
  ok(rotas === 0, "invariante: unos minutos fiables implican SIEMPRE lista_para_ejecutar_riego");
}

console.log("\n── C–F · la fuente y la confianza mandan, no solo el número ──");
{
  const caso = (riego, metodo) => R.evaluarCapacidadRiego(riego, metodo);
  const c = caso({ capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "alta" }, "goteo");
  ok(c.puede_ejecutar === true && c.clase === "fiable", "C · derivado_goteo + alta → ejecutable");
  const d = caso({ capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "baja" }, "goteo");
  ok(d.puede_ejecutar === false && d.clase === "provisional",
     "D · derivado_goteo + BAJA → no ejecutable (el mismo número, otra confianza)");
  const e = caso({ capacidad_mmh: 7, fuente: "inventada_manana", confianza: "alta" }, "goteo");
  ok(e.puede_ejecutar === false && e.capacidad_mmh === null,
     "E · fuente inventada + alta → ni ejecutable ni cruza al motor");
  const f = caso({ capacidad_mmh: 9, fuente: "declarado", confianza: "alta" }, "goteo");
  ok(f.puede_ejecutar === false && f.clase === "provisional",
     "F · `declarado` en un alta nueva → provisional, nunca fiable");
  // Y el método tiene que cuadrar con la fuente: un número derivado de una cinta
  // de goteo no vale para un aspersor ni como provisional.
  const g = caso({ capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "alta" }, "aspersion");
  ok(g.capacidad_mmh === null && g.motivo === "metodo_incompatible",
     "un caudal de goteo no se reutiliza en aspersión");
}

console.log("\n── G · legacy: minutos, pero PROVISIONALES ──");
{
  const cap = R.capacidadVigente({ metodoRiego: "goteo" }, { caudal: 1.8 });
  ok(cap.clase === "provisional", `las cuatro históricas salen provisionales (${cap.clase})`);
  ok(cap.motor === 1.8, "el número sigue cruzando al motor");
  const pres = R.presentarRiegoSeguro(MOTOR.presentarRiego, 8, { metodoRiego: "goteo", caudalMmh: cap.motor, clase: cap.clase });
  ok(/^Aproximadamente/.test(pres.texto), `y se presentan como aproximados: "${pres.texto}"`);
  ok(pres.aviso === "Capacidad de riego pendiente de validar", "con el aviso al lado");
}

console.log("\n── H · cliente y servidor clasifican IGUAL ──");
{
  // El servidor recupera la procedencia de config_app con `capacidadDeSiembra`.
  // Aquí se comprueba que, ante la MISMA siembra, las dos partes dan la misma
  // clase — porque las dos llaman a `evaluarCapacidadRiego`.
  const SERVIDOR = readFileSync(join(RAIZ, "api", "campo.js"), "utf8");
  ok(/evaluarCapacidadRiego/.test(SERVIDOR) && /require\("\.\.\/assets\/js\/riego-capacidad\.js"\)/.test(SERVIDOR),
     "api/campo.js usa la MISMA función, no una copia del criterio");
  ok(/select=config_app/.test(SERVIDOR),
     "y recupera la procedencia de config_app, sin columna nueva");

  const casos = [
    [{ capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "alta" }, "goteo",     "fiable"],
    [{ capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "baja" }, "goteo",     "provisional"],
    [{ capacidad_mmh: 9,   fuente: "declarado",      confianza: "media" }, "goteo",    "provisional"],
    [{ capacidad_mmh: 1.8, fuente: "heredado_finca", confianza: "baja" }, "goteo",     "provisional"],
    [{ capacidad_mmh: 4,   fuente: "estimado_metodo", confianza: "baja" }, "goteo",    "no_ejecutable"],
    [{ capacidad_mmh: 0,   fuente: "derivado_goteo", confianza: "alta" }, "goteo",     "no_ejecutable"],
    [{ capacidad_mmh: 11.2, fuente: "medido_vaso",   confianza: "alta" }, "aspersion", "fiable"],
  ];
  let iguales = 0;
  for (const [riego, metodo, esperada] of casos) {
    // Lado CLIENTE: por capacidadVigente, que es lo que lee configEfectiva.
    const cliente = R.capacidadVigente({ metodoRiego: metodo, riego }, {}).clase;
    // Lado SERVIDOR: la evaluación directa, que es lo que hace capacidadDeSiembra.
    const servidor = R.evaluarCapacidadRiego(riego, metodo).clase;
    if (cliente === servidor && cliente === esperada) iguales++;
    else console.log(`    ↳ discrepan: ${riego.fuente}/${riego.confianza} en ${metodo} → cliente ${cliente}, servidor ${servidor}, esperado ${esperada}`);
  }
  ok(iguales === casos.length, `las ${casos.length} clasificaciones coinciden en los dos lados`);
}

console.log("\n── I · el reload conserva la clasificación ──");
{
  const ls = almacen({ kylia_config: { lat: 41.3, lon: 2.0, suelo: "franco", metodoRiego: "goteo", caudal: 11 },
    kylia_zonas: [{ referencia: "R1", geometria: { type: "Polygon", coordinates: [[[0, 0]]] }, siembras: [
      { id: "A", cultivo: "lechuga", area_m2: 500, fechaPlantacion: "2026-08-01", metodoRiego: "goteo",
        caudal: 6.7, riego: { capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "alta" } },
      { id: "B", cultivo: "tomate", area_m2: 500, fechaPlantacion: "2026-08-01", metodoRiego: "aspersion",
        caudal: null, riego: { capacidad_mmh: null, fuente: "no_lo_se", confianza: "baja" } },
    ] }] });
  const cuerpo = `
    const window = { KyliaRiego: R };
    let cfgFinca = JSON.parse(localStorage.getItem("kylia_config") || "{}");
    let zonaActiva = null;
    const nombreCultivo = (c) => c;
    ${recorta("function zonasGuardadas(")}
    ${recorta("function parcelasDisponibles(")}
    ${recorta("function parcelaActiva(")}
    ${recorta("function configEfectiva(")}
    ${recorta("function payloadSiembra(")}
    ${recorta("function estable(")}
    return { ver: (id) => { zonaActiva = id; return configEfectiva(); }, payloadSiembra };
  `;
  const app = new Function("R", "localStorage", cuerpo)(R, ls);   // instancia NUEVA = reload
  const a = app.ver("A"), b = app.ver("B");
  ok(a.caudal === 6.7 && a.capacidadRiego.clase === "fiable", `A sobrevive al reload: 6,7 fiable (${a.capacidadRiego.clase})`);
  ok(b.caudal === null && b.capacidadRiego.clase === "no_ejecutable",
     `B sigue sin capacidad tras el reload (${b.capacidadRiego.clase})`);
  ok(b.caudal !== 11, "y B NO hereda el 11 de la finca");
  const zs = JSON.parse(ls.getItem("kylia_zonas"));
  ok(app.payloadSiembra(zs[0], zs[0].siembras[0], { caudal: 11 }, "d").caudal === 6.7, "payloadSiembra manda el suyo");
  ok(app.payloadSiembra(zs[0], zs[0].siembras[1], { caudal: 11 }, "d").caudal === null, "y null para el que no lo sabe");
}

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
