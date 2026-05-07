import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FILES = [
  'docs/marketing/contenido/semana-1/imagenes/1-lunes-anuncio',
  'docs/marketing/contenido/semana-1/imagenes/3-viernes-pricing',
  'docs/marketing/contenido/semana-2/imagenes/1-lunes-caso-coop',
  'docs/marketing/contenido/semana-2/imagenes/2-miercoles-vs-excel',
];

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();

for (const f of FILES) {
  const svgPath = path.resolve(__dirname, '..', `${f}.svg`);
  const pngPath = path.resolve(__dirname, '..', `${f}.png`);
  const svg = fs.readFileSync(svgPath, 'utf8');

  // Detect viewBox size
  const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  const w = vb ? +vb[1] : 1080;
  const h = vb ? +vb[2] : 1080;

  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
  await page.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0;background:#fff">${svg}</body></html>`, { waitUntil: 'domcontentloaded' });

  await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: w, height: h } });
  console.log(`✓ ${path.basename(pngPath)}`);
}

await browser.close();
