// El alta de parcela con varios cultivos, EJECUTADA en un navegador.
//   node tests/test-parcela-navegador.mjs
//
// tests/test-parcela-cultivos.mjs prueba el reparto, la geometría y el catálogo
// sin DOM. Esto prueba lo otro: que las pantallas existan, se encadenen y
// guarden. Es donde aparecieron los tres fallos que ningún test de fuente
// habría visto:
//
//   · `NOMBRE_METODO` vivía dentro del IIFE del alta, así que el resumen del
//     asistente reventaba y la lista de cultivos salía EN BLANCO — sin romper la
//     página, o sea en silencio.
//   · el contorno propuesto se dibujaba sin calcular su superficie, así que
//     "Seguir" no se encendía nunca a menos que arrastrases una esquina.
//   · el contorno del SEGUNDO cultivo nacía encima del primero: el solape se
//     detectaba bien, pero el flujo se quedaba encallado sin decir por qué.
import { readFileSync, existsSync } from "fs";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join, extname } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

let puppeteer = null;
try { puppeteer = (await import(join(RAIZ, "node_modules", "puppeteer", "lib", "esm", "puppeteer", "puppeteer.js"))).default; }
catch (_) { /* la CI corre sin dependencias */ }
if (!puppeteer) {
  console.log("  ⏭  omitida: puppeteer no está instalado (la CI corre sin dependencias).");
  process.exit(0);
}

// SIGPAC falso: dos recintos contiguos. Se simula el TRANSPORTE, no la lógica.
const RECINTOS = { recintos: [
  { referencia: "R1", superficie_m2: 5226, uso: "TA", satelite: true,
    geometria: { type: "Polygon", coordinates: [[[2.060, 41.324], [2.064, 41.324], [2.064, 41.327], [2.060, 41.327], [2.060, 41.324]]] } },
  { referencia: "R2", superficie_m2: 900, uso: "TA", satelite: false,
    geometria: { type: "Polygon", coordinates: [[[2.065, 41.324], [2.067, 41.324], [2.067, 41.326], [2.065, 41.326], [2.065, 41.324]]] } },
], umbral_satelite_m2: 5000 };

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const srv = createServer((req, res) => {
  const u = req.url.split("?")[0];
  if (u.startsWith("/api/sigpac")) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(RECINTOS)); }
  if (u.startsWith("/api/")) { res.writeHead(404); return res.end("{}"); }
  const f = (u === "/app" || u === "/") ? join(RAIZ, "app", "index.html") : join(RAIZ, u);
  if (!f.startsWith(RAIZ) || !existsSync(f) || f.endsWith("/")) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": MIME[extname(f)] || "text/plain" });
  res.end(readFileSync(f));
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;

const nav = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
const pag = await nav.newPage();
const errores = [];
pag.on("pageerror", e => errores.push(e.message));

try {
  await pag.goto(`http://127.0.0.1:${port}/app`, { waitUntil: "domcontentloaded" });
  await pag.evaluate(() => {
    localStorage.setItem("kylia_user_email", "prueba@kylia.app");
    localStorage.setItem("kylia_config", JSON.stringify({ lat: 41.3255, lon: 2.062, suelo: "franco", cultivos: [] }));
  });
  await pag.goto(`http://127.0.0.1:${port}/app`, { waitUntil: "networkidle2", timeout: 30000 });

  const r = await pag.evaluate(async () => {
    const o = {}, $ = (id) => document.getElementById(id);
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const clic = (sel) => { const e = document.querySelector(sel); if (!e) return false; e.click(); return true; };
    const paso = () => document.querySelector("#pc .alta-paso.activo")?.dataset?.pc;

    o.modulos = [typeof window.KyliaCultivos, typeof window.KyliaParcela, typeof window.KyliaGeo].join(",");
    o.puertas = [typeof window.kyliaParcelaNueva, typeof window.kyliaCultivoNuevo].join(",");
    window.kyliaParcelaNueva({ lat: 41.3255, lon: 2.062 });
    await sleep(1800);
    o.abierto = $("pc").hidden === false;
    o.paso0 = paso();
    o.recintosPintados = document.querySelectorAll("#pc-mapa path").length;
    o.notaMapa = $("pc-mapa-nota").textContent;

    document.querySelectorAll("#pc-mapa path")[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await sleep(300);
    o.selTxt = $("pc-sel-txt").textContent;
    clic("#pc-confirmar"); await sleep(200);
    o.trasConfirmar = paso();

    clic("[data-cuantos='varios']"); await sleep(200);
    o.trasCuantos = paso();

    const txt = $("pc-cultivo-txt");
    txt.value = "le"; txt.dispatchEvent(new Event("input", { bubbles: true })); await sleep(150);
    o.sugerencias = [...document.querySelectorAll("#pc-sug button")].map(b => b.textContent.trim()).slice(0, 3);
    document.querySelector("#pc-sug [data-cid='lechuga']").click(); await sleep(100);
    o.notaSoportado = $("pc-cultivo-nota").textContent;
    clic("#pc-b-cultivo"); await sleep(1400);
    o.trasCultivo = paso();
    o.areaPropuesta = window.__PCF()?.borrador?.area_m2 ?? null;
    o.botonSup = $("pc-b-sup").disabled;
    clic("#pc-b-sup"); await sleep(200);
    o.trasSup = paso();

    clic("#pc-cuando [data-hace='21']"); await sleep(100);
    o.fecha1 = window.__PCF()?.borrador?.fechaPlantacion;
    clic("#pc-b-fecha"); await sleep(200);
    o.trasFecha = paso();

    clic("#pc-metodo [data-metodo='goteo']"); await sleep(100);
    o.g = [!$("pc-g1").hidden, !$("pc-g2").hidden, !$("pc-g3").hidden];
    clic("#pc-gq [data-q='2']"); await sleep(80);   o.g2 = !$("pc-g2").hidden;
    clic("#pc-gsep [data-sep='0.3']"); await sleep(80); o.g3 = !$("pc-g3").hidden;
    clic("#pc-glin [data-lin='1']"); await sleep(80);
    o.riegoRes = $("pc-riego-res").textContent;
    o.tecnicoOculto = $("pc-tecnico").hidden;
    o.tecnico = $("pc-tecnico-txt").textContent;
    clic("#pc-b-riego"); await sleep(1000);
    o.trasRiego = paso();
    o.lista1 = $("pc-lista").textContent.replace(/\s+/g, " ").trim();

    clic("#pc-otro"); await sleep(200);
    const t2 = $("pc-cultivo-txt");
    t2.value = "Alcachofa"; t2.dispatchEvent(new Event("input", { bubbles: true })); await sleep(150);
    o.notaNoSoportado = $("pc-cultivo-nota").textContent;
    clic("#pc-b-cultivo"); await sleep(1400);
    o.solapaEvitado = $("pc-b-sup").disabled === false;
    clic("#pc-b-sup"); await sleep(200);
    clic("#pc-cuando [data-hace='50']"); await sleep(100);
    o.fecha2 = window.__PCF()?.borrador?.fechaPlantacion;
    clic("#pc-b-fecha"); await sleep(200);
    clic("#pc-metodo [data-metodo='aspersion']"); await sleep(100);
    o.vasoVisible = !$("pc-vaso").hidden; o.goteoOculto = $("pc-g1").hidden;
    clic("#pc-cm [data-cm='0.5']"); await sleep(100);
    clic("#pc-b-riego"); await sleep(1000);
    o.lista2 = $("pc-lista").textContent.replace(/\s+/g, " ").trim();

    clic("#pc-listo"); await sleep(400);
    o.cerrado = $("pc").hidden === true;
    const zonas = JSON.parse(localStorage.getItem("kylia_zonas") || "[]");
    o.zonas = zonas.length;
    o.ref = zonas[0]?.referencia;
    o.siembras = (zonas[0]?.siembras || []).map(s => ({
      cultivo: s.cultivo, area: s.area_m2, fecha: s.fechaPlantacion, metodo: s.metodoRiego,
      caudal: s.caudal, fuente: s.riego?.fuente, geom: !!s.geometria, id: !!s.id, token: !!s.sync?.token,
    }));
    return o;
  });

  console.log("── el mapa se abre con los recintos YA dibujados ──");
  ok(r.modulos === "object,object,object", "los tres módulos están cargados");
  ok(r.puertas === "function,function", "las dos puertas existen (parcela nueva y cultivo nuevo)");
  ok(r.abierto === true && r.paso0 === "parcela", "el asistente abre por el mapa");
  ok(r.recintosPintados === 2,
     `los ${r.recintosPintados} recintos de la zona salen dibujados sin pedir ninguna acción rara`);
  ok(/Toca la que trabajas/.test(r.notaMapa), "y se le dice qué hacer con ellos");
  ok(/5226 m²/.test(r.selTxt), `al tocar uno se resalta y enseña su superficie: "${r.selTxt}"`);
  ok(r.trasConfirmar === "cuantos", "confirmar lleva a \"¿cuántos cultivos?\"");
  ok(r.trasCuantos === "cultivo", "y \"más de uno\" entra directo al primer cultivo");

  console.log("\n── buscador de cultivos ──");
  ok(r.sugerencias[0] === "Lechuga", `escribir "le" propone Lechuga primero (${r.sugerencias.join(" · ")})`);
  ok(/sabemos calcular el riego/.test(r.notaSoportado), "un cultivo soportado lo dice");
  ok(/Todavía no sabemos calcular su riego/.test(r.notaNoSoportado),
     "y uno que el motor no conoce SE REGISTRA, avisando de que no habrá recomendación");
  ok(!/parecido|similar/.test(r.notaNoSoportado), "sin ofrecerle el Kc de un cultivo parecido");

  console.log("\n── superficie: el contorno nace usable ──");
  ok(r.trasCultivo === "superficie", "se pasa a marcar qué parte ocupa");
  ok(r.areaPropuesta > 0, `el contorno propuesto TRAE su superficie (${r.areaPropuesta} m²)`);
  ok(r.botonSup === false, "así que se puede seguir sin arrastrar nada");
  ok(r.trasSup === "fecha", "y se avanza");

  console.log("\n── una pregunta cada vez en el riego ──");
  ok(r.trasFecha === "riego", "tras la fecha, el riego");
  ok(JSON.stringify(r.g) === "[true,false,false]",
     "al elegir goteo solo aparece la PRIMERA pregunta, no las tres de golpe");
  ok(r.g2 === true && r.g3 === true, "cada respuesta destapa la siguiente");
  ok(/Ya podemos calcular/.test(r.riegoRes), "y al final se le dice que ya está");
  ok(r.tecnicoOculto === false && /6\.7 L\/m² cada hora/.test(r.tecnico),
     "los mm/h quedan en \"detalles técnicos\", no como concepto principal");
  ok(r.vasoVisible === true && r.goteoOculto === true,
     "con aspersión se pregunta por el vaso y desaparecen las del goteo");

  console.log("\n── dos cultivos en la misma parcela ──");
  ok(r.trasRiego === "resumen", "guardar un cultivo lleva al resumen");
  ok(/Lechuga/.test(r.lista1) && /Sin asignar/.test(r.lista1),
     `el resumen se pinta: "${r.lista1}"`);
  ok(r.solapaEvitado === true,
     "el contorno del SEGUNDO cultivo nace en un hueco libre, no encima del primero");
  ok(/Lechuga/.test(r.lista2) && /Alcachofa/.test(r.lista2), "y los dos salen en la lista");
  ok(/sin recomendación/.test(r.lista2), "con la alcachofa marcada como sin recomendación");
  ok(r.fecha1 !== r.fecha2, `dos fechas distintas (${r.fecha1} / ${r.fecha2})`);

  console.log("\n── lo que queda guardado ──");
  ok(r.cerrado === true && r.zonas === 1 && r.ref === "R1", "una parcela guardada");
  ok(r.siembras.length === 2, `con sus dos cultivos (${r.siembras.length})`);
  const [a, b] = r.siembras;
  ok(a.cultivo === "lechuga" && b.cultivo.startsWith("otro:"),
     "el soportado con su id canónico, el otro marcado como tal");
  ok(a.area > 0 && b.area > 0 && a.area !== b.area, `superficies propias (${a.area} / ${b.area} m²)`);
  ok(a.fecha !== b.fecha, "fechas propias");
  ok(a.metodo === "goteo" && b.metodo === "aspersion", "métodos propios");
  ok(a.caudal !== b.caudal, `caudales propios (${a.caudal} / ${b.caudal}) — sin contagiarse`);
  ok(a.fuente === "derivado_goteo" && b.fuente === "medido_vaso", "y su procedencia");
  ok(a.geom && b.geom, "cada uno con su contorno");
  ok(a.id && b.id && a.token && b.token,
     "y con id y token de sincronización: nacen por nuevaSiembra, como el resto de la app");

  console.log("\n── sin errores de JavaScript ──");
  ok(errores.length === 0, `0 errores de página (${errores.length ? errores.join(" · ") : "0"})`);
} finally {
  await nav.close();
  srv.close();
}

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
