// Cómo entra un riego al balance, de punta a punta.
//   node tests/test-riego-al-balance.mjs
//
// Auditoría del 14-sep-2026. El caudal está en mm/h, así que caudal×min/60 YA
// son mm = L/m²: el área no entra en el balance en ningún momento (solo al
// enseñar litros). Eso es correcto y hay que dejarlo fijado, porque el área es
// justo el dato que estaba mal en el piloto de Ferran (30 m² para 88).
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const M = require(join(RAIZ, "assets", "js", "motor-riego.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

const dia = i => new Date(new Date("2026-07-01T12:00:00Z").getTime() + i * 86400000).toISOString().slice(0, 10);
const serie = []; for (let i = 0; i < 30; i++) serie.push({ date: dia(i), et0: 5.5, lluvia: 0, tmax: 30, tmin: 18 });
const OPT = { suelo: "franco", cultivoId: "tomate", metodoRiego: "goteo", fechaPlantacion: dia(0) };

console.log("── caudal × duración, sin pasar por litros ni superficie ──");
ok(M.laminaRiego(null, 120, 15) === 30, "15 mm/h × 120 min = 30 mm");
ok(M.laminaRiego(null, 60, 10.9) === 10.9, "10,9 mm/h × 60 min = 10,9 mm");
ok(M.laminaRiego(null, 0, 15) === null, "duración 0 no es un riego de 0 mm: es no saber");
ok(M.laminaRiego(null, -30, 15) === null, "y una duración negativa tampoco (secaba el suelo)");
ok(M.laminaRiego(null, 60, null) === null, "SIN CAUDAL NO SE INVENTA UNA LÁMINA");
ok(M.laminaRiego(22, null, 15) === 22, "sin duración manda la cantidad apuntada");
ok(M.laminaRiego(null, null, 15) === null, "y sin ninguna de las dos, null — nunca 0");

console.log("\n── un riego sin cantidad es una HIPÓTESIS, y se declara ──");
// Entra como recarga completa (suelo a capacidad de campo). Es la suposición más
// optimista que existe y falla hacia el lado que no se nota: el motor cree el
// suelo lleno y no manda regar. Cuanto más seco esté, más agua regala.
const bNull = M.balanceHidrico(serie, [{ date: dia(10), litros: null }], OPT);
const bPoco = M.balanceHidrico(serie, [{ date: dia(10), litros: 5 }], OPT);
ok(bNull.Dr < bPoco.Dr,
   `un riego sin cifra deja el suelo MÁS lleno que uno de 5 mm (${bNull.Dr.toFixed(1)} vs ${bPoco.Dr.toFixed(1)} mm de déficit)`);
ok(bNull.riegosSinCantidad === 1, "el balance cuenta cuántos riegos entraron así");
ok(bNull.ultimoRiegoSinCantidad === dia(10), "y cuándo fue el último");
ok(bPoco.riegosSinCantidad === 0, "un riego cuantificado no cuenta como supuesto");

console.log("\n── un null NO puede borrar los mm que sí se saben ──");
// HALLAZGO DE CODEX. Si el mismo día había un riego cuantificado y otro sin
// cifra, el `null` dominaba: se tiraban los mm medidos y el día pasaba a recarga
// completa. Se perdía información real para poner una suposición en su sitio.
const soloDato = M.balanceHidrico(serie, [{ date: dia(10), litros: 20 }], OPT);
const mixto = M.balanceHidrico(serie, [{ date: dia(10), litros: 20 }, { date: dia(10), litros: null }], OPT);
ok(mixto.riegoNetoAcum === soloDato.riegoNetoAcum,
   `los ${mixto.riegoNetoAcum} mm medidos siguen contando aunque ese día haya además un riego sin cifra`);
ok(mixto.riegosSinCantidad === 1, "y el riego sin cifra se anota aparte, no borra al otro");
ok(mixto.riegoNetoAcum > 0, "antes este total era 0: el dato real desaparecía");

console.log("\n── tres estados de confianza, no dos ──");
const mk = (riegos, lluvia) => M.balanceHidrico(
  serie.map(d => ({ ...d, lluvia })), riegos, OPT);
ok(mk([{ date: dia(10), litros: 20 }], 0).confianzaBalance === "conocido",
   "todo cuantificado y con lluvia medida → conocido");
ok(mk([{ date: dia(10), litros: null }], 0).confianzaBalance === "parcial",
   "un riego sin cifra de veinte días → parcial");
ok(mk([], null).confianzaBalance === "incierto",
   "veinte días sin saber si llovió → incierto");
// El umbral es "más de una quinta parte de los días". La serie de este test son
// 30 días, así que 6 caen JUSTO en el 20% y no lo pasan: hace falta el séptimo.
ok(mk(Array.from({ length: 6 }, (_, i) => ({ date: dia(i * 4), litros: null })), 0).confianzaBalance === "parcial",
   "seis riegos sin cifra de treinta días (20% exacto) → todavía parcial");
ok(mk(Array.from({ length: 8 }, (_, i) => ({ date: dia(i * 3), litros: null })), 0).confianzaBalance === "incierto",
   "ocho de treinta (27%) → incierto");

console.log("\n── el agua de riego que percola deja de ser invisible ──");
// 100 mm de golpe sobre un suelo que aguanta 51 dejaban el MISMO balance que 20
// mm bien dados, y los 80 restantes desaparecían sin rastro. La lluvia ya se
// medía así (lluviaUtilAcum); el riego no.
const much = M.balanceHidrico(serie, [{ date: dia(10), litros: 100 }], OPT);
const just = M.balanceHidrico(serie, [{ date: dia(10), litros: 20 }], OPT);
ok(much.riegoNetoAcum > much.riegoUtilAcum,
   `de ${much.riegoNetoAcum} mm netos solo cupieron ${much.riegoUtilAcum}`);
ok(Math.abs(much.riegoNetoAcum - much.riegoUtilAcum) > 50,
   `se declara la percolación: ${(much.riegoNetoAcum - much.riegoUtilAcum).toFixed(1)} mm por debajo de la raíz`);
ok(just.riegoNetoAcum === just.riegoUtilAcum, "y un riego a dosis no percola nada");
ok(Math.abs(much.Dr - just.Dr) < 5,
   "el déficit final apenas se distingue: por eso hacía falta declararlo aparte");

console.log("\n── la eficiencia se aplica al agua aplicada, no a la recomendada ──");
const goteo = M.balanceHidrico(serie, [{ date: dia(10), litros: 20 }], OPT);
const asper = M.balanceHidrico(serie, [{ date: dia(10), litros: 20 }], { ...OPT, metodoRiego: "aspersion" });
ok(goteo.riegoNetoAcum > asper.riegoNetoAcum,
   `20 mm por goteo valen más que por aspersión (${goteo.riegoNetoAcum} vs ${asper.riegoNetoAcum} mm netos)`);
ok(Math.abs(goteo.riegoNetoAcum - 20 * 0.90) < 0.2, "goteo: 90% de eficiencia");
ok(Math.abs(asper.riegoNetoAcum - 20 * 0.75) < 0.2, "aspersión: 75%");

console.log("\n── el área NO entra en el balance ──");
// Es lo que protege del defecto de Ferran: su area_m2 estaba mal (30 para 88) y
// eso rompió los litros del informe, pero no podía romper la decisión de riego.
const fuente = require("fs").readFileSync(join(RAIZ, "assets", "js", "motor-riego.js"), "utf8");
ok(!/area_m2/.test(fuente), "el motor no conoce area_m2");
ok(!/\barea\b/.test(fuente.split("function balanceHidrico")[1].split("return {")[0]),
   "ni aparece dentro del bucle del balance");

console.log("\n── invariantes que no se pueden romper ──");
for (const litros of [0, 1, 5, 20, 100, 1000]) {
  const b = M.balanceHidrico(serie, [{ date: dia(10), litros }], OPT);
  ok(b.Dr >= 0, `regando ${litros} mm el déficit nunca es negativo (${b.Dr.toFixed(1)})`);
  ok(b.riegoUtilAcum <= b.riegoNetoAcum + 0.01, `y el agua útil nunca supera la aplicada (${litros} mm)`);
}

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
