// Test del motor de nutrición (pilar fertilizantes).
//   node tests/test-nutricion.mjs
// Verifica que los coeficientes de extracción caen dentro de los rangos de
// guías españolas (agroes.es, peldaño 2) y que el balance de masa cuadra.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { EXTRACCION, COLCHON_N_KG_HA, N_RESIDUOS_KG_HA, FRACCION_DISPONIBLE_RESIDUOS,
        creditoResiduosN, necesidadNutrientes } = require("../api/_motor-nutricion.js");

let fallos = 0;
function ok(cond, msg) {
  if (cond) { console.log("  ✓", msg); }
  else { console.log("  ✗", msg); fallos++; }
}
function dentro(x, min, max) { return x >= min && x <= max; }
function r1(x) { return Math.round((Number(x) || 0) * 10) / 10; }

// Rangos de extracción por tonelada (agroes.es, absorción por producción).
const RANGOS = {
  tomate:  { N: [2.5, 3.5], P2O5: [1.1, 1.5], K2O: [5.0, 5.5] },
  cebolla: { N: [2.1, 2.5], P2O5: [0.9, 1.5], K2O: [3.0, 3.8] },
  lechuga: { N: [2.2, 2.7], P2O5: [0.8, 1.4], K2O: [4.6, 6.0] },
};

console.log("1) Coeficientes dentro de los rangos oficiales:");
for (const [cultivo, r] of Object.entries(RANGOS)) {
  const e = EXTRACCION[cultivo];
  ok(!!e, `existe extracción para ${cultivo}`);
  for (const n of ["N", "P2O5", "K2O"]) {
    ok(dentro(e[n], r[n][0], r[n][1]),
      `${cultivo} ${n}=${e[n]} en [${r[n][0]}, ${r[n][1]}]`);
  }
}

console.log("2) Balance de masa (necesidad = extracción − aporte):");
// Sin analítica: necesidad = extracción bruta.
const a = necesidadNutrientes("tomate", 2); // 2 t
ok(a.disponible && !a.oferta_conocida, "sin suelo → oferta_conocida:false");
ok(a.nutrientes.K2O.necesidad_kg === Math.round(EXTRACCION.tomate.K2O * 2 * 10) / 10,
   `K2O = extracción×rendimiento (${a.nutrientes.K2O.necesidad_kg} kg)`);

// Con analítica: resta el aporte, nunca negativo.
const b = necesidadNutrientes("lechuga", 1, { N: 100, P2O5: 0.3, K2O: 1.0 });
ok(b.oferta_conocida, "con suelo → oferta_conocida:true");
ok(b.nutrientes.N.necesidad_kg === 0, "aporte N enorme → necesidad neta 0 (no negativa)");
ok(b.nutrientes.K2O.necesidad_kg > 0, "K2O sigue con necesidad tras restar aporte");

console.log("3) Cultivo desconocido:");
ok(necesidadNutrientes("mango", 1).disponible === false, "cultivo sin coeficientes → disponible:false");
ok(necesidadNutrientes("tomate", 0).disponible === false, "rendimiento 0 → disponible:false");

console.log("4) Colchón de N final de MAPA (solo N, escala con el área):");
// Sin área → términos de N inactivos (retrocompatible con las llamadas viejas).
const sinArea = necesidadNutrientes("tomate", 2);
ok(sinArea.balance_n_completo === false, "sin area_m2 → balance_n_completo:false");
ok(sinArea.nutrientes.N.colchon_final_kg === undefined, "sin área → no expone colchón");

// Con área: el N sube EXACTAMENTE el colchón escalado; P y K no se tocan.
const area = 10000; // 1 ha → escala 1: el colchón entra en kg tal cual
const conArea = necesidadNutrientes("tomate", 2, null, { area_m2: area });
ok(conArea.balance_n_completo === true, "con area_m2 → balance_n_completo:true");
ok(conArea.nutrientes.N.colchon_final_kg === COLCHON_N_KG_HA.tomate,
   `colchón tomate = ${COLCHON_N_KG_HA.tomate} kg (1 ha)`);
ok(conArea.nutrientes.N.necesidad_kg === r1(EXTRACCION.tomate.N * 2 + COLCHON_N_KG_HA.tomate),
   `N = extracción + colchón (${conArea.nutrientes.N.necesidad_kg} kg)`);
ok(conArea.nutrientes.K2O.necesidad_kg === sinArea.nutrientes.K2O.necesidad_kg,
   "K2O NO cambia con el colchón (es término de N)");
ok(conArea.nutrientes.P2O5.necesidad_kg === sinArea.nutrientes.P2O5.necesidad_kg,
   "P2O5 NO cambia con el colchón");

// El colchón escala con la superficie: media hectárea → medio colchón.
const media = necesidadNutrientes("tomate", 2, null, { area_m2: 5000 });
ok(media.nutrientes.N.colchon_final_kg === r1(COLCHON_N_KG_HA.tomate / 2),
   `colchón escala con el área (${media.nutrientes.N.colchon_final_kg} kg en 0,5 ha)`);

// Cebolla lleva colchón mayor (raíz poco eficiente): 75 > 45.
const ceb = necesidadNutrientes("cebolla", 2, null, { area_m2: 10000 });
ok(ceb.nutrientes.N.colchon_final_kg === COLCHON_N_KG_HA.cebolla &&
   COLCHON_N_KG_HA.cebolla > COLCHON_N_KG_HA.tomate,
   `cebolla colchón ${COLCHON_N_KG_HA.cebolla} > general ${COLCHON_N_KG_HA.tomate}`);

// Crédito de residuos del cultivo anterior: baja el N (y nunca por debajo de 0).
const conCredito = necesidadNutrientes("tomate", 2, null,
  { area_m2: 10000, credito_residuos_n_kg_ha: 20 });
ok(conCredito.nutrientes.N.credito_residuos_kg === 20, "crédito de residuos se expone (20 kg/ha en 1 ha)");
ok(conCredito.nutrientes.N.necesidad_kg === r1(EXTRACCION.tomate.N * 2 + COLCHON_N_KG_HA.tomate - 20),
   `N = extracción + colchón − crédito (${conCredito.nutrientes.N.necesidad_kg} kg)`);

console.log("\n5) Crédito de residuos del cultivo anterior (MAPA Tabla 23.3.1 × 60%):");
// Solo cuenta si los restos se incorporaron.
ok(creditoResiduosN("tomate", true) === r1(N_RESIDUOS_KG_HA.tomate * FRACCION_DISPONIBLE_RESIDUOS),
   `tomate incorporado = ${creditoResiduosN("tomate", true)} kg/ha (52 × 0,6)`);
ok(creditoResiduosN("tomate", false) === 0, "restos retirados → crédito 0");
ok(creditoResiduosN(null, true) === 0, "sin cultivo anterior → crédito 0");
ok(creditoResiduosN("desconocido", true) === 0, "cultivo sin dato de residuos → crédito 0");
ok(creditoResiduosN("brassica", true) > creditoResiduosN("lechuga", true),
   "brassica deja más N residual que lechuga");
// End-to-end: el helper alimenta el balance vía campo.js.
const credCeb = creditoResiduosN("cebolla", true); // 30 × 0,6 = 18
const planCeb = necesidadNutrientes("tomate", 2, null,
  { area_m2: 10000, credito_residuos_n_kg_ha: credCeb });
ok(planCeb.nutrientes.N.credito_residuos_kg === credCeb,
   `crédito de cebolla previa fluye al balance (${credCeb} kg/ha)`);

console.log(fallos === 0 ? "\n✅ TODOS LOS TESTS VERDES" : `\n❌ ${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
