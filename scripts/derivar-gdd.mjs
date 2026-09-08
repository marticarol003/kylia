#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────
// De dónde salen los grados-día de FAO_GDD (assets/js/motor-riego.js)
// ─────────────────────────────────────────────────────────────────
//   node scripts/derivar-gdd.mjs            # imprime la tabla
//   node scripts/derivar-gdd.mjs --json     # solo el bloque para pegar
//
// LA REGLA DE LA CASA es que ningún número del motor esté inventado. Estos
// tampoco: no se han ajustado a nuestros pilotos (de hecho los pilotos se usan
// para VALIDARLOS, no para calibrarlos, ver docs/tecnico/fenologia-termica.md).
//
// EL MÉTODO, que es el de FAO56rev:
//   1. Cada cultivo tiene en la Tabla 11 de FAO-56 unas longitudes de fase EN
//      DÍAS, atadas a una región y a UNA FECHA DE PLANTACIÓN de referencia.
//   2. Se planta virtualmente en esa fecha, en un sitio mediterráneo real, y se
//      integra la temperatura de 21 años (2005-2025) sobre esas mismas fases.
//   3. Lo que sale —cuánto calor pide cada fase— ya no depende del calendario.
//      Plantes cuando plantes, el cultivo necesita el mismo calor.
//
// Se usa la MEDIANA de los 21 años (no la media: un verano extremo no debe
// mover la constante) y se imprime el P10-P90, que es de dónde sale la anchura
// de la ventana de madurez.
//
// El sitio de referencia es La Selva (Girona), que es donde están los pilotos y
// es clima mediterráneo costero, el mismo al que se refiere la tabla de FAO.
//
// Tbase por cultivo: Pereira & Paredes (2025), «Base and upper temperature
// thresholds to support the calculation of growing degree days aiming at their
// use with the FAO56rev crop coefficients curve: A review», Agric. Water Manag.

const LAT = 41.674023, LON = 2.766436;
const DESDE = "2005-01-01", HASTA = "2025-12-31";

// L: las longitudes que el motor ya usa (FAO_KC).  ref: fecha de plantación de
// referencia de la Tabla 11 para la fila mediterránea de ese cultivo.
const CULTIVOS = {
  lechuga:   { tbase:  4.0, L: [20, 30, 15, 10], ref: "04-15", fao: "75 d · abril · Mediterráneo" },
  espinaca:  { tbase:  4.0, L: [20, 20, 15,  5], ref: "04-15", fao: "60 d · abril · Mediterráneo" },
  brassica:  { tbase:  4.0, L: [30, 35, 50, 15], ref: "09-01", fao: "130 d · septiembre" },
  tomate:    { tbase: 10.0, L: [30, 40, 45, 30], ref: "05-01", fao: "145 d · abril/mayo · Mediterráneo" },
  pimiento:  { tbase: 10.0, L: [30, 35, 40, 20], ref: "05-15", fao: "125 d · abril/junio · Europa y Medit." },
  berenjena: { tbase: 10.5, L: [30, 40, 40, 20], ref: "06-01", fao: "130 d · mayo/junio · Mediterráneo" },
  calabacin: { tbase: 10.0, L: [25, 35, 25, 15], ref: "04-15", fao: "100 d · abril · Mediterráneo" },
  cebolla:   { tbase:  6.0, L: [15, 25, 20, 10], ref: "05-01", fao: "70 d · abril/mayo · Mediterráneo" },
};

const mediana = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.round((s.length - 1) * p))]; };

const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}`
  + `&start_date=${DESDE}&end_date=${HASTA}`
  + `&daily=temperature_2m_max,temperature_2m_min&timezone=Europe%2FMadrid`;

const res = await fetch(url);
if (!res.ok) { console.error(`open-meteo ${res.status}`); process.exit(1); }
const d = (await res.json()).daily;
const idx = new Map(d.time.map((f, i) => [f, i]));
const gdd = (i, tb) => Math.max(0, (d.temperature_2m_max[i] + d.temperature_2m_min[i]) / 2 - tb);

const salida = {};
const filas = [];
for (const [nombre, k] of Object.entries(CULTIVOS)) {
  const porFase = [[], [], [], []], totales = [];
  for (let y = 2005; y <= 2025; y++) {
    let i = idx.get(`${y}-${k.ref}`);
    if (i == null) continue;
    const acum = [0, 0, 0, 0];
    let completo = true;
    for (let f = 0; f < 4 && completo; f++) {
      for (let n = 0; n < k.L[f]; n++) {
        if (i >= d.time.length) { completo = false; break; }
        acum[f] += gdd(i, k.tbase); i++;
      }
    }
    if (!completo) continue;
    acum.forEach((v, f) => porFase[f].push(v));
    totales.push(acum.reduce((a, b) => a + b, 0));
  }
  const med = porFase.map(a => Math.round(mediana(a)));
  const tot = med.reduce((a, b) => a + b, 0);
  salida[nombre] = { tbase: k.tbase, gdd: med };
  filas.push({ nombre, k, med, tot, p10: Math.round(pct(totales, 0.1)),
               p90: Math.round(pct(totales, 0.9)), n: totales.length });
}

if (process.argv.includes("--json")) {
  for (const { nombre, med, k } of filas) {
    console.log(`    ${(nombre + ":").padEnd(11)}{ tbase: ${String(k.tbase).padStart(4)}, gdd: [${med.map(v => String(v).padStart(3)).join(", ")}] },`);
  }
} else {
  console.log(`Grados-día por fase · ${LAT}N ${LON}E · ${DESDE.slice(0,4)}-${HASTA.slice(0,4)} · mediana de ${filas[0]?.n ?? 0} años\n`);
  console.log("cultivo      Tbase  ciclo(d)  ini + des + med + fin =  total   P10–P90   referencia FAO-56 Tabla 11");
  for (const f of filas) {
    const ciclo = f.k.L.reduce((a, b) => a + b, 0);
    console.log(
      `${f.nombre.padEnd(11)} ${String(f.k.tbase).padStart(5)} ${String(ciclo).padStart(8)}  ` +
      `${f.med.map(v => String(v).padStart(3)).join(" + ")} = ${String(f.tot).padStart(6)}   ` +
      `${String(f.p10).padStart(4)}–${String(f.p90).padStart(4)}   ${f.k.fao}`);
  }
  const c = filas.find(f => f.nombre === "cebolla");
  if (c) console.log(
    `\nValidación rápida: la cebolleta de El Tros de l'Uri acumuló 1061 °C·día en su ciclo real\n` +
    `(24-jun → 12-ago de 2026). La tabla pide ${c.tot}: ${Math.abs(1061 - c.tot)} °C·día de diferencia, ` +
    `unos 3 días.\nEse ciclo NO entra en esta derivación — es la comprobación, no el ajuste.`);
}
