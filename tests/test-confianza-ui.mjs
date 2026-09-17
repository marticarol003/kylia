// El aviso de precisión reducida tiene que LLEGAR A LA PANTALLA.
//   node tests/test-confianza-ui.mjs
//
// POR QUÉ EXISTE ESTE FICHERO. El bloqueo 2 de Codex ya estaba corregido, pero
// se verificaba leyendo app/index.html con expresiones regulares: comprobaba que
// la propagación estuviera ESCRITA, no que contestara. Es exactamente la clase
// de test que dejó pasar los tres defectos del 13-sep. Aquí se ejecuta la cadena
// entera —motor → adaptador → acciones → renderizador— y se mira el HTML que
// sale, que es lo que ve el agricultor.
//
// Los dos casos del encargo:
//   A · riego sin cantidad y HAY que regar   → la recomendación dice que es de menor confianza
//   B · riego sin cantidad y NO hay que hacer nada → el aviso sale IGUAL
// Y sus dos controles con el riego apuntado CON cantidad, que es lo que prueba
// que el aviso depende del dato y no está pegado siempre.
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
const AVISO = "Precisión reducida: falta conocer la cantidad de un riego anterior";

// Recorta el cuerpo de una función del fuente, con llaves balanceadas.
function cuerpo(src, nombre) {
  const i = src.indexOf(`function ${nombre}(`);
  if (i < 0) throw new Error(`no encuentro ${nombre}`);
  let d = 0, j = src.indexOf("{", i);
  for (; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (d === 0) break; }
  }
  return src.slice(i, j + 1);
}

// ─── Un DOM de mentira, suficiente para recoger lo que se pinta ──────────────
function nuevoDom() {
  const els = {};
  const elem = id => ({
    id, innerHTML: "", textContent: "", hidden: false, className: "",
    style: {}, classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    scrollIntoView() {}, getAttribute() { return "false"; }, click() {},
  });
  return { els, getElementById(id) { return els[id] || (els[id] = elem(id)); } };
}

// ════════════════════════════════════════════════════════════════════════════
// /app · motor → adaptador → acciones → renderizador, el código real
// ════════════════════════════════════════════════════════════════════════════
const app = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
const REALES = ["esc", "fmtRiegoCon", "diasDesde", "riegosConLamina",
                "calcularBalanceHidrico", "calcularAlertaRiego",
                "accionesDeParcela", "accionesDeHoy", "renderHoy"];

const PRELUDIO = `
  let CTX = null, cfg = {}, cfgFinca = {}, ultimoET0 = [], ultimoPrevision = [];
  let zonaActiva = null, ultimoNDVI = null, sateliteConsultado = false;
  function ctxActual() { return CTX; }
  function ctxDe(_p) { return CTX; }                     // una sola parcela
  function parcelasReales() { return [{ id: null, cultivo: (cfg.cultivos || [])[0] || null }]; }
  function nombreCultivo(c) { return String(c || ""); }
  function cambiarZona() {}
  function abrirModalRiego() {}
  function tramoDeAbonadoPendiente() { return null; }
  function aplicacionesConPlazoActivo() { return []; }
  function formatearFechaCorta(f) { return String(f); }
  function generarDetalleHoy() { return ""; }
`;
// `fmtRiegoCon` pasa por la puerta que decide si se pueden dar MINUTOS
// (assets/js/riego-capacidad.js), así que el arnés necesita su `window`.
const VENTANA = { KyliaRiego: createRequire(import.meta.url)("../assets/js/riego-capacidad.js") };
const fabricaApp = new Function("MOTOR", "KyliaClima", "document", "window",
  PRELUDIO + REALES.map(n => cuerpo(app, n)).join("\n\n") + `
  return {
    montar(ctx, serie, prevision) { CTX = ctx; cfg = ctx.cfg; cfgFinca = ctx.cfg;
                                    ultimoET0 = serie; ultimoPrevision = prevision || []; },
    calcularBalanceHidrico, accionesDeHoy, renderHoy,
  };`);

const hoy = KyliaClima.hoyISO();
const d  = n => KyliaClima.sumarDias(hoy, -n);
const DIAS = 44;
// Sin lluvia y con demanda constante: el déficit solo depende de los riegos, que
// es la variable del experimento.
const serie = Array.from({ length: DIAS + 1 }, (_, i) =>
  ({ date: d(DIAS - i), et0: 3, lluvia: 0, tmax: 24, tmin: 12 }));
// Un manejo normal: 12 mm cada tres días. Con esto el suelo llega a hoy sin
// pedir nada, que es lo que hace falta para probar el caso "todo en orden".
const PAUTA = []; for (let n = 42; n >= 4; n -= 3) PAUTA.push({ date: d(n), litros: 12 });
const CFG = { suelo: "franco", cultivos: ["lechuga"], metodoRiego: "aspersion",
              caudal: 15, areaParcela: 440, fechaPlantacion: d(DIAS) };

function pintar(riegos) {
  const dom = nuevoDom();
  const a = fabricaApp(MOTOR, KyliaClima, dom, VENTANA);
  a.montar({ cfg: CFG, riegos, ndmi: null }, serie, []);
  const bal = a.calcularBalanceHidrico();
  a.renderHoy();
  const el = dom.els["hoy-contenido"], card = dom.els["card-hoy"];
  return { bal, html: el ? el.innerHTML : "", oculta: card ? card.hidden : null };
}

console.log("── 1. el adaptador propaga de verdad (ejecutado, no leído) ──");
const sinCifra30 = pintar([{ date: d(30), litros: null, duracion: null }]);
ok(sinCifra30.bal !== null, "el adaptador devuelve balance");
ok(sinCifra30.bal.riegosSinCantidad === 1,
   `riegosSinCantidad = ${sinCifra30.bal.riegosSinCantidad} (el motor lo calcula y el adaptador lo copia)`);
ok(typeof sinCifra30.bal.confianzaBalance === "string" && sinCifra30.bal.confianzaBalance !== "conocido",
   `confianzaBalance = "${sinCifra30.bal.confianzaBalance}", no "conocido"`);
for (const campo of ["coberturaClima", "diasSinClima", "ventanaClimaDeclarada",
                     "diasEsperadosClima", "cicloCompletado"])
  ok(sinCifra30.bal[campo] !== undefined, `y ${campo} llega con valor (${sinCifra30.bal[campo]})`);

console.log("\n── 2. CASO A · riego sin cantidad y hay que regar ──");
ok(/accion-verbo">Regar/.test(sinCifra30.html), "la pantalla manda regar");
ok(sinCifra30.html.includes(AVISO), "y en la MISMA tarjeta dice que la precisión es reducida");
ok(!/\bDr\b|RAW|TAW|incertidumbre/.test(sinCifra30.html), "sin tecnicismos (ni Dr, ni RAW, ni TAW)");

console.log("\n── 3. CASO B · riego sin cantidad y NO hay nada que hacer ──");
const sinCifra2 = pintar([...PAUTA, { date: d(1), litros: null, duracion: null }]);
ok(sinCifra2.bal.riegosSinCantidad === 1, "el balance sigue apoyándose en un riego sin cifra");
ok(!/accion-verbo">Regar/.test(sinCifra2.html), "hoy no toca regar");
ok(sinCifra2.oculta === false, "la tarjeta NO se oculta (antes desaparecía y con ella el aviso)");
ok(sinCifra2.html.includes(AVISO), "y el aviso sale igual: 'no toca regar' ES la consecuencia del supuesto");

console.log("\n── 4. controles · con la cantidad apuntada no se avisa de nada ──");
const conCifra30 = pintar([{ date: d(30), litros: 30, duracion: null }]);
ok(conCifra30.bal.riegosSinCantidad === 0, "riegosSinCantidad = 0");
ok(/accion-verbo">Regar/.test(conCifra30.html), "también manda regar");
ok(!conCifra30.html.includes(AVISO),
   "y NO lleva el aviso — o sea que el aviso depende del dato, no está pegado siempre");
const conCifra2 = pintar([...PAUTA, { date: d(1), litros: 12, duracion: null }]);
ok(!conCifra2.html.includes(AVISO), "sin nada que hacer y con el dato completo, tampoco");
ok(conCifra2.oculta === true, "y ahí la tarjeta sí se oculta, como siempre");

console.log("\n── 5. y el caudal de hoy no puede resucitar el aviso ──");
// Remedir el caudal no cambia si SE SABE cuánta agua fue: son cosas distintas.
const CFG2 = { ...CFG, caudal: 5.4 };
const dom2 = nuevoDom(); const a2 = fabricaApp(MOTOR, KyliaClima, dom2, VENTANA);
a2.montar({ cfg: CFG2, riegos: [{ date: d(30), litros: 30, duracion: null }], ndmi: null }, serie, []);
a2.calcularBalanceHidrico(); a2.renderHoy();
ok(!dom2.els["hoy-contenido"].innerHTML.includes(AVISO),
   "con otro caudal y la cantidad apuntada, sigue sin avisar");

// ════════════════════════════════════════════════════════════════════════════
// /campo · el mismo aviso, en la otra pantalla
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 6. /campo pinta el aviso en los DOS niveles ──");
const campo = readFileSync(join(RAIZ, "campo", "index.html"), "utf8");
const fabricaCampo = new Function("document", `
  let USUARIO = {};
  const NIVEL = { alta: { tag: "Regar", titular: "Toca regar" },
                  media: { tag: "Vigilar", titular: "Vigila" },
                  baja: { tag: "Todo en orden", titular: "Todo en orden" } };
  function campoActual() { return { titulo: "Campo de prueba", unidad: "horas" }; }
  function fmtFecha(f) { return String(f); }
  function irA() {}
  function madurezCard() { return ""; }
  function desgloseCard() { return ""; }
  function durTxt(m) { return m + " min"; }
  function pintarChipsRiego() {}
  function borrarRiego() {}
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  ${cuerpo(campo, "pintarHoy")}
  return pintarHoy;`);

function pintarCampo(nivel, sinCantidad) {
  const dom = nuevoDom();
  fabricaCampo(dom)({
    ok: true, usuario: { ciudad: "Breda", cultivo: "lechuga" }, cosechado: false,
    hoy: { fecha: hoy, nivel, deficit_mm: nivel === "alta" ? 28 : 4, umbral_mm: 20,
           lluvia: 0, et0: 5, riegos_sin_cantidad: sinCantidad },
    proximo: null, desglose: null,
  });
  return dom.els["root"].innerHTML;
}
ok(pintarCampo("alta", 1).includes(AVISO), "nivel alta (toca regar): el aviso está");
ok(pintarCampo("baja", 1).includes(AVISO), "nivel baja (todo en orden): el aviso TAMBIÉN está");
ok(!pintarCampo("alta", null).includes(AVISO), "y sin riegos sin cantidad no aparece (control)");

console.log("\n── HISTORIAL DESCONOCIDO · lo que VE el agricultor ──");
{
  // Misma siembra: plantada hace 14 días, registrada HOY, clima completo y
  // controlado, y capacidad de riego MEDIDA y fiable — para que quede claro que
  // saber a qué ritmo riega no es saber cuánto regó.
  const PLANT = d(14);
  const CFG2 = { ...CFG, fechaPlantacion: PLANT, metodoRiego: "goteo", caudal: 6.7,
                 registradoEl: hoy };
  function pintar2(riegos, cfgExtra = {}) {
    const dom = nuevoDom();
    const a = fabricaApp(MOTOR, KyliaClima, dom, VENTANA);
    a.montar({ cfg: { ...CFG2, ...cfgExtra }, riegos, ndmi: null }, serie, []);
    const bal = a.calcularBalanceHidrico();
    a.renderHoy();
    const el = dom.els["hoy-contenido"];
    return { bal, texto: (el ? el.innerHTML : "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() };
  }

  const A = pintar2([]);
  ok(A.bal.aportesPreviosDesconocidos === 14, `A · sin riegos: ${A.bal.aportesPreviosDesconocidos} días a oscuras`);
  ok(A.bal.confianzaBalance === "incierto", "A · el balance no se declara conocido");
  // ⚠️ EL TITULAR, no un pie pequeño. Dejarlo en "Regar" con un aviso debajo es
  // presentar como confirmada una necesidad que no lo está: el aviso lo lee
  // quien ya duda, y el que no duda solo ve el verbo y el número.
  ok(/Quizá toque regar/.test(A.texto), `A · el titular duda: "${A.texto.slice(0, 70)}…"`);
  ok(!/>Regar</.test(A.texto), "A · y no dice \"Regar\" a secas");
  ok(/No sabemos cuánto regaste/.test(A.texto), "A · y explica por qué, con sus días");
  ok(/unos \d+ L\/m²/.test(A.texto), "A · la cantidad sale como aproximada");

  const B = pintar2([{ date: d(7), litros: 20 }]);
  ok(B.bal.aportesPreviosDesconocidos === 14,
     "B · UN riego de 20 L/m² NO cierra el hueco: no dice nada de los otros 13 días");
  ok(/Quizá toque regar/.test(B.texto), "B · y la pantalla lo sigue diciendo");

  const C = pintar2([{ date: d(7), litros: null }]);
  ok(C.bal.aportesPreviosDesconocidos === 14,
     "C · un riego SIN CANTIDAD tampoco: ahí Dr = 0 es una hipótesis nuestra");

  const D = pintar2([{ date: hoy, litros: 20 }]);
  ok(D.bal.aportesPreviosDesconocidos === 14,
     "D · un riego posterior al alta no demuestra nada de lo anterior");

  const E = pintar2([{ date: d(7), litros: 12 }], { registradoEl: PLANT });
  ok(E.bal.aportesPreviosDesconocidos === 0,
     "E · plantada el mismo día del registro: llevamos apuntando desde el día cero");
  ok(E.bal.confianzaBalance === "conocido", "E · y el balance se puede afirmar");
  ok(!/Quizá toque regar/.test(E.texto), "E · la pantalla vuelve a afirmar");

  console.log("\n  ── el reanclaje es DIAGNÓSTICO, no cierra el hueco ──");
  // Se intentó usarlo como evidencia suficiente —`Dr` está acotado en [0, TAW],
  // así que una entrada conocida de al menos TAW lo deja en 0— y no se sostiene:
  // un reanclaje el día 7 no dice nada de los días 8 a 13, y ni siquiera limpia
  // del todo lo anterior (`ks` se evalúa con el Dr PREVIO al riego). Se conserva
  // el dato, se retira la conclusión.
  const taw = A.bal.taw;
  ok(taw > 0, `TAW de esta parcela: ${taw.toFixed(1)} mm`);
  const porEncima = pintar2([{ date: d(7), litros: Math.ceil(taw) + 25 }]);
  ok(porEncima.bal.balanceReancladoEn === d(7),
     `se detecta y se anota cuándo se llenó el suelo (${porEncima.bal.balanceReancladoEn})`);
  ok(porEncima.bal.aportesPreviosDesconocidos === 14,
     "pero los 14 días previos SIGUEN sin registro");
  ok(porEncima.bal.confianzaBalance === "incierto",
     "así que el balance no se puede afirmar por eso");
  ok(/Quizá toque regar/.test(porEncima.texto), "y la pantalla lo sigue diciendo");

  console.log("\n  ── capacidad medida ≠ balance conocido ──");
  const R2 = createRequire(import.meta.url)("../assets/js/riego-capacidad.js");
  const cap = R2.evaluarCapacidadRiego({ capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "alta" }, "goteo");
  ok(cap.puede_ejecutar === true, "la instalación está medida y da minutos fiables");
  ok(A.bal.confianzaBalance === "incierto",
     "y aun así el balance sigue siendo incierto: convertir unidades no es conocer el déficit");
}

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
