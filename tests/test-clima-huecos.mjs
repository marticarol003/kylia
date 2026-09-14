// Un archivo que empieza bien pero tiene días ausentes EN MEDIO.
//   node tests/test-clima-huecos.mjs
//
// HALLAZGO DE CODEX sobre 3c8f73d: cargarSerie() detectaba el archivo vacío y el
// archivo que empieza tarde, pero NO uno que empieza donde toca y ha perdido un
// tramo antiguo por el camino. Con esos huecos el balance se calculaba sobre
// menos clima del que había disponible — el pronóstico ampliado podía cubrirlos
// y nadie se lo pedía.
//
// La regla que NO puede cambiar: histórico válido > fallback. El pronóstico solo
// rellena los días que el archivo no trae; nunca sustituye a uno que sí traiga.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const C = require(join(RAIZ, "assets", "js", "clima-reglas.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

const hoy = C.hoyISO();
const dia = n => C.sumarDias(hoy, -n);
const CICLO = 72;
const ET0_ARCH = 4, ET0_PRON = 9;      // distintos a propósito: así se ve quién gana

// Archivo con los huecos que se le pidan; pronóstico con toda su memoria.
function pedirCon(faltan) {
  const ausentes = new Set(faltan.map(dia));
  return async (url, fuente) => {
    if (String(url).includes("archive-api")) {
      const out = [];
      for (let i = CICLO; i >= 1; i--) {
        const d = dia(i);
        if (!ausentes.has(d)) out.push({ date: d, et0: ET0_ARCH, lluvia: 1, fuente: "archivo" });
      }
      return out;
    }
    const past = Number(String(url).match(/past_days=(\d+)/)[1]);
    return Array.from({ length: past + 1 }, (_, i) =>
      ({ date: C.sumarDias(hoy, -past + i), et0: ET0_PRON, lluvia: 0, fuente: "pronostico" }));
  };
}
const cargar = (faltan) => C.cargarSerie({ lat: 41.7, lon: 2.5, desde: dia(CICLO), futuro: 1, pedir: pedirCon(faltan) });

console.log("── los cinco casos ──");
const CASOS = [
  ["archivo completo",            []],
  ["hueco al PRINCIPIO",          [70, 69, 68, 67, 66]],
  ["hueco INTERMEDIO y antiguo",  [55, 54, 53, 52, 51, 50]],   // el caso de Codex
  ["hueco al FINAL",              [5, 4, 3]],
  ["múltiples huecos",            [68, 67, 40, 39, 38, 6, 5]],
];
const resultados = {};
for (const [etiqueta, faltan] of CASOS) {
  const serie = await cargar(faltan);
  const p = C.procedencia(serie, hoy);
  resultados[etiqueta] = { serie, p, faltan };
  const cubiertos = faltan.map(dia).filter(d => serie.some(x => x.date === d));
  ok(cubiertos.length === faltan.length,
     `${etiqueta}: los ${faltan.length} días ausentes del archivo quedan cubiertos (${cubiertos.length})`);
  ok(p.pasado_pronostico === faltan.length,
     `  y exactamente esos ${faltan.length} salen del pronóstico (${p.pasado_pronostico})`);
}

console.log("\n── EL HISTÓRICO VÁLIDO NO SE SUSTITUYE NUNCA ──");
// Es la regla que no se puede romper al rellenar: un día que el archivo trae
// tiene que conservar SU valor, aunque el pronóstico ampliado también lo traiga.
for (const [etiqueta, r] of Object.entries(resultados)) {
  const ausentes = new Set(r.faltan.map(dia));
  const pisados = r.serie.filter(d => d.date < hoy && !ausentes.has(d.date) && d.fuente !== "archivo");
  ok(pisados.length === 0, `${etiqueta}: ningún día del archivo pisado por el fallback`);
  const malValor = r.serie.filter(d => d.fuente === "archivo" && d.et0 !== ET0_ARCH);
  ok(malValor.length === 0, `  y todos conservan su ET₀ de archivo (${ET0_ARCH} mm)`);
}

console.log("\n── la cobertura refleja lo que de verdad faltó ──");
ok(resultados["archivo completo"].p.coherencia === 1, "archivo completo → coherencia 1");
for (const etiqueta of ["hueco al PRINCIPIO", "hueco INTERMEDIO y antiguo", "hueco al FINAL", "múltiples huecos"]) {
  const p = resultados[etiqueta].p;
  ok(p.coherencia < 1, `${etiqueta} → coherencia ${p.coherencia}: la mezcla se declara`);
}

console.log("\n── y si el pronóstico tampoco llega, el día falta y se sabe ──");
// Más allá de la memoria del pronóstico (~92 días de past_days) no hay nada que
// pedir: el día se queda fuera y el motor lo contará como clima ausente.
const largo = await C.cargarSerie({
  lat: 41.7, lon: 2.5, desde: C.sumarDias(hoy, -200), futuro: 1,
  pedir: async (url) => String(url).includes("archive-api") ? [] : [],
});
ok(largo.length === 0, "sin ninguna fuente, serie vacía: no se inventa nada");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
