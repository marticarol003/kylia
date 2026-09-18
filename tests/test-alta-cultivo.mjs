// El alta de un cultivo, EJECUTADA en Chrome a tamaño de móvil.
//   node tests/test-alta-cultivo.mjs
//
// tests/test-parcela-cultivos.mjs prueba el flujo sin DOM. Esto prueba lo otro:
// que las pantallas existan, se encadenen, guarden y sobrevivan a un reload.
// Es donde aparecieron los fallos que ningún test de fuente habría visto:
//
//   · pulsar dos veces "Guardar cultivo" creaba el cultivo DOS VECES — el guard
//     comparaba un `__altaId` que `nuevaSiembra` no copia, así que nunca casaba.
//   · el borrador no se borraba al guardar: `anotar()` lo volvía a escribir
//     justo después de borrarlo, y la app se ofrecía a "retomar" un alta hecha.
//   · la nota de superficie enseñaba los metros libres de ANTES del cultivo, así
//     que decía "ocupa 2.499 m² y te quedan 4.998", que no cuadra.
//   · "¿Dónde está lechuga?", sin artículo, sonaba a robot.
//
// Se simula el TRANSPORTE (SIGPAC y las llamadas de red), nunca la lógica: el
// flujo, la persistencia, la reconstrucción y la presentación son los reales.
import { readFileSync, existsSync } from "fs";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join, extname } from "path";
import { sinRed } from "./_sin-red.mjs";

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

// Tres terrenos: uno normal, uno CON AGUJERO y uno en varios trozos.
const LAT0 = 41.324, LON0 = 2.060, mLat = (m) => m / 111320, mLon = (m) => m / 83600;
const cuad = (x0, y0, l) => [[
  [LON0 + mLon(x0), LAT0 + mLat(y0)], [LON0 + mLon(x0 + l), LAT0 + mLat(y0)],
  [LON0 + mLon(x0 + l), LAT0 + mLat(y0 + l)], [LON0 + mLon(x0), LAT0 + mLat(y0 + l)],
  [LON0 + mLon(x0), LAT0 + mLat(y0)]]];
const conHueco = [cuad(200, 0, 70.7)[0], cuad(225, 25, 20)[0]];
const RECINTOS = { recintos: [
  { referencia: "R1", superficie_m2: 5000, uso: "TA", satelite: true,
    geometria: { type: "Polygon", coordinates: cuad(0, 0, 70.7) } },
  { referencia: "R2", superficie_m2: 4600, uso: "TA", satelite: true,
    geometria: { type: "Polygon", coordinates: conHueco } },
  { referencia: "R3", superficie_m2: 1800, uso: "TA", satelite: false,
    geometria: { type: "MultiPolygon", coordinates: [cuad(0, 200, 30), cuad(60, 200, 30)] } },
], umbral_satelite_m2: 5000 };

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const srv = createServer((q, r) => {
  const u = q.url.split("?")[0];
  if (u.startsWith("/api/sigpac")) { r.writeHead(200, { "Content-Type": "application/json" }); return r.end(JSON.stringify(RECINTOS)); }
  if (u.startsWith("/api/")) { r.writeHead(404); return r.end("{}"); }
  const f = (u === "/app" || u === "/") ? join(RAIZ, "app", "index.html") : join(RAIZ, u);
  if (!f.startsWith(RAIZ) || !existsSync(f) || f.endsWith("/")) { r.writeHead(404); return r.end("no"); }
  r.writeHead(200, { "Content-Type": MIME[extname(f)] || "text/plain" });
  r.end(readFileSync(f));
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;

const nav = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
const pag = await nav.newPage();
  await sinRed(pag);
// Tamaño de móvil real: es donde se usa esto, de pie y al sol.
await pag.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
const errores = [];
pag.on("pageerror", e => errores.push(e.message));

try {
  await pag.goto(`http://127.0.0.1:${port}/app`, { waitUntil: "domcontentloaded" });
  await pag.evaluate(() => {
    // ⚠️ UN DISPOSITIVO QUE CANJEÓ UN ENLACE, no uno que escribió un correo.
    // La marca la deja el canje de `?acceso=` y lleva dentro el propietario: es
    // lo único que permite saltarse la pantalla de identificación y decir
    // "guardado en tu cuenta". Escribir el correo no vale, y así debe ser.
    const PROP = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    localStorage.setItem("kylia_user_id", PROP);
    localStorage.setItem("kylia_acceso_verificado", JSON.stringify({ propietario_id: PROP, en: new Date().toISOString() }));
    localStorage.setItem("kylia_user_email", "prueba@kylia.app");
    // ⚠️ LA FINCA TIENE RIEGO PROPIO a propósito: aspersión y 11,2 mm/h. Si una
    // alta nueva que dice "lo indicaré después" lo hereda, se nota aquí.
    localStorage.setItem("kylia_config", JSON.stringify({ lat: 41.3255, lon: 2.062, suelo: "franco",
      cultivos: [], metodoRiego: "aspersion", caudal: 11.2 }));
  });
  await pag.goto(`http://127.0.0.1:${port}/app`, { waitUntil: "networkidle2", timeout: 30000 });

  const r = await pag.evaluate(async () => {
    const o={}, $=id=>document.getElementById(id), sleep=ms=>new Promise(r=>setTimeout(r,ms));
    try {
    const clic=s=>{const e=document.querySelector(s); if(!e||e.disabled) return false; e.click(); return true;};
    const paso=()=>document.querySelector("#pc .alta-paso.activo")?.dataset?.pc;
    const G = window.KyliaGeo;

    // ── CASO A · alta sencilla ──────────────────────────────────────────
    window.kyliaParcelaNueva({lat:41.3255,lon:2.062});
    await sleep(1600);
    o.A_paso0=paso(); o.A_recintos=document.querySelectorAll("#pc-mapa path").length;
    o.A_atrasOculto=$("pc-atras").hidden;
    document.querySelectorAll("#pc-mapa path")[0].dispatchEvent(new MouseEvent("click",{bubbles:true}));
    await sleep(250);
    o.A_sup=$("pc-sel-txt").textContent;
    clic("#pc-confirmar"); await sleep(200);
    o.A_paso1=paso(); o.A_atrasVisible=$("pc-atras").hidden===false;
    o.A_habituales=document.querySelectorAll("#pc-habituales .pc-cultivo").length;
    clic("#pc-habituales [data-cid='lechuga']"); await sleep(120);
    o.A_notaCult=$("pc-cultivo-nota").textContent;
    clic("#pc-b-cultivo"); await sleep(200);
    o.A_pasoVar=paso();
    clic("#pc-variedad-nose"); await sleep(100);
    clic("#pc-b-variedad"); await sleep(300);
    o.A_paso2=paso(); o.A_preg=$("pc-sup-preg").textContent;
    o.A_todoVisible=$("pc-todo").hidden===false;
    clic("#pc-parte"); await sleep(1300);
    o.A_area=window.__PCF()?.borrador?.area_m2;
    o.A_supNota=$("pc-sup-nota").textContent;
    clic("#pc-b-sup"); await sleep(250);
    o.A_paso3=paso(); o.A_fechaPreg=$("pc-fecha-preg").textContent;
    clic("#pc-cuando [data-hace='14']"); await sleep(150);
    o.A_fechaNota=$("pc-fecha-nota").textContent;
    o.A_precision=window.__PCF()?.borrador?.fechaPrecision;
    clic("#pc-b-fecha"); await sleep(250);
    o.A_paso4=paso();
    clic("#pc-metodo [data-metodo='goteo']"); await sleep(150);
    o.A_inst=document.querySelector("[data-preg='inst']").hidden===false;
    clic("#pc-inst-ahora"); await sleep(150);
    o.A_greg=document.querySelector("[data-preg='g-regular']").hidden===false;
    clic("#pc-g-regular [data-reg='regular']"); await sleep(120);
    o.A_g1=document.querySelector("[data-preg='g-q']").hidden===false; o.A_g2=document.querySelector("[data-preg='g-sep']").hidden===false;
    clic("#pc-gq [data-q='2']"); await sleep(80); clic("#pc-b-gq"); await sleep(120);
    o.A_g2b=document.querySelector("[data-preg='g-sep']").hidden===false;
    clic("#pc-gsep [data-sep='0.3']"); await sleep(80); clic("#pc-b-gsep"); await sleep(120);
    clic("#pc-glin [data-lin='1']"); await sleep(80); clic("#pc-b-glin"); await sleep(200);
    o.A_riegoRes=$("pc-riego-res").textContent; o.A_tecnico=$("pc-tecnico-txt").textContent;
    clic("#pc-b-riego"); await sleep(250);
    clic("#pc-b-revisar"); await sleep(900);
    o.A_paso5=paso(); o.A_tarjeta=$("pc-tarjeta").textContent.replace(/\s+/g," ").trim();
    o.A_titulo=$("pc-ok-tit").textContent;
    clic("#pc-listo"); await sleep(200);

    // ── CASO B · dos cultivos, mismo terreno, todo independiente ────────
    window.kyliaCultivoNuevo("R1"); await sleep(400);
    o.B_paso=paso(); o.B_conserva=window.__PCF()?.cultivos?.length;
    // §4 · ESCRIBIR NO CONFIRMA. A medio teclear no puede quedar elegido nada:
    // antes, "lechu" fijaba un `otro:lechu` sin Kc y el botón se encendía.
    $("pc-cultivo-txt").value="tomà";
    $("pc-cultivo-txt").dispatchEvent(new Event("input",{bubbles:true})); await sleep(180);
    o.B_aMedias=window.__PCF()?.borrador?.cultivoId;
    o.B_botonAMedias=$("pc-b-cultivo").disabled;
    o.B_sugerencias=[...document.querySelectorAll("#pc-sug button")].map(x=>x.textContent.trim());
    // Elegir de la lista sí confirma, y conserva el identificador canónico.
    $("pc-cultivo-txt").value="tomàquet";
    $("pc-cultivo-txt").dispatchEvent(new Event("input",{bubbles:true})); await sleep(180);
    clic("#pc-sug button[data-cid='tomate']"); await sleep(120);
    o.B_sinonimo=window.__PCF()?.borrador?.cultivoId;
    o.B_elegidoVisible=$("pc-elegido").hidden===false;
    o.B_elegidoTxt=$("pc-elegido-txt").textContent;
    clic("#pc-b-cultivo"); await sleep(200);
    clic("#pc-variedad-nose"); await sleep(100);
    clic("#pc-b-variedad"); await sleep(1300);
    o.B_todoOculto=$("pc-todo").hidden;                  // ya hay un cultivo → no se ofrece
    o.B_areaB=window.__PCF()?.borrador?.area_m2;
    o.B_leyenda=$("pc-leyenda").textContent.replace(/\s+/g," ").trim();
    clic("#pc-b-sup"); await sleep(250);
    clic("#pc-cuando [data-hace='5']"); await sleep(150);
    clic("#pc-b-fecha"); await sleep(250);
    clic("#pc-metodo [data-metodo='aspersion']"); await sleep(150);
    clic("#pc-inst-ahora"); await sleep(150);
    // §8B · la primera pregunta de aspersión es fijos/móviles, y SOLO esas dos.
    o.B_fijosQ=document.querySelector("[data-preg='a-fijos']").hidden===false;
    o.B_fijosOpciones=[...document.querySelectorAll("#pc-a-fijos .pc-opcion")].map(x=>x.textContent.trim());
    clic("#pc-a-fijos [data-fijos='1']"); await sleep(120);
    clic("#pc-a-regular [data-reg='regular']"); await sleep(120);
    $("pc-aq-txt").value="900"; $("pc-aq-txt").dispatchEvent(new Event("input",{bubbles:true}));
    await sleep(80); clic("#pc-b-aq"); await sleep(120);
    $("pc-asep-txt").value="12"; $("pc-asep-txt").dispatchEvent(new Event("input",{bubbles:true}));
    await sleep(80); clic("#pc-b-asep"); await sleep(120);
    $("pc-alin-txt").value="12"; $("pc-alin-txt").dispatchEvent(new Event("input",{bubbles:true}));
    await sleep(80); clic("#pc-b-alin"); await sleep(200);
    o.B_tecnico=$("pc-tecnico-txt").textContent;
    clic("#pc-b-riego"); await sleep(250);
    clic("#pc-b-revisar"); await sleep(900);
    clic("#pc-listo"); await sleep(200);

    const zonas=()=>JSON.parse(localStorage.getItem("kylia_zonas")||"[]");
    const s1=zonas()[0]?.siembras||[];
    o.B_siembras=s1.map(s=>({c:s.cultivo,a:s.area_m2,f:s.fechaPlantacion,p:s.fechaPrecision,
      m:s.metodoRiego,q:s.caudal,fu:s.riego?.fuente,g:!!s.geometria,id:!!s.id,tok:!!s.sync?.token}));
    o.B_areasCoinciden=s1.every(s=>s.area_m2===G.areaDePolygon(s.geometria));
    o.B_sinSolape=!G.seSolapan(s1[0].geometria,s1[1].geometria);

    // ── CASO C · pendientes ────────────────────────────────────────────
    window.kyliaCultivoNuevo("R1"); await sleep(400);
    clic("#pc-habituales [data-cid='cebolla']"); await sleep(120);
    clic("#pc-b-cultivo"); await sleep(200);
    clic("#pc-variedad-nose"); await sleep(100);
    clic("#pc-b-variedad"); await sleep(1300);
    clic("#pc-b-sup"); await sleep(250);
    clic("#pc-sin-fecha"); await sleep(150);
    o.C_notaSinFecha=$("pc-fecha-nota").textContent;
    clic("#pc-b-fecha"); await sleep(250);
    clic("#pc-metodo [data-metodo='goteo']"); await sleep(150);
    clic("#pc-inst-luego"); await sleep(150);
    o.C_notaInstLuego=$("pc-riego-res").textContent;
    clic("#pc-b-riego"); await sleep(250);
    clic("#pc-b-revisar"); await sleep(900);
    o.C_tarjeta=$("pc-tarjeta").textContent.replace(/\s+/g," ").trim();
    const sc=zonas()[0].siembras.slice(-1)[0];
    o.C_fecha=sc.fechaPlantacion; o.C_caudal=sc.caudal; o.C_fuente=sc.riego?.fuente;
    o.C_clase=window.KyliaRiego.evaluarCapacidadRiego(sc.riego,sc.metodoRiego).clase;
    clic("#pc-listo"); await sleep(200);

    // ── CASO E · cultivo libre ─────────────────────────────────────────
    window.kyliaCultivoNuevo("R1"); await sleep(400);
    $("pc-cultivo-txt").value="quinoa";
    $("pc-cultivo-txt").dispatchEvent(new Event("input",{bubbles:true})); await sleep(180);
    // Lo que no está en el catálogo se ofrece explícitamente como texto libre.
    o.E_opcionLibre=!!document.querySelector("#pc-sug button[data-libre]");
    clic("#pc-sug button[data-libre]"); await sleep(150);
    o.E_nota=$("pc-cultivo-nota").textContent;
    clic("#pc-b-cultivo"); await sleep(200);
    clic("#pc-variedad-nose"); await sleep(100);
    clic("#pc-b-variedad"); await sleep(1300);
    clic("#pc-b-sup"); await sleep(250);
    clic("#pc-cuando [data-hace='30']"); await sleep(150);
    clic("#pc-b-fecha"); await sleep(250);
    clic("#pc-riego-luego"); await sleep(150);
    clic("#pc-b-riego"); await sleep(250);
    clic("#pc-b-revisar"); await sleep(900);
    o.E_tarjeta=$("pc-tarjeta").textContent.replace(/\s+/g," ").trim();
    const sq=zonas()[0].siembras.slice(-1)[0];
    o.E_id=sq.cultivo; o.E_kc=window.KyliaMotor.FAO_KC[sq.cultivo]===undefined;
    o.E_metodo=sq.metodoRiego;
    clic("#pc-listo"); await sleep(200);

    // ── CASO D · terreno parcialmente gestionado ───────────────────────
    o.D_reparto=window.KyliaParcela.reparto(
      {superficie_m2:G.areaDePolygon(zonas()[0].geometria)}, zonas()[0].siembras);

    // ── CASO F · terreno CON AGUJEROS ──────────────────────────────────
    window.kyliaParcelaNueva({lat:41.3255,lon:2.062}); await sleep(1600);
    const caminos=[...document.querySelectorAll("#pc-mapa path")];
    // R2 es el del agujero (segundo recinto)
    caminos[1].dispatchEvent(new MouseEvent("click",{bubbles:true})); await sleep(250);
    o.F_sup=$("pc-sel-txt").textContent;
    clic("#pc-confirmar"); await sleep(250);
    clic("#pc-habituales [data-cid='pimiento']"); await sleep(120);
    clic("#pc-b-cultivo"); await sleep(200);
    clic("#pc-variedad-nose"); await sleep(100);
    clic("#pc-b-variedad"); await sleep(400);
    o.F_todoVisible=$("pc-todo").hidden===false;
    clic("#pc-todo"); await sleep(1300);
    o.F_anillos=(window.__PCF()?.borrador?.geometria?.coordinates||[]).length;
    o.F_area=window.__PCF()?.borrador?.area_m2;
    o.F_ayuda=$("pc-sup-ayuda").textContent;
    o.F_tiradores=document.querySelectorAll("#pc-mapa2 .tirador").length;
    clic("#pc-b-sup"); await sleep(250);
    clic("#pc-cuando [data-hace='5']"); await sleep(150);
    clic("#pc-b-fecha"); await sleep(250);
    clic("#pc-metodo [data-metodo='surco']"); await sleep(150);
    clic("#pc-b-riego"); await sleep(250);
    clic("#pc-b-revisar"); await sleep(900);
    clic("#pc-listo"); await sleep(250);
    const zR2=zonas().find(z=>z.referencia==="R2");
    o.F_guardado_anillos=(zR2?.siembras?.[0]?.geometria?.coordinates||[]).length;
    o.F_guardado_area=zR2?.siembras?.[0]?.area_m2;
    o.F_area_coincide=zR2?.siembras?.[0]?.area_m2===G.areaDePolygon(zR2.siembras[0].geometria);
    o.F_menor_que_exterior=G.areaDePolygon({type:"Polygon",coordinates:[zR2.geometria.coordinates[0]]})>o.F_guardado_area;

    // ── CASO G · interrupciones ────────────────────────────────────────
    window.kyliaCultivoNuevo("R1"); await sleep(400);
    clic("#pc-habituales [data-cid='calabacin']"); await sleep(120);
    clic("#pc-b-cultivo"); await sleep(200);
    clic("#pc-variedad-nose"); await sleep(100);
    clic("#pc-b-variedad"); await sleep(1300);
    clic("#pc-b-sup"); await sleep(250);
    clic("#pc-cuando [data-hace='5']"); await sleep(150);
    clic("#pc-b-fecha"); await sleep(250);
    o.G_pasoAntes=paso();
    // "atrás" no pierde lo contestado
    clic("#pc-atras"); await sleep(200);
    o.G_trasAtras=paso();
    o.G_conservaFecha=!!window.__PCF()?.borrador?.fechaPlantacion;
    o.G_conservaGeom=!!window.__PCF()?.borrador?.geometria;
    clic("#pc-b-fecha"); await sleep(250);
    // cerrar a media alta deja borrador
    clic("#pc-cerrar"); await sleep(250);
    o.G_hayBorrador=window.kyliaHayAltaPendiente();
    const antesDeRetomar=zonas()[0].siembras.length;
    o.G_noCreoSiembra=antesDeRetomar;
    // retomar
    o.G_retoma=window.kyliaAltaPendiente(); await sleep(300);
    o.G_pasoRetomado=paso();
    o.G_cultivoRetomado=window.__PCF()?.borrador?.cultivoId;
    clic("#pc-metodo [data-metodo='goteo']"); await sleep(150);
    clic("#pc-inst-luego"); await sleep(150);
    clic("#pc-b-riego"); await sleep(250);
    o.G_pasoRepaso=paso();
    o.G_repasoLineas=[...document.querySelectorAll("#pc-revision .pc-rev-fila")].length;
    o.G_repasoPend=$("pc-revisar-pend").textContent;
    // DOBLE PULSACIÓN en guardar
    $("pc-b-revisar").click(); $("pc-b-revisar").click(); await sleep(1000);
    o.G_trasDoble=zonas()[0].siembras.length;
    o.G_duplicados=o.G_trasDoble-antesDeRetomar;
    o.G_borradorBorrado=window.kyliaHayAltaPendiente()===false;
    clic("#pc-listo"); await sleep(200);

    o.H_zonas=zonas().length;
    o.H_total_siembras=zonas().reduce((n,z)=>n+(z.siembras||[]).length,0);

    // ── CASO I · "lo indicaré después" NO hereda el riego de la finca ───
    // La finca está en aspersión y 11,2 mm/h. Una lechuga recién dada de alta
    // que deja el riego para después no puede salir regando por aspersión.
    window.kyliaCultivoNuevo("R1"); await sleep(400);
    clic("#pc-habituales [data-cid='lechuga']"); await sleep(120);
    clic("#pc-b-cultivo"); await sleep(200);
    clic("#pc-variedad-nose"); await sleep(100);
    clic("#pc-b-variedad"); await sleep(1400);
    clic("#pc-b-sup"); await sleep(250);
    clic("#pc-cuando [data-hace='14']"); await sleep(150);   // plantada hace 2 semanas
    clic("#pc-b-fecha"); await sleep(250);
    clic("#pc-riego-luego"); await sleep(150);
    clic("#pc-b-riego"); await sleep(250);
    clic("#pc-b-revisar"); await sleep(1000);
    o.I_tarjeta=$("pc-tarjeta").textContent.replace(/\s+/g," ").trim();
    clic("#pc-listo"); await sleep(300);
    const sI=zonas()[0].siembras.slice(-1)[0];
    o.I_persistido={metodo:sI.metodoRiego,caudal:sI.caudal,pendiente:sI.riegoPendiente,
                    fuente:sI.riego?.fuente,registradoEl:sI.registradoEl,fecha:sI.fechaPlantacion};
    o.I_capacidad=window.KyliaRiego.capacidadVigente(sI,JSON.parse(localStorage.getItem("kylia_config")));
    // Balance con clima controlado: 20 días de ET₀ 4 mm y sin lluvia.
    const serie=[]; const ah=new Date();
    for(let k=19;k>=0;k--){const d=new Date(ah.getTime()-k*86400000);
      serie.push({date:d.toISOString().slice(0,10),et0:4,lluvia:0,tmax:26,tmin:15});}
    const bal=window.KyliaMotor.balanceHidrico(serie,[],{suelo:"franco",cultivoId:"lechuga",
      metodoRiego:sI.metodoRiego,fechaPlantacion:sI.fechaPlantacion,termico:false,
      ventana:{desde:sI.fechaPlantacion,hasta:serie[serie.length-1].date},
      historialDesde:sI.registradoEl});
    o.I_confianza=bal.confianzaBalance; o.I_previos=bal.aportesPreviosDesconocidos;
    o.I_lamina=window.KyliaMotor.decisionRiego(bal,{lluviaPrevista:[]}).cantidad_l_m2;
    } catch (e) { o.__error = e.message + " @ " + (e.stack||"").split("\n")[1]; }
    return o;
  });

  console.log("── CASO A · alta sencilla ──");
  ok(r.A_paso0 === "terreno", "arranca preguntando dónde tiene el huerto");
  ok(r.A_atrasOculto === true, "sin \"Atrás\" en la primera pantalla, que no lleva a ningún sitio");
  ok(r.A_recintos === 3, `los ${r.A_recintos} terrenos salen dibujados solos`);
  ok(/Son 4\.99\d m²/.test(r.A_sup),
     `y su superficie es secundaria, con separador de miles: "${r.A_sup}"`);
  ok(r.A_paso1 === "cultivo" && r.A_atrasVisible, "confirmar lleva al cultivo, con \"Atrás\" ya visible");
  ok(r.A_habituales === 6, "seis cultivos habituales con dibujo, más el buscador");
  ok(/Sabemos calcular el riego/.test(r.A_notaCult), "un cultivo soportado lo dice");
  ok(r.A_preg === "¿Dónde está la lechuga?", `pregunta por su nombre y con artículo: "${r.A_preg}"`);
  ok(r.A_todoVisible === true, "con el terreno vacío se ofrece usarlo entero");
  ok(r.A_area > 0, `el contorno propuesto trae su superficie (${r.A_area} m²)`);
  // El resumen da los DOS números —lo que registra y lo que queda fuera— con el
  // texto concreto del encargo. Antes decía "ocupa X · te quedarán Y".
  ok(/Vas a registrar/.test(r.A_supNota) && /quedan sin configurar en Kylia/.test(r.A_supNota),
     `y dice lo que registra y lo que queda fuera: "${r.A_supNota}"`);
  ok(r.A_fechaPreg === "¿Cuándo plantaste la lechuga?", "la fecha, también por su nombre");
  ok(r.A_precision === "aproximada", "\"hace unas dos semanas\" se guarda como APROXIMADA");
  ok(/aproximada/.test(r.A_fechaNota), `y se le dice: "${r.A_fechaNota}"`);
  ok(r.A_inst === true, "tras elegir goteo se pregunta si quiere configurar la instalación");
  ok(r.A_g1 === true && r.A_g2 === false, "y las preguntas salen de UNA EN UNA");
  ok(r.A_g2b === true, "cada respuesta destapa la siguiente");
  ok(/6\.7 litros por metro cuadrado/.test(r.A_tecnico) && /mm\/h/.test(r.A_tecnico),
     "los mm/h viven en \"detalles técnicos\", no en la pregunta");
  // "Lechuga, guardada": el género concuerda, no se escribe un masculino fijo.
  ok(r.A_paso5 === "guardado" && /Lechuga, guardada/.test(r.A_titulo),
     `y se guarda, con el género bien: "${r.A_titulo}"`);
  ok(/Ya podemos decirte cuándo y cuánto regar/.test(r.A_tarjeta),
     "con todo completo, la tarjeta lo dice");

  console.log("\n── CASO B · dos cultivos, nada se contagia ──");
  ok(r.B_paso === "cultivo" && r.B_conserva === 1,
     "\"añadir cultivo\" mantiene el terreno y lo ya configurado, sin volver a pedir terreno");
  ok(r.B_aMedias == null && r.B_botonAMedias === true,
     "escribir a medias NO elige cultivo ni enciende el botón (antes \"lechu\" daba un otro: sin Kc)");
  ok(r.B_sugerencias.length > 0 && /Tomate/.test(r.B_sugerencias.join(" ")),
     `el buscador sugiere mientras escribe: ${JSON.stringify(r.B_sugerencias.slice(0,3))}`);
  ok(r.B_sinonimo === "tomate", "\"tomàquet\" elegido de la lista resuelve al cultivo canónico");
  ok(r.B_elegidoVisible === true && /Tomate/.test(r.B_elegidoTxt),
     "y lo elegido se enseña aparte del texto escrito");
  ok(r.B_todoOculto === true, "con un cultivo dentro ya no se ofrece \"todo el terreno\"");
  ok(/Tomate/.test(r.B_leyenda) && /Lechuga/.test(r.B_leyenda),
     `la leyenda nombra los cultivos, no solo los colorea: "${r.B_leyenda}"`);
  ok(r.B_fijosQ === true, "con aspersores lo PRIMERO es si están fijos o se mueven");
  ok(r.B_fijosOpciones.length === 2
     && /fijos/i.test(r.B_fijosOpciones[0]) && /moviendo/i.test(r.B_fijosOpciones[1]),
     `y solo esas dos opciones, sin "no lo sé": ${JSON.stringify(r.B_fijosOpciones)}`);
  const [a, b] = r.B_siembras;
  ok(a.f !== b.f, `fechas independientes (${a.f} / ${b.f})`);
  ok(a.m !== b.m && a.q !== b.q, `métodos y caudales independientes (${a.q} / ${b.q})`);
  ok(a.fu === "derivado_goteo" && b.fu === "derivado_aspersion",
     `y su procedencia (${a.fu} / ${b.fu})`);
  ok(a.g && b.g && a.id && b.id && a.tok && b.tok,
     "cada uno con su contorno, su id y su token de sincronización");
  ok(r.B_areasCoinciden === true, "las áreas guardadas coinciden con su GeoJSON");
  ok(r.B_sinSolape === true, "y no se pisan");

  console.log("\n── CASO C · datos pendientes ──");
  ok(r.C_fecha === null, "\"no me acuerdo\" NO fabrica una fecha");
  ok(/sin fecha/.test(r.C_notaSinFecha), "y se explica qué pasa entonces");
  ok(r.C_caudal === null && r.C_fuente === "no_lo_se", "dejar el riego para después no inventa capacidad");
  ok(r.C_clase === "no_ejecutable", "así que no hay minutos fiables");
  ok(/Falta decirnos cuándo lo plantaste/.test(r.C_tarjeta),
     "y la tarjeta lo dice como ACCIÓN, no como campo vacío");
  ok(/Falta medir la instalación/.test(r.C_tarjeta), "igual que la instalación");
  ok(!/Ya podemos decirte/.test(r.C_tarjeta), "sin prometer que está todo listo");

  console.log("\n── CASO D · terreno parcialmente gestionado ──");
  ok(r.D_reparto.sin_configurar > 0,
     `${r.D_reparto.sin_configurar} m² sin configurar en Kylia, y el alta termina igual`);
  ok(r.D_reparto.excedido === 0, "sin excederse del terreno");
  ok(/sin configurar en Kylia/.test(r.C_tarjeta), "y se llama \"sin configurar\", no \"sin cultivar\"");

  console.log("\n── CASO E · cultivo libre ──");
  ok(r.E_opcionLibre === true,
     "lo que no está en el catálogo se ofrece explícitamente, no se cuela al teclear");
  // §4 · el texto exacto del encargo.
  ok(/Todavía no calculamos recomendaciones para este cultivo/.test(r.E_nota)
     && /registrarlo/.test(r.E_nota),
     `se explica sin rodeos: "${r.E_nota}"`);
  ok(r.E_id === "otro:quinoa", "conserva su identidad");
  ok(r.E_kc === true, "y el motor NO lo conoce: nada de Kc prestado");
  ok(/Todavía no calculamos el riego/.test(r.E_tarjeta), "la tarjeta lo repite");

  console.log("\n── CASO F · terreno con agujeros ──");
  ok(/sin contar los huecos/.test(r.F_sup), `la superficie los descuenta ya al elegirlo: "${r.F_sup}"`);
  ok(r.F_anillos === 2, "\"usar todo el terreno\" copia el GeoJSON COMPLETO, con su agujero");
  ok(r.F_tiradores === 0 && /no se puede ajustar a mano/.test(r.F_ayuda),
     "y se BLOQUEA la edición del contorno, explicando por qué: moverlo dejaría el hueco fuera");
  ok(r.F_guardado_anillos === 2, "tras guardar y recargar siguen los dos anillos");
  ok(r.F_area_coincide === true, "el área guardada coincide con su GeoJSON");
  ok(r.F_menor_que_exterior === true, "y es menor que la del contorno exterior: el hueco no cuenta");

  console.log("\n── CASO G · interrupciones ──");
  ok(r.G_trasAtras === "fecha", "\"Atrás\" retrocede un paso");
  ok(r.G_conservaFecha && r.G_conservaGeom, "sin perder el contorno ni la fecha ya contestados");
  ok(r.G_hayBorrador === true, "cerrar a media alta deja el progreso guardado");
  ok(r.G_retoma === true && r.G_pasoRetomado === "riego" && r.G_cultivoRetomado === "calabacin",
     "y se retoma en el mismo paso, con lo contestado");
  ok(r.G_duplicados === 1, `pulsar dos veces \"Guardar\" crea UN cultivo, no dos (${r.G_duplicados})`);
  ok(r.G_borradorBorrado === true, "y al guardar, el borrador desaparece: ya no hay nada que retomar");

  console.log("\n── CASO H · nada se toca por abrir el alta ──");
  ok(r.H_zonas === 2, `los dos terrenos usados (${r.H_zonas})`);
  ok(r.H_total_siembras === 6, `y sus ${r.H_total_siembras} cultivos, ninguno duplicado`);

  console.log("\n── CASO I · pendiente no hereda, e historial desconocido se declara ──");
  ok(r.I_persistido.metodo === null && r.I_persistido.caudal === null,
     "lo persistido no lleva método ni caudal de la finca");
  ok(r.I_persistido.pendiente === true && r.I_persistido.fuente === "pendiente",
     "sino la marca explícita de \"lo indicaré después\"");
  ok(r.I_capacidad.motor === null && r.I_capacidad.motivo === "riego_pendiente",
     "y tras el reload NADA cruza al motor, con la finca en aspersión 11,2");
  ok(!!r.I_persistido.registradoEl, `queda sellado desde cuándo hay registro (${r.I_persistido.registradoEl})`);
  ok(r.I_previos === 14, `plantada 14 días antes de darla de alta: ${r.I_previos} días sin registro`);
  ok(r.I_confianza === "incierto", `el balance NO se declara conocido (${r.I_confianza})`);
  ok(r.I_lamina > 0, `y la lámina se sigue calculando (${r.I_lamina} L/m²): no se suprime nada`);
  ok(/Falta decirnos cómo lo riegas/.test(r.I_tarjeta), "la tarjeta pide el riego que falta");

  console.log("\n── sin errores de JavaScript ──");
  ok(errores.length === 0, `0 errores de página (${errores.length ? errores.join(" · ") : "0"})`);
} finally {
  await nav.close();
  srv.close();
}

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
