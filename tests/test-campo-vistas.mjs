// Las vistas de /api/campo, EJECUTADAS.
//   node tests/test-campo-vistas.mjs
//
// 13-sep-2026. `vista=comparativa` —la pantalla "Kylia vs tu padre", la del
// campo de 440 m²— llevaba desde el 1 de agosto respondiendo
//
//     {"ok":false,"error":"hoy is not defined"}
//
// Seis semanas. `264539e` quitó `const hoy = hoyISO()` al meter ultimoDiaDe() y
// dejó la referencia en el objeto de respuesta. No lo cazó nadie porque los
// tests de esta zona LEEN EL FUENTE con expresiones regulares —comprueban que la
// vista está escrita, no que conteste— y porque el reveal, que sí funcionaba,
// se parece lo bastante como para dar sensación de cobertura.
//
// Este test monta Supabase y la red en falso y llama al handler de verdad. No
// comprueba agronomía (para eso están los tests del motor): comprueba que cada
// vista CONTESTA, que no se cuela un `undefined` en el JSON y que las dos que
// publican un porcentaje declaran con cuánto clima lo calcularon.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

// ── El campo de pruebas: una parcela cosechada, como los tres pilotos ──
const HOY = new Date().toISOString().slice(0, 10);
const dia = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const PLANT = dia(80), COSECHA = dia(10);
const USUARIO = {
  id: "11111111-2222-3333-4444-555555555555",
  ciudad: "Sant Boi de Llobregat", lat: 41.343, lon: 2.037,
  cultivos: ["lechuga"], metodo_riego: "aspersion", caudal: 15, area_m2: 440,
  suelo: "franco", fecha_plantacion: PLANT, fecha_cosecha: COSECHA,
  piloto_inicio: PLANT, tarifa_agua: 0.3,
};
const ACCIONES = [];
for (let i = 75; i > 10; i -= 4) ACCIONES.push({ fecha_local: dia(i), tipo: "riego", cantidad_l_m2: null, duracion_min: 90 });
const RECS = ACCIONES.map(a => ({ fecha: `${a.fecha_local}T06:00:00Z`, tipo: "riego", cantidad_l_m2: 20, nivel: "alta" }));

// ── Supabase en falso, instalado en el require cache antes de cargar campo.js ──
const sb = require(join(RAIZ, "api", "_supabase.js"));
sb.isConfigured = () => true;
sb.supabaseSelect = async (tabla) => {
  if (tabla === "usuarios") return [USUARIO];
  if (tabla === "acciones") return ACCIONES;
  if (tabla === "recomendaciones_log") return RECS;
  return [];
};
sb.supabaseUpdate = async () => ({});

// ── Y la red: Open-Meteo (clima y archivo) + SoilGrids ──
const http = require(join(RAIZ, "api", "_http.js"));
const serie = (desde, n) => {
  const t = [], et0 = [], pp = [], tx = [], tn = [];
  for (let i = 0; i < n; i++) {
    t.push(new Date(new Date(`${desde}T12:00:00Z`).getTime() + i * 86400000).toISOString().slice(0, 10));
    et0.push(4.8); pp.push(i % 9 === 0 ? 6 : 0); tx.push(28); tn.push(16);
  }
  return { time: t, et0_fao_evapotranspiration: et0, precipitation_sum: pp,
           temperature_2m_max: tx, temperature_2m_min: tn };
};
http.fetchConTimeout = async (url) => {
  const u = String(url);
  if (u.includes("isric.org")) {
    return { ok: true, json: async () => ({ properties: { layers: [] } }) };
  }
  // Tanto el pronóstico como el archivo devuelven la serie entera desde la
  // plantación: aquí no se está probando la cobertura, se está probando que las
  // vistas contestan.
  return { ok: true, json: async () => ({ daily: serie(PLANT, 95) }) };
};

const handler = require(join(RAIZ, "api", "campo.js"));

function llamar(query) {
  return new Promise((resolve) => {
    const res = {
      _code: 200,
      status(c) { this._code = c; return this; },
      json(body) { resolve({ code: this._code, body }); },
      end() { resolve({ code: this._code, body: null }); },
      setHeader() {},
    };
    handler({ method: "GET", query, headers: {} }, res).catch(e => resolve({ code: 500, body: { ok: false, error: e.message } }));
  });
}

const VISTAS = ["hoy", "config", "reveal", "comparativa", "perfil", "cuaderno", "madurez"];

console.log("── todas las vistas contestan ──");
const salidas = {};
for (const vista of VISTAS) {
  const r = await llamar({ vista, usuario_id: USUARIO.id });
  salidas[vista] = r;
  const err = r.body && r.body.ok === false ? (r.body.error || r.body.reason || "sin motivo") : null;
  ok(r.code === 200 && !err, `vista=${vista} → 200 ok${err ? ` · devolvió "${err}"` : ""}`);
  // Un `undefined` serializado es la firma de una variable que ya no existe.
  const txt = JSON.stringify(r.body || {});
  ok(!/:\s*undefined/.test(txt), `vista=${vista} → sin undefined en el JSON`);
}

console.log("\n── y las dos que publican un porcentaje dicen con cuánto clima ──");
// Es la comprobación que faltaba el 10-sep y que costó los dos informes de
// piloto. Que exista el campo no basta: tiene que venir con número.
const agua = salidas.reveal.body?.informe?.dimensiones?.agua || {};
ok(agua.cobertura_clima != null, `el reveal declara cobertura_clima (${agua.cobertura_clima})`);
ok(typeof agua.publicable === "boolean", "y si es publicable o no");
const tot = salidas.comparativa.body?.totales || {};
ok(tot.cobertura_clima != null, `la comparativa declara cobertura_clima (${tot.cobertura_clima})`);
ok(typeof tot.publicable === "boolean", "y si es publicable o no");

console.log("\n── el día de hoy sale en la respuesta de la comparativa ──");
ok(salidas.comparativa.body?.hoy === HOY,
   `hoy = ${salidas.comparativa.body?.hoy} (era la variable que no existía)`);

console.log("\n── vistas sin usuario ──");
const sinUsuario = await llamar({ vista: "textura", lat: 41.343, lon: 2.037 });
ok(sinUsuario.code === 200, "vista=textura contesta sin usuario_id");
const malUuid = await llamar({ vista: "hoy", usuario_id: "no-soy-un-uuid" });
ok(malUuid.code === 400, "y un usuario_id que no es UUID se rechaza con 400");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
