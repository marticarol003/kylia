// Los tests de navegador NO salen a internet.
//
// POR QUÉ EXISTE. `test-capacidad-fuentes-nuevas` simulaba `getJSON` mientras el
// código pedía por `fetchConTimeout`: sin darnos cuenta estaba consultando
// Open-Meteo y SoilGrids de verdad, y salía verde o rojo según la red. Lo mismo
// pasa en el navegador con Leaflet, que la app carga desde unpkg: si unpkg tarda,
// no hay mapa, no hay recintos que tocar y el test revienta en un sitio que no
// tiene nada que ver con lo que estaba probando.
//
// Un test que depende de la red no prueba lo que dice probar: prueba la red.
//
// Aquí se sirve Leaflet desde una copia local —byte a byte la misma, los SRI de
// app/index.html siguen validando— y se ANOTA cualquier otra petición que
// intente salir, para que un despiste así no vuelva a pasar en silencio.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const LEAFLET_JS  = readFileSync(join(AQUI, "vendor", "leaflet-1.9.4.js"));
const LEAFLET_CSS = readFileSync(join(AQUI, "vendor", "leaflet-1.9.4.css"));

// Las teselas del mapa son fotos: no hacen falta para que Leaflet dibuje los
// polígonos, que es lo que miran los tests. Se cortan y no cuentan como fuga.
const COSMETICO = /arcgisonline\.com|tile\.openstreetmap|\.png($|\?)|\.jpg($|\?)|favicon/i;

/**
 * Corta la red de una página de puppeteer.
 * Devuelve `fugas()`, la lista de URLs externas que intentaron salir.
 */
export async function sinRed(pag) {
  const fugas = [];
  await pag.setRequestInterception(true);
  pag.on("request", (req) => {
    const url = req.url();
    if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")
        || url.startsWith("data:") || url.startsWith("blob:")) return req.continue();
    // ⚠️ CON CORS. La app carga Leaflet con `crossorigin="anonymous"` (para que
    // el SRI pueda comprobarse), así que sin `Access-Control-Allow-Origin` el
    // navegador descarta el script y no hay mapa. El SRI sigue validando: son
    // exactamente los mismos bytes que sirve unpkg.
    const cors = { "Access-Control-Allow-Origin": "*" };
    if (/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.js/.test(url)) {
      return req.respond({ status: 200, contentType: "text/javascript", headers: cors, body: LEAFLET_JS });
    }
    if (/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.css/.test(url)) {
      return req.respond({ status: 200, contentType: "text/css", headers: cors, body: LEAFLET_CSS });
    }
    if (COSMETICO.test(url)) return req.abort();
    fugas.push(url);
    return req.abort();
  });
  return () => fugas.slice();
}
