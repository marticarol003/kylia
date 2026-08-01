// Cerrar el piloto el día de la cosecha (fecha_cosecha).
//   node tests/test-cierre-piloto.mjs
//
// El piloto tenía principio (piloto_inicio) pero no FINAL. El campo de 440 m²
// se cosechó el 30-jul-2026 y el cron del Diario B siguió congelando cada
// mañana una decisión de riego para una parcela VACÍA — y `recomendaciones_log`
// es de donde lee el reveal, así que el informe se ensuciaba un día más cada
// día. Encima la ventana del reveal se cerraba en "hoy": contando jornadas
// posteriores a la cosecha, en las que Kylia "recomendaba regar" y el
// agricultor lógicamente no regaba, el ahorro publicado salía diluido.
//
// Esto fija las dos mitades: que el cron pare y que el reveal corte.
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const { construirReveal } = require("../api/_reveal.js");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

const COSECHA = "2026-07-30";

console.log("── el informe declara si el piloto está cerrado ──");
const base = {
  riegosReales: [{ dia: "2026-07-01", l_m2: 6 }, { dia: "2026-07-20", l_m2: 6 }],
  riegosKylia:  [{ dia: "2026-07-01", nivel: "alta", l_m2: 5 }, { dia: "2026-07-20", nivel: "alta", l_m2: 5 }],
  tratReales: [], tratKylia: [], jornadas: [],
};
const abierto = construirReveal({ ...base, usuario: { id: "u1", cultivos: ["lechuga"] } });
const cerrado = construirReveal({ ...base, usuario: { id: "u1", cultivos: ["lechuga"], fecha_cosecha: COSECHA } });

ok(abierto.cerrado === false, "sin fecha_cosecha → cerrado:false (es una foto a mitad de campaña)");
ok(cerrado.cerrado === true,  "con fecha_cosecha → cerrado:true (ciclo completo, informe defendible)");
ok(cerrado.usuario.fecha_cosecha === COSECHA, "y la fecha viaja en el informe");
ok(abierto.usuario.fecha_cosecha === null, "sin cosecha, va a null (no undefined)");

console.log("── guarda: el cron NO puede volver a escribir sobre lo cosechado ──");
const diarioB = readFileSync(join(RAIZ, "api", "diario-b.js"), "utf8");
ok(/fecha_cosecha/.test(diarioB), "diario-b.js mira fecha_cosecha");
ok(/cosechado el/.test(diarioB),  "y se salta el piloto diciendo por qué");
// El goteo automático sintetiza riegos en `acciones`; sobre tierra vacía serían
// agua inventada que el contrafactual contaría como realmente aplicada.
ok(/tope/.test(diarioB) && /d <= tope/.test(diarioB),
   "el goteo automático corta en la cosecha, no sigue inventando riegos");

console.log("── guarda: la ventana del reveal corta en la cosecha ──");
const campo = readFileSync(join(RAIZ, "api", "campo.js"), "utf8");
ok(/function ultimoDiaDe\(u\)/.test(campo), "campo.js tiene un único sitio que decide el último día");
ok(/fecha=lte\./.test(campo) && /fecha_local=lte\./.test(campo),
   "las lecturas del reveal llevan tope superior, no solo inferior");
const usosUltimoDia = (campo.match(/ultimoDiaDe\(u\)/g) || []).length;
ok(usosUltimoDia >= 2, `los dos contrafactuales usan el tope (${usosUltimoDia} usos)`);
// La vista diaria sí mira "hoy" (es su trabajo), pero tiene que callarse en una
// parcela cosechada: el balance FAO-56 no sabe de cosechas y seguiría acumulando
// déficit sobre tierra vacía, con la orden de riego creciendo sola cada día.
ok(/cosechado: true/.test(campo), "la vista diaria marca la parcela como cosechada");
ok(/Sin cultivo, no hay riego que calcular/.test(campo),
   "y no da orden de riego sobre tierra vacía");

console.log("── el esquema lo recoge ──");
const schema = readFileSync(join(RAIZ, "db", "schema.sql"), "utf8");
ok(/fecha_cosecha\s+date/.test(schema), "schema.sql declara fecha_cosecha (la fuente de verdad)");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
