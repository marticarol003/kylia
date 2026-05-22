// Convierte docs/estrategia/vision-y-roadmap.html a PDF con Puppeteer.
// Uso: node scripts/build_estrategia_pdf.mjs
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root      = path.resolve(__dirname, "..");
const htmlPath  = path.join(root, "docs/estrategia/vision-y-roadmap.html");
const pdfPath   = path.join(root, "docs/estrategia/Kylia-vision-y-roadmap.pdf");

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const page = await browser.newPage();
await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0" });
await page.pdf({
  path: pdfPath,
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
});
await browser.close();
console.log(`PDF generado en: ${pdfPath}`);
