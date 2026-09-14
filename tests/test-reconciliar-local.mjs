// El historial del móvil se reconcilia con el del servidor tras la migración.
//   node tests/test-reconciliar-local.mjs
//
// HALLAZGO DE CODEX sobre 3c8f73d: la migración congela las acciones en Supabase
// (lamina_mm, lamina_origen, caudal_mmh) pero los riegos que ya estaban en el
// localStorage del móvil no reciben nada. El servidor usa la lámina congelada y
// la app sigue recalculando con el caudal actual: vuelven a divergir.
//
// El test NO fabrica una acción ya congelada: parte de una fila ANTIGUA (con
// duración y sin lámina), le aplica el MISMO backfill que hace la migración SQL,
// y comprueba que la app acaba usando esa lámina.
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

const CAUDAL_HISTORICO = 15, CAUDAL_ACTUAL = 5.4;   // el cambio real del bancal

// ── Punto de partida: el histórico ANTIGUO, tal como está hoy ──
// En el móvil: duración, sin lámina. En Supabase: lo mismo.
const localAntiguo = [
  { date: "2026-07-20", litros: null, duracion: 60, franja: "manana" },
  { date: "2026-07-24", litros: null, duracion: 90, franja: "manana" },
  { date: "2026-07-28", litros: 22,   duracion: null, franja: "tarde" },
];
const servidorAntiguo = localAntiguo.map((r, i) => ({
  id: 100 + i, fecha_local: r.date, tipo: "riego",
  cantidad_l_m2: r.litros, duracion_min: r.duracion,
  lamina_mm: null, lamina_origen: null, caudal_mmh: null,
}));

console.log("── 1. antes de migrar: app y servidor recalculan y divergen ──");
const leerLocal = (rs, caudal) => rs.map(r => MOTOR.laminaDeAccion(
  { cantidad_l_m2: r.litros ?? null, duracion_min: r.duracion ?? null,
    lamina_mm: r.lamina_mm ?? null, lamina_origen: r.lamina_origen ?? null }, caudal).mm);
const antesA = leerLocal(localAntiguo, CAUDAL_HISTORICO);
const antesB = leerLocal(localAntiguo, CAUDAL_ACTUAL);
ok(JSON.stringify(antesA) !== JSON.stringify(antesB),
   `sin congelar, el historial local se mueve con el caudal: ${JSON.stringify(antesA)} → ${JSON.stringify(antesB)}`);

console.log("\n── 2. la migración congela EN SUPABASE (mismo backfill que el SQL) ──");
// Réplica de db/congelar-lamina-riego-2026-09-14.sql, pasos 6a y 6b.
const migrar = (filas, caudalUsuario) => filas.map(f => {
  if (f.lamina_origen) return f;                                   // idempotente
  if (f.cantidad_l_m2 != null && !(f.duracion_min > 0))
    return { ...f, lamina_mm: f.cantidad_l_m2, lamina_origen: "cantidad_apuntada" };
  if (f.duracion_min > 0 && caudalUsuario > 0)
    return { ...f, caudal_mmh: caudalUsuario,
             lamina_mm: Math.round((caudalUsuario * f.duracion_min / 60) * 10) / 10,
             lamina_origen: "backfill_caudal_actual" };
  return { ...f, lamina_origen: "desconocida" };
});
// La migración corre CON EL CAUDAL HISTÓRICO todavía puesto.
const servidorMigrado = migrar(servidorAntiguo, CAUDAL_HISTORICO);
ok(servidorMigrado.every(f => f.lamina_origen != null), "todas las filas del servidor quedan clasificadas");
ok(migrar(servidorMigrado, 99).every((f, i) => f.lamina_origen === servidorMigrado[i].lamina_origen),
   "y reejecutar el backfill no reclasifica ninguna (idempotente)");
const laminasServidor = servidorMigrado.map(f => f.lamina_mm);
ok(JSON.stringify(laminasServidor) === JSON.stringify([15, 22.5, 22]),
   `láminas congeladas: ${JSON.stringify(laminasServidor)}`);

console.log("\n── 3. la app reconcilia: clave fecha + contenido ──");
// Se ejecutan las funciones REALES de la app.
function extraer(nombre) {
  let i = app.indexOf(`function ${nombre}(`);
  // Si la declaración es `async function`, hay que llevarse el `async` — sin él
  // el cuerpo extraído tiene `await` en una función normal y ni siquiera compila.
  if (app.slice(i - 6, i) === "async ") i -= 6;
  let d = 0, j = app.indexOf("{", i);
  for (; j < app.length; j++) { if (app[j] === "{") d++; else if (app[j] === "}") { d--; if (!d) break; } }
  return app.slice(i, j + 1);
}
const remotos = servidorMigrado.map(f => ({
  id: f.id, fecha: f.fecha_local, duracion_min: f.duracion_min,
  cantidad_l_m2: f.cantidad_l_m2, lamina_mm: f.lamina_mm,
  lamina_origen: f.lamina_origen, caudal_mmh: f.caudal_mmh,
}));
let guardado = null;
const ctxApp = {
  riegos: localAntiguo.map(r => ({ ...r })),
  saveRiegos: (arr) => { guardado = arr; ctxApp.riegos = arr; },
  idParcelaActiva: () => "11111111-2222-3333-4444-555555555555",
  fetch: async () => ({ ok: true, json: async () => ({ riegos_recientes: remotos }) }),
};
const fn = new Function("riegos", "saveRiegos", "idParcelaActiva", "fetch", "window",
  `${extraer("firmaRiego")}\n${extraer("reconciliarRiegos")}\n;return reconciliarRiegos;`);
const reconciliar = fn(ctxApp.riegos, ctxApp.saveRiegos, ctxApp.idParcelaActiva, ctxApp.fetch, {});
const r1 = await reconciliar();
ok(r1.reconciliados === 3, `se reconcilian los 3 riegos (${r1.reconciliados}), sin casar ${r1.sinCasar}`);
ok(guardado.every(x => x.lamina_mm != null), "todos reciben su lámina congelada");
ok(guardado.every(x => x.reconciliado === true), "y quedan marcados como reconciliados");

console.log("\n── 4. app y servidor usan YA la misma lámina histórica ──");
const laminasApp = leerLocal(guardado, CAUDAL_ACTUAL);
ok(JSON.stringify(laminasApp) === JSON.stringify(laminasServidor),
   `app ${JSON.stringify(laminasApp)} == servidor ${JSON.stringify(laminasServidor)}`);

console.log("\n── 5. y cambiar otra vez el caudal ya no mueve nada ──");
for (const caudal of [CAUDAL_HISTORICO, CAUDAL_ACTUAL, 2, 40]) {
  ok(JSON.stringify(leerLocal(guardado, caudal)) === JSON.stringify(laminasServidor),
     `con el caudal actual a ${caudal} mm/h, el histórico sigue igual`);
}

console.log("\n── lo que NO se puede casar se conserva y se marca ──");
// Dos riegos el mismo día con la misma firma: no hay forma de saber cuál es cuál.
const ambiguoLocal = [
  { date: "2026-08-02", litros: null, duracion: 30 },
  { date: "2026-08-02", litros: null, duracion: 30 },
];
const ambiguoRemoto = [
  { id: 1, fecha: "2026-08-02", duracion_min: 30, cantidad_l_m2: null, lamina_mm: 7.5, lamina_origen: "backfill_caudal_actual", caudal_mmh: 15 },
  { id: 2, fecha: "2026-08-02", duracion_min: 30, cantidad_l_m2: null, lamina_mm: 7.5, lamina_origen: "backfill_caudal_actual", caudal_mmh: 15 },
];
let guardado2 = null;
const rec2 = new Function("riegos", "saveRiegos", "idParcelaActiva", "fetch", "window",
  `${extraer("firmaRiego")}\n${extraer("reconciliarRiegos")}\n;return reconciliarRiegos;`)(
  ambiguoLocal, (a) => { guardado2 = a; }, () => "x",
  async () => ({ ok: true, json: async () => ({ riegos_recientes: ambiguoRemoto }) }), {});
const r2 = await rec2();
ok(r2.reconciliados === 0 && r2.sinCasar === 2, `dos riegos idénticos el mismo día: 0 reconciliados, ${r2.sinCasar} sin casar`);
ok(guardado2 === null, "y no se sobrescribe el historial local");

// Fecha igual pero contenido distinto: tampoco casa.
let guardado3 = null;
const rec3 = new Function("riegos", "saveRiegos", "idParcelaActiva", "fetch", "window",
  `${extraer("firmaRiego")}\n${extraer("reconciliarRiegos")}\n;return reconciliarRiegos;`)(
  [{ date: "2026-08-05", litros: null, duracion: 45 }],
  (a) => { guardado3 = a; }, () => "x",
  async () => ({ ok: true, json: async () => ({ riegos_recientes: [
    { id: 9, fecha: "2026-08-05", duracion_min: 120, cantidad_l_m2: null, lamina_mm: 30, lamina_origen: "duracion_x_caudal", caudal_mmh: 15 }] }) }), {});
const r3 = await rec3();
ok(r3.reconciliados === 0, "misma fecha con otra duración: NO se copia la lámina de la que no es");

console.log("\n── y sin red, el historial local se queda como estaba ──");
const rec4 = new Function("riegos", "saveRiegos", "idParcelaActiva", "fetch", "window",
  `${extraer("firmaRiego")}\n${extraer("reconciliarRiegos")}\n;return reconciliarRiegos;`)(
  localAntiguo, () => { throw new Error("no debería guardar"); }, () => "x",
  async () => { throw new Error("offline"); }, {});
const r4 = await rec4();
ok(r4.reconciliados === 0 && r4.motivo === "sin red", `sin red no se toca nada (${r4.motivo})`);

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
