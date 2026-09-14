// "No sé si llovió" sobrevive de la API cruda hasta la pantalla.
//   node tests/test-lluvia-e2e.mjs
//
// HALLAZGO DE CODEX en la reauditoría de 56fd87b: el parseo ya conservaba el
// null, pero varios consumidores lo volvían a convertir en 0 —las salidas de
// campo.js, el log del Diario B y la previsión de la app— así que el estado se
// perdía justo donde alguien podía leerlo y creérselo.
//
// Este test sigue el dato por toda la cadena: respuesta cruda de Open-Meteo →
// serie → balance → API → log → reveal.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dia = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const PLANT = dia(25);

// ── 1. La API devuelve un día con ET₀ y SIN dato de lluvia ──
const sb = require(join(RAIZ, "api", "_supabase.js"));
sb.isConfigured = () => true;
sb.supabaseUpdate = async () => ({});
sb.supabaseSelect = async (t) => t === "usuarios" ? [{
  id: "11111111-2222-3333-4444-555555555555", ciudad: "Breda", lat: 41.7, lon: 2.5,
  cultivos: ["tomate"], metodo_riego: "goteo", caudal: 10, area_m2: 88, suelo: "franco",
  fecha_plantacion: PLANT, piloto_inicio: PLANT,
}] : [];

const http = require(join(RAIZ, "api", "_http.js"));
const N = 26;
http.fetchConTimeout = async (url) => {
  if (String(url).includes("isric.org")) return { ok: true, json: async () => ({ properties: { layers: [] } }) };
  const t = [], e = [], p = [], tx = [], tn = [];
  for (let i = 0; i < N; i++) {
    t.push(new Date(new Date(`${PLANT}T12:00:00Z`).getTime() + i * 86400000).toISOString().slice(0, 10));
    e.push(5.0);
    p.push(i % 2 === 0 ? null : 0);      // la mitad de los días SIN dato de lluvia
    tx.push(29); tn.push(16);
  }
  return { ok: true, json: async () => ({ daily: {
    time: t, et0_fao_evapotranspiration: e, precipitation_sum: p,
    temperature_2m_max: tx, temperature_2m_min: tn } }) };
};

console.log("── 1. al parsear la respuesta cruda ──");
const C = require(join(RAIZ, "assets", "js", "clima-reglas.js"));
const serie = await require(join(RAIZ, "api", "_clima.js")).climaSerie(41.7, 2.5, PLANT, { futuro: 1 });
const sinDato = serie.filter(d => d.lluvia === null).length;
ok(sinDato > 0, `${sinDato} días de la serie entran con lluvia null`);
ok(!serie.some(d => d.lluvia === 0 && d.lluviaConocida === false), "ningún día sin dato se ha convertido en 0");
const proc = C.procedencia(serie, hoy);
ok(proc.dias_sin_lluvia_conocida === sinDato, `procedencia() los cuenta (${proc.dias_sin_lluvia_conocida})`);

console.log("\n── 2. en el balance: se supone 0, pero queda contado ──");
const M = require(join(RAIZ, "assets", "js", "motor-riego.js"));
const bal = M.balanceHidrico(serie, [], { suelo: "franco", cultivoId: "tomate", metodoRiego: "goteo", fechaPlantacion: PLANT });
ok(bal.diasSinLluviaConocida === sinDato, `el balance declara ${bal.diasSinLluviaConocida} días sin lluvia conocida`);
ok(bal.confianzaBalance !== "conocido", `y baja la confianza a "${bal.confianzaBalance}"`);

console.log("\n── 3. en la API: null, no 0 ──");
const handler = require(join(RAIZ, "api", "campo.js"));
const llamar = (q) => new Promise(r => {
  const res = { _c: 200, status(c) { this._c = c; return this; }, json(b) { r({ code: this._c, body: b }); }, end() { r({ code: this._c }); }, setHeader() {} };
  handler({ method: "GET", query: q, headers: {} }, res).catch(e => r({ code: 500, body: { error: e.message } }));
});
const v = await llamar({ vista: "hoy", usuario_id: "11111111-2222-3333-4444-555555555555" });
const h = v.body?.hoy || {};
ok(v.code === 200, "vista=hoy contesta");
ok("lluvia_conocida" in h, "declara lluvia_conocida");
ok(h.lluvia_conocida === false ? h.lluvia === null : h.lluvia != null,
   `y son coherentes: lluvia=${JSON.stringify(h.lluvia)} con lluvia_conocida=${h.lluvia_conocida}`);
ok(h.dias_sin_lluvia_conocida === sinDato, `y arrastra el recuento del balance (${h.dias_sin_lluvia_conocida})`);

console.log("\n── 4. en el LOG de la decisión ──");
const db = readFileSync(join(RAIZ, "api", "diario-b.js"), "utf8");
const ctx = db.split("contexto: {")[1].split("},")[0];
ok(/lluvia:\s+hoyClima\.lluvia == null \? null/.test(ctx), "el log guarda null, no 0");
ok(/lluvia_conocida:/.test(ctx), "y declara si se sabía");
ok(/dias_sin_lluvia_conocida:/.test(ctx), "y sobre cuántos días del balance se supuso");

console.log("\n── 5. en el reveal: si son demasiados, no hay porcentaje ──");
const rev = await llamar({ vista: "reveal", usuario_id: "11111111-2222-3333-4444-555555555555" });
const agua = rev.body?.informe?.dimensiones?.agua || {};
ok(rev.code === 200, "vista=reveal contesta");
ok(agua.publicable === false, "con la mitad de los días sin lluvia conocida, no es publicable");
ok(/no se sabe si llovió/.test(agua.motivo_no_publicable || ""), `y lo dice: "${agua.motivo_no_publicable}"`);
ok(agua.ahorro_pct == null, "el porcentaje no existe");

console.log("\n── 6. la previsión de la app conserva el estado ──");
const app = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
ok(/lluvia: d\.daily\.precipitation_sum\?\.\[i\] \?\? null/.test(app),
   "la previsión de la app guarda null cuando no hay dato");
ok(/lluvia_3d_dias_sin_dato/.test(app),
   "y cuenta cuántos días de la previsión venían sin dato");
// Tratar la previsión desconocida como 0 al DECIDIR es lo conservador: una
// lluvia que no sabemos si llega no puede cancelar un riego.
const dec = M.decisionRiego({ Dr: 30, raw: 20, taw: 50, efic: 0.9 },
                            { lluviaPrevista: [{ lluvia: null }, { lluvia: null }] });
ok(dec.nivel === "alta", "una previsión sin dato NO cancela el riego (regar de menos cuesta cosecha)");
ok(dec.lluvia_prevista_mm === 0, "y se cuenta como 0 mm de lluvia prevista, no como un dato");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
