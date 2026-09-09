#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────
// Un informe de piloto en HTML → PDF listo para enviar
// ─────────────────────────────────────────────────────────────────
//   node scripts/informe-a-pdf.mjs docs/pilotos/informe-oriol-2026-08.html
//   node scripts/informe-a-pdf.mjs <entrada.html> [salida.pdf]
//
// Se renderiza con el Chrome que ya trae puppeteer (dependencia de desarrollo),
// así el PDF sale exactamente igual que lo que se ve en pantalla — sin una
// segunda implementación del diseño que se desincronice.
//
// `printBackground` es obligatorio: sin él Chrome tira los fondos y la barra que
// enseña el ahorro sale en blanco, que es justo lo que el documento va a contar.
//
// Los márgenes van en el @page del CSS del informe, no aquí: cada documento sabe
// los suyos.
import { existsSync, readFileSync } from "fs";
import { resolve, basename } from "path";
import { pathToFileURL } from "url";

const entrada = process.argv[2];
if (!entrada) { console.error("uso: node scripts/informe-a-pdf.mjs <entrada.html> [salida.pdf]"); process.exit(1); }
const rutaEntrada = resolve(entrada);
if (!existsSync(rutaEntrada)) { console.error(`no existe: ${rutaEntrada}`); process.exit(1); }
const rutaSalida = resolve(process.argv[3] || rutaEntrada.replace(/\.html?$/i, ".pdf"));

const { default: puppeteer } = await import("puppeteer");
const navegador = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
try {
  const pagina = await navegador.newPage();
  const fallos = [];
  pagina.on("pageerror", e => fallos.push(e.message));
  // `networkidle0` y no `load`: las tipografías de Google llegan después del
  // load, y sin esperarlas el PDF sale con la fuente de reserva.
  await pagina.goto(pathToFileURL(rutaEntrada).href, { waitUntil: "networkidle0", timeout: 60000 });
  await pagina.evaluateHandle("document.fonts.ready");
  await pagina.pdf({ path: rutaSalida, format: "A4", printBackground: true, preferCSSPageSize: true });

  // Cuántas páginas tiene el PDF DE VERDAD, no cuántos bloques .hoja hay en el
  // HTML: si un bloque se pasa de alto, Chrome lo parte y aparece una página de
  // sobra con cuatro líneas sueltas. Contando divs eso no se ve — pasó con el
  // informe de Ferran, que salía "2 páginas" y eran 3, la última rota.
  const bytes = readFileSync(rutaSalida);
  const paginas = (bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  const bloques = await pagina.evaluate(() => document.querySelectorAll(".hoja").length);
  console.log(`✓ ${basename(rutaSalida)} · ${paginas || "?"} páginas (${bloques} bloques en el HTML)`);
  if (paginas && bloques && paginas !== bloques) {
    console.warn(`  ⚠️ descuadre: algún bloque no cabe en su página y Chrome lo ha partido.`);
    console.warn(`     Comprueba la altura: en A4 con estos márgenes caben ~1015 px.`);
  }
  if (fallos.length) console.warn("  ⚠️ errores de JS en el documento:", fallos.join(" | "));
} finally {
  await navegador.close();
}
