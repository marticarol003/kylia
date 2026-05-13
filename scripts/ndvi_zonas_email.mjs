// Obtiene NDVI/NDMI real esta semana para cada zona cooperativa
// Uso: node scripts/ndvi_zonas_email.mjs

const BASE = "https://kylia.app";

const ZONAS = [
  { nombre: "ActelGrup",              email: "actel@actel.es",                          lat: 41.660, lon: 0.598, zona: "Lleida" },
  { nombre: "Conjuntfruit",           email: "m.dones@conjuntfruit.es",                 lat: 41.726, lon: 0.582, zona: "Torrefarrera (Lleida)" },
  { nombre: "Fruits de Ponent",       email: "info@fruitsponent.com",                   lat: 41.579, lon: 0.524, zona: "Alcarràs (Lleida)" },
  { nombre: "Agal Fruits",            email: "agal@agal.es",                            lat: 41.552, lon: 0.635, zona: "Albatàrrec (Lleida)" },
  { nombre: "Trecoop",                email: "trecoop@trecoop.com",                     lat: 41.572, lon: 0.622, zona: "Sudanell (Lleida)" },
  { nombre: "Girona Fruits",          email: "gironafruits@gironafruits.com",           lat: 42.014, lon: 2.878, zona: "Bordils (Girona)" },
  { nombre: "Verdcamp Fruits",        email: "verdcamp@verdcampfruits.com",             lat: 41.072, lon: 1.062, zona: "Cambrils (Tarragona)" },
  { nombre: "Coop. Almoster",         email: "hola@coopalmoster.cat",                   lat: 41.148, lon: 1.096, zona: "Almoster (Tarragona)" },
  { nombre: "Coop. Agraria Tordera",  email: "agraria@cooperativaagrariatordera.cat",   lat: 41.696, lon: 2.724, zona: "Tordera (Maresme)" },
  { nombre: "Coop. Banyoles",         email: "info@cabanyoles.com",                     lat: 42.118, lon: 2.762, zona: "Banyoles (Girona)" },
];

function estadoTexto(ndvi) {
  if (ndvi > 0.6)  return "✅ buena salud";
  if (ndvi > 0.35) return "🟡 vigor moderado";
  return "🔴 estrés detectado";
}

function ndmiTexto(ndmi) {
  if (ndmi === null) return "no disponible";
  if (ndmi > 0.2)  return "humedad alta";
  if (ndmi > 0.0)  return "humedad normal";
  return "estrés hídrico";
}

async function fetchNdvi(lat, lon) {
  const url = `${BASE}/api/sentinel?lat=${lat}&lon=${lon}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function main() {
  console.log("\n=== NDVI por zona cooperativa ===\n");
  console.log(`Fecha consulta: ${new Date().toLocaleDateString("es-ES")}\n`);

  for (const z of ZONAS) {
    process.stdout.write(`Consultando ${z.nombre}...`);
    try {
      const d = await fetchNdvi(z.lat, z.lon);
      if (!d.ndvi) {
        console.log(" sin datos satelitales recientes");
        continue;
      }
      console.log(" OK");
      console.log(`\n📍 ${z.nombre} — ${z.zona}`);
      console.log(`   Email:   ${z.email}`);
      console.log(`   Fecha:   ${d.fecha}`);
      console.log(`   NDVI:    ${d.ndvi} → ${estadoTexto(d.ndvi)}`);
      if (d.ndmi !== null) console.log(`   NDMI:    ${d.ndmi} → ${ndmiTexto(d.ndmi)}`);
      if (d.stdev)         console.log(`   Variab.: ±${d.stdev} (parcelas heterogéneas si >0.15)`);
      console.log(`   URL app: ${BASE}/app?lat=${z.lat}&lon=${z.lon}`);

      // Línea para copiar directamente en el email
      console.log(`\n   ✉️  Fragmento para el email:`);
      console.log(`   "Esta semana el satélite detecta en la zona de ${z.zona} un NDVI de ${d.ndvi}`);
      console.log(`    (${estadoTexto(d.ndvi).replace(/.*? /, "")}) y ${ndmiTexto(d.ndmi)} según NDMI.`);
      console.log(`    Puedes ver el detalle parcela a parcela aquí: ${BASE}/app?lat=${z.lat}&lon=${z.lon}"\n`);
    } catch (e) {
      console.log(` ERROR: ${e.message}`);
    }
  }

  console.log("\n=== Fin ===\n");
}

main();
