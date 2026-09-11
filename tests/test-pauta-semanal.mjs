// Pauta semanal de calendario: "riega todos los lunes y jueves".
//   node tests/test-pauta-semanal.mjs
//
// El goteo automático (cada N días desde un ancla) ya lo sintetizaba diario-b.
// Pero la cebolleta de El Tros de l'Uri es aspersión que abre una persona SIEMPRE
// los mismos días de la semana: lunes y jueves, 2 h. Eso es 3-4-3-4 días, y no
// cabe en un intervalo fijo — con `cada_dias = 3` el patrón se desfasa solo y a
// la cuarta semana riega en martes.
//
// Esto ESCRIBE agua que nadie ha confirmado en `acciones`, y `acciones` es de
// donde sale el ahorro del reveal. Por eso la pieza que decide los días se testea
// aparte: un día de más son 30 L/m² inventados en el informe.
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const { fechasDePauta } = require("../api/diario-b.js");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };
const mismo = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}  →  [${a}]`);

const LUN_JUE = [1, 4];

console.log("── la pauta cae en los días que toca ──");
// 2026-08-06 es jueves. Del lunes 3 al domingo 9: riega 3 (lun) y 6 (jue).
mismo(fechasDePauta({ desde: "2026-08-03", tope: "2026-08-09", diasSemana: LUN_JUE }, []),
      ["2026-08-03", "2026-08-06"], "una semana entera da exactamente 2 riegos");

mismo(fechasDePauta({ desde: "2026-08-03", tope: "2026-08-17", diasSemana: LUN_JUE }, []),
      ["2026-08-03", "2026-08-06", "2026-08-10", "2026-08-13", "2026-08-17"],
      "dos semanas: el patrón NO se desfasa (3-4-3-4)");

// El fallo que hace falta evitar: 'cada 3 días' desde un lunes se va a martes.
const cada3 = fechasDePauta({ desde: "2026-08-03", tope: "2026-08-17", cada: 3 }, []);
ok(cada3.includes("2026-08-12"), "…mientras que 'cada 3 días' acaba regando en miércoles (por eso existe la pauta semanal)");
ok(!cada3.includes("2026-08-10"), "…y se salta el lunes 10");

console.log("── idempotente: no duplica lo ya apuntado ──");
mismo(fechasDePauta({ desde: "2026-08-03", tope: "2026-08-09", diasSemana: LUN_JUE },
                    ["2026-08-03", "2026-08-06"]),
      [], "si los dos riegos ya están registrados, no genera nada");
mismo(fechasDePauta({ desde: "2026-08-03", tope: "2026-08-09", diasSemana: LUN_JUE },
                    ["2026-08-03"]),
      ["2026-08-06"], "autocurativo: rellena solo el que falta");

console.log("── el tope manda (cosecha o 'hoy') ──");
mismo(fechasDePauta({ desde: "2026-08-03", tope: "2026-08-05", diasSemana: LUN_JUE }, []),
      ["2026-08-03"], "no inventa el jueves si el tope es el miércoles");
mismo(fechasDePauta({ desde: "2026-08-10", tope: "2026-08-03", diasSemana: LUN_JUE }, []),
      [], "ancla posterior al tope → nada (parcela cosechada antes de empezar)");

console.log("── la semanal manda sobre 'cada N días' ──");
mismo(fechasDePauta({ desde: "2026-08-03", tope: "2026-08-09", cada: 1, diasSemana: LUN_JUE }, []),
      ["2026-08-03", "2026-08-06"], "con las dos puestas, gana el calendario (no riega los 7 días)");

console.log("── pauta vacía o inválida no genera agua ──");
mismo(fechasDePauta({ desde: "2026-08-03", tope: "2026-08-09" }, []), [], "sin pauta → nada");
mismo(fechasDePauta({ desde: "2026-08-03", tope: "2026-08-09", diasSemana: [] }, []), [], "lista vacía → nada");
mismo(fechasDePauta({ desde: "2026-08-03", tope: "2026-08-09", diasSemana: [0, 8, 99] }, []), [],
      "días fuera de 1-7 se descartan (no hay 'día 0')");
mismo(fechasDePauta({ desde: "2026-08-03", tope: "2026-08-09", cada: 0 }, []), [], "cada=0 → nada (no bucle infinito)");

console.log("── domingo = 7, no 0 (el borde clásico de getUTCDay) ──");
mismo(fechasDePauta({ desde: "2026-08-03", tope: "2026-08-09", diasSemana: [7] }, []),
      ["2026-08-09"], "el domingo se pide con 7");
mismo(fechasDePauta({ desde: "2026-08-03", tope: "2026-08-09", diasSemana: [1, 2, 3, 4, 5, 6, 7] }, []).length === 7
        ? [7] : [0], [7], "los 7 días de la semana caben, sin repetir ni saltar");

console.log("── el relleno está ACOTADO: esto escribe agua que nadie confirma ──");
// Ciclo 13 de la auditoría (11-sep-2026). `fechasDePauta` recorría desde la
// fecha ancla hasta hoy sin tope. Medido antes del arreglo:
//
//   riego_auto_desde = 2020-01-01, pauta lun+jue → 699 filas de una sentada
//   riego_auto_desde = 0001-01-01                → 105.696 filas y 1,8 s
//
// Y cada fila es "agua aplicada" en el cuaderno del agricultor y en el reveal
// del piloto. Un cero de más en una columna de la base de datos reescribía la
// historia de riego de una parcela.
const HOY = "2026-09-11";
const largo = fechasDePauta({ desde: "2020-01-01", tope: HOY, cada: 0, diasSemana: [1, 4] }, []);
ok(largo.length === 40, `una fecha ancla de 2020 rellena 40 días, no 699 (salen ${largo.length})`);
ok(largo[largo.length - 1] > largo[0], "y salen en orden ascendente, como antes");
ok(largo[largo.length - 1] === "2026-09-10",
   "el recorte se queda con los días RECIENTES: son los que el balance de hoy necesita");

const t0 = Date.now();
const absurda = fechasDePauta({ desde: "0001-01-01", tope: HOY, cada: 0, diasSemana: [1] }, []);
ok(absurda.length === 40 && Date.now() - t0 < 200,
   "y una fecha imposible se resuelve al instante en vez de recorrer dos milenios");

ok(fechasDePauta({ desde: "garbage", tope: HOY, cada: 0, diasSemana: [1] }, []).length === 0,
   "una fecha que no es una fecha no entra en el bucle");
ok(fechasDePauta({ desde: "2026-10-01", tope: HOY, cada: 0, diasSemana: [1] }, []).length === 0,
   "ni una fecha ancla posterior a hoy");

// Y lo que NO puede cambiar: el caso real del piloto sale exactamente igual.
const real = fechasDePauta({ desde: "2026-08-06", tope: HOY, cada: 0, diasSemana: [1, 4] }, []);
ok(real.length === 11 && real[0] === "2026-08-06" && real[10] === "2026-09-10",
   "la cebolleta de El Tros de l'Uri (lun+jue desde el 6-ago) sigue dando sus 11 días");

console.log("── guardas de integridad del piloto ──");
const diarioB = readFileSync(join(RAIZ, "api", "diario-b.js"), "utf8");
ok(/fecha_cosecha/.test(diarioB) && /d <= tope/.test(diarioB),
   "la pauta sigue cortando en la cosecha (no riega tierra vacía)");
ok(/motivo:\s*"goteo-auto"/.test(diarioB),
   "los riegos sintetizados quedan marcados en `motivo` (distinguibles de los confirmados)");
ok(/franja_horaria:\s*semana\.length \? null : "manana"/.test(diarioB),
   "la pauta semanal no inventa franja horaria (la abre una persona)");

const schema = readFileSync(join(RAIZ, "db", "schema.sql"), "utf8");
ok(/riego_auto_dias_semana\s+smallint\[\]/.test(schema), "schema.sql declara la columna");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
