// La app tampoco puede reescribir el pasado, ni equivocarse de día a medianoche.
//   node tests/test-app-historico.mjs
//
// HALLAZGOS DE CODEX sobre ff8f2be, todos reproducidos aquí ejecutando el código
// REAL de app/index.html en un entorno de mentira (sin navegador):
//
//   1. riegosConLamina() convertía TODO el historial con `cfg.caudal`, el caudal
//      de HOY: remedir el caudal reescribía el balance que ve el agricultor,
//      mientras el servidor ya respetaba la lámina congelada.
//   3. fechas agronómicas en UTC: a las 00:30 en España, la plantación y los
//      riegos sembrados al alta se corrían un día.
//   4. la ventana de clima se quedaba en 10 días si el archivo fallaba, así que
//      un ciclo de 110 días se truncaba a 10 en el móvil.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const MOTOR = require(join(RAIZ, "assets", "js", "motor-riego.js"));
const KyliaClima = require(join(RAIZ, "assets", "js", "clima-reglas.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };
const app = readFileSync(join(RAIZ, "app", "index.html"), "utf8");

// Extrae una función suelta del fuente de la app y la ejecuta con el contexto
// que necesite. No es un navegador, pero SÍ es el código que corre en producción.
function extraer(nombre, extra = "") {
  const i = app.indexOf(`function ${nombre}(`);
  if (i < 0) throw new Error(`no encuentro ${nombre} en app/index.html`);
  // Recorta hasta cerrar llaves balanceadas.
  let d = 0, j = app.indexOf("{", i);
  const ini = j;
  for (; j < app.length; j++) {
    if (app[j] === "{") d++;
    else if (app[j] === "}") { d--; if (d === 0) break; }
  }
  const cuerpo = app.slice(i, j + 1);
  return new Function("MOTOR", "KyliaClima", extra ? extra.split(",")[0] : "_",
    `${cuerpo}\n;return ${nombre};`);
}

console.log("── 1. el historial no se recalcula con el caudal de hoy ──");
const CAUDAL_A = 15, CAUDAL_B = 5.4;
const riegosConLamina = extraer("riegosConLamina")(MOTOR, KyliaClima, null);
// Un riego de 60 min apuntado cuando el caudal era 15 mm/h, ya congelado.
const congelado = [{ date: "2026-07-20", litros: null, duracion: 60,
                     lamina_mm: 15, lamina_origen: "duracion_x_caudal", caudal_mmh: CAUDAL_A }];
const conA = riegosConLamina({ cfg: { caudal: CAUDAL_A }, riegos: congelado });
const conB = riegosConLamina({ cfg: { caudal: CAUDAL_B }, riegos: congelado });
ok(conA[0].litros === 15, `con el caudal de entonces: ${conA[0].litros} mm`);
ok(conB[0].litros === 15, `y tras remedirlo a ${CAUDAL_B}: sigue siendo ${conB[0].litros} mm`);
ok(conB[0].lamina_origen === "duracion_x_caudal", "conservando su procedencia");
ok(conB[0].reconstruida === false, "y sin marcarse como reconstrucción: es dato de época");

// Y sin congelar, el fallback SÍ recalcula — pero lo declara.
const viejo = [{ date: "2026-07-20", litros: null, duracion: 60 }];
const vA = riegosConLamina({ cfg: { caudal: CAUDAL_A }, riegos: viejo });
const vB = riegosConLamina({ cfg: { caudal: CAUDAL_B }, riegos: viejo });
ok(vA[0].litros !== vB[0].litros,
   `un riego sin congelar sí se mueve (${vA[0].litros} → ${vB[0].litros}): es el bug que había`);
ok(vB[0].reconstruida === true, "y sale MARCADO como reconstruido, no se cuela como dato");

console.log("\n── y al apuntar, la app congela ──");
ok(/lamina_mm: laminaMm, lamina_origen: origen, caudal_mmh: caudalAhora/.test(app),
   "addRiego guarda lámina, origen y caudal del momento");
ok(/const laminaMm = MOTOR\.laminaRiego\(litrosN, duracion, caudalAhora\)/.test(app),
   "calculada UNA vez con el caudal de ese momento");

console.log("\n── 3. fechas agronómicas: 00:30 CEST y 00:30 CET ──");
// El día civil lo resuelve el módulo compartido; aquí se comprueba que la app lo
// USA para las fechas que mueven agronomía (plantación y riegos del alta).
for (const [iso, esperado, etiqueta] of [
  ["2026-07-15T00:30:00+02:00", "2026-07-15", "verano (CEST)"],
  ["2026-01-15T00:30:00+01:00", "2026-01-15", "invierno (CET)"],
]) {
  const hoy = KyliaClima.hoyISO(new Date(iso));
  const utc = new Date(iso).toISOString().slice(0, 10);
  ok(hoy === esperado, `${etiqueta}: hoy = ${hoy} (en UTC daba ${utc})`);
  // "planté hace 40 días" a esa hora
  ok(KyliaClima.sumarDias(hoy, -40) !== KyliaClima.sumarDias(utc, -40),
     `y la plantación de hace 40 días cae en ${KyliaClima.sumarDias(hoy, -40)}, no en ${KyliaClima.sumarDias(utc, -40)}`);
}
ok(/const plantado = KyliaClima\.sumarDias\(KyliaClima\.hoyISO\(\), -hace\)/.test(app),
   "la app calcula la fecha de plantación con el día civil");
ok(/const menosDias = n => KyliaClima\.sumarDias\(KyliaClima\.hoyISO\(\), -n\)/.test(app),
   "y los riegos que siembra el alta, también");
ok(!/const menosDias = n => \{ const d = new Date\(\)/.test(app), "sin el helper UTC de antes");

console.log("\n── 4. el clima: mismo flujo que el servidor, ciclos largos incluidos ──");
ok(/KyliaClima\.cargarSerie\(/.test(app), "la app usa cargarSerie, el flujo compartido");
ok(!/past_days=\$\{Math\.min\(10, past\)\}/.test(app), "ya no tiene su propio tope de 10 días");

// Se prueba el flujo de verdad, con el archivo caído y medio caído.
const dia = (base, n) => { const d = new Date(`${base}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const hoy = KyliaClima.hoyISO();
function pedirFalso({ archivoDesde = null }) {
  return async (url, fuente) => {
    const u = String(url);
    if (u.includes("archive-api")) {
      if (!archivoDesde) return [];                       // archivo CAÍDO
      const ini = u.match(/start_date=(\d{4}-\d{2}-\d{2})/)[1];
      const desde = ini > archivoDesde ? ini : archivoDesde;
      const n = Math.round((new Date(`${hoy}T12:00:00Z`) - new Date(`${desde}T12:00:00Z`)) / 86400000);
      return Array.from({ length: Math.max(0, n) }, (_, i) => ({ date: dia(desde, i), et0: 4, lluvia: 0, fuente: "archivo" }));
    }
    const past = Number(u.match(/past_days=(\d+)/)[1]);
    return Array.from({ length: past + 1 }, (_, i) => ({ date: dia(hoy, -past + i), et0: 9, lluvia: 0, fuente: "pronostico" }));
  };
}
for (const [etiqueta, ciclo] of [["72 días", 72], ["110 días", 110]]) {
  const desde = dia(hoy, -ciclo);
  const caido = await KyliaClima.cargarSerie({ lat: 41.7, lon: 2.5, desde, futuro: 1, pedir: pedirFalso({}) });
  ok(caido.length > 60,
     `ciclo de ${etiqueta} con el archivo CAÍDO: ${caido.length} días (antes se quedaba en 11)`);
  ok(KyliaClima.procedencia(caido, hoy).coherencia === 0,
     "y la degradación se declara (coherencia 0), no se esconde");
  // Archivo PARCIAL: solo cubre desde hace 40 días.
  const parcial = await KyliaClima.cargarSerie({ lat: 41.7, lon: 2.5, desde, futuro: 1,
                                                 pedir: pedirFalso({ archivoDesde: dia(hoy, -40) }) });
  const pr = KyliaClima.procedencia(parcial, hoy);
  ok(pr.pasado_archivo > 0 && pr.pasado_pronostico > 0,
     `y con el archivo PARCIAL se mezcla declarándolo: ${pr.pasado_archivo} del archivo, ${pr.pasado_pronostico} del pronóstico`);
  ok(pr.coherencia > 0 && pr.coherencia < 1, `coherencia ${pr.coherencia}: ni completa ni cero`);
}

console.log("\n── 5. la app declara la ventana que NECESITA, no la que recibe ──");
// HALLAZGO DE CODEX: la app llamaba al balance sin `{ desde, hasta }`, así que
// una serie truncada se comparaba consigo misma y parecía completa. El caso
// crítico: ciclo de 110 días, clima disponible 93. No puede dar cobertura 1.
const MOTOR2 = MOTOR;
const hoyC = KyliaClima.hoyISO();
const d = n => KyliaClima.sumarDias(hoyC, -n);
const CICLO_D = 110, DISPONIBLES = 93;
const serie110 = Array.from({ length: DISPONIBLES }, (_, i) =>
  ({ date: d(DISPONIBLES - i), et0: 5, lluvia: 0, tmax: 29, tmin: 16 }));
const OPTS = { suelo: "franco", cultivoId: "tomate", metodoRiego: "goteo", fechaPlantacion: d(CICLO_D) };

const sinVentana = MOTOR2.balanceHidrico(serie110, [], OPTS);
ok(sinVentana.coberturaClima === 1,
   "sin ventana el motor da cobertura 1 midiendo la serie contra sí misma: por eso hacía falta");
ok(sinVentana.ventanaClimaDeclarada === false, "y lo declara: esa cobertura no significa nada");

const conVentana = MOTOR2.balanceHidrico(serie110, [], { ...OPTS, ventana: { desde: d(CICLO_D), hasta: hoyC } });
ok(conVentana.ventanaClimaDeclarada === true, "con la ventana del ciclo, la cobertura sí se mide");
ok(conVentana.diasEsperadosClima === CICLO_D + 1,
   `días esperados = ${conVentana.diasEsperadosClima} (el ciclo entero)`);
ok(conVentana.coberturaClima < 1,
   `cobertura ${conVentana.coberturaClima}, NO 1`);
ok(conVentana.diasSinClima === CICLO_D + 1 - DISPONIBLES,
   `y declara los ${conVentana.diasSinClima} días ausentes`);
ok(conVentana.confianzaBalance === "incierto",
   `y la confianza cae a "${conVentana.confianzaBalance}"`);

// Y que la app lo haga de verdad: construye la ventana desde la plantación.
ok(/const ventana = plant \? \{ desde: String\(plant\)\.slice\(0, 10\), hasta: hoyCivil \} : null/.test(app),
   "la app declara { desde: plantación, hasta: hoy civil }");
ok(/fechaPlantacion: plant,[\s\S]{0,40}ventana,/.test(app), "y se la pasa al motor");
for (const campo of ["coberturaClima", "diasSinClima", "confianzaBalance", "riegosSinCantidad",
                     "ventanaClimaDeclarada", "diasSinLluviaConocida", "diasEsperadosClima"])
  ok(new RegExp(`${campo}:\\s+bal\\.${campo}`).test(app), `y el adaptador propaga ${campo}`);

console.log("\n── 6. la confianza baja llega a la pantalla ──");
ok(/bal\?\.riegosSinCantidad > 0/.test(app),
   "la tarjeta de riego mira si el balance se apoya en un riego sin cifra");
ok(/Precisión reducida: falta conocer la cantidad de un riego anterior/.test(app),
   "y lo dice en castellano, sin tecnicismos");
ok(/accionesDeHoy\.__confianzaBaja = /.test(app),
   "y también cuando HOY no hay nada que hacer: 'no toca regar' puede venir de ese supuesto");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
