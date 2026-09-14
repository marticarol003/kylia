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
// 14-sep: el clima se unificó en api/_clima.js y la regla se INVIRTIÓ. Antes
// mandaba el pronóstico en el solape; ahora manda el archivo en todo el pasado.
// Quién gana se comprueba EJECUTANDO, en tests/test-clima-fuentes.mjs; aquí solo
// queda que no vuelva el `?? 0`.
const clima = readFileSync(join(RAIZ, "api", "_clima.js"), "utf8");
ok(/archive-api\.open-meteo\.com/.test(clima), "el módulo de clima conoce el archivo");
ok(/for \(const d of arch\) if \(d\.date < hoy\) mapa\.set/.test(clima),
   "y el archivo manda en el pasado (el pronóstico solo cubre hoy y lo que viene)");
ok(!/et0_fao_evapotranspiration\?\.\[i\] \?\? 0/.test(clima),
   "y ya no queda ningún `?? 0` sobre la ET0");
ok(/UN DATO QUE FALTA NO ES UN CERO/.test(clima),
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
// Y desde el 14-sep ya no puede: no tiene climaSerie propia. Las dos copias del
// servidor pasan por el mismo módulo, así que no pueden volver a derivar.
ok(!/async function climaSerie/.test(db), "diario-b ya no tiene su propia copia del clima");
ok(/require\("\.\/_clima\.js"\)/.test(db), "usa el módulo único");
ok(/filter\(x => x\.et0 != null\)/.test(clima), "los días sin ET₀ se descartan");

console.log("\n── el barrido: CUATRO copias del mismo defecto ──");
// Ciclo 8. El `?? 0` sobre la ET₀ no estaba en un sitio: estaba en los cuatro
// que cargan clima. Arreglar campo.js el 11-sep no bastaba, y arreglar dos
// tampoco. Este test recorre los cuatro para que no vuelva por el que quede.
const FUENTES = [
  ["api/campo.js",      readFileSync(join(RAIZ, "api", "campo.js"), "utf8")],
  ["api/diario-b.js",   readFileSync(join(RAIZ, "api", "diario-b.js"), "utf8")],
  ["app/index.html",    readFileSync(join(RAIZ, "app", "index.html"), "utf8")],
];
for (const [nombre, txt] of FUENTES) {
  ok(!/et0_fao_evapotranspiration\?\.\[i\] \?\? 0/.test(txt),
     `${nombre}: ninguna ET₀ ausente convertida en cero`);
  ok(!/et0: vals\[i\] \?\? 0/.test(txt), `${nombre}: ni en la forma corta`);
}
const appTxt = FUENTES[2][1];
ok(/\.filter\(x => x\.et0 != null\)/.test(appTxt), "la app descarta los días sin ET₀ del histórico");
ok(/archive-api\.open-meteo\.com/.test(appTxt),
   "y desde el 14-sep baja al ARCHIVO para el pasado, como el servidor: era la única de las cuatro que no lo hacía");
ok(/for \(const d of arch\) if \(d\.date < hoyISO\)/.test(appTxt),
   "con la misma regla: el archivo manda en el pasado, el pronóstico en hoy");
ok(/\.filter\(x => x\.et0 != null\)/.test(appTxt), "y también los del pronóstico del calendario");

console.log("\n── y un riego sin cantidad no son cero litros, en los tres sitios ──");
// Misma forma, tercera copia: en la comparativa del campo del padre un `?? 0`
// hacía desaparecer del total los riegos apuntados sin cifra, inflando el
// ahorro que se le enseña.
const campoTxt = FUENTES[0][1];
ok(!/laminaRiego\(r\.cantidad_l_m2, r\.duracion_min \?\? null, caudal\) \?\? 0/.test(campoTxt),
   "la comparativa ya no cuenta como 0 un riego sin cantidad");
ok(/riegos_sin_cantidad: sinCantidad \|\| null/.test(campoTxt), "los declara aparte");
const revealTxt = readFileSync(join(RAIZ, "api", "_reveal.js"), "utf8");
ok((revealTxt.match(/riegos_sin_cantidad/g) || []).length >= 2,
   "y el reveal los declara en sus dos ramas");

console.log("\n── las DOS pantallas que publican un % miran el mismo umbral ──");
// 13-sep. El reveal preguntaba "¿con cuánto clima se ha calculado esto?" antes
// de publicar. La comparativa del campo del padre —la del 440 m², de donde salió
// el ahorro publicado— no lo preguntaba: pintaba "siguiendo a Kylia ahorrarías
// un X%" sobre lo que hubiera salido. Es la misma afirmación y ahora pasa por la
// misma puerta, con el umbral en un único sitio.
const RV = require(join(RAIZ, "api", "_reveal.js"));
ok(typeof RV.motivoClimaNoPublicable === "function" && RV.COBERTURA_MIN === 0.95,
   "el umbral y la comprobación viven en _reveal.js, exportados");
ok(RV.motivoClimaNoPublicable({ coberturaClima: 1 }) === null, "con el clima entero, se publica");
ok(/67%/.test(RV.motivoClimaNoPublicable({ coberturaClima: 0.67, diasSinClima: 29 }) || ""),
   "con el 67% dice cuánto falta");
ok(RV.motivoClimaNoPublicable({}) !== null, "y sin cobertura declarada, tampoco se publica");
ok(/publicable:\s+motivoClimaNoPublicable\(kylia\) === null/.test(campoTxt),
   "la comparativa usa ese mismo helper, no una copia");
ok(/ventana: \{ desde: inicio \|\| dias\[0\]\?\.date \|\| null, hasta: corte \}/.test(campoTxt),
   "y declara la ventana que esperaba cubrir, o los huecos del principio no se ven");
const campoHtml = readFileSync(join(RAIZ, "campo", "index.html"), "utf8");
ok(/const climaCorto = t\.publicable !== true;/.test(campoHtml),
   "y /campo no pinta el ahorro si el servidor no lo declara publicable");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
