import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const MOCKUPS = [
  { src: 'scripts/mockups/mobile.html',    out: 'assets/img/product-mobile.png',    w: 620,  h: 940  },
  { src: 'scripts/mockups/desktop.html',   out: 'assets/img/product-desktop.png',   w: 1600, h: 1000 },
  { src: 'scripts/mockups/dashboard.html', out: 'assets/img/product-dashboard.png', w: 1400, h: 900  },
];

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();

for (const m of MOCKUPS) {
  const srcPath = path.resolve(root, m.src);
  const outPath = path.resolve(root, m.out);

  await page.setViewport({ width: m.w, height: m.h, deviceScaleFactor: 2 });
  await page.goto(`file://${srcPath}`, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: m.w, height: m.h } });
  console.log(`✓  ${m.out}`);
}

await browser.close();
console.log('Done.');
