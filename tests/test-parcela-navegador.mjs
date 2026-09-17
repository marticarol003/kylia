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
// SIGPAC falso: se simula el TRANSPORTE, no la lógica. Las geometrías miden de
// verdad lo que declaran —un cuadrado de 72,3 m de lado son 5.226 m²—, porque
// desde el cierre de los agujeros la superficie que se enseña sale del CONTORNO
// y no del campo `superficie_m2`. El fixture anterior declaraba 5.226 con un
// polígono de 111.673 m², y el test lo cazó.
const LAT0 = 41.324, LON0 = 2.060;
const mLat = (m) => m / 111320, mLon = (m) => m / 83600;
const cuadrado = (x0, y0, lado) => [[
  [LON0 + mLon(x0),        LAT0 + mLat(y0)],
  [LON0 + mLon(x0 + lado), LAT0 + mLat(y0)],
  [LON0 + mLon(x0 + lado), LAT0 + mLat(y0 + lado)],
  [LON0 + mLon(x0),        LAT0 + mLat(y0 + lado)],
  [LON0 + mLon(x0),        LAT0 + mLat(y0)],
]];
const RECINTOS = { recintos: [
  { referencia: "R1", superficie_m2: 5226, uso: "TA", satelite: true,
    geometria: { type: "Polygon", coordinates: cuadrado(0, 0, 72.3) } },
  { referencia: "R2", superficie_m2: 900, uso: "TA", satelite: false,
    geometria: { type: "Polygon", coordinates: cuadrado(120, 0, 30) } },
  // Una parcela en dos trozos: Kylia todavía no sabe gestionarla y el
  // agricultor no debe poder confirmarla.
  { referencia: "R3", superficie_m2: 1800, uso: "TA", satelite: false,
    geometria: { type: "MultiPolygon", coordinates: [cuadrado(0, 120, 30), cuadrado(60, 120, 30)] } },
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

    // R3 es un MultiPolygon: Kylia todavía no sabe gestionarlo y no debe
    // dejarse confirmar. Antes se quedaba con su primer trozo en silencio.
    const caminos = document.querySelectorAll("#pc-mapa path");
    caminos[caminos.length - 1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await sleep(300);
    o.multiTxt = $("pc-sel-txt").textContent;
    o.multiBloqueado = $("pc-confirmar").disabled === true;

    document.querySelectorAll("#pc-mapa path")[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await sleep(300);
    o.selTxt = $("pc-sel-txt").textContent;
    o.confirmarActivo = $("pc-confirmar").disabled === false;
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

    // ── §10 · los bloqueos, moviendo el contorno de verdad ──────────────
    // Se añade un TERCER cultivo y se le mueve el contorno encima del primero y
    // luego fuera de la parcela, comprobando que el botón de seguir se apaga y
    // la nota lo explica. Se manipula el estado del flujo con las mismas
    // funciones que usa el arrastre (KyliaGeo), no un doble.
    clic("#pc-otro"); await sleep(200);
    const t3 = $("pc-cultivo-txt");
    t3.value = "Espinaca"; t3.dispatchEvent(new Event("input", { bubbles: true })); await sleep(150);
    clic("#pc-b-cultivo"); await sleep(1400);
    o.tercerValido = $("pc-b-sup").disabled === false;
    o.tercerNota = $("pc-sup-nota").textContent;

    // ENCIMA del primer cultivo (que ocupa media parcela desde el borde oeste).
    const f = window.__PCF();
    const primero = f.cultivos[0].geometria;
    window.__pcPonerContorno(JSON.parse(JSON.stringify(primero)));
    await sleep(300);
    o.solapeBloqueado = $("pc-b-sup").disabled === true;
    o.solapeNota = $("pc-sup-nota").textContent;

    // FUERA de la parcela: se desplaza el contorno medio grado al este.
    const parc = f.parcela.geometria;
    const anillo = window.KyliaGeo.anilloExterior(parc);
    const fuera = { type: "Polygon", coordinates: [[...anillo.map(([lo, la]) => [lo + 0.01, la]),
                                                    [anillo[0][0] + 0.01, anillo[0][1]]]] };
    window.__pcPonerContorno(fuera);
    await sleep(300);
    o.fueraBloqueado = $("pc-b-sup").disabled === true;
    o.fueraNota = $("pc-sup-nota").textContent;

    // Y de vuelta a un sitio válido: el bloqueo no es permanente.
    window.__pcPonerContorno(null);
    await sleep(700);
    o.recuperado = $("pc-b-sup").disabled === false;

    // Se termina el tercero, para comprobar que tres cultivos conviven.
    clic("#pc-b-sup"); await sleep(200);
    clic("#pc-cuando [data-hace='5']"); await sleep(100);
    clic("#pc-b-fecha"); await sleep(200);
    clic("#pc-metodo [data-metodo='surco']"); await sleep(150);
    o.surcoSinCapacidad = $("pc-nolose-caja").hidden === true;
    clic("#pc-b-riego"); await sleep(1000);
    o.lista3 = $("pc-lista").textContent.replace(/\s+/g, " ").trim();

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
  ok(r.recintosPintados === 3,
     `los ${r.recintosPintados} recintos de la zona salen dibujados sin pedir ninguna acción rara`);
  ok(/Toca la que trabajas/.test(r.notaMapa), "y se le dice qué hacer con ellos");
  // La superficie que se enseña sale del CONTORNO, que es la que usan el
  // reparto y el satélite — no el campo declarado por SIGPAC.
  ok(/5\.?2\d\d m²/.test(r.selTxt), `al tocar uno se resalta y enseña su superficie: "${r.selTxt}"`);
  ok(r.confirmarActivo === true, "y se puede confirmar");
  ok(r.multiBloqueado === true,
     "una parcela en varios trozos (MultiPolygon) NO se puede confirmar");
  ok(/todavía no puede gestionar/.test(r.multiTxt), `y se le dice por qué: "${r.multiTxt}"`);
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
  // "Sin configurar" y no "sin asignar": esa superficie puede tener otros
  // cultivos que el agricultor no quiere registrar en Kylia, y llamarla "sin
  // asignar" da a entender que está vacía.
  ok(/Lechuga/.test(r.lista1) && /Sin configurar/.test(r.lista1),
     `el resumen se pinta: "${r.lista1}"`);
  ok(r.solapaEvitado === true,
     "el contorno del SEGUNDO cultivo nace en un hueco libre, no encima del primero");
  ok(/Lechuga/.test(r.lista2) && /Alcachofa/.test(r.lista2), "y los dos salen en la lista");
  ok(/sin recomendación/.test(r.lista2), "con la alcachofa marcada como sin recomendación");
  ok(r.fecha1 !== r.fecha2, `dos fechas distintas (${r.fecha1} / ${r.fecha2})`);

  console.log("\n── lo que queda guardado ──");
  ok(r.cerrado === true && r.zonas === 1 && r.ref === "R1", "una parcela guardada");
  ok(r.siembras.length === 3, `con sus tres cultivos (${r.siembras.length})`);
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

  console.log("\n── §10 · se bloquea lo imposible, arrastrando de verdad ──");
  ok(r.tercerValido === true, `un tercer cultivo nace en sitio válido: "${r.tercerNota}"`);
  ok(r.solapeBloqueado === true, "moverlo ENCIMA de otro cultivo apaga el botón de seguir");
  ok(/pisa con otro cultivo/.test(r.solapeNota), `y lo explica: "${r.solapeNota}"`);
  ok(r.fueraBloqueado === true, "sacarlo de la parcela, también");
  ok(/sale de tu parcela/i.test(r.fueraNota), `y lo explica: "${r.fueraNota}"`);
  ok(r.recuperado === true, "y al volver a un sitio válido se puede seguir: el bloqueo no es permanente");
  ok(r.surcoSinCapacidad === true, "a surco no se le pregunta capacidad: su orden va en L/m²");
  ok(/Espinaca/.test(r.lista3), `y los tres salen en la lista: "${r.lista3}"`);

  console.log("\n── sin errores de JavaScript ──");
  ok(errores.length === 0, `0 errores de página (${errores.length ? errores.join(" · ") : "0"})`);
} finally {
  await nav.close();
  srv.close();
}

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
