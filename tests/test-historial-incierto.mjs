// Un balance que no se puede afirmar no se afirma por NINGÚN camino.
//   node tests/test-historial-incierto.mjs
//
// Cinco fallos reproducidos sobre bcb2c30, y los cinco venían de lo mismo: dar
// por resuelto un historial que no lo está.
//
// 1 · Un reanclaje el día 8 no dice nada de los días 9-16. Medido: añadir
//     20 L/m² el 12 movía la recomendación del 17 de 26,8 a 18,6 — con el hueco
//     "cerrado" en las dos.
// 2 · Una capacidad SIN VALIDAR reconstruía una lámina que reanclaba el balance:
//     400 min × 6,7 mm/h declarados pasaban por medición.
// 3 · Si fallaba la lectura de config_app, `registradoEl` quedaba en null —
//     indistinguible de una configuración legacy— y los 14 días desaparecían.
// 4 · El residuo SÍ cambia decisiones: dos historias con el mismo reanclaje daban
//     Dr 9,667 y 11,186 contra un RAW de 11,165. Vigilar en una, regar 12,4 L/m²
//     en la otra, ambas "conocidas". Yo había afirmado lo contrario.
// 5 · El cron congelaba "Regar hoy ~32 L/m²" con confianza "conocido", y el
//     reveal lo publicaba sin rastro de la incertidumbre.
//
// Decisión de alcance: CONSERVADORA. El reanclaje se queda como diagnóstico
// —dice cuándo se llenó el suelo— pero ya no cierra nada. Mientras haya un tramo
// sin registro, el balance es orientativo.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";
import Module from "module";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const M = require(join(RAIZ, "assets", "js", "motor-riego.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

const d = (i, e = {}) => {
  const x = new Date(new Date("2026-09-03T12:00:00Z").getTime() + i * 86400000);
  return { date: x.toISOString().slice(0, 10), et0: 4, lluvia: 0, tmax: 26, tmin: 15, ...e };
};
const O = { suelo: "franco", cultivoId: "lechuga", metodoRiego: "goteo",
            fechaPlantacion: "2026-09-03", termico: false };

// ══════════════════════════════════════════════════════════════════
console.log("── 1 · un reanclaje NO cierra los días que vienen después ──");
{
  const S = Array.from({ length: 15 }, (_, i) => d(i));
  const o = { ...O, ventana: { desde: "2026-09-03", hasta: "2026-09-17" }, historialDesde: "2026-09-17" };
  const A = M.balanceHidrico(S, [{ date: "2026-09-08", litros: 60 }], o);
  const B = M.balanceHidrico(S, [{ date: "2026-09-08", litros: 60 }, { date: "2026-09-12", litros: 20 }], o);
  const dA = M.decisionRiego(A, { lluviaPrevista: [] }), dB = M.decisionRiego(B, { lluviaPrevista: [] });
  ok(A.balanceReancladoEn === "2026-09-08", "el reanclaje del día 8 se detecta y se anota");
  ok(A.aportesPreviosDesconocidos === 14, `pero NO cierra el hueco (${A.aportesPreviosDesconocidos} días)`);
  ok(A.confianzaBalance === "incierto" && B.confianzaBalance === "incierto",
     "las dos historias siguen siendo inciertas");
  ok(Math.abs(dA.cantidad_l_m2 - dB.cantidad_l_m2) > 5,
     `y con razón: ${dA.cantidad_l_m2} vs ${dB.cantidad_l_m2} L/m² según lo que pasara los días 9-16`);
}

console.log("\n── 2 · una capacidad SIN VALIDAR no sube la confianza ──");
{
  // 400 min × 6,7 mm/h "declarado" = 44,7 mm reconstruidos, más que el TAW.
  const L = M.laminaDeAccion({ cantidad_l_m2: null, duracion_min: 400, lamina_mm: null,
                               lamina_origen: null, caudal_mmh: null }, 6.7);
  ok(L.reconstruida === true && L.origen === "recalculada_caudal_actual",
     `la lámina viene reconstruida del caudal actual (${L.mm} mm)`);
  const S = Array.from({ length: 15 }, (_, i) => d(i));
  const b = M.balanceHidrico(S, [{ date: "2026-09-08", litros: L.mm }],
    { ...O, ventana: { desde: "2026-09-03", hasta: "2026-09-17" }, historialDesde: "2026-09-17" });
  ok(b.confianzaBalance === "incierto",
     "y aun así el balance sigue siendo incierto: no se gana confianza con una capacidad sin validar");
  ok(b.aportesPreviosDesconocidos === 14, "los 14 días siguen ahí");
  // Y el número NO se toca: la prioridad de la lámina congelada sigue igual.
  const congelada = M.laminaDeAccion({ cantidad_l_m2: 5, duracion_min: 30, lamina_mm: 12.3,
                                       lamina_origen: "medida", caudal_mmh: 6 }, 99);
  ok(congelada.mm === 12.3 && congelada.reconstruida !== true,
     "la lámina congelada sigue mandando sobre el caudal de hoy");
}

console.log("\n── 3 · un error de lectura no es un historial conocido ──");
{
  const S = Array.from({ length: 15 }, (_, i) => d(i));
  const base = { ...O, ventana: { desde: "2026-09-03", hasta: "2026-09-17" } };
  const legacy = M.balanceHidrico(S, [], { ...base, historialDesde: null, historialSinDeterminar: false });
  ok(legacy.confianzaBalance === "conocido",
     "A · configuración legacy LEÍDA y sin registradoEl: se comporta como siempre");
  const roto = M.balanceHidrico(S, [], { ...base, historialDesde: null, historialSinDeterminar: true });
  ok(roto.confianzaBalance === "incierto",
     "B · lectura fallida: NO se convierte en A, el balance queda incierto");
  ok(roto.historialSinDeterminar === true, "y se declara explícitamente, no se deduce");
  ok(legacy.historialSinDeterminar === false, "mientras que el legacy identificado no lo lleva");
}

console.log("\n── 4 · el residuo SÍ cambia decisiones (contraejemplo) ──");
{
  // ET₀ 4 del 3 al 13, y 5,99 el 14 y el 15. Mismo reanclaje de 60 L/m² el 13.
  const S = [];
  for (let i = 0; i < 11; i++) S.push(d(i));
  S.push(d(11, { et0: 5.99 })); S.push(d(12, { et0: 5.99 }));
  const o = { ...O, ventana: { desde: "2026-09-03", hasta: "2026-09-15" }, historialDesde: "2026-09-15" };
  const A = M.balanceHidrico(S, [{ date: "2026-09-13", litros: 60 }], o);
  const B = M.balanceHidrico(S, [{ date: "2026-09-11", litros: 20 }, { date: "2026-09-13", litros: 60 }], o);
  const dA = M.decisionRiego(A, { lluviaPrevista: [] }), dB = M.decisionRiego(B, { lluviaPrevista: [] });
  ok(A.balanceReancladoEn === "2026-09-13" && B.balanceReancladoEn === "2026-09-13",
     "las dos reanclan el mismo día");
  ok(Math.abs(A.Dr - B.Dr) > 1e-6,
     `y aun así NO convergen: Dr ${A.Dr.toFixed(6)} vs ${B.Dr.toFixed(6)} (RAW ${A.raw.toFixed(6)})`);
  ok(dA.nivel !== dB.nivel, `con decisiones OPUESTAS: ${dA.nivel} vs ${dB.nivel}`);
  ok(A.confianzaBalance === "incierto" && B.confianzaBalance === "incierto",
     "por eso ninguna de las dos se declara conocida");
}

console.log("\n── el reanclaje sobrevive como DIAGNÓSTICO, sin implicar nada ──");
{
  const S = Array.from({ length: 15 }, (_, i) => d(i));
  const b = M.balanceHidrico(S, [{ date: "2026-09-08", litros: 60 }],
    { ...O, ventana: { desde: "2026-09-03", hasta: "2026-09-17" }, historialDesde: "2026-09-17" });
  ok(b.balanceReancladoEn === "2026-09-08", "se sigue anotando cuándo se llenó el suelo");
  ok(b.confianzaBalance === "incierto", "pero no implica historial resuelto");
  // Lo ÚNICO que cierra el hueco: haber estado apuntando desde el día cero.
  const desdeElDiaCero = M.balanceHidrico(S, [],
    { ...O, ventana: { desde: "2026-09-03", hasta: "2026-09-17" }, historialDesde: "2026-09-03" });
  ok(desdeElDiaCero.aportesPreviosDesconocidos === 0 && desdeElDiaCero.confianzaBalance === "conocido",
     "plantada y registrada el mismo día: ahí sí no hay tramo a oscuras");
  // Y sin contexto, el comportamiento de siempre.
  const sinContexto = M.balanceHidrico(S, [], { ...O, ventana: { desde: "2026-09-03", hasta: "2026-09-17" } });
  ok(sinContexto.confianzaBalance === "conocido", "sin `historialDesde`, exactamente como antes");
}

// ══════════════════════════════════════════════════════════════════
// Los HANDLERS reales. Se simulan Supabase y el clima (transporte); la lógica
// de campo.js, diario-b.js y _reveal.js es la de verdad.
// ══════════════════════════════════════════════════════════════════
const hoyD = new Date("2026-09-17T09:00:00Z");
const iso = (x) => x.toISOString().slice(0, 10);
const HOY = iso(hoyD), PLANT = iso(new Date(hoyD.getTime() - 14 * 86400000));
const SERIE = []; for (let i = 19; i >= 0; i--) SERIE.push({ date: iso(new Date(hoyD.getTime() - i * 86400000)), et0: 4, lluvia: 0, tmax: 26, tmin: 15 });
const UID = "11111111-2222-4333-8444-555555555555";
const U = { id: UID, propietario_id: UID, lat: 41.32, lon: 2.06, suelo: "franco",
            cultivos: ["lechuga"], metodo_riego: "goteo", caudal: 6.7, area_m2: 500,
            fecha_plantacion: PLANT, fecha_cosecha: null, piloto_sombra: true };

// Carga un handler con el transporte sustituido. `configRota` hace fallar SOLO
// la lectura de config_app del propietario, que es el caso 3.
function cargarHandler(ruta, { config = null, configRota = false, capturar = null } = {}) {
  const orig = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id.endsWith("_supabase.js")) return {
      isConfigured: () => true, preludio: () => true,
      supabaseSelect: async (t, q) => {
        if (t === "usuarios" && /config_app/.test(q)) {
          if (configRota) throw new Error("config_app no disponible");
          return [{ config_app: config }];
        }
        if (t === "usuarios") return [U];
        return [];
      },
      supabaseInsert: async (t, filas) => { capturar?.(t, filas); return filas; },
      supabaseUpdate: async () => ({}),
    };
    if (id.endsWith("_clima.js")) return {
      climaSerie: async () => SERIE, serieTermica: async () => SERIE, hoyISO: () => HOY,
      normalesMensuales: async () => null, procedencia: () => ({ fuente: "archivo", dias: 20 }),
      diasConDato: () => 20, sumarDias: (f, n) => iso(new Date(new Date(`${f}T12:00:00Z`).getTime() + n * 86400000)),
      diasEntre: () => 0,
    };
    return orig.apply(this, arguments);
  };
  try { delete require.cache[require.resolve(join(RAIZ, ruta))]; } catch (_) {}
  const h = require(join(RAIZ, ruta));
  Module.prototype.require = orig;
  return h;
}
const llamar = async (h, query) => {
  let salida = null, codigo = null;
  const res = { status(c) { codigo = c; return this; }, json(x) { salida = x; return this; },
                setHeader() {}, end() {}, getHeader() {} };
  await h({ method: "GET", url: "/api/campo", query, headers: {} }, res);
  return { codigo, salida };
};

const CFG_NUEVA = { zonas: [{ referencia: "R1", siembras: [{ id: UID, cultivo: "lechuga",
  registradoEl: HOY, riego: { capacidad_mmh: 6.7, fuente: "derivado_goteo", confianza: "alta" } }] }] };

console.log("\n── HANDLER REAL · vista=hoy ──");
{
  const campo = cargarHandler("api/campo.js", { config: CFG_NUEVA });
  const { codigo, salida } = await llamar(campo, { vista: "hoy", usuario_id: UID });
  ok(codigo === 200, "responde 200");
  ok(salida.capacidad_riego.clase === "fiable" && salida.capacidad_riego.puede_ejecutar === true,
     "la CAPACIDAD es fiable: la instalación está medida");
  ok(salida.balance_confianza.confianza === "incierto",
     "y aun así el BALANCE es incierto: son dos ejes distintos");
  ok(salida.balance_confianza.aportes_previos_desconocidos === 14, "con sus 14 días");
  ok(salida.hoy.balance_incierto === true, "la recomendación de hoy va marcada");
  ok(/^Quizá toque regar/.test(salida.hoy.texto), `y el texto no afirma: "${salida.hoy.texto.slice(0, 48)}…"`);
  ok(/^quizá /.test(salida.hoy.presentacion.texto),
     `tampoco la presentación: "${salida.hoy.presentacion.texto}"`);
  ok(/orientativo/.test(salida.hoy.presentacion.aviso || ""), "con su aviso");

  console.log("\n  ── 3 · con la lectura de config_app ROTA ──");
  const campoRoto = cargarHandler("api/campo.js", { configRota: true });
  const r2 = await llamar(campoRoto, { vista: "hoy", usuario_id: UID });
  ok(r2.salida.balance_confianza.historial_sin_determinar === true,
     "se declara que no se ha podido determinar el contexto");
  ok(r2.salida.balance_confianza.confianza === "incierto",
     "el balance NO pasa a conocido por un error de lectura");
  ok(r2.salida.hoy.balance_incierto === true, "y la recomendación sigue marcada");
  ok(/comprobar tu historial/.test(r2.salida.hoy.presentacion?.aviso || ""),
     `con un aviso propio: "${(r2.salida.hoy.presentacion?.aviso || "").slice(0, 52)}…"`);

  console.log("\n  ── legacy leído de verdad: se comporta como siempre ──");
  const CFG_LEGACY = { zonas: [{ referencia: "R1", siembras: [{ id: UID, cultivo: "lechuga" }] }] };
  const campoLegacy = cargarHandler("api/campo.js", { config: CFG_LEGACY });
  const r3 = await llamar(campoLegacy, { vista: "hoy", usuario_id: UID });
  ok(r3.salida.balance_confianza.historial_sin_determinar === false,
     "el contexto SÍ se determinó: es legacy, no un error");
  ok(r3.salida.hoy.balance_incierto === false, "y su recomendación no se marca");
  ok(/^Regar hoy/.test(r3.salida.hoy.texto), `afirma, como siempre: "${r3.salida.hoy.texto.slice(0, 32)}…"`);
}

console.log("\n── 5 · CADENA CRON → LOG → REVEAL, sin escribir fuera ──");
{
  const filasLog = [];
  const diario = cargarHandler("api/diario-b.js", { config: CFG_NUEVA,
    capturar: (t, f) => { if (t === "recomendaciones_log") filasLog.push(...f); } });
  let salida = null;
  const res = { status() { return this; }, json(x) { salida = x; return this; }, setHeader() {}, end() {} };
  // El cron solo persiste con DIARIO_B_LIVE=1. Se enciende SOLO para esta
  // llamada y los inserts se capturan en memoria: cero escrituras fuera.
  const antes = process.env.DIARIO_B_LIVE;
  process.env.DIARIO_B_LIVE = "1";
  try { await diario({ method: "GET", url: "/api/diario-b", query: {}, headers: {} }, res); }
  finally { if (antes === undefined) delete process.env.DIARIO_B_LIVE; else process.env.DIARIO_B_LIVE = antes; }
  ok(filasLog.length > 0, `el cron congela ${filasLog.length} fila(s), capturadas EN MEMORIA`);
  const riego = filasLog.find(f => f.tipo === "riego");
  ok(!!riego, "hay una decisión de riego");
  ok(riego.contexto.confianza === "incierto",
     `y la guarda como incierta (${riego.contexto.confianza})`);
  ok(riego.contexto.aportes_previos_desconocidos === 14,
     `con los 14 días dentro del log (${riego.contexto.aportes_previos_desconocidos})`);
  ok(riego.contexto.historial_sin_determinar === false, "y el contexto determinado");

  // El REVEAL, alimentado con esas filas capturadas.
  const { construirReveal } = require(join(RAIZ, "api", "_reveal.js"));
  const marca = (ctx) => (ctx.aportes_previos_desconocidos === undefined
                          && ctx.historial_sin_determinar === undefined) ? null
                       : ((Number(ctx.aportes_previos_desconocidos) || 0) > 0
                          || ctx.historial_sin_determinar === true);
  const riegosKylia = filasLog.filter(f => f.tipo === "riego").map(f => ({
    dia: String(f.fecha).slice(0, 10), l_m2: f.cantidad_l_m2, nivel: f.nivel,
    incierto: marca(f.contexto), confianza: f.contexto.confianza }));
  const rev = construirReveal({ usuario: U, riegosKylia,
    riegosReales: [{ dia: HOY, l_m2: 40 }], tratReales: [], tratKylia: [], jornadas: [] });
  const agua = rev.dimensiones.agua;
  ok(agua && agua.publicable === false,
     "el reveal NO publica una cifra congelada sobre un balance incierto");
  ok(/sin conocer los riegos anteriores/.test(agua.motivo_no_publicable || ""),
     `y dice por qué: "${(agua.motivo_no_publicable || "").slice(0, 60)}…"`);
  ok(agua.recomendada_l_m2 === null, "sin sacar la cifra comparada");
  ok(agua.decisiones_inciertas >= 1, `${agua.decisiones_inciertas} decisión(es) incierta(s), declaradas`);

  console.log("\n  ── logs ANTIGUOS: tratamiento explícito, sin inventar confianza ──");
  const viejos = riegosKylia.map(r => ({ dia: r.dia, l_m2: r.l_m2, nivel: r.nivel, incierto: marca({}) }));
  const rev2 = construirReveal({ usuario: U, riegosKylia: viejos,
    riegosReales: [{ dia: HOY, l_m2: 40 }], tratReales: [], tratKylia: [], jornadas: [] });
  const agua2 = rev2.dimensiones.agua;
  ok(agua2.decisiones_sin_metadato_confianza >= 1,
     "se cuentan las filas sin el metadato, en vez de suponerlas conocidas");
  ok(agua2.historial_declarado === false, "y se declara que el historial no consta");
  ok(!/sin conocer los riegos anteriores/.test(agua2.motivo_no_publicable || ""),
     "no se bloquean por ser anteriores a que el metadato existiera");
  void salida;
}

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
