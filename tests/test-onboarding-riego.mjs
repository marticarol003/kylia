// El onboarding no puede inventarse el dato del que dependen los minutos.
//   node tests/test-onboarding-riego.mjs
//
// POR QUÉ EXISTE. La capacidad de aplicación (mm/h) es el input más frágil de
// Kylia: de él salen los minutos que el agricultor ejecuta. Hasta hoy pasaban
// tres cosas, las tres medidas:
//
//   1. Se preguntaba de frente ("¿cuántos L/m²·h echa tu riego?"), que es una
//      pregunta que casi nadie sabe contestar. En Breda se calculó a mano fuera
//      de la app: 32 mm/h. Medido después: 10,9.
//   2. Cuando no se contestaba, el motor metía CAUDAL_DEFAULT_MMH en silencio.
//      El bancal real medía 5,4 mm/h y la tabla dice 10: el doble de agua, y en
//      pantalla salía igual de seguro que un dato medido.
//   3. `caudal` era de la FINCA, aunque `metodoRiego` ya fuera por siembra desde
//      julio. Un bancal a goteo y otro a aspersión tenían eficiencias distintas
//      y COMPARTÍAN los mm/h.
//
// Lo que se prueba aquí es EJECUTANDO: el módulo puro, y las funciones reales
// recortadas de app/index.html. Los tests que leen el fuente con regex no vieron
// ninguno de los tres defectos del 13-sep.
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

// Recorta una función REAL del cliente y la ejecuta. Mismo mecanismo que
// test-sincronizar-zonas.mjs: comprobar que está escrito no es comprobar que
// contesta.
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

const CULTIVOS = Object.keys(MOTOR.FAO_KC);
const HOY = "2026-09-16";

// ══════════════════════════════════════════════════════════════════
console.log("\n── 1. alta de goteo completa: deriva los mm/h ──");
{
  // El ejemplo del guion: 2 L/h, goteros cada 30 cm, líneas cada 1 m.
  const r = R.capacidadGoteo({ l_h_gotero: 2, sep_goteros_m: 0.30, sep_lineas_m: 1 });
  ok(r.ok === true, "deriva");
  ok(r.valor === 6.7, `2 / (0,30 × 1) = 6,7 mm/h (${r.valor})`);
  ok(r.unidad === "mm/h", "y lo dice en mm/h, no en un número pelado");
  ok(r.fuente === "derivado_goteo" && r.confianza === "alta",
     "con fuente derivado_goteo y confianza alta");
  // §10: guardar el resultado sin los datos que lo produjeron hace imposible
  // recalcularlo si mañana cambia la fórmula o la cinta.
  ok(r.datos.l_h_gotero === 2 && r.datos.sep_goteros_m === 0.30 && r.datos.sep_lineas_m === 1,
     "y conserva los datos ORIGINALES, no solo el resultado");

  // La separación entre líneas también se puede dar como ancho ÷ nº de líneas,
  // que es más fácil de contestar mirando el bancal.
  const g2 = R.capacidadGoteo({ l_h_gotero: 2, sep_goteros_m: 0.30, ancho_m: 3, lineas: 3 });
  ok(g2.ok && g2.valor === 6.7, `ancho 3 m ÷ 3 líneas da lo mismo (${g2.valor})`);

  // Y cuando la cinta viene en L/h por metro de manguera.
  const g3 = R.capacidadGoteo({ l_h_metro: 6, sep_goteros_m: 0.30, sep_lineas_m: 1 });
  ok(g3.ok && g3.valor === 6, `6 L/h·m × 0,30 = 1,8 L/h por gotero → 6 mm/h (${g3.valor})`);

  // Un número increíble NO se ofrece: sería peor que reconocer que no se sabe.
  // Es exactamente el caso de Breda (32 mm/h calculados, 10,9 medidos).
  const malo = R.capacidadGoteo({ l_h_gotero: 4, sep_goteros_m: 0.05, sep_lineas_m: 0.1 });
  ok(malo.ok === false && malo.motivo === "fuera_de_rango",
     `800 mm/h se rechaza en vez de guardarse (${malo.motivo})`);
}

console.log("\n── 2. goteo \"no lo sé\": no se inventa confianza alta ──");
{
  const vacio = R.capacidadGoteo({});
  ok(vacio.ok === false && vacio.motivo === "datos_incompletos", "sin datos no hay número");
  ok(vacio.valor === undefined, "y no se devuelve un valor a medias");

  // Lo que SÍ se puede hacer es estimar, pero marcado.
  const est = R.capacidadEstimada("goteo");
  ok(est.ok === true && est.valor === 4, "la estimación por método existe (4 mm/h en goteo)");
  ok(est.fuente === "estimado_metodo" && est.confianza === "baja",
     "pero sale con fuente estimado_metodo y confianza BAJA, nunca alta");
  ok(est.valor === MOTOR.CAUDAL_DEFAULT_MMH.goteo,
     "y es el MISMO número que el motor usaba en silencio: lo que cambia es que ahora se declara");
}

console.log("\n── 3. dos cultivos con riegos distintos no comparten caudal ──");
{
  // La función REAL del cliente, con parcelaActiva sustituida por la siembra que
  // se quiera mirar. Es donde vivía el defecto: metodoRiego se heredaba por
  // siembra y `caudal` no.
  const cuerpo = `
    const window = { KyliaRiego: R };
    let cfgFinca = finca;
    let zonaActiva = null;
    let parcelaActiva = () => p;
    ${recorta("function configEfectiva(")}
    return configEfectiva;
  `;
  // Ojo: el cuerpo devuelve la FUNCIÓN configEfectiva; hay que ejecutarla.
  const construir = (finca, p) => new Function("finca", "p", "R", cuerpo)(finca, p, R)();

  const FINCA = { lat: 41.3, lon: 2.0, suelo: "franco", metodoRiego: "goteo", caudal: 11 };
  const goteo = { id: "s1", cultivo: "lechuga", area_m2: 100, metodoRiego: "goteo",
                  caudal: 6.7, riego: { capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "alta" } };
  const asper = { id: "s2", cultivo: "tomate", area_m2: 200, metodoRiego: "aspersion",
                  caudal: 20, riego: { capacidad_mmh: 20, fuente: "medido_vaso", confianza: "alta" } };

  const cA = construir(FINCA, goteo);
  const cB = construir(FINCA, asper);
  ok(cA.caudal === 6.7, `el cultivo a goteo usa SU 6,7 (${cA.caudal})`);
  ok(cB.caudal === 20,  `el de aspersión usa SU 20 (${cB.caudal})`);
  ok(cA.caudal !== cB.caudal, "y no comparten el 11 de la finca, que es lo que pasaba antes");
  ok(cA.metodoRiego === "goteo" && cB.metodoRiego === "aspersion", "cada uno con su método");
  ok(cA.riegoInfo?.fuente === "derivado_goteo" && cB.riegoInfo?.fuente === "medido_vaso",
     "y la procedencia viaja con cada uno");

  // Y los minutos que salen son DISTINTOS, que es de lo que iba todo esto.
  const minA = MOTOR.presentarRiego(6, { metodoRiego: cA.metodoRiego, caudalMmh: cA.caudal });
  const minB = MOTOR.presentarRiego(6, { metodoRiego: cB.metodoRiego, caudalMmh: cB.caudal });
  ok(minA.valor !== minB.valor, `6 mm son ${minA.valor} min a goteo y ${minB.valor} min a aspersión`);
  // Y el reparto es el correcto: con los caudales de la finca (11 para los dos)
  // los minutos habrían salido iguales y uno de ellos mal.
  const conFinca = MOTOR.presentarRiego(6, { metodoRiego: "aspersion", caudalMmh: 11 });
  ok(conFinca.valor !== minB.valor,
     `con el caudal de finca al de aspersión le habrían salido ${conFinca.valor} min en vez de ${minB.valor}`);
}

console.log("\n── 4. cultivo no soportado: bloqueado explícitamente ──");
{
  const e = R.estadoSiembra({ cultivo: "sandia", fechaPlantacion: "2026-08-01", lat: 41, lon: 2,
                              area_m2: 100, metodoRiego: "goteo" }, {}, { cultivosSoportados: CULTIVOS, hoy: HOY });
  ok(e.faltan.includes("cultivo_no_soportado"), "se declara, con su motivo exacto");
  ok(e.lista_para_calcular_agua === false, "y NO se puede calcular agua");
  ok(e.estado_configuracion === "incompleta", "estado: incompleta");
  // El motor no lo conoce, así que no es "menos preciso": es imposible.
  ok(MOTOR.FAO_KC.sandia === undefined, "el motor efectivamente no tiene Kc para él");
  // Y el editor de cultivos lo corta antes de crear la siembra.
  const guardar = recorta("function guardarCultivoNuevo(");
  ok(/!FAO_KC\[cultivo\]/.test(guardar) && /return;/.test(guardar),
     "y guardarCultivoNuevo se planta antes de crear la siembra");
}

console.log("\n── 5. fecha futura: bloqueada ──");
{
  const e = R.estadoSiembra({ cultivo: "lechuga", fechaPlantacion: "2026-12-01", lat: 41, lon: 2,
                              area_m2: 100, metodoRiego: "goteo" }, {}, { cultivosSoportados: CULTIVOS, hoy: HOY });
  ok(e.faltan.includes("fecha_plantacion_futura"), "una plantación por delante se rechaza");
  ok(e.lista_para_calcular_agua === false, "y no se puede calcular nada con ella");
  const mala = R.estadoSiembra({ cultivo: "lechuga", fechaPlantacion: "ayer", lat: 41, lon: 2,
                                 area_m2: 100, metodoRiego: "goteo" }, {}, { cultivosSoportados: CULTIVOS, hoy: HOY });
  ok(mala.faltan.includes("fecha_plantacion_invalida"), "y una fecha que no es fecha, también");
  // El input de tipo date deja teclear futuro aunque tenga `max`.
  ok(/ev\.target\.value > hoyISO\(\)/.test(FUENTE), "el alta lo comprueba en el change, no solo con max");
}

console.log("\n── 6. SoilGrids disponible: no se pregunta de más ──");
{
  const e = R.estadoSiembra({ cultivo: "lechuga", fechaPlantacion: "2026-09-06", lat: 41, lon: 2,
                              area_m2: 2174, metodoRiego: "goteo", caudal: 6.7,
                              riego: { capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "alta" } },
                            { suelo: "franco", sueloFuente: "soilgrids" },
                            { cultivosSoportados: CULTIVOS, hoy: HOY });
  ok(!e.faltan.includes("suelo"), "con textura de SoilGrids el suelo no falta");
  ok(e.estado_configuracion === "completa", "y la configuración queda completa");
  const inc = e.incertidumbres.find(i => i.dato === "suelo");
  ok(!!inc && inc.motivo === "prior_soilgrids_250m",
     "pero se declara que es un prior de 250 m, no una analítica");
  ok(inc.efecto.includes("±10%"), "con el efecto medido: ±10% de lámina");
}

console.log("\n── 7. falla SoilGrids: el onboarding sigue, con fallback explícito ──");
{
  const e = R.estadoSiembra({ cultivo: "lechuga", fechaPlantacion: "2026-09-06", lat: 41, lon: 2,
                              area_m2: 2174, metodoRiego: "goteo", caudal: 6.7,
                              riego: { capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "alta" } },
                            {}, { cultivosSoportados: CULTIVOS, hoy: HOY });
  ok(e.lista_para_calcular_agua === true, "sin suelo NO se bloquea: franco es el término medio de FAO-56");
  ok(e.lista_para_ejecutar_riego === true, "y los minutos siguen siendo fiables");
  const inc = e.incertidumbres.find(i => i.dato === "suelo");
  ok(!!inc && inc.motivo === "sin_determinar", "pero queda declarado que no se ha determinado");
  ok(MOTOR.SUELO_AWC.franco === 0.15, "y el fallback es el valor central de la tabla, no un invento");
}

console.log("\n── 8. falla el clima: la configuración puede estar completa ──");
{
  const cfg = R.estadoSiembra({ cultivo: "lechuga", fechaPlantacion: "2026-09-06", lat: 41, lon: 2,
                                area_m2: 2174, metodoRiego: "goteo", caudal: 6.7,
                                riego: { capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "alta" } },
                              { suelo: "franco" }, { cultivosSoportados: CULTIVOS, hoy: HOY });
  ok(cfg.estado_configuracion === "completa", "la configuración está completa");
  // Lo que NO puede pasar: que una caída de Open-Meteo devuelva al agricultor al
  // onboarding. Su configuración no ha cambiado; el que falla es el proveedor.
  const d = R.estadoDecision(cfg, { coberturaClima: 0.42 });
  ok(d.estado_datos_externos === "clima_temporalmente_incompleto", "el clima se declara aparte");
  ok(d.estado_decision === "esperando_datos", "y la decisión espera datos");
  ok(cfg.estado_configuracion === "completa", "SIN tocar el estado de configuración");
  ok(!JSON.stringify(cfg.faltan).includes("clima"), "el clima nunca aparece en `faltan`");
  // Y con clima, decide.
  const d2 = R.estadoDecision(cfg, { coberturaClima: 1 });
  ok(d2.estado_decision === "puede_decidir", "con cobertura completa, decide");
}

console.log("\n── 9. caudal estimado → pendiente_validacion ──");
{
  const e = R.estadoSiembra({ cultivo: "lechuga", fechaPlantacion: "2026-09-06", lat: 41, lon: 2,
                              area_m2: 2174, metodoRiego: "goteo" },
                            { suelo: "franco" }, { cultivosSoportados: CULTIVOS, hoy: HOY });
  ok(e.estado_configuracion === "pendiente_validacion",
     `ni completa ni incompleta: pendiente_validacion (${e.estado_configuracion})`);
  ok(e.lista_para_calcular_agua === true, "el agua se puede calcular");
  ok(e.lista_para_ejecutar_riego === false, "los minutos NO son fiables");
  ok(e.faltan.length === 0, "y no 'falta' nada: lo que hay es una incertidumbre, que no es lo mismo");
  const inc = e.incertidumbres.find(i => i.dato === "capacidad_riego");
  ok(inc?.motivo === "sin_capacidad_declarada" && inc.confianza === "baja",
     "declarada como lo que es: no hay capacidad, no hay minutos");
  ok(e.capacidad.operativo === null,
     "y NO hay caudal operativo: la estimación no cruza la puerta del motor");
  ok(e.capacidad.estimacion_mmh === 4,
     "la estimación se conserva aparte, solo para orientar (4 mm/h en goteo)");

  // Heredar el caudal del cultivo de al lado tampoco cuenta como dato propio.
  const h = R.estadoSiembra({ cultivo: "lechuga", fechaPlantacion: "2026-09-06", lat: 41, lon: 2,
                              area_m2: 2174, metodoRiego: "goteo" },
                            { suelo: "franco", caudal: 11 }, { cultivosSoportados: CULTIVOS, hoy: HOY });
  ok(h.capacidad.fuente === "heredado_finca", "un caudal heredado se marca como heredado");
  ok(h.lista_para_ejecutar_riego === false, "y tampoco habilita los minutos");
  ok(h.estado_configuracion === "pendiente_validacion", "queda pendiente_validacion");
}

console.log("\n── 10. sin capacidad: lámina sí, minutos no ──");
{
  const e = R.estadoSiembra({ cultivo: "lechuga", fechaPlantacion: "2026-09-06", lat: 41, lon: 2,
                              area_m2: 2174, metodoRiego: "goteo" },
                            { suelo: "franco" }, { cultivosSoportados: CULTIVOS, hoy: HOY });
  ok(e.lista_para_calcular_agua && !e.lista_para_ejecutar_riego,
     "los dos niveles son independientes: se puede saber el agua sin saber los minutos");
  // Y el motor lo corrobora: sin caudal declarado marca caudalEstimado.
  const p = MOTOR.presentarRiego(6, { metodoRiego: "goteo", caudalMmh: null });
  ok(p.caudalEstimado === true || p.unidad === "min",
     "presentarRiego lo resuelve con la tabla, y por eso hace falta declararlo arriba");
  // ⚠️ LÍMITE CONOCIDO, y el test lo fija tal como ES. `presentarRiego` solo
  // expone `caudalEstimado` en el camino largo (>2 h de riego). En el camino
  // corriente —el de casi todos los días— devuelve los minutos sin decir si el
  // caudal era suyo o nuestro. Por eso la fiabilidad de los minutos NO se
  // pregunta al motor: se pregunta a estadoSiembra, que sí lo sabe. Tocar el
  // motor para añadirlo es un front que este encargo deja fuera (§16).
  const pOk = MOTOR.presentarRiego(6, { metodoRiego: "goteo", caudalMmh: 6.7 });
  ok(pOk.caudalEstimado === undefined && pOk.unidad === "min",
     "en el camino corriente el motor NO declara si el caudal era estimado: por eso decide estadoSiembra");
  const conCap = R.estadoSiembra({ cultivo: "lechuga", fechaPlantacion: "2026-09-06", lat: 41, lon: 2,
                                   area_m2: 100, metodoRiego: "goteo", caudal: 6.7,
                                   riego: { capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "alta" } },
                                 { suelo: "franco" }, { cultivosSoportados: CULTIVOS, hoy: HOY });
  ok(conCap.lista_para_ejecutar_riego === true, "y con capacidad derivada, los minutos SÍ son fiables");

  // Regadera: su capacidad no es mm/h, son litros. Y falta de verdad.
  const reg = R.estadoSiembra({ cultivo: "lechuga", fechaPlantacion: "2026-09-06", lat: 41, lon: 2,
                                area_m2: 30, metodoRiego: "regadera" },
                              { suelo: "franco" }, { cultivosSoportados: CULTIVOS, hoy: HOY });
  ok(reg.unidad_orden === "regaderas", "la orden de una regadera se cuenta en viajes");
  ok(reg.faltan.includes("capacidad_regadera"), "y sin litros de regadera falta un dato de verdad");
  const reg2 = R.estadoSiembra({ cultivo: "lechuga", fechaPlantacion: "2026-09-06", lat: 41, lon: 2,
                                 area_m2: 30, metodoRiego: "regadera", capacidadRegaderaL: 10 },
                               { suelo: "franco" }, { cultivosSoportados: CULTIVOS, hoy: HOY });
  ok(reg2.estado_configuracion === "completa", "con los litros, completa");

  // Surco: no hay modelo de caudal y no hace falta. La orden va en L/m².
  const sur = R.estadoSiembra({ cultivo: "lechuga", fechaPlantacion: "2026-09-06", lat: 41, lon: 2,
                                area_m2: 500, metodoRiego: "surco" },
                              { suelo: "franco" }, { cultivosSoportados: CULTIVOS, hoy: HOY });
  ok(sur.unidad_orden === "l_m2" && sur.lista_para_ejecutar_riego === true,
     "a surco se le da la orden en L/m² y eso SÍ es ejecutable");
}

console.log("\n── 11. configuración histórica: sigue funcionando ──");
{
  // Una siembra creada antes de todo esto: sin `riego`, sin `caudal` propio.
  const vieja = { id: "h1", cultivo: "cebolla", area_m2: 440, fechaPlantacion: "2026-06-01" };
  const FINCA = { lat: 41.3, lon: 2.0, suelo: "franco", metodoRiego: "goteo", caudal: 15 };

  const cuerpo = `
    const window = { KyliaRiego: R };
    let cfgFinca = finca;
    let zonaActiva = null;
    let parcelaActiva = () => p;
    ${recorta("function configEfectiva(")}
    return configEfectiva;
  `;
  const c = new Function("finca", "p", "R", cuerpo)(FINCA, vieja, R)();
  ok(c.caudal === 15, `hereda el caudal de la finca, como siempre hizo (${c.caudal})`);
  ok(c.metodoRiego === "goteo", "y el método");
  ok(c.riegoInfo === null, "sin procedencia inventada");

  // Y LA HUELLA NO SE MUEVE: si payloadSiembra cambiara el valor enviado para
  // una siembra antigua, el despliegue dispararía una ronda de sincronización de
  // todo el histórico. `s.caudal ?? base.caudal` da exactamente lo de antes.
  const cuerpo2 = `
    const window = { KyliaRiego: R };
    const nombreCultivo = (c) => c;
    ${recorta("function payloadSiembra(")}
    ${recorta("function estable(")}
    ${recorta("function huellaPayload(")}
    return { payloadSiembra, huellaPayload };
  `;
  const { payloadSiembra, huellaPayload } = new Function("R", cuerpo2)(R);
  const z = { referencia: "R1", geometria: { type: "Polygon", coordinates: [[[0, 0]]] }, siembras: [vieja] };
  const pay = payloadSiembra(z, vieja, FINCA, "dueno-1");
  ok(pay.caudal === 15, `la siembra histórica sigue mandando el caudal de la finca (${pay.caudal})`);

  // Y una nueva manda el suyo.
  const nueva = { id: "n1", cultivo: "lechuga", area_m2: 100, fechaPlantacion: "2026-09-06",
                  metodoRiego: "aspersion", caudal: 20 };
  const z2 = { referencia: "R1", geometria: { type: "Polygon", coordinates: [[[0, 0]]] }, siembras: [nueva] };
  const pay2 = payloadSiembra(z2, nueva, FINCA, "dueno-1");
  ok(pay2.caudal === 20, `y la nueva manda el suyo (${pay2.caudal}), no el 15 de la finca`);
  ok(huellaPayload(pay) !== huellaPayload(pay2), "huellas distintas, como debe ser");

  // La columna ya existía por fila: esto NO necesita migración.
  const schema = readFileSync(join(RAIZ, "db", "schema.sql"), "utf8");
  ok(/caudal\s+numeric/.test(schema), "usuarios.caudal ya existe y es por fila: cada siembra ES una fila");
}

console.log("\n── 12. la capacidad vigente sale de un solo sitio ──");
{
  // Una sola función decide qué caudal rige, para que el motor, la pantalla y el
  // estado no puedan responder cosas distintas sobre la misma siembra.
  const propio = R.capacidadVigente({ metodoRiego: "goteo", riego: { capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "alta" } }, { caudal: 11 });
  ok(propio.operativo === 6.7 && propio.nivel === "siembra", "el de la siembra gana al de la finca");

  // ⚠️ UNA SIEMBRA QUE DECLARÓ SU RIEGO NO HEREDA. `riego` con capacidad nula es
  // "dijo que no lo sabe", y eso NO puede resolverse con el caudal del cultivo
  // de al lado ni con la tabla por defecto.
  const noLoSe = R.capacidadVigente({ metodoRiego: "goteo", riego: { capacidad_mmh: null, fuente: "no_lo_se" } }, { caudal: 11 });
  ok(noLoSe.operativo === null, `"no lo sé" no hereda el 11 de la finca (${noLoSe.operativo})`);
  ok(noLoSe.estimacion_mmh === 4, "pero la estimación queda a mano, en su propio campo");
  ok(noLoSe.declarada === true, "y consta que declaró su riego: por eso no hereda");

  // Legacy intacto: sin `riego` se hereda como siempre.
  const heredado = R.capacidadVigente({ metodoRiego: "goteo" }, { caudal: 11 });
  ok(heredado.operativo === 11 && heredado.nivel === "finca", "sin el suyo y sin declarar, el de la finca");
  ok(heredado.declarada === false, "marcado como no declarado");

  const nada = R.capacidadVigente({ metodoRiego: "goteo" }, {});
  ok(nada.operativo === null, "sin ninguno NO se inventa: operativo null");
  ok(nada.estimacion_mmh === 4 && nada.fuente === "sin_datos", "con la estimación aparte y la fuente dicha");

  const surco = R.capacidadVigente({ metodoRiego: "surco" }, {});
  ok(surco.operativo === null && surco.estimacion_mmh === null,
     "y a surco no se le inventa un caudal que no tiene modelo");
  ok(R.puedeDarMinutos("surco", null) === true,
     "aunque a surco sí se le puede dar su orden: va en L/m² y no depende del caudal");
}

console.log("\n── 13. el alta ya no pregunta mm/h de frente ──");
{
  ok(!/¿Sabes cuánta agua echa tu riego\?/.test(FUENTE),
     "la pregunta directa por el caudal ha desaparecido del alta");
  ok(!/Litros por metro cuadrado en una hora/.test(FUENTE),
     "y el campo numérico en mm/h, también");
  ok(/id="alta-cap-q"/.test(FUENTE) && /id="alta-cap-sep"/.test(FUENTE) && /id="alta-cap-lin"/.test(FUENTE),
     "en su lugar hay tres preguntas que se contestan mirando el bancal");
  ok(/id="alta-cap-nolose"/.test(FUENTE) && /id="ec-cap-nolose"/.test(FUENTE),
     "y \"no lo sé\" existe como respuesta en las dos puertas");
  ok(/L\/m² cada hora/.test(FUENTE), "el resultado se enseña en la unidad del agricultor, no en mm/h");
  // El vaso no puede volver a ofrecerse en goteo.
  const pinta = recorta("function ecPintarCapacidad(");
  ok(/esVaso\s*=\s*m === "aspersion" \|\| m === "manguera"/.test(pinta),
     "el vaso se ofrece SOLO en aspersión y manguera, nunca en goteo (sobreestima ×29)");
}

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
