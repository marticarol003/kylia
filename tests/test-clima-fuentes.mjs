// El pasado se mira en el ARCHIVO y el futuro en el PRONÓSTICO.
//   node tests/test-clima-fuentes.mjs
//
// 14-sep-2026. Había cuatro implementaciones del flujo de clima (campo.js,
// diario-b.js, _clima-termico.js y app/index.html), cada una con su umbral para
// bajar al archivo —60 días, 92 días, o nunca— y las cuatro dejaban que el
// PRONÓSTICO mandara en el solape. Una serie larga venía medio de cada fuente,
// con un escalón en medio.
//
// Lo que costaba, medido con el motor real sobre los tres pilotos:
//   Ferran   mezcla 463,9 L/m² · archivo entero 393,6  → +17,9% y 17 puntos de ahorro
//   Oriol    mezcla 343,2      · archivo entero 348,2  →  −1,4%
//   Padre    mezcla 310,8      · archivo entero 323,0  →  −3,8%
// El mecanismo, sobre los 62 días que las dos fuentes cubren en Breda: el
// pronóstico da +8,7% de ET₀ y 28,2 mm MENOS de lluvia efectiva. La mezcla se
// queda con la ET₀ alta de una y sin la lluvia de la otra.
//
// Este test NO lee el fuente: inyecta las dos respuestas y mira la serie.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

const hoy = new Date().toISOString().slice(0, 10);
const dia = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// Las dos fuentes dan valores DISTINTOS a propósito, para poder ver cuál manda.
const ET0_ARCHIVO = 4.0, ET0_PRONOSTICO = 9.0;
const LL_ARCHIVO  = 6.0, LL_PRONOSTICO  = 0.0;

function daily(desde, n, et0, lluvia) {
  const t = [], e = [], p = [], tx = [], tn = [];
  for (let i = 0; i < n; i++) { t.push(dia(desde + i)); e.push(et0); p.push(lluvia); tx.push(28); tn.push(15); }
  return { time: t, et0_fao_evapotranspiration: e, precipitation_sum: p,
           temperature_2m_max: tx, temperature_2m_min: tn };
}

const http = require(join(RAIZ, "api", "_http.js"));
let pedidas = [];
let fallaArchivo = false;
http.fetchConTimeout = async (url) => {
  pedidas.push(String(url));
  if (String(url).includes("archive-api")) {
    if (fallaArchivo) return { ok: false, status: 500 };
    return { ok: true, json: async () => ({ daily: daily(-30, 31, ET0_ARCHIVO, LL_ARCHIVO) }) };  // −30 … hoy
  }
  return { ok: true, json: async () => ({ daily: daily(-10, 18, ET0_PRONOSTICO, LL_PRONOSTICO) }) }; // −10 … +7
};
const C = require(join(RAIZ, "api", "_clima.js"));

console.log("── el archivo manda en el pasado, el pronóstico en el futuro ──");
const serie = await C.climaSerie(41.7, 2.5, dia(-30), { futuro: 7 });
const pasados = serie.filter(d => d.date < hoy);
const futuros = serie.filter(d => d.date > hoy);
ok(pasados.length > 0 && pasados.every(d => d.fuente === "archivo"),
   `los ${pasados.length} días pasados vienen del archivo`);
ok(futuros.length > 0 && futuros.every(d => d.fuente === "pronostico"),
   `los ${futuros.length} días futuros vienen del pronóstico`);
ok(pasados.every(d => d.et0 === ET0_ARCHIVO),
   "y traen la ET₀ del archivo, no la del pronóstico (que aquí es más del doble)");
ok(pasados.every(d => d.lluvia === LL_ARCHIVO),
   "y su lluvia también: es la que el pronóstico no ve");

console.log("\n── el solape: los 10 días que cubren AMBAS ──");
// Es donde estaba el defecto. El pronóstico también los trae, y antes ganaba.
const solape = serie.filter(d => d.date >= dia(-10) && d.date < hoy);
ok(solape.length >= 9 && solape.every(d => d.fuente === "archivo"),
   `los ${solape.length} días de solape se resuelven con el archivo`);

console.log("\n── hoy es del pronóstico: es el único que lo tiene cerrado al día ──");
const deHoy = serie.find(d => d.date === hoy);
ok(!!deHoy, "hoy está en la serie");
ok(deHoy?.fuente === "pronostico", "y viene del pronóstico");

console.log("\n── no hay saltos de fuente dentro del pasado ──");
const cambios = pasados.filter((d, i) => i > 0 && d.fuente !== pasados[i - 1].fuente).length;
ok(cambios === 0, `cero cambios de fuente entre días pasados consecutivos (${cambios})`);

console.log("\n── y la serie DECLARA de dónde viene ──");
const pr = C.procedencia(serie, hoy);
ok(pr.coherencia === 1, `coherencia 1: todo el pasado es histórico (${pr.coherencia})`);
ok(pr.pasado_pronostico === 0, "ningún día pasado calculado con pronóstico");
ok(pr.futuro === futuros.length, `y ${pr.futuro} días de futuro declarados`);

console.log("\n── si el archivo falla, se degrada pero SE DICE ──");
// Degradar en silencio es lo que no se hace: el balance tiene que poder contar
// que ese día no se calculó con histórico.
fallaArchivo = true;
const serie2 = await C.climaSerie(41.9, 2.9, dia(-30), { futuro: 7 });   // otra clave: sin caché
const pr2 = C.procedencia(serie2, hoy);
ok(serie2.length > 0, "sigue habiendo serie: el pronóstico cubre lo que puede");
ok(pr2.coherencia < 1, `y la coherencia lo declara (${pr2.coherencia})`);
ok(pr2.pasado_pronostico > 0, `${pr2.pasado_pronostico} días pasados salieron del pronóstico`);
fallaArchivo = false;

console.log("\n── un día sin ET₀ se descarta, no se cuenta como cero ──");
// El defecto que costó dos informes de piloto (11-sep). Aquí, en el módulo único.
const conNulos = C.diasConDato({
  time: ["2026-06-01", "2026-06-02", "2026-06-03"],
  et0_fao_evapotranspiration: [null, 5.2, null],
  precipitation_sum: [null, 0, 3],
}, "archivo");
ok(conNulos.length === 1 && conNulos[0].date === "2026-06-02", "de 3 días con 2 sin ET₀ queda 1");
ok(!conNulos.some(d => d.et0 === 0), "ninguno entra con ET₀ = 0");
ok(conNulos[0].lluvia === 0, "pero la lluvia sí puede ser cero de verdad");

console.log("\n── el archivo se pide hasta HOY, no seis días atrás ──");
// RETRASO_ARCHIVO valía 6 en campo.js y 10 en _clima-termico.js: una suposición
// vieja que le regalaba una semana de pasado al pronóstico. Verificado contra la
// API el 14-sep-2026: el archivo tiene dato de hoy.
const urlArchivo = pedidas.find(u => u.includes("archive-api"));
ok(!!urlArchivo && urlArchivo.includes(`end_date=${hoy}`),
   "la petición al archivo termina hoy");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
