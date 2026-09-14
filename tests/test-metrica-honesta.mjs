// Cuatro cosas distintas se llamaban "ahorro". Que no vuelvan a mezclarse.
//   node tests/test-metrica-honesta.mjs
//
// 14-sep-2026. Las clases son: (1) consistencia técnica del modelo, (2)
// comparación contrafactual Kylia vs agricultor, (3) ahorro POTENCIAL y (4)
// ahorro DEMOSTRADO. De la (4) no tenemos nada y no se puede afirmar: en un
// piloto ciego el agricultor riega a su manera, así que no hay nada que
// demostrar, solo que simular. Detalle en docs/tecnico/metricas.md.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const RV = require(join(RAIZ, "api", "_reveal.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

const dia = i => new Date(new Date("2026-06-01T12:00:00Z").getTime() + i * 86400000).toISOString().slice(0, 10);
const riegos = []; for (let i = 0; i < 20; i++) riegos.push({ dia: dia(i), l_m2: 20 });
const cf = { puntos: [{ date: dia(0), acum_l_m2: 0 }, { date: dia(19), acum_l_m2: 300 }],
             total: 300, deficitFinal: 0, coberturaClima: 1, diasSinClima: 0 };

console.log("── el número dice de qué clase es ──");
const a = RV.dimAguaDesdeContrafactual(riegos, cf);
ok(a.clase_metrica === "contrafactual_simulado", `clase_metrica = ${a.clase_metrica}`);
ok(a.ahorro_demostrado === false, "ahorro_demostrado = false, SIEMPRE");
ok(a.ahorro_potencial_pct === a.ahorro_pct,
   `y el ahorro se expone con el nombre que dice lo que es (${a.ahorro_potencial_pct}%)`);

console.log("\n── la rama heredada también ──");
// dimAgua sin contrafactual cae al método de recomendaciones_log. Es otra forma
// de calcularlo, pero sigue siendo una simulación: nadie ha demostrado nada.
const b = RV.dimAgua(riegos, [{ dia: dia(3), l_m2: 18, nivel: "alta" }], null);
ok(b.ahorro_demostrado === false, "la rama heredada tampoco afirma un ahorro demostrado");
ok(b.clase_metrica != null, `y también declara su clase (${b.clase_metrica})`);

console.log("\n── no se publica un ahorro sin poder demostrarlo ──");
// El informe del piloto habla SIEMPRE en condicional: "habrías ahorrado", nunca
// "ahorraste". Es la diferencia entre (3) y (4).
const informe = readFileSync(join(RAIZ, "piloto", "informe", "index.html"), "utf8");
ok(/habrías <b>ahorrado<\/b>|habrías ahorrado/.test(informe),
   "el informe del piloto habla en condicional");
ok(!/\bahorraste\b|\bhas ahorrado\b|\bahorró\b/i.test(informe),
   "y nunca en pasado, que sería afirmar lo que no se ha medido");

console.log("\n── y el 62% no se vende como accuracy ──");
const doc = readFileSync(join(RAIZ, "docs", "tecnico", "metricas.md"), "utf8");
ok(/NO es una métrica de accuracy/.test(doc), "el doc lo dice explícitamente");
ok(/por construcción/.test(doc),
   "y explica por qué subirlo con Kc dual no sería mejorar: sería converger con otro modelo");
ok(/CERO/.test(doc.split("Ahorro DEMOSTRADO")[1] || ""),
   "y que de ahorro demostrado tenemos cero");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
