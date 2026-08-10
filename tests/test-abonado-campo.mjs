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
// La aritmética real del bancal: 41 g de N de cobertera para las 33 plantas, en
// dos aplicaciones, con un producto al 15% de riqueza.
const gN = 41, veces = 2, pct = 15;
const gNvez = Math.round(gN / veces * 10) / 10;
const gProd = Math.round(gNvez / (pct / 100));
ok(gNvez === 20.5, `la cobertera repartida en ${veces} aplicaciones: ${gNvez} g de N por vez`);
ok(gProd === 137, `y al 15% de riqueza son ${gProd} g de producto que pesar`);
// El motivo de llevar un decimal: redondear a entero arrastra al producto.
ok(Math.abs(Math.round(Math.round(gN / veces) / (pct / 100)) - gProd) >= 3,
   "con gramos enteros de N la dosis se desviaría 3 g o más de producto");

console.log("── la dosis solo se parte si el ensayo parte la parcela ──");
// El ensayo del bancal NO la parte: es manejo completo contra la zona B del
// padre (decisión del consejo del 24-jul). Un diseño partido que se colara aquí
// dejaría media parcela sin abonar sin que nadie lo hubiera decidido.
const pintar = campoHtml.slice(campoHtml.indexOf("function pintarAbonado"), campoHtml.indexOf("async function enviar"));
ok(/e && e\.plantas_tratadas && e\.plantas_total \? e\.plantas_tratadas \/ e\.plantas_total : 1/.test(pintar),
   "sin plantas_tratadas la dosis va ENTERA a la parcela; solo se escala si el ensayo la parte");
ok(/e\?\.plantas_control/.test(pintar),
   "y la línea del 'otro lado sin producto' solo sale si de verdad hay un control declarado");
ok(/plantas_tratadas \|\| e\?\.plantas_total/.test(pintar),
   "el reparto por planta usa las tratadas si las hay y si no todas");

console.log("── lo que hay que apuntar sale en pantalla, no en un papel aparte ──");
ok(/e\.apuntar/.test(pintar),
   "el qué apuntar viene declarado con el ensayo, no cableado en el front");
ok(/e\.comparacion/.test(pintar),
   "y contra qué se compara, para que no se confunda con un ensayo controlado");

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

console.log("── el porqué: cada cifra con su fuente ──");
// Una recomendación que no se puede discutir es una orden. El desglose del
// balance se calculaba y se TIRABA: llegaba "58 g" y punto.
const fert = leer("api", "_motor-cuaderno-fert.js");
ok(/desglose: \{/.test(fert) && /extraccion_kg:\s+necesidad/.test(fert),
   "el motor pasa los sumandos del balance a cada línea del plan, en vez de tirarlos");
const pq = campoHtml.slice(campoHtml.indexOf("function porQueAbonado"), campoHtml.indexOf("function pintarAbonado"));
for (const [txt, que] of [
  ["Lo que se lleva el cultivo", "la extracción del cultivo"],
  ["Reserva que hay que dejar", "el colchón final de MAPA"],
  ["Lo que pone el suelo", "el aporte del suelo"],
  ["Del cultivo anterior", "el crédito de residuos"],
  ["en cobertera", "el reparto fondo/cobertera"],
]) ok(pq.includes(txt), `se explica ${que}`);
ok(/Tabla 4\.2 de MAPA sobre SoilGrids/.test(pq),
   "y de dónde sale el término más flojo: la Tabla 4.2 aplicada sobre un prior de satélite");
ok(/suelo limpio/.test(pq),
   "el supuesto de suelo limpio se declara como supuesto, no se esconde en un 0");
ok(/no es una analítica de tu parcela/.test(pq) || /no una analítica de tu parcela/.test(pq),
   "y se dice que la materia orgánica es estimada, no medida en su tierra");

console.log("── el porqué del producto ──");
ok(/÷ \$\{pr\.pct_nutriente\}% de riqueza/.test(pq),
   "la cuenta que convierte gramos de N en gramos de producto se enseña, no se oculta");
ok(/Descartados, y por qué/.test(pq),
   "y los descartados con su motivo: es lo que dice por qué NO es lo que sale primero al buscar");
ok(/target="_blank"/.test(pq) && /pr\.consultado/.test(pq),
   "con las fuentes reales y la fecha, para poder comprobarlo antes de comprar");
const api = leer("api", "campo.js");
ok(/descartados: \(u\.producto_fert\.descartados/.test(api),
   "el razonamiento viaja desde el servidor, no se reconstruye en el navegador");

console.log("── la declaración del ensayo no pisa otras preferencias ──");
ok(/coalesce\(preferencias, '\{\}'::jsonb\) \|\|/.test(sql),
   "el SQL FUSIONA el jsonb en vez de reemplazarlo");
ok(/manejo-completo/.test(sql),
   "el ensayo declarado es el de MANEJO COMPLETO contra la zona B, el que decidió el consejo");
ok(/NO VALIDA EL MOTOR DE FERTILIZANTES/.test(sql),
   "y queda escrito que esto NO valida el motor: sin control sin nitrógeno no se puede");
ok(/plantas_borde/.test(sql),
   "las ~8 plantas de borde a descartar están declaradas (media ración de agua)");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
