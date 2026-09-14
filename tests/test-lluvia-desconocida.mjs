// "No llovió" y "no sé si llovió" no son el mismo estado.
//   node tests/test-lluvia-desconocida.mjs
//
// HALLAZGO DE CODEX (14-sep-2026), confirmado. `diasConDato` hacía
// `precipitation_sum?.[i] ?? 0`: un día con ET₀ pero sin dato de lluvia entraba
// al balance como "ese día no llovió". Es el mismo error que costó dos informes
// con la ET₀ —un dato que falta no es un cero— en la otra variable de la serie.
//
// Para el BALANCE el 0 sigue siendo la hipótesis correcta: si no sabes si
// llovió, no descuentes agua que a lo mejor no cayó. Descontar lluvia inventada
// haría regar de MENOS, que es el error que cuesta cosecha. Pero hay que poder
// CONTAR sobre cuántos días se está suponiendo eso, y negarse a publicar un
// porcentaje si son demasiados.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const C = require(join(RAIZ, "assets", "js", "clima-reglas.js"));
const M = require(join(RAIZ, "assets", "js", "motor-riego.js"));
const RV = require(join(RAIZ, "api", "_reveal.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

console.log("── al parsear: el hueco se conserva, no se rellena ──");
const crudo = {
  time: ["2026-06-01", "2026-06-02", "2026-06-03"],
  et0_fao_evapotranspiration: [5.0, 5.0, 5.0],
  precipitation_sum: [0, null, 4.2],
};
const dias = C.diasConDato(crudo, "archivo");
ok(dias.length === 3, "los tres días entran: todos traen ET₀");
ok(dias[0].lluvia === 0, "el día que midió 0 mm entra como 0");
ok(dias[1].lluvia === null, "el día SIN dato entra como null, no como 0");
ok(dias[2].lluvia === 4.2, "y el que llovió, con su valor");
// Y si la API ni siquiera manda el array:
const sinArray = C.diasConDato({ time: ["2026-06-01"], et0_fao_evapotranspiration: [5] }, "archivo");
ok(sinArray[0].lluvia === null, "sin array de precipitación, todos los días son null");

console.log("\n── en el balance: se supone 0, pero se CUENTA ──");
const dia = i => new Date(new Date("2026-07-01T12:00:00Z").getTime() + i * 86400000).toISOString().slice(0, 10);
const mk = ll => Array.from({ length: 20 }, (_, i) => ({ date: dia(i), et0: 5, lluvia: ll, tmax: 30, tmin: 18 }));
const OPT = { suelo: "franco", cultivoId: "tomate", metodoRiego: "goteo", fechaPlantacion: dia(0) };
const cero = M.balanceHidrico(mk(0), [], OPT);
const nulo = M.balanceHidrico(mk(null), [], OPT);
ok(cero.Dr === nulo.Dr, `el déficit sale igual (${cero.Dr.toFixed(1)} mm): la hipótesis conservadora es no descontar`);
ok(cero.diasSinLluviaConocida === 0, "pero con lluvia medida a 0, cero días dudosos");
ok(nulo.diasSinLluviaConocida === 20, "y con lluvia desconocida, los 20 declarados");
// Mezcla realista: la mayoría conocidos, unos pocos no.
const mezcla = mk(0).map((d, i) => (i % 10 === 0 ? { ...d, lluvia: null } : d));
ok(M.balanceHidrico(mezcla, [], OPT).diasSinLluviaConocida === 2, "en una mezcla, cuenta solo los dudosos");

console.log("\n── y el contrafactual también los cuenta ──");
const sim = M.simularKylia(mk(null), { ...OPT, ventana: { desde: dia(0), hasta: dia(19) } });
ok(sim.diasSinLluviaConocida === 20, `simularKylia declara ${sim.diasSinLluviaConocida} días sin lluvia conocida`);
ok(M.simularKylia(mk(0), { ...OPT, ventana: { desde: dia(0), hasta: dia(19) } }).diasSinLluviaConocida === 0,
   "y cero cuando la lluvia está medida");

console.log("\n── si son demasiados, el informe NO publica porcentaje ──");
const base = { puntos: [{ date: dia(0), acum_l_m2: 0 }, { date: dia(19), acum_l_m2: 300 }],
               total: 300, deficitFinal: 0, coberturaClima: 1, diasSinClima: 0 };
ok(RV.motivoClimaNoPublicable({ ...base, diasSinLluviaConocida: 0 }, 20) === null,
   "sin días dudosos, se publica");
ok(RV.motivoClimaNoPublicable({ ...base, diasSinLluviaConocida: 4 }, 20) === null,
   "con 4 de 20 (20%), todavía se publica");
const motivo = RV.motivoClimaNoPublicable({ ...base, diasSinLluviaConocida: 9 }, 20);
ok(motivo !== null, "con 9 de 20 ya no");
ok(/no se sabe si llovió/.test(motivo || ""), `y lo dice: "${motivo}"`);

console.log("\n── el informe completo se niega a dar la cifra ──");
const riegos = Array.from({ length: 20 }, (_, i) => ({ dia: dia(i), l_m2: 20 }));
const d = RV.dimAguaDesdeContrafactual(riegos, { ...base, diasSinLluviaConocida: 15 });
ok(d.publicable === false, "publicable = false");
ok(d.ahorro_pct === null && d.recomendada_l_m2 === null, "y las cifras no salen, para que nadie las copie");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
