// Cambiar el caudal no puede mover el histórico QUE VE EL AGRICULTOR.
//   node tests/test-consumidores-congelado.mjs
//
// HALLAZGO DE CODEX en la reauditoría de 56fd87b: laminaDeAccion() estaba bien,
// pero varios consumidores no SELECCIONABAN las columnas congeladas
// (lamina_mm, lamina_origen, caudal_mmh). Sin ellas en la fila, el helper cae a
// su fallback y recalcula con `u.caudal` — o sea, el bug seguía vivo aguas
// abajo aunque el helper fuera correcto.
//
// El test anterior probaba el helper. Este ejecuta los CONSUMIDORES: vistaHoy,
// vistaPerfil, el reveal y el aviso, con Supabase y la red en falso, cambiando
// el caudal del usuario entre las dos ejecuciones.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

const CAUDAL_A = 15, CAUDAL_B = 5.4;      // el cambio real del bancal, 28-jul-2026
const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dia = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const PLANT = dia(40);

// Riegos YA CONGELADOS con el caudal A (lo que hace api/log.js al registrar).
const RIEGOS = [30, 24, 18, 12, 6, 2].map(n => ({
  id: n, fecha_local: dia(n), tipo: "riego", duracion_min: 60,
  cantidad_l_m2: null, caudal_mmh: CAUDAL_A, lamina_mm: CAUDAL_A, lamina_origen: "duracion_x_caudal",
  franja_horaria: "manana",
}));

let CAUDAL_ACTUAL = CAUDAL_A;
const USUARIO = () => ({
  id: "11111111-2222-3333-4444-555555555555",
  ciudad: "Breda", lat: 41.749, lon: 2.556, cultivos: ["tomate"], metodo_riego: "goteo",
  caudal: CAUDAL_ACTUAL, area_m2: 88, suelo: "franco",
  fecha_plantacion: PLANT, piloto_inicio: PLANT, tarifa_agua: 0.3,
});

// ── Supabase y red en falso ──
const sb = require(join(RAIZ, "api", "_supabase.js"));
sb.isConfigured = () => true;
sb.supabaseUpdate = async () => ({});
sb.supabaseSelect = async (tabla, query) => {
  if (tabla === "usuarios") return [USUARIO()];
  if (tabla === "acciones") {
    // Simula PostgREST: devuelve SOLO las columnas pedidas en el select. Es lo
    // que destapó el fallo — con un mock que devolviera la fila entera, un
    // consumidor al que le falta `lamina_mm` en el select pasaría el test.
    const m = /select=([^&]+)/.exec(query || "");
    const cols = m ? m[1].split(",") : null;
    return RIEGOS.map(r => {
      if (!cols) return { ...r };
      const o = {};
      for (const c of cols) if (c in r) o[c] = r[c];
      return o;
    });
  }
  if (tabla === "recomendaciones_log") return [];
  return [];
};
const http = require(join(RAIZ, "api", "_http.js"));
const daily = (desde, n) => {
  const t = [], e = [], p = [], tx = [], tn = [];
  for (let i = 0; i < n; i++) {
    t.push(new Date(new Date(`${desde}T12:00:00Z`).getTime() + i * 86400000).toISOString().slice(0, 10));
    e.push(5.2); p.push(0); tx.push(29); tn.push(16);
  }
  return { time: t, et0_fao_evapotranspiration: e, precipitation_sum: p,
           temperature_2m_max: tx, temperature_2m_min: tn };
};
http.fetchConTimeout = async (url) => String(url).includes("isric.org")
  ? { ok: true, json: async () => ({ properties: { layers: [] } }) }
  : { ok: true, json: async () => ({ daily: daily(PLANT, 50) }) };

const handler = require(join(RAIZ, "api", "campo.js"));
const llamar = (query) => new Promise((resolve) => {
  const res = { _c: 200, status(c) { this._c = c; return this; },
                json(b) { resolve({ code: this._c, body: b }); }, end() { resolve({ code: this._c }); }, setHeader() {} };
  handler({ method: "GET", query, headers: {} }, res).catch(e => resolve({ code: 500, body: { ok: false, error: e.message } }));
});

async function fotografia() {
  const [hoyV, perfil, reveal] = await Promise.all([
    llamar({ vista: "hoy", usuario_id: USUARIO().id }),
    llamar({ vista: "perfil", usuario_id: USUARIO().id }),
    llamar({ vista: "reveal", usuario_id: USUARIO().id }),
  ]);
  return {
    hoy_deficit: hoyV.body?.hoy?.deficit_mm,
    hoy_recientes: JSON.stringify(hoyV.body?.riegos_recientes || []),
    perfil_riegos: JSON.stringify(perfil.body?.riegos_recientes || []),
    reveal_aplicada: reveal.body?.informe?.dimensiones?.agua?.aplicada_l_m2,
    codigos: [hoyV.code, perfil.code, reveal.code].join("/"),
  };
}

console.log("── con el caudal de entonces ──");
CAUDAL_ACTUAL = CAUDAL_A;
const antes = await fotografia();
ok(antes.codigos === "200/200/200", `las tres vistas contestan (${antes.codigos})`);
ok(antes.hoy_recientes.length > 10, "vistaHoy devuelve riegos recientes");
ok(antes.perfil_riegos.length > 10, "y vistaPerfil también (si sale [], el test no está mirando nada)");
ok(/"l_m2":15/.test(antes.perfil_riegos), "con la lámina congelada de 15 mm");

console.log("\n── se remide el caudal: 15 → 5,4 mm/h ──");
CAUDAL_ACTUAL = CAUDAL_B;
const despues = await fotografia();
ok(despues.codigos === "200/200/200", "las tres siguen contestando");

for (const [campo, etiqueta] of [
  ["hoy_deficit",    "el déficit de hoy (vistaHoy)"],
  ["hoy_recientes",  "los riegos recientes (vistaHoy)"],
  ["perfil_riegos",  "el historial de riegos (vistaPerfil)"],
  ["reveal_aplicada","el agua aplicada del reveal"],
]) {
  ok(JSON.stringify(antes[campo]) === JSON.stringify(despues[campo]),
     `${etiqueta} NO cambia al remedir el caudal` +
     (JSON.stringify(antes[campo]) !== JSON.stringify(despues[campo])
       ? `  (${JSON.stringify(antes[campo])} → ${JSON.stringify(despues[campo])})` : ` (${String(antes[campo]).slice(0, 40)})`));
}

console.log("\n── y sin congelar SÍ se movería: el test detecta el fallo ──");
// Se le quitan las columnas congeladas a los eventos, como si fueran anteriores
// a la migración. Entonces el caudal actual manda y el histórico se mueve.
for (const r of RIEGOS) { delete r.lamina_mm; delete r.lamina_origen; delete r.caudal_mmh; }
CAUDAL_ACTUAL = CAUDAL_A;
const viejoA = await fotografia();
CAUDAL_ACTUAL = CAUDAL_B;
const viejoB = await fotografia();
ok(viejoA.reveal_aplicada !== viejoB.reveal_aplicada,
   `sin congelar, el agua aplicada del reveal pasa de ${viejoA.reveal_aplicada} a ${viejoB.reveal_aplicada}`);
ok(viejoA.hoy_deficit !== viejoB.hoy_deficit,
   `y el déficit de hoy, de ${viejoA.hoy_deficit} a ${viejoB.hoy_deficit} mm`);

console.log("\n── el aviso de riego usa la misma puerta ──");
const aviso = require("fs").readFileSync(join(RAIZ, "api", "aviso-lechugas.js"), "utf8");
ok(/laminaDeAccion\(riego, data\.usuario\?\.caudal\)/.test(aviso), "aviso-lechugas pasa por laminaDeAccion");
ok(/lamina_mm,lamina_origen,caudal_mmh/.test(aviso), "y se trae las columnas congeladas en su select");
const M = require(join(RAIZ, "assets", "js", "motor-riego.js"));
const congelado = { cantidad_l_m2: null, duracion_min: 60, lamina_mm: 15, lamina_origen: "duracion_x_caudal", caudal_mmh: 15 };
ok(M.laminaDeAccion(congelado, CAUDAL_B).mm === 15,
   "y con esa fila el aviso diría 15 mm aunque el caudal actual sea 5,4");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
