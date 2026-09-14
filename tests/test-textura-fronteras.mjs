// La distancia a la frontera se mide contra la REGIÓN, no contra un umbral suelto.
//   node tests/test-textura-fronteras.mjs
//
// HALLAZGO DE CODEX (14-sep-2026), confirmado. La clasificación real es:
//
//     arcilla ≥ 35                 → arcilloso
//     arena ≥ 65 Y arcilla < 20    → arenoso
//     resto                        → franco
//
// La del arenoso es una CONJUNCIÓN. La versión anterior medía |35−arcilla| y
// |65−arena| por separado, como si cada umbral fuera una frontera por sí mismo,
// y eso da respuestas falsas en las tres esquinas que encontró Codex.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { clasificarTextura, fragilidadTextura } = require(join(RAIZ, "api", "_suelo-oferta.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

console.log("── los tres casos de Codex ──");
// 1. Con arcilla 30 NUNCA puede ser arenoso, por mucha arena que se le eche.
//    Antes decía "a 1 punto de arenoso".
const a = fragilidadTextura(30, 64);
ok(a.clase === "franco", "clay=30 sand=64 es franco");
ok(a.clase_vecina === "arcilloso",
   `su vecina real es arcilloso, no arenoso (vía ${a.via})`);
ok(a.margen_pp === 5, `y el margen es 5 pp (arcilla 30→35), no 1 (${a.margen_pp})`);
ok(clasificarTextura(30, 99) === "franco",
   "prueba directa: con arcilla 30 y arena 99 sigue siendo franco");

// 2. Sigue siendo arcilloso pase lo que pase con la arena. Antes: margen 0.
const b = fragilidadTextura(36, 65);
ok(b.clase === "arcilloso", "clay=36 sand=65 es arcilloso");
ok(b.margen_pp === 1, `su frontera real es arcilla=35, a 1 pp (${b.margen_pp})`);
ok(b.clase_vecina === "franco", "y al cruzarla pasa a franco");
ok(clasificarTextura(36, 99) === "arcilloso", "con arena 99 seguiría siendo arcilloso");

// 3. Lo que lo saca de arenoso es la ARCILLA, a 1 punto. Antes decía 5.
const c = fragilidadTextura(19, 70);
ok(c.clase === "arenoso", "clay=19 sand=70 es arenoso");
ok(c.margen_pp === 1, `y está a 1 pp de dejar de serlo, no a 5 (${c.margen_pp})`);
ok(c.via.includes("arcilla"), `por la arcilla (${c.via}), que era la condición que no se miraba`);
ok(clasificarTextura(20, 70) === "franco", "prueba directa: arcilla 20 con arena 70 ya es franco");

console.log("\n── puntos claramente interiores: margen amplio y no frágiles ──");
for (const [cl, sa, clase] of [[10, 30, "franco"], [50, 10, "arcilloso"], [5, 85, "arenoso"], [25, 40, "franco"]]) {
  const f = fragilidadTextura(cl, sa);
  ok(f.clase === clase, `clay=${cl} sand=${sa} → ${f.clase}`);
  ok(f.margen_pp > 8 === !f.fragil, `margen ${f.margen_pp} pp → fragil=${f.fragil} (coherente con el umbral de 8)`);
}

console.log("\n── puntos EXACTAMENTE en la frontera ──");
ok(clasificarTextura(35, 40) === "arcilloso", "arcilla=35 exacto ya es arcilloso (≥)");
ok(clasificarTextura(34.99, 40) === "franco", "y 34,99 todavía es franco");
ok(clasificarTextura(10, 65) === "arenoso", "arena=65 con arcilla baja ya es arenoso (≥)");
ok(clasificarTextura(10, 64.99) === "franco", "y 64,99 todavía es franco");
ok(clasificarTextura(20, 70) === "franco", "arcilla=20 exacta rompe el arenoso (la condición es < 20)");
ok(fragilidadTextura(35, 40).margen_pp <= 0.1, "un punto en la frontera tiene margen ~0");
ok(fragilidadTextura(35, 40).fragil === true, "y se declara frágil");

console.log("\n── cambios mínimos a ambos lados de cada frontera ──");
const EPS = 0.02;
for (const [n, cl, sa] of [["arcilla=35", 35, 40], ["arena=65 (arcilla baja)", 10, 65], ["arcilla=20 (arena alta)", 20, 70]]) {
  const dentro = clasificarTextura(cl, sa), fuera = clasificarTextura(cl - EPS, sa);
  const distintas = dentro !== fuera || clasificarTextura(cl, sa - EPS) !== dentro;
  ok(distintas, `${n}: un cambio de ${EPS} pp cambia de clase (${dentro} ↔ ${fuera})`);
  const f = fragilidadTextura(cl, sa);
  ok(f.margen_pp < 1, `y la fragilidad lo ve: margen ${f.margen_pp} pp`);
}

console.log("\n── las parcelas reales, con los valores medidos ──");
for (const [n, cl, sa, esperada] of [["Breda (Ferran)", 22.13, 42.81, false], ["Sant Boi (padre)", 26.62, 33.88, false]]) {
  const f = fragilidadTextura(cl, sa);
  ok(f.clase === "franco" && f.fragil === esperada,
     `${n}: ${f.clase}, margen ${f.margen_pp} pp hacia ${f.clase_vecina} → fragil=${f.fragil}`);
}

console.log("\n── el dominio físico: arcilla + arena ≤ 100 ──");
// Segundo hallazgo de Codex sobre esto. La versión anterior proponía candidatos
// imposibles: para clay=0 sand=100 decía "a 20 pp de franco" por el punto
// (20, 100), que serían 120% de suelo. Para ganar arcilla hay que perder arena.
const extremo = fragilidadTextura(0, 100);
ok(extremo.clase === "arenoso", "clay=0 sand=100 es arenoso");
ok(Math.abs(extremo.margen_pp - 28.3) < 0.2,
   `y el franco más cercano está a 28,3 pp —el punto (20, 80)—, no a 20 (${extremo.margen_pp})`);
ok(fragilidadTextura(60, 60) === null, "un punto que suma 120 no es un suelo: null");
// SoilGrids da medias ponderadas en profundidad y la suma puede salir en 101 por
// redondeo. Eso no puede dejar la parcela sin evaluar.
const redondeo = fragilidadTextura(36, 65);
ok(redondeo !== null && redondeo.clase === "arcilloso",
   `una suma de 101 (redondeo) se sigue evaluando: ${redondeo && redondeo.clase}`);
ok(redondeo && redondeo.margen_pp === 1, "y su frontera real sigue siendo arcilla=35, a 1 pp");

console.log("\n── comprobación por fuerza bruta: 400 puntos al azar ──");
// La distancia declarada tiene que ser la mínima REAL. Se barre una rejilla fina
// del dominio buscando el punto de otra clase más cercano; si existe uno más
// próximo que el que devuelve fragilidadTextura, es que se ha escapado.
let peor = 0, peorCaso = null, evaluados = 0;
const rnd = (() => { let x = 42; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; })();
for (let i = 0; i < 400; i++) {
  // Mitad al azar en todo el dominio, mitad cerca de las fronteras (que es donde duele)
  let c, a;
  if (i % 2) { c = rnd() * 60; a = rnd() * (100 - c); }
  else {
    const cerca = [[35, 40], [20, 70], [10, 65], [19.9, 65.1], [35.1, 20]][i % 5];
    c = clamp(cerca[0] + (rnd() - 0.5) * 3, 0, 100);
    a = clamp(cerca[1] + (rnd() - 0.5) * 3, 0, 100 - c);
  }
  const f = fragilidadTextura(c, a);
  if (!f || f.margen_pp == null) continue;
  evaluados++;
  const clase = clasificarTextura(c, a);
  let mejorReal = Infinity;
  for (let dc = -40; dc <= 40; dc += 0.25) for (let da = -40; da <= 40; da += 0.25) {
    const c2 = c + dc, a2 = a + da;
    if (c2 < 0 || a2 < 0 || c2 + a2 > Math.max(100, c + a) + 1e-9) continue;
    if (clasificarTextura(c2, a2) === clase) continue;
    mejorReal = Math.min(mejorReal, Math.hypot(dc, da));
  }
  // La rejilla es de 0,25 pp, así que se admite esa holgura.
  const error = f.margen_pp - mejorReal;
  if (error > peor) { peor = error; peorCaso = { c: +c.toFixed(2), a: +a.toFixed(2), dicho: f.margen_pp, real: +mejorReal.toFixed(2) }; }
}
function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
ok(evaluados > 300, `${evaluados} puntos evaluados`);
ok(peor <= 0.4,
   peorCaso ? `el margen declarado nunca supera al real por más de 0,4 pp (peor: clay=${peorCaso.c} sand=${peorCaso.a}, dice ${peorCaso.dicho} y son ${peorCaso.real})`
            : "el margen declarado coincide con el mínimo real en todos los puntos");

console.log("\n── entrada fuera del dominio físico: estado explícito ──");
// Las fracciones de un suelo no pueden ser negativas ni sumar más de 100. Sin
// esta comprobación, clay = −5 devolvía "franco, margen 25,5 pp" tan tranquilo.
for (const [c, a, etiqueta] of [
  [-5, 40,  "arcilla negativa"],
  [20, -3,  "arena negativa"],
  [-1, -1,  "las dos negativas"],
  [60, 60,  "suma 120"],
  [80, 40,  "suma 120 por el otro lado"],
]) ok(fragilidadTextura(c, a) === null, `${etiqueta} (clay=${c}, sand=${a}) → null`);
// El límite del redondeo: 105 pasa, 106 no. La frontera está donde se decidió,
// no donde a uno le parezca.
ok(fragilidadTextura(100, 5) !== null, "suma 105 (el tope del redondeo tolerado) todavía se evalúa");
ok(fragilidadTextura(100, 6) === null, "y 106 ya no");
// Y lo que SÍ es válido sigue calculándose, incluido el límite exacto.
for (const [c, a, etiqueta] of [
  [50, 50, "suma 100 exacta"],
  [30, 70, "suma 100, franco"],
  [0, 100, "suma 100, todo arena"],
  [0, 0,   "todo limo"],
  [36, 65, "suma 101: redondeo de SoilGrids, se tolera"],
]) {
  const f = fragilidadTextura(c, a);
  ok(f !== null && f.margen_pp != null, `${etiqueta} (clay=${c}, sand=${a}) → ${f && f.clase} con margen ${f && f.margen_pp}`);
}

console.log("\n── y sin datos no se inventa nada ──");
ok(fragilidadTextura(null, 40) === null, "sin arcilla, null");
ok(fragilidadTextura(20, undefined) === null, "sin arena, null");
ok(fragilidadTextura(NaN, NaN) === null, "con NaN, null");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
