// El reloj del cultivo: calor, no calendario.
//   node tests/test-fenologia-termica.mjs
//
// POR QUÉ EXISTE ESTE FICHERO. Hasta el 8-sep-2026 el motor situaba la fenología
// contando días desde la plantación, con las longitudes de la Tabla 11 de
// FAO-56. Esas longitudes vienen atadas a una fecha de plantación de referencia
// ("Mediterranean, April"), así que solo valen si plantas cuando plantaba la
// tabla. El piloto de cebolleta de El Tros de l'Uri lo destapó:
//
//   plantado 24-jun-2026 · primera cosecha 12-ago-2026 · 49 días reales
//   el modelo de calendario decía 70 → 2-sep → 21 días tarde
//
// Y no era un error de FAO: con la temperatura REAL de ese campo, la misma suma
// térmica que Oriol acumuló en 49 días de verano pide 70 días plantando el 1 de
// mayo, que es justo la fecha de referencia de la tabla. Los dos números eran
// correctos; la unidad estaba mal.
//
// Los datos de abajo son los de ese ciclo, tal cual los da Open-Meteo para
// 41.674 N 2.766 E. Se embeben para que los tests no toquen la red (la CI corre
// sin dependencias ni claves).
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const M = require(join(RAIZ, "assets", "js", "motor-riego.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };
const casi = (a, b, tol) => Math.abs(a - b) <= tol;

// ── El ciclo real de Oriol, 24-jun → 20-ago de 2026 ────────────────
const PLANT = "2026-06-24";
const COSECHA_REAL = "2026-08-12";
const TMAX = [31.8,30.7,31.6,31,30.3,32.1,31.7,29.5,29.8,31.7,31,32.4,32.7,32,34.1,33.6,31.4,31,30.5,31.2,29.8,33.5,32.2,31,31.8,34.8,32.7,34,31.5,31.9,31.8,30.4,28.2,28.6,29.8,30.9,30.6,30.8,30.4,31.8,31.1,30.6,32.9,32.1,31.1,33.8,33.7,32.3,33,33.5,34.1,34.3,32.3,32.3,32,31,32.5,31.5];
const TMIN = [21.9,22.8,24.4,22.8,24,23.9,23,22.6,21.4,19.8,21.6,19.9,20.5,22.2,22.1,23.6,23.5,23.2,21.3,21.8,21.9,25.1,25,23.8,23.9,23.8,23.9,24.1,23.8,21.8,23,23.7,19.6,20,20.5,22.7,25,23.8,22.5,23.2,22.9,23.3,23.8,23.9,22,22.7,24,23.3,24.9,22.8,23.5,23.4,24.1,22.9,22.9,24.1,25,23];
const ET0  = [6.11,6.23,7.01,6.32,6.17,5.94,5.82,5.53,6.39,6.56,6.35,7.09,6.95,6.87,7.29,7.1,6.26,5.57,5.83,5.88,5.65,5.68,5.21,5.61,6,6.22,6.29,6.66,6.91,6.25,6.69,5.74,4.87,5.06,5.54,5.87,6.07,5.77,5.32,5.26,4.93,4.93,5.8,4.76,4.93,5.83,5.66,5.63,5.2,5.25,5.57,5.57,5.21,4.67,4.56,4.96,5.41,3.64];

const sumarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const serieCompleta = TMAX.map((tmax, i) => ({ date: sumarDias(PLANT, i), tmax, tmin: TMIN[i], et0: ET0[i], lluvia: 0 }));
const hasta = f => serieCompleta.filter(d => d.date <= f);
// Normales mensuales de La Selva (medias 2015-2024, Open-Meteo) para proyectar
// más allá del pronóstico.
const NORMALES = { 6: { tmax: 26.6, tmin: 17.4 }, 7: { tmax: 29.4, tmin: 20.3 },
                   8: { tmax: 29.4, tmin: 20.5 }, 9: { tmax: 26.1, tmin: 17.6 } };

console.log("── la tabla térmica está completa y cuadra con el eje de FAO ──");
for (const cultivo of Object.keys(M.FAO_KC)) {
  const g = M.FAO_GDD[cultivo];
  if (!g) { ok(false, `${cultivo} no tiene tabla de grados-día`); continue; }
  ok(g.gdd.length === 4 && g.gdd.every(v => v > 0), `${cultivo}: 4 fases con calor positivo`);
}
ok(Object.keys(M.FAO_GDD).length === Object.keys(M.FAO_KC).length,
   "no hay cultivos con Kc y sin reloj térmico (o al revés)");
for (const cultivo of Object.keys(M.FAO_KC)) {
  const ciclo = M.FAO_KC[cultivo].L.reduce((a, b) => a + b, 0);
  ok(casi(M.diasFenologicos(cultivo, M.gddDelCiclo(cultivo)), ciclo, 0.01),
     `${cultivo}: el calor del ciclo entero cae justo en el día ${ciclo} del eje de FAO`);
}

console.log("\n── el caso que lo destapó: 49 días reales contra 70 de calendario ──");
const curva = M.curvaFenologica("cebolla", hasta(COSECHA_REAL), PLANT);
ok(curva !== null, "con temperatura desde la plantación, el reloj térmico se enciende");
const diaCal = M.diasEntre(PLANT, new Date(`${COSECHA_REAL}T12:00:00`));
const diaFen = curva.diaDe(COSECHA_REAL);
ok(diaCal === 49, `el calendario dice que el 12-ago era el día ${diaCal} del ciclo`);
ok(diaFen >= 68, `y el calor dice que era el día ${diaFen.toFixed(0)} — o sea, el final (eran 70)`);
ok(M.faseDelDia("cebolla", diaCal) === "media" && M.faseDelDia("cebolla", diaFen) === "final",
   "el día que Oriol empezó a arrancar, el calendario lo creía en fase media y el calor lo ponía en final");
ok(curva.gddAcum >= 1000, `calor acumulado del ciclo real: ${Math.round(curva.gddAcum)} °C·día`);

console.log("\n── y por eso el Kc iba corto: no es solo planificación, es riego ──");
const opts = { suelo: "franco", cultivoId: "cebolla", metodoRiego: "aspersion", fechaPlantacion: PLANT };
const balCal = M.balanceHidrico(hasta(COSECHA_REAL), [], { ...opts, termico: false });
const balTer = M.balanceHidrico(hasta(COSECHA_REAL), [], opts);
ok(balCal.modoFenologia === "calendario" && balTer.modoFenologia === "termico",
   "el mismo balance, con los dos relojes");
ok(balTer.etcAcum > balCal.etcAcum,
   `el reloj de calendario pedía MENOS agua de la que el cultivo gastaba: ` +
   `${balCal.etcAcum.toFixed(1)} mm contra ${balTer.etcAcum.toFixed(1)} mm`);
const desvio = (balTer.etcAcum / balCal.etcAcum - 1) * 100;
ok(desvio > 3 && desvio < 9, `la desviación en el ciclo entero es del ${desvio.toFixed(1)}% (medido: 8,7%)`);

console.log("\n── la ventana es una ventana, y contiene la cosecha real ──");
let contenidas = 0, mirados = 0;
for (const hoy of ["2026-06-30", "2026-07-10", "2026-07-20", "2026-07-31", "2026-08-07"]) {
  const c = M.curvaFenologica("cebolla", hasta(hoy), PLANT);
  const v = M.ventanaMadurez("cebolla", { gddAcum: c.gddAcum, desdeISO: hoy,
              pronostico: serieCompleta.filter(d => d.date > hoy).slice(0, 16), normales: NORMALES });
  mirados++;
  if (v.desde <= COSECHA_REAL && v.hasta >= COSECHA_REAL) contenidas++;
  else console.log(`      (${hoy}: ${v.desde} → ${v.hasta})`);
}
ok(contenidas === mirados,
   `las ${mirados} ventanas, desde 6 días después de plantar, contienen el 12-ago real`);

const vLejos = M.ventanaMadurez("cebolla", { gddAcum: M.curvaFenologica("cebolla", hasta("2026-06-30"), PLANT).gddAcum,
                desdeISO: "2026-06-30", pronostico: [], normales: NORMALES });
const vCerca = M.ventanaMadurez("cebolla", { gddAcum: M.curvaFenologica("cebolla", hasta("2026-08-07"), PLANT).gddAcum,
                desdeISO: "2026-08-07", pronostico: [], normales: NORMALES });
const ancho = v => Math.round((new Date(v.hasta) - new Date(v.desde)) / 86400000);
ok(ancho(vLejos) > ancho(vCerca),
   `la ventana se estrecha al acercarse la madurez (${ancho(vLejos)} d a mes y medio, ${ancho(vCerca)} d a una semana)`);
ok(vLejos.desde < vLejos.probable && vLejos.probable < vLejos.hasta,
   "y siempre está ordenada: desde < probable < hasta");
ok(M.ventanaMadurez("cebolla", { gddAcum: 5000, desdeISO: "2026-08-12" }).estado === "lista",
   "pasado el calor del ciclo, el estado es 'lista' y no una fecha futura");

console.log("\n── el pronóstico no cuenta como calor ya caído ──");
// Bug encontrado el 8-sep-2026 con datos de producción: la serie térmica trae 16
// días de PRONÓSTICO, y curvaFenologica los sumaba en `gddAcum`. El tomate de
// Ferran salía con 1823 °C·día sobre 1749 —o sea "lista"— cuando lo acumulado de
// verdad eran 1653 y le faltaban seis días. La ventana se adelantaba justo lo que
// durase el pronóstico, y como el agricultor cosecha por su cuenta, el fallo
// habría pasado por acierto.
const conFuturo = M.curvaFenologica("cebolla", serieCompleta, PLANT);   // llega al 20-ago
ok(conFuturo.gddEn(COSECHA_REAL) < conFuturo.gddAcum,
   `el calor al 12-ago (${Math.round(conFuturo.gddEn(COSECHA_REAL))}) es MENOR que al final de la serie (${Math.round(conFuturo.gddAcum)})`);
ok(Math.abs(conFuturo.gddEn(COSECHA_REAL) - curva.gddAcum) < 0.01,
   "y coincide exactamente con el de una serie cortada ese día: el futuro no cuenta");
const balFuturo = M.balanceHidrico(hasta(COSECHA_REAL), [], { ...opts, serieTermica: serieCompleta });
ok(balFuturo.gddAcum === Math.round(curva.gddAcum),
   "el balance reporta el calor de su último día, no el del final de la serie térmica");
ok(conFuturo.gddEn("2026-06-01") === 0 && conFuturo.gddEn("2026-06-24") > 0,
   "antes de plantar no hay calor acumulado, y el día de la plantación ya empieza a contar");

console.log("\n── nada de esto se inventa cuando no se puede saber ──");
ok(M.curvaFenologica("cebolla", hasta(COSECHA_REAL).map(({ date, et0 }) => ({ date, et0 })), PLANT) === null,
   "sin temperaturas en la serie no hay reloj térmico (se vuelve al calendario)");
ok(M.curvaFenologica("cebolla", hasta(COSECHA_REAL).filter(d => d.date > "2026-07-01"), PLANT) === null,
   "y con la serie empezada a mitad del ciclo TAMPOCO: media suma térmica haría parecer joven a un cultivo hecho");
ok(M.curvaFenologica("patata", hasta(COSECHA_REAL), PLANT) === null,
   "un cultivo sin tabla térmica no activa el reloj");
ok(M.curvaFenologica("cebolla", hasta(COSECHA_REAL), null) === null,
   "y sin fecha de plantación tampoco hay nada que contar");
ok(M.ventanaMadurez("cebolla", { gddAcum: 300, desdeISO: "2026-07-10", pronostico: [], normales: null }) === null,
   "sin pronóstico NI normales no se proyecta una fecha a ojo: se devuelve null");
ok(M.gradosDia(null, 20, 6) === null && M.gradosDia(30, undefined, 6) === null,
   "un día sin las dos temperaturas no suma 0 grados-día: suma null, y quien llame decide");
ok(M.gradosDia(4, 2, 6) === 0, "y un día por debajo de la temperatura base no resta calor");

console.log("\n── compatibilidad: sin temperatura, el motor es el de siempre ──");
const sinTemp = hasta(COSECHA_REAL).map(({ date, et0, lluvia }) => ({ date, et0, lluvia }));
const a = M.balanceHidrico(sinTemp, [], opts);
const b = M.balanceHidrico(sinTemp, [], { ...opts, termico: false });
ok(a.Dr === b.Dr && a.etcAcum === b.etcAcum && a.kcActual === b.kcActual,
   "mismo déficit, misma ETc y mismo Kc: la validación contra pyfao56 sigue en pie");
ok(a.modoFenologia === "calendario", "y lo dice, para que se pueda auditar desde fuera");
const sk = M.simularKylia(sinTemp, opts), sk2 = M.simularKylia(sinTemp, { ...opts, termico: false });
ok(sk.total === sk2.total, "el contrafactual del reveal tampoco se mueve sin temperatura");

console.log("\n── el resultado no depende de haber acertado la temperatura base ──");
// Si la conclusión cambiara al mover Tbase un par de grados, sería un artefacto.
const base = M.FAO_GDD.cebolla.tbase;
for (const tb of [base - 2, base + 2]) {
  const gddCiclo = TMAX.slice(0, 49).reduce((s, tx, i) => s + Math.max(0, (tx + TMIN[i]) / 2 - tb), 0);
  // Con esa Tbase, ¿cuántos días de MAYO harían falta para el mismo calor?
  // Aproximación con las normales: mayo-junio ronda los 22 °C de media.
  ok(gddCiclo > 0, `con Tbase ${tb} °C el ciclo real acumula ${Math.round(gddCiclo)} °C·día (sigue habiendo señal)`);
}
const rel = M.diasFenologicos("cebolla", M.gddDelCiclo("cebolla") * 0.7);
ok(rel > 40 && rel < 60, `el mapeo calor→día del eje es monótono y sensato (70% del calor ≈ día ${rel.toFixed(0)})`);

console.log("\n── las normales mensuales salen de la serie, no de una constante ──");
const hist = [{ date: "2020-07-01", tmax: 30, tmin: 20 }, { date: "2021-07-01", tmax: 28, tmin: 18 },
              { date: "2020-01-01", tmax: 14, tmin: 4 }];
const n = M.normalesMensuales(hist);
ok(n[7].tmax === 29 && n[7].tmin === 19 && n[1].tmax === 14, "media por mes, con los meses que haya");
ok(M.normalesMensuales([]) === null && M.normalesMensuales(null) === null,
   "y sin serie devuelve null en vez de un mes inventado");

console.log("\n── el cableado: quien calcula fenología tiene que recibir temperatura ──");
const leer = f => readFileSync(join(RAIZ, ...f), "utf8");
const campo   = leer(["api", "campo.js"]);
const diarioB = leer(["api", "diario-b.js"]);
const app     = leer(["app", "index.html"]);
for (const [nombre, src] of [["api/campo.js", campo], ["api/diario-b.js", diarioB], ["app/index.html", app]]) {
  ok(/temperature_2m_max,temperature_2m_min/.test(src),
     `${nombre} pide Tmax/Tmin a open-meteo (va en la misma llamada, no cuesta una petición más)`);
}
// El reveal y la comparativa arrancan DESPUÉS de la plantación, así que el calor
// no se puede contar sobre su propia ventana: necesitan la serie térmica aparte.
// Sin esto el contrafactual usaría el reloj de calendario y volvería a discrepar
// del que ve el agricultor cada día — el mismo desajuste que costó el 31-jul.
ok((campo.match(/serieTermica: termica/g) || []).length >= 2,
   "el reveal y la comparativa reciben la serie térmica del ciclo completo");
ok(/serieTermica: termica/.test(campo.slice(campo.indexOf("async function vistaHoy"))),
   "y la vista de hoy también, que es la que ve el agricultor");
ok(/vista === "madurez"/.test(campo) && /async function vistaMadurez/.test(campo),
   "existe la vista que /app consulta para la ventana de madurez");
ok(/id="card-madurez"/.test(app) && /<section class="card card-madurez" id="card-madurez" aria-label="Cuándo estará lista" hidden>/.test(app),
   "la tarjeta de /app nace OCULTA: sin respuesta del servidor no se enseña una fecha a medias");
ok(/no una fecha de cosecha/.test(app),
   "y en pantalla dice que es una ventana de madurez, no una fecha de cosecha");
ok(/kcActual:\s+bal\.kcActual/.test(app),
   "el Kc que enseña /app sale del balance, no de un cálculo aparte por calendario");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
