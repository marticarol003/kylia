// Un dato de clima que falta NO es un cero.
//   node tests/test-clima-sin-ceros.mjs
//
// El 11-sep-2026 se descubrió que los dos informes de piloto publicados estaban
// mal por esto. El endpoint de PRONÓSTICO de open-meteo solo guarda ~64 días de
// pasado real: con past_days=92 devuelve el array entero pero los días viejos
// vienen a `null`. climaSerie hacía `?? 0`, así que esos días entraban al
// balance como "ese día no se evaporó nada".
//
// Efecto medido: el ciclo de Ferran (101 días) entró con 39 días de ET0 en cero
// —el 39% de la campaña— y su reveal decía que Kylia no habría regado hasta el
// 12 de julio. El de Oriol perdió 14 días (29%) y publicaba un ahorro del 34%
// que, con el clima real del archivo, no existe.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const campo = require(join(RAIZ, "api", "campo.js"));
const src = readFileSync(join(RAIZ, "api", "campo.js"), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

console.log("── un día sin ET0 se descarta, no se cuenta como cero ──");
const crudo = {
  time:                        ["2026-06-01", "2026-06-02", "2026-06-03"],
  et0_fao_evapotranspiration:  [null,          5.2,          null],
  precipitation_sum:           [null,          0,            3],
  temperature_2m_max:          [null,          28,           27],
  temperature_2m_min:          [null,          15,           16],
};
const dias = campo.diasConDato(crudo);
ok(dias.length === 1, `de 3 días con 2 sin ET0 queda 1 (${dias.length})`);
ok(dias[0].date === "2026-06-02" && dias[0].et0 === 5.2, "y es el que sí traía dato");
ok(!dias.some(d => d.et0 === 0), "ningún día entra con ET0 = 0");

console.log("\n── la lluvia sí puede ser cero de verdad ──");
// No llover es un dato; no medir no lo es. Por eso la lluvia SÍ cae a 0 y la
// ET0 no: un día sin ET0 no tiene demanda que calcular.
const conLluvia = campo.diasConDato({
  time: ["2026-06-02"], et0_fao_evapotranspiration: [5.2],
  precipitation_sum: [null], temperature_2m_max: [28], temperature_2m_min: [15],
});
ok(conLluvia.length === 1 && conLluvia[0].lluvia === 0,
   "un día con ET0 pero sin lluvia medida entra con lluvia 0");

console.log("\n── y para lo pasado manda el archivo ──");
ok(/archive-api\.open-meteo\.com/.test(src), "climaSerie conoce el archivo");
ok(/if \(ini && past > 60\)/.test(src),
   "y lo pide cuando el ciclo se sale de lo que el pronóstico recuerda");
ok(/for \(const d of partes\[1\] \|\| \[\]\) mapa\.set/.test(src)
   && /for \(const d of partes\[0\] \|\| \[\]\) mapa\.set/.test(src),
   "el pronóstico manda en el solape: es la lectura más fresca del mismo día");
ok(!/et0_fao_evapotranspiration\?\.\[i\] \?\? 0/.test(src),
   "y ya no queda ningún `?? 0` sobre la ET0");
ok(/UN DATO QUE FALTA NO ES UN CERO/.test(src),
   "con el porqué escrito donde se toca, que esto se vuelve a colar solo");

console.log("\n── el balance nota la diferencia: comprobado con el motor ──");
const MOTOR = require(join(RAIZ, "assets", "js", "motor-riego.js"));
const hoy = new Date();
const iso = d => new Date(hoy.getTime() - d * 86400000).toISOString().slice(0, 10);
// 60 días de tomate: los 25 primeros "sin dato" contra los mismos puestos a 0.
const real = [], conCeros = [];
for (let d = 60; d >= 0; d--) {
  const dia = { date: iso(d), et0: 5.4, lluvia: 0, tmax: 30, tmin: 17 };
  if (d > 35) { conCeros.push({ ...dia, et0: 0 }); } else { conCeros.push(dia); }
  real.push(dia);
}
const opt = { suelo: "franco", cultivoId: "tomate", metodoRiego: "goteo", fechaPlantacion: iso(60) };
const bien = MOTOR.simularKylia(real, opt).total;
const mal  = MOTOR.simularKylia(conCeros, opt).total;
ok(mal < bien * 0.75,
   `con 25 días a cero Kylia pide ${mal.toFixed(0)} L/m² en vez de ${bien.toFixed(0)}: un ${Math.round(100 - 100 * mal / bien)}% menos`);
ok(bien - mal > 50,
   `y la diferencia (${(bien - mal).toFixed(0)} L/m²) es mayor que cualquier ahorro que se pueda publicar`);

console.log("\n── y el MISMO defecto vivía en una segunda copia ──");
// diario-b.js tiene su propia climaSerie, y tenía el mismo `?? 0`. Arreglar
// campo.js no bastaba: el Diario B congela la decisión del piloto con ella, y de
// ahí sale el reveal por la vía heredada.
const db = readFileSync(join(RAIZ, "api", "diario-b.js"), "utf8");
ok(!/et0_fao_evapotranspiration\?\.\[i\] \?\? 0/.test(db),
   "diario-b tampoco convierte una ET₀ ausente en cero");
ok(/filter\(x => x\.et0 != null\)/.test(db), "los días sin ET₀ se descartan");
ok(/archive-api\.open-meteo\.com/.test(db), "y para lo pasado también manda el archivo");
ok(/UN DATO QUE FALTA NO ES UN CERO/.test(db), "con el porqué escrito también aquí");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
