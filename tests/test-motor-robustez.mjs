// El motor no puede decidir mal con datos rotos.
//   node tests/test-motor-robustez.mjs
//
// Ciclo de auditoría del 11-sep-2026. Cada bloque de aquí reproduce un fallo
// REAL que el motor tenía: no son hipótesis, todos se ejecutaron primero contra
// el código viejo y dieron el resultado equivocado que se documenta al lado.
//
// El hilo que los une es siempre el mismo: UN DATO QUE FALTA NO ES UN CERO, y
// un dato roto no puede producir una decisión tranquilizadora.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const M = require(join(RAIZ, "assets", "js", "motor-riego.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

const hoy = new Date();
const iso = d => new Date(hoy.getTime() - d * 86400000).toISOString().slice(0, 10);
const serie = (n, extra = {}) => {
  const s = [];
  for (let d = n; d >= 0; d--) s.push({ date: iso(d), et0: 4, lluvia: 0, tmax: 28, tmin: 16, ...extra });
  return s;
};
const OPT = { suelo: "franco", cultivoId: "tomate", metodoRiego: "goteo", fechaPlantacion: iso(80) };
const S = serie(6);

console.log("── CRÍTICO · un balance roto no puede decir 'todo en orden' ──");
// Antes: Dr = NaN caía por las dos ramas hasta "Todo en orden · déficit NaN mm".
// El peor modo de fallo posible, porque TRANQUILIZA con los datos corrompidos.
for (const bal of [{ Dr: NaN, raw: 20, taw: 100, efic: 0.9 },
                   { Dr: 30, raw: NaN, taw: 100, efic: 0.9 },
                   { Dr: 30, raw: 20, taw: 100, efic: 0 },
                   { Dr: 30, raw: 0, taw: 100, efic: 0.9 },
                   null, undefined, {}]) {
  const d = M.decisionRiego(bal, {});
  ok(d.nivel === "desconocido" && d.cantidad_l_m2 === null,
     `${JSON.stringify(bal)} → "${d.nivel}"`);
}
ok(M.decisionRiego({ Dr: 30, raw: 20, taw: 100, efic: 0.9 }, {}).nivel === "alta",
   "y con un balance sano sigue decidiendo igual que siempre");

console.log("\n── CRÍTICO · una duración de 0 no borra un riego ──");
// Antes: laminaRiego(12.5, 0, 11) → 0. El campo duracion_min existe en la base
// de datos y llega a 0 cuando nadie lo rellenó: el riego desaparecía del balance
// llevándose su cantidad apuntada.
ok(M.laminaRiego(12.5, 0, 11) === 12.5, "duración 0 → se respeta la cantidad guardada");
ok(M.laminaRiego(12.5, -30, 11) === 12.5, "duración negativa tampoco es una duración");
ok(M.laminaRiego(12.5, 50, 11) === 9.2, "y una duración de verdad sigue mandando");
// Number(null) es 0: el mismo agujero que vigila gradosDia.
ok(M.laminaRiego(null, null, 11) === null, "sin cantidad → null, no 0");
ok(M.laminaRiego("", null, 11) === null, "cadena vacía tampoco es 0");
ok(M.laminaRiego(0, null, 11) === 0, "pero un 0 declarado SÍ es un 0");

console.log("\n── ALTO · un dato de clima que falta no es un día sin gastar agua ──");
// Antes: et0 = null contaba como 0. Con tres días sin dato de siete, el déficit
// pasaba de 32,2 a 18,4 mm. Es el mismo defecto que costó dos informes de piloto
// publicados mal, pero dentro del motor.
const sano = M.balanceHidrico(S, [], OPT);
// El hueco va EN MEDIO a propósito: los del final no se ven porque el tramo se
// define con los propios datos y simplemente se encoge (para eso están
// desdeSerie/hastaSerie, que el que llama sí puede comparar con lo que esperaba).
const conNulos = M.balanceHidrico(S.map((d, i) => (i >= 2 && i <= 4) ? { ...d, et0: null } : d), [], OPT);
// OJO, y esto se descubrió auditando el propio arreglo: descartar el día y
// contarlo como cero dan EL MISMO déficit. Sanear la entrada solo deja de tragar
// basura; lo que de verdad protege es DECIR que la serie está incompleta.
ok(conNulos.diasSinClima === 3,
   `el balance declara los 3 días sin clima (diasSinClima=${conNulos.diasSinClima})`);
ok(conNulos.coberturaClima < 0.7,
   `y su cobertura baja a ${conNulos.coberturaClima}: no es un balance del que publicar nada`);
ok(sano.desdeSerie === S[0].date && sano.hastaSerie === S.at(-1).date,
   "y se dan los extremos, para cazar los huecos del final que el tramo no ve");
ok(sano.diasSinClima === 0 && sano.coberturaClima === 1,
   "con la serie entera, cobertura 1 y ningún hueco");
for (const malo of [undefined, "", "abc", NaN]) {
  const b = M.balanceHidrico([{ date: iso(1), et0: malo, lluvia: 0 }], [], OPT);
  ok(b.etcAcum === 0 && Number.isFinite(b.Dr), `et0=${JSON.stringify(malo)} → día descartado, Dr finito`);
}
ok(M.balanceHidrico([{ date: iso(1), et0: -50, lluvia: 0 }], [], OPT).etcAcum === 0,
   "una ET₀ negativa se recorta a 0: no existe evaporación negativa");

console.log("\n── ALTO · un riego no puede secar el suelo ──");
// Antes: litros = −20 subía el déficit de 32,2 a 50,2. Un riego negativo SECABA.
const neg = M.balanceHidrico(S, [{ date: iso(3), litros: -20 }], OPT);
ok(Math.abs(neg.Dr - sano.Dr) < 0.01, `un riego de −20 L/m² se descarta (Dr ${neg.Dr.toFixed(1)})`);
const pos = M.balanceHidrico(S, [{ date: iso(3), litros: 20 }], OPT);
ok(pos.Dr < sano.Dr, "y uno positivo sí baja el déficit");

console.log("\n── CRÍTICO · un riego con la cantidad rota no envenena el balance ──");
// Antes: litros = NaN o "mucha" propagaban Dr = NaN a TODO lo que viniera detrás.
for (const v of [NaN, "mucha", Infinity, -Infinity, {}, []]) {
  const b = M.balanceHidrico(S, [{ date: iso(3), litros: v }], OPT);
  ok(Number.isFinite(b.Dr), `litros=${JSON.stringify(v)} → Dr sigue siendo un número (${b.Dr.toFixed(1)})`);
}
ok(M.balanceHidrico(S, [{ date: "ayer", litros: 20 }], OPT).Dr === sano.Dr,
   "una fecha que no es una fecha se descarta");

console.log("\n── MEDIO · el mismo día no se cuenta dos veces ──");
// Antes: un día repetido sumaba su ETc otra vez (32,2 → 34,3 con uno triplicado).
const dup = [...S, S[3], S[3]];
ok(Math.abs(M.balanceHidrico(dup, [], OPT).Dr - sano.Dr) < 0.01,
   "con un día repetido tres veces el balance no se mueve");

console.log("\n── ALTO · un hueco en la serie térmica no se traga el calor ──");
// Antes: con 15 días ausentes de 41, el acumulado caía de 492 a 300 °C·día. El
// cultivo parecía 15 días más joven, el Kc bajaba y Kylia regaba de menos.
const larga = serie(40);
const gddSano = M.curvaFenologica("tomate", larga, iso(40))?.gddAcum;
for (const n of [1, 2, 3]) {
  const rota = larga.filter((d, i) => !(i >= 20 && i < 20 + n));
  const c = M.curvaFenologica("tomate", rota, iso(40));
  ok(c && Math.abs(c.gddAcum - gddSano) <= 2,
     `con ${n} día(s) ausente(s) se interpola y el calor se mantiene (${c?.gddAcum} vs ${gddSano})`);
}
for (const n of [4, 15]) {
  const rota = larga.filter((d, i) => !(i >= 20 && i < 20 + n));
  ok(M.curvaFenologica("tomate", rota, iso(40)) === null,
     `con ${n} días seguidos ausentes se devuelve null: mejor calendario que termómetro a medias`);
  ok(M.balanceHidrico(rota, [], { ...OPT, fechaPlantacion: iso(40), serieTermica: rota }).modoFenologia === "calendario",
     `   ...y el balance lo dice: modoFenologia = "calendario"`);
}

console.log("\n── ALTO · un pronóstico absurdo no cancela un riego ──");
// Antes: lluvia = 1.000.000 daba "esperar a la lluvia · se prevén 1000000 mm".
const bal = { Dr: 30, raw: 20, taw: 100, efic: 0.9 };
for (const v of [1e6, 500, NaN, "muchísima", -50, null]) {
  const d = M.decisionRiego(bal, { lluviaPrevista: [{ lluvia: v }] });
  ok(d.nivel === "alta", `lluvia prevista = ${JSON.stringify(v)} → sigue mandando regar`);
}
ok(M.decisionRiego(bal, { lluviaPrevista: [{ lluvia: 40 }] }).nivel === "media",
   "y una lluvia creíble sí aplaza el riego");
ok(M.decisionRiego(bal, { lluviaPrevista: [{ lluvia: 150 }] }).nivel === "media",
   "150 mm en un día es mucho pero pasa en la costa mediterránea: se acepta");

console.log("\n── MEDIO · no se riega un campo sin plantar ──");
// Antes: con la plantación en el futuro salía un balance normal con Kc de fase
// inicial, así que Kylia podía mandar regar tierra vacía.
const futuro = M.balanceHidrico(S, [], { ...OPT, fechaPlantacion: iso(-30) });
ok(futuro.sinPlantar === true, "se marca que todavía no hay cultivo");
ok(futuro.Dr === 0, "y el déficit es 0: no hay planta que gaste");
ok(M.decisionRiego(futuro, {}).nivel !== "alta", "así que no se manda regar");

console.log("\n── BAJO · un suelo desconocido se declara ──");
// El AWC va de 0,08 a 0,16, casi el doble. Caer a franco está bien; hacerlo en
// silencio convierte un typo en una suposición invisible.
ok(M.aguaSuelo("franco").sueloReconocido === true, "franco se reconoce");
ok(M.aguaSuelo("Franco").sueloReconocido === false, "'Franco' con mayúscula NO");
ok(M.aguaSuelo("marciano").sueloReconocido === false, "ni un suelo inventado");
ok(M.aguaSuelo("marciano").awc === M.SUELO_AWC.franco, "pero el valor que se usa sigue siendo el de franco");

console.log("── la regadera, con áreas imposibles ──");
// Ciclo 14. `areaM2 > 0` deja pasar Infinity, y `0 × Infinity` es NaN: la
// pantalla decía "NaN regaderas (NaN L)". Salía 1 de cada 40.000 escenarios
// adversariales, o sea: por ahí entra cualquier área rota que llegue del alta.
const reg = (mm, area, cap) => M.presentarRiego(mm, { metodoRiego: "regadera", areaM2: area, capacidadRegaderaL: cap });
ok(!/NaN/.test(reg(0, Infinity, 10).texto), "área infinita ya no da 'NaN regaderas (NaN L)'");
ok(reg(0, Infinity, 10).unidad === "l_m2", "se cae a L/m², que siempre se puede decir");
ok(reg(10, "33", "10").texto === "33 regaderas (330 L)", "y un área que llega como texto se sigue entendiendo");
ok(reg(10, 33, 10).texto === "33 regaderas (330 L)", "el caso real del bancal no cambia");
ok(reg(10, 1e9, 10).unidad === "l_m2", "cien mil hectáreas no se riegan a regadera: se dice en L/m²");
ok(reg(10, 33, 1000).unidad === "l_m2", "ni 1.000 L es una regadera: eso es un depósito");
ok(reg(10, 33, 100).unidad === "regaderas", "100 L sí (una carretilla con bidón), y sigue contando");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
