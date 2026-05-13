import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Genera rutas para instagram (s1d1-a, s1d1-b ... s2d7-b) y linkedin (s1d1 ... s2d7)
const igFiles = [];
const liFiles = [];
for (const semana of [1, 2]) {
  for (const dia of [1, 2, 3, 4, 5, 6, 7]) {
    igFiles.push(`docs/marketing/contenido/instagram/imagenes/s${semana}d${dia}-a`);
    igFiles.push(`docs/marketing/contenido/instagram/imagenes/s${semana}d${dia}-b`);
    liFiles.push(`docs/marketing/contenido/linkedin/imagenes/s${semana}d${dia}`);
  }
}

const FILES = [...igFiles, ...liFiles];

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();

for (const f of FILES) {
  const svgPath = path.resolve(__dirname, '..', `${f}.svg`);
  const pngPath = path.resolve(__dirname, '..', `${f}.png`);

  if (!fs.existsSync(svgPath)) {
    console.log(`⚠ no encontrado: ${path.basename(svgPath)}`);
    continue;
  }

  const svg = fs.readFileSync(svgPath, 'utf8');
  const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  const w = vb ? +vb[1] : 1080;
  const h = vb ? +vb[2] : 1080;

  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
  await page.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0;background:#071c0c">${svg}</body></html>`, { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: w, height: h } });
  console.log(`✓ ${path.basename(pngPath)}`);
}

await browser.close();
