// Test determinista del generador del reveal (api/_reveal.js), sin red.
// Ejecuta:  node scripts/test-reveal.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { construirReveal, semanaISO } = require("../api/_reveal.js");

let fallos = 0;
function ok(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); }
  else { console.log(`  ✗ ${msg}`); fallos++; }
}
function eq(a, b, msg) { ok(a === b, `${msg} (esperado ${b}, obtuve ${a})`); }

// ── Escenario: piloto que riega DE MÁS frente a la lámina FAO-56 ──
// Kylia congeló 3 días "alta" (regar) sumando 60 L/m². El agricultor regó
// 90 L/m² en el mismo periodo + 20 L/m² antes de que arrancara el registro.
const datos = {
  usuario: {
    id: "11111111-1111-1111-1111-111111111111",
    ciudad: "Lleida", cultivos: ["lechuga"], metodo_riego: "goteo",
    fecha_plantacion: "2026-06-04", tarifa_agua: 0.30, area_m2: 200,
  },
  riegosKylia: [
    { dia: "2026-06-10", l_m2: 20, nivel: "alta" },
    { dia: "2026-06-12", l_m2: 0,  nivel: "baja" },
    { dia: "2026-06-15", l_m2: 22, nivel: "alta" },
    { dia: "2026-06-18", l_m2: 18, nivel: "alta" },
  ],
  riegosReales: [
    { dia: "2026-06-05", l_m2: 20 },   // antes del registro → no compara
    { dia: "2026-06-10", l_m2: 30 },
    { dia: "2026-06-13", l_m2: 30 },
    { dia: "2026-06-17", l_m2: 30 },
  ],
  tratReales: [
    { dia: "2026-06-11", producto: "Bacillus thuringiensis" },  // sin señal de Kylia
  ],
  tratKylia: [],   // el Diario B hoy no congela tratamientos
  jornadas: [
    { fuente_decision: ["experiencia"] },
    { fuente_decision: ["meteo", "rutina"] },
    { fuente_decision: ["asesor"] },
  ],
};

console.log("semanaISO");
eq(semanaISO("2026-06-10"), "2026-W24", "10-jun-2026 cae en W24");

console.log("\nDimensión AGUA (regó de más)");
const r = construirReveal(datos);
const a = r.dimensiones.agua;
ok(a.disponible, "agua disponible");
eq(a.recomendada_l_m2, 60, "lámina recomendada = 20+22+18");
eq(a.aplicada_l_m2, 90, "agua aplicada en periodo = 30+30+30 (excluye los 20 de antes)");
eq(a.exceso_l_m2, 30, "exceso = 90-60");
eq(a.exceso_pct, 50, "exceso% = 50");
ok(a.riegos_antes_del_registro && a.riegos_antes_del_registro.n === 1, "1 riego anterior al registro, aparte");
ok(/más/.test(a.veredicto), "veredicto menciona que regó de más");

console.log("\nSerie diaria acumulada (gráfica de 2 líneas, fuente congelada)");
eq(a.serie.length, 9, "9 días del 10 al 18 de junio");
eq(a.serie[0].date, "2026-06-10", "arranca el primer día con decisión congelada");
eq(a.serie[0].kylia_l_m2, 20, "día 1: Kylia acumula 20");
eq(a.serie[0].real_l_m2, 30, "día 1: real acumula 30");
eq(a.serie[a.serie.length - 1].kylia_l_m2, 60, "último: Kylia acumula 60 (=lámina total)");
eq(a.serie[a.serie.length - 1].real_l_m2, 90, "último: real acumula 90 (=agua aplicada)");

console.log("\nDimensión COSTE (solo agua, € validado)");
const c = r.dimensiones.coste;
// 30 L/m² × 200 m² = 6000 L = 6 m³ × 0.30 €/m³ = 1.80 €
eq(c.agua_eur, 1.8, "coste agua = 1.80 €");
eq(c.tratamientos_eur, null, "tratamientos NO se monetizan (frontera honesta)");

console.log("\nDimensión TRATAMIENTOS (cualitativo, sin contrafactual)");
const t = r.dimensiones.tratamientos;
eq(t.aplicados, 1, "1 tratamiento aplicado");
eq(t.sin_senal_kylia, 1, "marcado sin señal de Kylia");
ok(t.sin_contrafactual, "declara que falta contrafactual (Diario B solo riego)");

console.log("\nDimensión HORAS (proxy honesto, no inventa)");
const h = r.dimensiones.horas;
ok(!h.disponible, "horas NO disponible (sin captura de tiempo)");
eq(h.datos.dias_registrados, 3, "3 jornadas");
eq(h.datos.mezcla_fuentes.experiencia, 1, "1 día por experiencia");

console.log("\nAvisos de transparencia");
ok(r.avisos.length >= 2, "incluye avisos de lo que aún no puede medir");
ok(r.periodo && r.periodo.cobertura_pct != null, "reporta cobertura del registro");

// ── Escenario 2: sin decisiones congeladas todavía ──
console.log("\nEscenario 2: piloto sin Diario B activo aún");
const vacio = construirReveal({ usuario: datos.usuario, riegosReales: [{ dia: "2026-06-05", l_m2: 20 }], riegosKylia: [] });
ok(!vacio.dimensiones.agua.disponible, "agua no disponible sin decisiones congeladas");

// ── Escenario 3: contrafactual FAO-56 (goteo de pauta fija riega DE MÁS) ──
// El caso de Breda: la lámina de Kylia se simula independiente (simularKylia),
// NO se lee de recomendaciones_log. El goteo fijo aplica 64 L/m² cuando la
// referencia FAO-56 (planta joven, kc bajo) solo pedía 23.
console.log("\nEscenario 3: agua con contrafactual FAO-56 (goteo riega de más)");
const cf = construirReveal({
  usuario: { id: "22222222-2222-2222-2222-222222222222", ciudad: "Hostalric",
             cultivos: ["tomate"], metodo_riego: "goteo", fecha_plantacion: "2026-05-27" },
  riegosReales: [
    { dia: "2026-06-21", l_m2: 16 }, { dia: "2026-06-23", l_m2: 16 },
    { dia: "2026-06-25", l_m2: 16 }, { dia: "2026-06-27", l_m2: 16 },
  ],
  riegosKylia: [],   // el log está contaminado / vacío: NO se usa
  contrafactual: {
    total: 23,
    puntos: [
      { date: "2026-06-20", acum_l_m2: 0 },  { date: "2026-06-21", acum_l_m2: 0 },
      { date: "2026-06-22", acum_l_m2: 0 },  { date: "2026-06-23", acum_l_m2: 0 },
      { date: "2026-06-24", acum_l_m2: 0 },  { date: "2026-06-25", acum_l_m2: 23 },
      { date: "2026-06-26", acum_l_m2: 23 }, { date: "2026-06-27", acum_l_m2: 23 },
    ],
  },
}).dimensiones.agua;
ok(cf.disponible, "agua disponible (contrafactual)");
eq(cf.metodo, "contrafactual-fao56", "marca el método contrafactual");
eq(cf.recomendada_l_m2, 23, "Kylia (FAO-56) = 23 (no 0 del log contaminado)");
eq(cf.aplicada_l_m2, 64, "real = 4×16 = 64");
eq(cf.exceso_l_m2, 41, "exceso = 64-23");
eq(cf.exceso_pct, 178, "exceso% sobre Kylia = round(41/23)");
eq(cf.ahorro_pct, 64, "ahorro% sobre el real = round(41/64) (el número del campo del padre)");
eq(cf.serie.length, 8, "serie del 20 al 27 de junio");
eq(cf.serie[cf.serie.length - 1].kylia_l_m2, 23, "último: Kylia acumula 23");
eq(cf.serie[cf.serie.length - 1].real_l_m2, 64, "último: real acumula 64");
ok(/más/.test(cf.veredicto), "veredicto: regó de más");

console.log(fallos === 0 ? "\n✅ Todos los asserts pasan." : `\n❌ ${fallos} asserts fallan.`);
process.exit(fallos === 0 ? 0 : 1);
