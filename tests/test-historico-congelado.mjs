// Cambiar el caudal de la parcela NO puede cambiar un riego ya registrado.
//   node tests/test-historico-congelado.mjs
//
// HALLAZGO DE CODEX (14-sep-2026), confirmado. `laminaRiego` convierte duración
// × caudal en mm, y diario-b.js y campo.js le pasaban SIEMPRE el caudal ACTUAL
// del usuario. Así que un riego de 60 min que en julio valía 15 mm pasaba a
// valer 5,4 mm en cuanto se remedía el caudal con el vaso — y con él se movían
// el balance del ciclo entero y el reveal del piloto.
//
// Es exactamente lo que le pasó al bancal: el caudal se corrigió de 15 a 5,4
// mm/h el 28-jul. Un piloto ciego cuyos números cambian cada vez que se afina un
// dato no se puede validar.
//
// El test es el que pidió el encargo: registrar con caudal A → guardar →
// cambiar el caudal a B → reconstruir → el histórico tiene que salir idéntico.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const M = require(join(RAIZ, "assets", "js", "motor-riego.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

const CAUDAL_A = 15,  CAUDAL_B = 5.4;    // el cambio real del bancal, 28-jul-2026

console.log("── 1. se registra un riego con el caudal de entonces ──");
// Es lo que hace api/log.js al recibir el riego: calcula la lámina UNA vez.
const mm = M.laminaRiego(null, 60, CAUDAL_A);
const evento = { fecha_local: "2026-07-20", duracion_min: 60,
                 caudal_mmh: CAUDAL_A, lamina_mm: mm, lamina_origen: "duracion_x_caudal" };
ok(mm === 15, `60 min a ${CAUDAL_A} mm/h = ${mm} mm, y eso es lo que se congela`);

console.log("\n── 2. después se remide el caudal y baja a 5,4 ──");
const leido = M.laminaDeAccion(evento, CAUDAL_B);
ok(leido.mm === 15, `el riego del 20-jul sigue valiendo ${leido.mm} mm (no ${M.laminaRiego(null, 60, CAUDAL_B)})`);
ok(leido.origen === "duracion_x_caudal", "y conserva de dónde salió");
ok(leido.caudal_mmh === CAUDAL_A, `con el caudal de aquel día (${leido.caudal_mmh}), no el de hoy`);
ok(leido.reconstruida === false, "no está marcado como reconstrucción: es dato de época");

console.log("\n── 3. el balance del ciclo tampoco se mueve ──");
const dia = i => new Date(new Date("2026-07-01T12:00:00Z").getTime() + i * 86400000).toISOString().slice(0, 10);
const serie = []; for (let i = 0; i < 30; i++) serie.push({ date: dia(i), et0: 5.5, lluvia: 0, tmax: 30, tmin: 18 });
const OPT = { suelo: "franco", cultivoId: "tomate", metodoRiego: "goteo", fechaPlantacion: dia(0) };
const eventos = [5, 10, 15, 20].map(i => ({
  fecha_local: dia(i), duracion_min: 60, caudal_mmh: CAUDAL_A,
  lamina_mm: M.laminaRiego(null, 60, CAUDAL_A), lamina_origen: "duracion_x_caudal",
}));
const reconstruir = (caudalHoy) => M.balanceHidrico(serie,
  eventos.map(e => ({ date: e.fecha_local, litros: M.laminaDeAccion(e, caudalHoy).mm })), OPT);
const conA = reconstruir(CAUDAL_A), conB = reconstruir(CAUDAL_B);
ok(conA.Dr === conB.Dr, `el déficit final es el mismo con caudal ${CAUDAL_A} y con ${CAUDAL_B} (${conA.Dr.toFixed(1)} mm)`);
ok(conA.riegoNetoAcum === conB.riegoNetoAcum, `y el agua contada también (${conA.riegoNetoAcum} mm)`);

console.log("\n── y sin congelar SÍ se movía: la prueba de que el test sirve ──");
const sinCongelar = eventos.map(e => ({ fecha_local: e.fecha_local, duracion_min: 60 }));
const viejoA = M.balanceHidrico(serie, sinCongelar.map(e => ({ date: e.fecha_local, litros: M.laminaDeAccion(e, CAUDAL_A).mm })), OPT);
const viejoB = M.balanceHidrico(serie, sinCongelar.map(e => ({ date: e.fecha_local, litros: M.laminaDeAccion(e, CAUDAL_B).mm })), OPT);
ok(viejoA.Dr !== viejoB.Dr,
   `sin lámina congelada el déficit cambia de ${viejoA.Dr.toFixed(1)} a ${viejoB.Dr.toFixed(1)} mm al remedir el caudal`);
ok(M.laminaDeAccion(sinCongelar[0], CAUDAL_B).reconstruida === true,
   "y esos riegos salen MARCADOS como reconstruidos, no se cuelan como dato");

console.log("\n── el fallback es explícito, nunca silencioso ──");
for (const [n, accion, caudal, esperado] of [
  ["evento congelado",        { lamina_mm: 12, lamina_origen: "duracion_x_caudal" }, 9,    "duracion_x_caudal"],
  ["backfill de la migración",{ lamina_mm: 12, lamina_origen: "backfill_caudal_actual" }, 9, "backfill_caudal_actual"],
  ["sin congelar, con dur.",  { duracion_min: 90 },                                  10,   "recalculada_caudal_actual"],
  ["cantidad a mano",         { cantidad_l_m2: 22 },                                 10,   "cantidad_apuntada"],
  ["ni cantidad ni duración", {},                                                    10,   "desconocida"],
]) {
  const r = M.laminaDeAccion(accion, caudal);
  ok(r.origen === esperado, `${n} → origen "${r.origen}"`);
}
ok(M.laminaDeAccion({ lamina_mm: 12, lamina_origen: "backfill_caudal_actual" }, 9).reconstruida === true,
   "el backfill queda marcado como reconstrucción: se calculó con el caudal de hoy, no con el de entonces");
ok(M.laminaDeAccion({}, 10).mm === null, "y sin datos no se inventa una lámina: null, nunca 0");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
