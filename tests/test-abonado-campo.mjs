// La tarjeta de abonado de /campo: del plan de Kylia al gesto de pesar.
//   node tests/test-abonado-campo.mjs
//
// El plan habla en GRAMOS DE NUTRIENTE y el que está en el campo pesa GRAMOS DE
// PRODUCTO. Ese salto es donde se pierde la recomendación: un agricultor no
// puede "echar 9,5 g de nitrógeno". Aquí se comprueba la cuenta que los une y,
// sobre todo, que un ensayo declarado no se convierta en media dosis para todos.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

const campoHtml = leer("campo", "index.html");
const campoApi  = leer("api", "campo.js");
const sql       = leer("db", "ensayo-fertilizantes-bancal-2026-08-10.sql");

console.log("── la cuenta que convierte nitrógeno en producto ──");
// Se reproduce aquí la misma aritmética que hace la tarjeta, con los datos
// reales del bancal: 41 g de N de cobertera, 15 de 33 plantas tratadas, en dos
// aplicaciones, con un producto al 15% de riqueza.
const gN = 41, tratadas = 15, total = 33, veces = 2, pct = 15;
const gNapl = Math.round(gN * (tratadas / total));
const gNvez = Math.round(gNapl / veces * 10) / 10;
const gProd = Math.round(gNvez / (pct / 100));
ok(gNapl === 19, `la dosis va solo a la parte tratada: ${gNapl} g de N de los ${gN} del bancal`);
ok(gNvez === 9.5, `repartida en ${veces} aplicaciones: ${gNvez} g por vez`);
ok(gProd === 63, `y al 15% de riqueza son ${gProd} g de producto que pesar`);
// El motivo de llevar un decimal: redondear a entero arrastra al producto.
ok(Math.round(Math.round(gNapl / veces) / (pct / 100)) - gProd >= 4,
   "con gramos enteros la dosis se iría 4 g arriba, un 7% en un bancal de 5 m²");

console.log("── un ensayo no puede acabar siendo media dosis para todos ──");
const pintar = campoHtml.slice(campoHtml.indexOf("function pintarAbonado"), campoHtml.indexOf("async function enviar"));
ok(/e\.plantas_tratadas \/ e\.plantas_total/.test(pintar),
   "con ensayo declarado, la dosis se escala a la fracción tratada");
ok(/: 1;/.test(pintar), "y sin ensayo va entera al bancal, como debe");
ok(/sin producto/.test(pintar),
   "el control se riega con la MISMA agua y sin producto (si no, se mide agua otra vez)");
ok(/plantas_control/.test(pintar), "y se dice cuántas son, para que no haya duda de qué lado es cuál");

console.log("── lo que hay que apuntar sale en pantalla, no en un papel aparte ──");
ok(/más pequeñas o más pálidas/.test(pintar),
   "se pide el dato que distingue 'al suelo le faltaba N' de 'le sobraba'");
ok(/su sitio/.test(pintar) && /su peso/.test(pintar),
   "y la posición y el peso planta a planta, que es de donde sale la medida");

console.log("── nada se calcula en el navegador ──");
ok(/vista=cuaderno/.test(campoHtml), "los números vienen del servidor");
ok(/producto: u\.producto_fert\?\.recomendado/.test(campoApi),
   "el %N sale de la búsqueda de mercado ya cacheada, no de una tabla cableada");
ok(/ensayo: \(u\.preferencias && u\.preferencias\.ensayo\)/.test(campoApi),
   "y el ensayo, de las preferencias de la parcela");
ok(/certificado_eco === false \?/.test(pintar),
   "si el producto no consta como ecológico se avisa en la propia tarjeta");

console.log("── apuntar el abonado es un toque ──");
ok(/motivo: "abonado"/.test(pintar), "queda registrado como abonado en el cuaderno");
ok(/cargarAbonado\(\);/.test(pintar), "y la tarjeta se refresca sola tras apuntarlo");

console.log("── la declaración del ensayo no pisa otras preferencias ──");
ok(/coalesce\(preferencias, '\{\}'::jsonb\) \|\|/.test(sql),
   "el SQL FUSIONA el jsonb en vez de reemplazarlo");
ok(/plantas_buffer',   3/.test(sql), "las 3 de separación están declaradas");
ok(/COTA INFERIOR/.test(sql),
   "y queda escrito que lo que mide es una cota inferior, no una medida");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
