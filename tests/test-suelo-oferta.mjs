// Demo/prueba real: oferta de suelo desde SoilGrids en los pilotos + efecto en
// la recomendación de nutrición. Hace llamadas de red reales (SoilGrids).
//   node tests/test-suelo-oferta.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { ofertaSuelo } = require("../api/_suelo-oferta.js");
const { necesidadNutrientes } = require("../api/_motor-nutricion.js");

// Pilotos reales (coordenadas de memoria) + rendimiento esperado orientativo.
const PILOTOS = [
  { nom: "Tomate — Breda",     cultivo: "tomate",  lat: 41.74, lon: 2.57, area: 30,  rendT: 0.18 }, // ~6 kg/m²
  { nom: "Cebolla — La Selva", cultivo: "cebolla", lat: 41.87, lon: 2.72, area: 380, rendT: 1.90 }, // ~5 kg/m²
  { nom: "Campo padre — Sant Boi (urbano→fallback)", cultivo: "lechuga", lat: 41.34, lon: 2.04, area: 440, rendT: 1.10 },
];

const kg = (x) => (x == null ? "—" : `${x} kg`);

for (const p of PILOTOS) {
  console.log(`\n═══ ${p.nom} (${p.cultivo}, ${p.area} m²) ═══`);
  const oferta = await ofertaSuelo(p.lat, p.lon, p.area);

  if (!oferta.disponible) {
    console.log(`  Oferta suelo: NO disponible — ${oferta.motivo}`);
  } else {
    const o = oferta.observado;
    console.log(`  Suelo (SoilGrids, punto ${oferta.fuente_punto}): ` +
      `N total ${o.n_total_g_kg} g/kg · MO(C) ${o.carbono_org_g_kg} g/kg · pH ${o.ph} · ` +
      `arcilla ${o.arcilla_pct}% · dens ${o.densidad_t_m3} t/m³`);
    console.log(`  Modelo N: ${oferta.modelo_n.n_mineralizable_kg_ha} kg/ha mineralizable ` +
      `→ ${kg(oferta.N)} disponibles en la parcela`);
  }

  const bruta = necesidadNutrientes(p.cultivo, p.rendT, null);
  const conSuelo = oferta.disponible
    ? necesidadNutrientes(p.cultivo, p.rendT, { N: oferta.N, P2O5: oferta.P2O5, K2O: oferta.K2O })
    : null;

  console.log(`  N a aplicar (hoy, extracción bruta): ${kg(bruta.nutrientes.N.necesidad_kg)}`);
  if (conSuelo) {
    console.log(`  N a aplicar (con oferta de suelo):   ${kg(conSuelo.nutrientes.N.necesidad_kg)} ` +
      `  ← descuenta ${kg(oferta.N)} que ya da el suelo`);
  }
}
console.log("\n(P₂O₅ y K₂O sin cambio: SoilGrids no da sus formas asimilables — pendiente ESDAC/analítica)");
