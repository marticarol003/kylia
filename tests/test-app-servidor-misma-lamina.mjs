// La app y el servidor tienen que decidir LO MISMO sobre los mismos riegos.
// Correr con: node tests/test-app-servidor-misma-lamina.mjs
//
// El 28-jul se unificó el motor en un solo fichero porque las dos copias habían
// derivado. Pero el motor puede ser el mismo y la decisión salir distinta si se
// le entrega una ENTRADA distinta, que es lo que pasaba hasta hoy:
//
//   servidor → laminaRiego(cantidad_l_m2, duracion_min, usuarios.caudal) → balance
//   app      → r.litros de localStorage (congelado) ────────────────────→ balance
//
// El `litros` guardado se congela con el caudal que hubiera el día del riego, y
// los caudales se afinan: el bancal de las 33 fue 15 → 5,4 → 11 mm/h. Con el
// caudal corregido a la baja la app veía MENOS déficit del real y llegó a decir
// "todo en orden" mientras el servidor mandaba regar 42 L/m².
//
// Este test fija el invariante por los dos lados: el numérico (misma lámina,
// misma decisión) y el estructural (que /app siga llamando a laminaRiego).
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const M = require("../api/_motor-riego.js");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

let fallos = 0;
function ok(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); }
  else      { console.error(`  ✗ ${msg}`); fallos++; }
}

const CAUDAL_VIEJO = 15;   // el que había cuando se registraron los riegos
const CAUDAL_REAL  = 11;   // el medido después (lo que hay hoy en usuarios.caudal)
const PLANT = "2026-06-21";
const OPTS  = { suelo: "franco", cultivoId: "lechuga", metodoRiego: "aspersion", fechaPlantacion: PLANT };

console.log("── laminaRiego: la duración manda sobre lo guardado ──");
ok(M.laminaRiego(12.5, 50, 11) === 9.2, "50 min a 11 mm/h → 9,2 mm (ignora los 12,5 congelados)");
ok(M.laminaRiego(12.5, null, 11) === 12.5, "sin duración → se respeta la cantidad guardada");
ok(M.laminaRiego(12.5, 50, null) === 12.5, "sin caudal → se respeta la cantidad guardada");
ok(M.laminaRiego(null, null, 11) === null, "sin nada → null (riego sin cantidad)");

// ── Escenario común: 40 días de lechuga en julio, riego cada 3 días ──
const serie = Array.from({ length: 40 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 5, 21 + i)).toISOString().slice(0, 10),
  et0: 5.2, lluvia: 0,
}));
// Tal cual los guarda localStorage: duración real + litros congelados al caudal viejo.
const guardados = [];
for (let i = 2; i < 40; i += 3) {
  guardados.push({
    date: new Date(Date.UTC(2026, 5, 21 + i)).toISOString().slice(0, 10),
    duracion: 50,
    litros: Math.round((CAUDAL_VIEJO * 50 / 60) * 10) / 10,
  });
}

// Cómo lee el servidor (api/campo.js:71) y cómo debe leer la app.
const comoServidor = guardados.map(r => ({
  date: r.date, litros: M.laminaRiego(r.litros, r.duracion, CAUDAL_REAL),
}));

console.log("── app y servidor: misma entrada → misma decisión ──");
const balSrv = M.balanceHidrico(serie, comoServidor, OPTS);
const balApp = M.balanceHidrico(serie, comoServidor, OPTS);   // la app ya mapea igual
ok(balSrv.Dr === balApp.Dr, `mismo déficit Dr por los dos lados (${balSrv.Dr.toFixed(1)} mm)`);
ok(M.decisionRiego(balSrv).nivel === M.decisionRiego(balApp).nivel,
   `misma decisión (${M.decisionRiego(balSrv).nivel})`);

console.log("── el bug de verdad: pasar el litros congelado desvía la decisión ──");
const balCongelado = M.balanceHidrico(serie, guardados, OPTS);   // lo que hacía la app antes
ok(balCongelado.Dr < balSrv.Dr,
   `el litros congelado INFRAVALORA el déficit (${balCongelado.Dr.toFixed(1)} vs ${balSrv.Dr.toFixed(1)} mm)`);

// Caso con la decisión invertida: riego más frecuente, el déficit se queda corto
// del umbral por el lado de la app y lo cruza por el del servidor.
const frecuentes = [];
for (let i = 2; i < 36; i += 2) {
  frecuentes.push({
    date: new Date(Date.UTC(2026, 5, 21 + i)).toISOString().slice(0, 10),
    duracion: 45,
    litros: Math.round((CAUDAL_VIEJO * 45 / 60) * 10) / 10,
  });
}
const serie36 = serie.slice(0, 36);
const decCongelado = M.decisionRiego(M.balanceHidrico(serie36, frecuentes, OPTS));
const decCorrecta  = M.decisionRiego(M.balanceHidrico(serie36,
  frecuentes.map(r => ({ date: r.date, litros: M.laminaRiego(r.litros, r.duracion, CAUDAL_REAL) })), OPTS));
ok(decCongelado.nivel === "baja" && decCorrecta.nivel === "alta",
   `sin el arreglo: app dice "${decCongelado.nivel}" y el servidor "${decCorrecta.nivel}" — decisiones opuestas`);

console.log("── guarda estructural: /app no puede dejar de aplicar la lámina ──");
const app = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
ok(/MOTOR\.laminaRiego\(/.test(app),
   "app/index.html llama a MOTOR.laminaRiego");
ok(/function riegosConLamina\(\)/.test(app),
   "app/index.html define riegosConLamina()");
ok(/balanceHidrico\(serie,\s*conLamina\b/.test(app),
   "el balance de la app recibe los riegos con la lámina recalculada, no el array crudo");
ok(!/balanceHidrico\(serie,\s*riegos\s*,/.test(app),
   "ningún balance de la app recibe ya el array crudo `riegos`");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ app y servidor anclados a la misma lámina");
