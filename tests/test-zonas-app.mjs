// Zona activa en /app: que cada zona lleve SUS datos y no los de la vecina.
//   node tests/test-zonas-app.mjs
//
// Un agricultor con varias zonas ve una cada vez. El riesgo no es visual: si el
// balance de una zona contara el agua echada en otra, el déficit saldría
// inventado — la misma clase de fallo que la lámina congelada (19% de decisiones
// opuestas). Estas guardas son estructurales: leen app/index.html y saltan si
// alguien vuelve a juntar lo que tiene que ir separado.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const app  = readFileSync(join(RAIZ, "app", "index.html"), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

console.log("── la config de la finca y la de la zona no se pisan ──");
ok(/let cfgFinca\s*=\s*loadConfig\(\)/.test(app),
   "cfgFinca guarda lo persistido");
ok(/function configEfectiva\(\)/.test(app),
   "cfg pasa a ser la config EFECTIVA de la zona que se está mirando");
ok(/function saveConfig\(newCfg\)\s*\{\s*\n\s*cfgFinca = newCfg;/.test(app),
   "saveConfig escribe SIEMPRE la finca, no la zona activa");
ok(!/guardarYActualizar\(\{ \.\.\.cfg,/.test(app),
   "ningún guardado parte de la config efectiva (metería el cultivo de la zona en la finca)");
ok(/fp\.value = cfgFinca\.fechaPlantacion/.test(app),
   "el panel de configuración se rellena con los datos de la FINCA");
ok(/const seleccionado = \(cfgFinca\.cultivos \|\| \[\]\)\[0\]/.test(app),
   "y el cultivo marcado en el panel es el de la finca");

console.log("── los riegos van por parcela, nunca en una lista común ──");
ok(/function riegosKey\(\)/.test(app), "la clave de almacenamiento depende de la zona");
ok(/zonaActiva \? `kylia_riegos_\$\{zonaActiva\}` : "kylia_riegos"/.test(app),
   "cada zona tiene su propia lista en localStorage");
// Ojo: la detección de modo (demo vs piloto) sí lee "kylia_riegos" a pelo, y
// está bien: solo mira si el usuario tenía datos de antes, no alimenta ningún
// balance. Lo que no puede pasar es que el ALMACÉN de riegos use una clave fija.
const almacen = app.slice(app.indexOf("function riegosKey()"), app.indexOf("function addRiego("));
ok(!/localStorage\.(get|set)Item\("kylia_riegos"/.test(almacen),
   "load/saveRiegos nunca usan la clave global fija, siempre riegosKey()");
ok((almacen.match(/riegosKey\(\)/g) || []).length >= 3,
   "leer, migrar y guardar pasan los tres por riegosKey()");
ok(/usuario_id:\s*idParcelaActiva\(\)/.test(app),
   "el riego se sube contra el id de SU parcela, no contra el del usuario");

console.log("── el plan de abonado es el de la zona que se mira ──");
ok(/const uid = idParcelaActiva\(\)/.test(app),
   "el cuaderno se pide para la parcela activa (cada zona tiene sus kg)");

console.log("── cambiar de zona recalcula lo que depende del cultivo ──");
const cambiar = app.slice(app.indexOf("function cambiarZona("), app.indexOf("function cambiarZona(") + 1400);
ok(/riegos\s*=\s*loadRiegos\(\)/.test(cambiar), "recarga los riegos de la nueva zona");
ok(/ultimoNDVI\s*=\s*null/.test(cambiar) && /sateliteConsultado = false/.test(cambiar),
   "tira el NDVI cacheado: el de la zona anterior no describe a esta");
ok(/cargarPlanAbonado\(\)/.test(cambiar), "vuelve a pedir el plan de abonado");
ok(/cargarNDVI\(true\)/.test(cambiar), "y fuerza una medida nueva del satélite");

console.log("── el selector solo estorba si hace falta ──");
ok(/if \(lista\.length < 2\) \{ cont\.hidden = true/.test(app),
   "con una sola parcela el selector no aparece (al agricultor de siempre no le cambia la pantalla)");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
