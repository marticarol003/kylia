// El día civil no es el día UTC, y de eso dependía qué fuente de clima se usaba.
//   node tests/test-clima-medianoche.mjs
//
// HALLAZGO DE CODEX (14-sep-2026), confirmado. `hoyISO()` calculaba el día con
// `new Date().toISOString()` —o sea, en UTC— mientras los datos se piden con
// timezone=Europe/Madrid. En verano España va en UTC+2, así que entre las 00:00
// y las 02:00 hora local el "hoy" en UTC sigue siendo AYER.
//
// Consecuencia: a las 00:30 del 15 de julio, hoyISO() devolvía "2026-07-14". El
// corte `date < hoy` dejaba el día 14 —que en el campo ya es pasado— en manos
// del PRONÓSTICO en vez del archivo. El escalón que se arregló ese mismo día,
// reaparecido en la franja de medianoche.
//
// Estos tests FALLABAN antes de la corrección: los seis primeros asserts dan el
// día anterior con la implementación UTC.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const R = require(join(RAIZ, "assets", "js", "clima-reglas.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };
const utc = iso => new Date(iso).toISOString().slice(0, 10);   // lo que hacía antes

console.log("── verano (CEST, UTC+2): la franja 00:00-02:00 ──");
for (const [iso, esperado] of [
  ["2026-07-15T00:00:01+02:00", "2026-07-15"],
  ["2026-07-15T00:30:00+02:00", "2026-07-15"],
  ["2026-07-15T01:59:59+02:00", "2026-07-15"],
  ["2026-07-15T02:00:01+02:00", "2026-07-15"],
  ["2026-07-14T23:59:59+02:00", "2026-07-14"],
]) {
  const d = R.hoyISO(new Date(iso));
  const antes = utc(iso);
  ok(d === esperado, `${iso} → ${d}${antes !== esperado ? `  (en UTC daba ${antes}: el bug)` : ""}`);
}

console.log("\n── invierno (CET, UTC+1): la franja 00:00-01:00 ──");
for (const [iso, esperado] of [
  ["2026-01-15T00:00:01+01:00", "2026-01-15"],
  ["2026-01-15T00:30:00+01:00", "2026-01-15"],
  ["2026-01-15T00:59:59+01:00", "2026-01-15"],
  ["2026-01-14T23:59:59+01:00", "2026-01-14"],
]) {
  const d = R.hoyISO(new Date(iso));
  const antes = utc(iso);
  ok(d === esperado, `${iso} → ${d}${antes !== esperado ? `  (en UTC daba ${antes}: el bug)` : ""}`);
}

console.log("\n── los dos cambios de hora, que es donde un offset fijo se rompe ──");
// España cambia el último domingo de marzo (02:00→03:00) y el de octubre
// (03:00→02:00). Con un `+2` cableado, el de invierno saldría mal medio año.
ok(R.hoyISO(new Date("2026-03-29T01:30:00Z")) === "2026-03-29", "29-mar 01:30Z (justo antes del salto) → 29");
ok(R.hoyISO(new Date("2026-03-29T02:30:00Z")) === "2026-03-29", "29-mar 02:30Z (ya en CEST) → 29");
ok(R.hoyISO(new Date("2026-10-25T00:30:00Z")) === "2026-10-25", "25-oct 00:30Z (aún CEST) → 25");
ok(R.hoyISO(new Date("2026-10-25T23:30:00Z")) === "2026-10-26", "25-oct 23:30Z (ya CET) → 26, porque en Madrid son las 00:30");
// Y el caso que distingue una implementación con offset fijo de una con tz real:
ok(R.hoyISO(new Date("2026-12-31T23:30:00Z")) === "2027-01-01",
   "31-dic 23:30Z → 1-ene: en invierno el salto de día es a las 23:00Z");
ok(R.hoyISO(new Date("2026-06-30T23:30:00Z")) === "2026-07-01",
   "30-jun 23:30Z → 1-jul: en verano es a las 22:00Z");
ok(R.hoyISO(new Date("2026-06-30T22:30:00Z")) === "2026-07-01",
   "30-jun 22:30Z → 1-jul también, y AQUÍ es donde UTC se equivocaba");
ok(R.hoyISO(new Date("2026-12-31T22:30:00Z")) === "2026-12-31",
   "pero 31-dic 22:30Z sigue siendo 31: en CET todavía no ha cambiado el día");

console.log("\n── y la SELECCIÓN de fuente alrededor de medianoche ──");
// Lo que de verdad importa: que el día de ayer se resuelva con el archivo.
const dia = (base, n) => {
  const d = new Date(`${base}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const mk = (fechas, fuente, et0) => fechas.map(date => ({ date, et0, lluvia: 0, fuente }));
const AYER = "2026-07-14", HOY = "2026-07-15";
const arch = mk([dia(AYER, -1), AYER, HOY], "archivo", 4);
const pron = mk([AYER, HOY, dia(HOY, 1)], "pronostico", 9);

// A las 00:30 del 15 en Madrid (= 22:30Z del 14)
const hoyReal = R.hoyISO(new Date("2026-07-14T22:30:00Z"));
ok(hoyReal === HOY, `a las 00:30 del 15 en Madrid, hoy = ${hoyReal}`);
const serie = R.fusionar(pron, arch, hoyReal);
const deAyer = serie.find(d => d.date === AYER);
ok(deAyer.fuente === "archivo",
   "y el día de AYER se resuelve con el archivo, no con el pronóstico");
ok(deAyer.et0 === 4, `con la ET₀ del archivo (${deAyer.et0}), no la del pronóstico (9)`);
ok(serie.find(d => d.date === HOY).fuente === "pronostico", "mientras que hoy sigue siendo del pronóstico");

// Con el día UTC (el bug), ayer habría caído en el pronóstico:
const serieBug = R.fusionar(pron, arch, utc("2026-07-14T22:30:00Z"));
ok(serieBug.find(d => d.date === AYER).fuente === "pronostico",
   "y con el día UTC caía en el pronóstico: esto es exactamente lo que fallaba");
ok(serieBug.find(d => d.date === AYER).et0 === 9,
   "con 9 mm en vez de 4: un 125% de más en la ET₀ de ese día");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
