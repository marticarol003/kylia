// Ningún escritor de acciones de riego puede saltarse la congelación.
//   node tests/test-escritores-riego.mjs
//
// HALLAZGO DE CODEX sobre ff8f2be: `materializarGoteoAuto()` insertaba acciones
// de riego con cantidad y duración pero SIN lamina_mm / lamina_origen /
// caudal_mmh. Y son las filas más sensibles que hay: las sintetiza el cron, nadie
// las revisa, y en el piloto de Ferran son 73 de los riegos del ciclo. Al no
// congelarse, remedir el caudal las reescribía hacia atrás.
//
// Este test EJECUTA el cron con Supabase en falso y mira lo que inserta.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dia = n => { const d = new Date(`${hoy}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const CAUDAL = 11;

const M = require(join(RAIZ, "assets", "js", "motor-riego.js"));
const insertados = [];
const sb = require(join(RAIZ, "api", "_supabase.js"));
sb.isConfigured = () => true;
sb.supabaseInsert = async (tabla, filas) => { if (tabla === "acciones") insertados.push(...[].concat(filas)); return filas; };
sb.supabaseSelect = async (tabla) => tabla === "usuarios" ? [{
  id: "11111111-2222-3333-4444-555555555555", ciudad: "Breda", lat: 41.7, lon: 2.5,
  cultivos: ["tomate"], metodo_riego: "goteo", caudal: CAUDAL, area_m2: 88, suelo: "franco",
  fecha_plantacion: dia(30), piloto_inicio: dia(30), piloto_sombra: true,
  riego_auto: true, riego_auto_min: 60, riego_auto_cada_dias: 3, riego_auto_desde: dia(30),
}] : [];

const http = require(join(RAIZ, "api", "_http.js"));
http.fetchConTimeout = async () => ({ ok: true, json: async () => {
  const t = [], e = [], p = [], tx = [], tn = [];
  for (let i = 31; i >= 0; i--) { t.push(dia(i)); e.push(5); p.push(0); tx.push(29); tn.push(16); }
  return { daily: { time: t, et0_fao_evapotranspiration: e, precipitation_sum: p,
                    temperature_2m_max: tx, temperature_2m_min: tn } };
} });

// El cron corre en DRY-RUN salvo que DIARIO_B_LIVE sea "1": sin esto no escribe
// nada y los `every()` de abajo pasarían sobre un array vacío sin probar nada.
process.env.DIARIO_B_LIVE = "1";
const handler = require(join(RAIZ, "api", "diario-b.js"));
await new Promise(r => {
  const res = { _c: 200, status(c) { this._c = c; return this; }, json() { r(); }, end() { r(); }, setHeader() {} };
  handler({ method: "GET", query: {}, headers: {} }, res).catch(() => r());
});

console.log("── el goteo automático congela como cualquier otro riego ──");
const riegos = insertados.filter(f => f.tipo === "riego");
// ⚠️ `every()` sobre un array vacío devuelve TRUE. Sin este mínimo, un cron que
// no escribiera nada pasaría todos los asserts de abajo sin probar nada — que es
// justo lo que hacía este test mientras corría en dry-run.
ok(riegos.length >= 5, `el cron sintetizó ${riegos.length} riegos de pauta fija`);
ok(riegos.length > 0 && riegos.every(f => f.lamina_mm != null), "todos traen lamina_mm");
ok(riegos.length > 0 && riegos.every(f => f.caudal_mmh === CAUDAL), `con el caudal del momento (${CAUDAL} mm/h)`);
ok(riegos.length > 0 && riegos.every(f => f.lamina_origen === "duracion_x_caudal"), "y su origen declarado");
const esperada = Math.round((60 / 60) * CAUDAL * 10) / 10;
ok(riegos.length > 0 && riegos.every(f => f.lamina_mm === esperada),
   `y la lámina cuadra con duración × caudal (${esperada} mm para 60 min a ${CAUDAL})`);
ok(riegos.length > 0 && riegos.every(f => f.motivo === "goteo-auto"),
   "siguen marcados como sintetizados, no confirmados por nadie");

console.log("\n── y lo congelado no se mueve si luego cambia el caudal ──");
const fila = riegos[0];
ok(M.laminaDeAccion(fila, 5.4).mm === esperada,
   `con el caudal remedido a 5,4 la fila sigue valiendo ${esperada} mm`);
ok(M.laminaDeAccion(fila, 5.4).reconstruida === false, "y no se marca como reconstrucción");

console.log("\n── inventario: los DOS escritores de acciones de riego ──");
// Si aparece un tercero que no congele, este test no lo vería: por eso se
// cuentan aquí. Cualquier supabaseInsert("acciones") nuevo tiene que pasar por
// el mecanismo o romper esta cuenta.
const fuentes = ["api/log.js", "api/diario-b.js"];
let total = 0;
for (const f of fuentes) {
  const src = readFileSync(join(RAIZ, f), "utf8");
  const n = (src.match(/supabaseInsert\(\s*"acciones"/g) || []).length;
  total += n;
  if (!n) continue;
  ok(/lamina_mm/.test(src) && /lamina_origen/.test(src) && /caudal_mmh/.test(src),
     `${f}: sus ${n} escritura(s) de acciones congelan lámina, origen y caudal`);
}
const otros = ["api/campo.js", "api/sentinel.js", "api/feedback.js", "api/pago.js", "api/aviso-lechugas.js", "api/recordatorio-wizard.js"];
for (const f of otros) {
  const src = readFileSync(join(RAIZ, f), "utf8");
  total += (src.match(/supabaseInsert\(\s*"acciones"/g) || []).length;
}
ok(total === 2, `en todo api/ hay exactamente 2 escritores de acciones (${total})`);

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
