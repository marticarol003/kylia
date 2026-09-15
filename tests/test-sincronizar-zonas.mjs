// Una siembra que está en la configuración tiene que existir como parcela.
//   node tests/test-sincronizar-zonas.mjs
//
// POR QUÉ EXISTE. sincronizarZonas() iteraba `zonasSel`, el Map del editor de
// mapa, que nace vacío y nunca se hidrata desde kylia_zonas — así que solo
// registraba lo que hubiera abierto en el editor. Y se llamaba desde UN sitio,
// mientras subirConfig() —lo que sube config_app— se llama desde cuatro.
// Medido en producción el 15-sep: 4 zonas en config_app del servidor y CERO
// filas en `usuarios`, desde el 11-sep, sin que nadie se enterara.
//
// PUNTO 1 = CONSISTENCIA PROSPECTIVA, opción (b). Lo nuevo y lo modificado se
// sincroniza; lo histórico se DECLARA y no se crea — eso es el punto 2.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const FUENTE = readFileSync(join(RAIZ, "app", "index.html"), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

function recortaLinea(marca) {
  const i = FUENTE.indexOf(marca);
  if (i < 0) throw new Error(`no encuentro: ${marca}`);
  return FUENTE.slice(i, FUENTE.indexOf("\n", i));
}
function recorta(marca) {
  const i = FUENTE.indexOf(marca);
  if (i < 0) throw new Error(`no encuentro: ${marca}`);
  let k = FUENTE.indexOf("(", i), prof = 0;
  for (; k < FUENTE.length; k++) {
    if (FUENTE[k] === "(") prof++;
    else if (FUENTE[k] === ")" && --prof === 0) { k++; break; }
  }
  while (k < FUENTE.length && FUENTE[k] !== "{") k++;
  prof = 0;
  for (let j = k; j < FUENTE.length; j++) {
    if (FUENTE[j] === "{") prof++;
    else if (FUENTE[j] === "}" && --prof === 0) return FUENTE.slice(i, j + 1);
  }
  throw new Error(`llaves sin cerrar: ${marca}`);
}

function almacen(inicial = {}) {
  const m = new Map(Object.entries(inicial).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return { getItem: k => (m.has(k) ? m.get(k) : null),
           setItem: (k, v) => m.set(k, String(v)),
           removeItem: k => m.delete(k), _m: m };
}

// Monta las piezas reales sobre un kyliaSync simulado.
function monta({ zonas, finca = {}, responde = () => ({ ok: true, persisted: true }) }) {
  const ls = almacen({ kylia_zonas: zonas, kylia_user_email: "a@b.c" });
  const enviados = [];
  const win = {
    kyliaSync: {
      userId: "dueno-1",
      registroUsuario: async (payload) => { enviados.push(payload); return responde(payload); },
    },
  };
  let subidas = 0;
  const cuerpo = `
    const cfgFinca = finca;
    const nombreCultivo = (c) => ({ lechuga: "Lechuga", brassica: "Col", calabacin: "Calabacín" }[c] || c);
    const subirConfig = () => { subidas++; };
    ${recorta("function zonasGuardadas(")}
    ${recorta("function guardarZonasSinSubir(")}
    ${recorta("function uuidZona(")}
    ${recorta("function nuevaSiembra(")}
    ${recorta("function payloadSiembra(")}
    ${recorta("function estable(")}
    ${recorta("function huellaPayload(")}
    ${recorta("function normalizarZonasLegacy(")}
    ${recorta("function hidratarSyncZonas(")}
    ${recorta("function decidirSiembra(")}
    ${recorta("function clasificarSiembras(")}
    ${recorta("function anotarSync(")}
    ${recortaLinea("let cadenaSincro = ")}
    ${recorta("function sincronizarZonas(")}
    ${recorta("async function rondaSincro(")}
    return { hidratarSyncZonas, normalizarZonasLegacy, sincronizarZonas, payloadSiembra,
             huellaPayload, estable, decidirSiembra, clasificarSiembras, nuevaSiembra,
             zonasGuardadas, subidas: () => subidas };
  `;
  const f = new Function("finca", "localStorage", "window", "subidas", cuerpo);
  const api = f(finca, ls, win, 0);
  return { ...api, enviados, ls, leerZonas: () => JSON.parse(ls.getItem("kylia_zonas")) };
}

const FINCA = { ciudad: "Sant Boi", lat: 41.34, lon: 2.03, suelo: "franco", metodoRiego: "goteo", caudal: 11 };
const zonaCon = (siembras, extra = {}) => [{ referencia: "R1", nombre: "Recinto", geometria: { g: 1 }, siembras, ...extra }];
const siembra = (id, extra = {}) => ({ id, cultivo: "lechuga", area_m2: 100,
  fechaPlantacion: "2026-06-01", metodoRiego: "goteo", ...extra });

console.log("\n── 1. históricas: se declaran, NO se crean (opción b) ──");
{
  const app = monta({ zonas: zonaCon([siembra("h1"), siembra("h2"), siembra("h3")]), finca: FINCA });
  app.hidratarSyncZonas();
  const r = await app.sincronizarZonas(FINCA);
  ok(app.enviados.length === 0, `0 peticiones (${app.enviados.length})`);
  ok(r.pendientes_reparacion.length === 3, `las 3 declaradas pendientes (${r.pendientes_reparacion.length})`);
  const r2 = await app.sincronizarZonas(FINCA);
  const r3 = await app.sincronizarZonas(FINCA);
  ok(app.enviados.length === 0, "y al segundo y tercer guardado, siguen sin crearse");
  ok(r3.pendientes_reparacion.length === 3, "siguen declaradas: idempotente");
}

console.log("\n── 2. la baseline se pone al HIDRATAR, no al guardar ──");
{
  // El agujero: si `vista` se estrenara durante el guardado, una histórica
  // editada en la primera sesión tras el deploy estrenaría `vista` con el
  // contenido YA modificado y quedaría como histórica intacta para siempre.
  const app = monta({ zonas: zonaCon([siembra("h1")]), finca: FINCA });
  app.hidratarSyncZonas();
  const sync = app.leerZonas()[0].siembras[0].sync;
  ok(sync && sync.nueva === false && sync.confirmada === null, "hidratada: nueva:false, confirmada:null");
  ok(typeof sync.vista === "string" && sync.vista.length > 0, "y con vista = huella del contenido de ANTES");

  // Ahora se edita ANTES del primer guardado.
  const zonas = app.leerZonas();
  zonas[0].siembras[0].cultivo = "brassica";
  app.ls.setItem("kylia_zonas", JSON.stringify(zonas));
  const r = await app.sincronizarZonas(FINCA);
  ok(app.enviados.length === 1, `la modificación SÍ se envía (${app.enviados.length})`);
  ok(r.pendientes_reparacion.length === 0, "y deja de estar pendiente");
}

console.log("\n── 3. siembra nueva ──");
{
  const nueva = siembra("n1", { sync: { nueva: true, vista: null, confirmada: null } });
  const app = monta({ zonas: zonaCon([siembra("h1"), nueva]), finca: FINCA });
  app.hidratarSyncZonas();
  const r = await app.sincronizarZonas(FINCA);
  ok(app.enviados.length === 1, `solo se envía la nueva (${app.enviados.length})`);
  ok(app.enviados[0].id === "n1", "y es la nueva, no la histórica");
  ok(r.pendientes_reparacion.includes("h1"), "la histórica sigue declarada");
  const s = app.leerZonas()[0].siembras[1].sync;
  ok(s.nueva === false && s.confirmada === s.vista && s.confirmada != null, "tras confirmar: nueva:false y marcas al día");
}

console.log("\n── 4. REINTENTO: si falla, no avanza ninguna marca ──");
{
  let falla = true;
  const app = monta({ zonas: zonaCon([siembra("h1")]), finca: FINCA,
                      responde: () => (falla ? { ok: false, status: 500, persisted: false } : { ok: true, persisted: true }) });
  app.hidratarSyncZonas();
  const vistaA = app.leerZonas()[0].siembras[0].sync.vista;

  const z = app.leerZonas(); z[0].siembras[0].area_m2 = 250;       // A → B
  app.ls.setItem("kylia_zonas", JSON.stringify(z));

  const r1 = await app.sincronizarZonas(FINCA);
  ok(r1.fallidas === 1 && r1.confirmadas === 0, "el registro falla");
  const tras = app.leerZonas()[0].siembras[0].sync;
  ok(tras.vista === vistaA, "`vista` SIGUE EN A: no avanza con un fallo");
  ok(tras.confirmada === null, "y `confirmada` tampoco");

  const r2 = await app.sincronizarZonas(FINCA);
  ok(r2.enviadas === 1, "el siguiente guardado vuelve a detectar A != B y REINTENTA");

  falla = false;
  const r3 = await app.sincronizarZonas(FINCA);
  ok(r3.confirmadas === 1, "y cuando el servidor confirma, se resuelve");
  const fin = app.leerZonas()[0].siembras[0].sync;
  ok(fin.vista === fin.confirmada && fin.vista !== vistaA, "ahora sí: vista = confirmada = B");
  const r4 = await app.sincronizarZonas(FINCA);
  ok(r4.enviadas === 0, "y deja de reenviarse");
}
{
  // persisted:false con HTTP 200 cuenta igual que un 500.
  const app = monta({ zonas: zonaCon([siembra("n1", { sync: { nueva: true, vista: null, confirmada: null } })]),
                      finca: FINCA, responde: () => ({ ok: true, status: 200, persisted: false }) });
  await app.sincronizarZonas(FINCA);
  const s = app.leerZonas()[0].siembras[0].sync;
  ok(s.nueva === true && s.confirmada === null, "persisted:false → sigue nueva y sin confirmar");
  const r = await app.sincronizarZonas(FINCA);
  ok(r.enviadas === 1, "y se reintenta");
}

console.log("\n── 5. payload y huella son EL MISMO objeto ──");
{
  const app = monta({ zonas: zonaCon([siembra("n1", { sync: { nueva: true, vista: null, confirmada: null } })]), finca: FINCA });
  await app.sincronizarZonas(FINCA);
  const enviado = app.enviados[0];
  const z = app.leerZonas()[0];
  const recalculado = app.payloadSiembra(z, z.siembras[0], FINCA, "dueno-1");
  ok(JSON.stringify(enviado) === JSON.stringify(recalculado), "el payload enviado se reconstruye idéntico");
  ok(app.huellaPayload(recalculado) === z.siembras[0].sync.confirmada,
     "y la huella guardada es la de ESE payload, no la de otra lista de campos");
  const cuerpo = recorta("async function rondaSincro(");
  ok((recorta("function clasificarSiembras(").match(/payloadSiembra\(/g) || []).length === 1,
     "el payload se construye UNA vez, en el clasificador");
}

console.log("\n── 6. solo cambia lo que se envía ──");
{
  const app = monta({ zonas: zonaCon([siembra("h1")]), finca: FINCA });
  app.hidratarSyncZonas();
  const z = app.leerZonas();
  z[0].siembras[0].riegoMinutos = 45;            // NO va en el payload
  app.ls.setItem("kylia_zonas", JSON.stringify(z));
  const r = await app.sincronizarZonas(FINCA);
  ok(r.enviadas === 0, "un campo que no se sincroniza no dispara reenvío");
  for (const [campo, valor] of [["cultivo", "brassica"], ["area_m2", 999],
                                ["fechaPlantacion", "2026-07-01"], ["metodoRiego", "aspersion"]]) {
    const a = monta({ zonas: zonaCon([siembra("h1")]), finca: FINCA });
    a.hidratarSyncZonas();
    const zz = a.leerZonas(); zz[0].siembras[0][campo] = valor;
    a.ls.setItem("kylia_zonas", JSON.stringify(zz));
    ok((await a.sincronizarZonas(FINCA)).enviadas === 1, `cambiar ${campo} sí lo dispara`);
  }
}

console.log("\n── 7. geometría por siembra ──");
{
  const una = monta({ zonas: zonaCon([siembra("a", { sync: { nueva: true } })]), finca: FINCA });
  await una.sincronizarZonas(FINCA);
  ok(JSON.stringify(una.enviados[0].parcela) === JSON.stringify({ g: 1 }), "1 siembra → contorno del recinto");

  const varias = monta({ zonas: zonaCon([siembra("a", { sync: { nueva: true } }), siembra("b", { sync: { nueva: true } })]), finca: FINCA });
  await varias.sincronizarZonas(FINCA);
  ok(varias.enviados.every(p => p.parcela === null), "varias sin partir → parcela null (si no, el cron mezcla el NDVI)");

  const part = monta({ zonas: zonaCon([siembra("a", { sync: { nueva: true }, geometria: { g: "a" } }),
                                       siembra("b", { sync: { nueva: true }, geometria: { g: "b" } })]), finca: FINCA });
  await part.sincronizarZonas(FINCA);
  ok(part.enviados.map(p => p.parcela.g).join() === "a,b", "partidas → cada una con SU trozo");
}

console.log("\n── 8. round-trip de s.sync por config_app ──");
{
  const app = monta({ zonas: zonaCon([siembra("n1", { sync: { nueva: true, vista: null, confirmada: null } })]), finca: FINCA });
  await app.sincronizarZonas(FINCA);
  // Lo que subirConfig manda al servidor son las zonas tal cual están.
  const viaje = JSON.parse(JSON.stringify(app.zonasGuardadas()));
  ok(viaje[0].siembras[0].sync.confirmada != null, "s.sync viaja dentro de config_app");

  // Otro dispositivo: restaura esas zonas y NO tiene nada más.
  const otro = monta({ zonas: viaje, finca: FINCA });
  otro.hidratarSyncZonas();
  const r = await otro.sincronizarZonas(FINCA);
  ok(r.enviadas === 0, "en el dispositivo nuevo no se reenvía: la marca llegó con la config");
  ok(r.pendientes_reparacion.length === 0, "y no se confunde con una histórica");
}

console.log("\n── 9. perder la caché local es conservador, no corrupto ──");
{
  const app = monta({ zonas: zonaCon([siembra("x", { sync: { nueva: false, vista: "v", confirmada: "v" } })]), finca: FINCA });
  const z = app.leerZonas(); delete z[0].siembras[0].sync;        // se pierde todo
  app.ls.setItem("kylia_zonas", JSON.stringify(z));
  app.hidratarSyncZonas();
  const r = await app.sincronizarZonas(FINCA);
  ok(r.enviadas === 0, "sin marcas no se crea nada a ciegas");
  ok(r.pendientes_reparacion.length === 1, "se declara pendiente: el punto 2 decide");
}

console.log("\n── 10. sin cultivo, y estructura ──");
{
  const app = monta({ zonas: zonaCon([siembra("s1", { cultivo: null })]), finca: FINCA });
  app.hidratarSyncZonas();
  const r = await app.sincronizarZonas(FINCA);
  ok(app.enviados.length === 0 && r.sin_cultivo.includes("s1"), "sin cultivo: no se envía y se declara");
}
{
  const app = monta({ zonas: zonaCon([siembra("h1")]), finca: FINCA,
                      responde: () => { throw new Error("boom"); } });
  app.hidratarSyncZonas();
  const z = app.leerZonas(); z[0].siembras[0].area_m2 = 5; app.ls.setItem("kylia_zonas", JSON.stringify(z));
  let reventó = false;
  try { await app.sincronizarZonas(FINCA); } catch (_) { reventó = true; }
  ok(!reventó, "si registroUsuario lanza, sincronizarZonas no revienta");
}
{
  const cuerpo = recorta("async function rondaSincro(");
  ok(!cuerpo.includes("zonasSel") && !recorta("function clasificarSiembras(").includes("zonasSel"),
     "ni rondaSincro ni el clasificador dependen de zonasSel");
  ok(recorta("function clasificarSiembras(").includes("zonasGuardadas()"), "itera la verdad persistida");
  ok(!cuerpo.includes("subirConfig("), "y no llama a subirConfig: sería un bucle");
  ok(!recorta("function hidratarSyncZonas(").includes("registroUsuario"), "hidratar no hace ningún POST");
  ok(recorta("function guardarZonasSinSubir(").includes("localStorage.setItem"), "las marcas se escriben sin subir");
  const ficheros = FUENTE.match(/kylia_riegos/g) || [];
  ok(!recorta("async function rondaSincro(").includes("riego") &&
     !recorta("function clasificarSiembras(").includes("riego"), "no toca riegos");
  ok(!recorta("function hidratarSyncZonas(").includes("riego"), "la hidratación tampoco");
}

console.log("\n── 11. BLOQUEANTE 1 · la huella incluye la geometría ENTERA ──");
{
  const app = monta({ zonas: zonaCon([siembra("g")]), finca: FINCA });
  const gA = { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] };
  const gB = { type: "Polygon", coordinates: [[[0, 0], [0, 2], [2, 2], [0, 0]]] };
  const gC = { type: "MultiPolygon", coordinates: gA.coordinates };
  const base = { referencia: "R1", siembras: [siembra("g")] };
  const h = (g) => app.huellaPayload(app.payloadSiembra(base, { ...siembra("g"), geometria: g }, FINCA, "d"));
  ok(h(gA) !== h(gB), "dos polígonos distintos → huellas distintas");
  ok(h(gA) !== h(gC), "mismo coordinates y distinto type → huellas distintas");
  ok(h(gA) === h(gA), "y la misma geometría da la misma huella");
  ok(app.estable({ b: 1, a: 2 }) === app.estable({ a: 2, b: 1 }), "claves ordenadas: el orden no cambia la huella");
  ok(app.estable([1, 2]) !== app.estable([2, 1]), "pero el orden de un array SÍ cuenta");
  ok(app.estable({ a: null }) === '{"a":null}', "los null explícitos se conservan");
}
{
  // Y de punta a punta: mover el polígono dispara sincronización.
  const app = monta({ zonas: [{ referencia: "R1", geometria: { g: 0 }, siembras: [
    siembra("g", { geometria: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] } })] }], finca: FINCA });
  app.hidratarSyncZonas();
  ok((await app.sincronizarZonas(FINCA)).enviadas === 0, "sin tocar nada, 0 envíos");
  const z = app.leerZonas();
  z[0].siembras[0].geometria.coordinates[0][1] = [0, 5];      // mover un vértice
  app.ls.setItem("kylia_zonas", JSON.stringify(z));
  ok((await app.sincronizarZonas(FINCA)).enviadas === 1, "mover un vértice SÍ dispara sincronización");
}

console.log("\n── 12. BLOQUEANTE 2 · una respuesta tardía no pisa una edición ──");
{
  let soltar; const espera = new Promise(r => { soltar = r; });
  const app = monta({ zonas: zonaCon([siembra("x", { area_m2: 100, sync: { nueva: true, vista: null, confirmada: null } })]),
                      finca: FINCA, responde: async () => { await espera; return { ok: true, persisted: true }; } });
  const enVuelo = app.sincronizarZonas(FINCA);
  await new Promise(r => setTimeout(r, 0));
  // Mientras vuela el POST de A=100, el usuario cambia a B=200.
  const z = app.leerZonas(); z[0].siembras[0].area_m2 = 200;
  app.ls.setItem("kylia_zonas", JSON.stringify(z));
  soltar(); await enVuelo;

  const fin = app.leerZonas()[0].siembras[0];
  ok(fin.area_m2 === 200, `el área final sigue siendo 200 (${fin.area_m2}) — la edición NO se pisa`);
  ok(fin.sync.confirmada != null, "se registra la confirmación de A");
  const r2 = await app.sincronizarZonas(FINCA);
  ok(r2.enviadas === 1, "y el siguiente ciclo detecta A !== B y envía B");
  ok(app.enviados[1].area_m2 === 200, "con el área nueva");
  const fin2 = app.leerZonas()[0].siembras[0];
  ok(fin2.sync.confirmada !== fin.sync.confirmada, "y ahora sí queda confirmada B");
}
{
  // Dos rondas concurrentes: single-flight.
  let n = 0;
  const app = monta({ zonas: zonaCon([siembra("a", { sync: { nueva: true } }), siembra("b", { sync: { nueva: true } })]),
                      finca: FINCA, responde: async () => { n++; await new Promise(r => setTimeout(r, 1)); return { ok: true, persisted: true }; } });
  const [r1, r2] = await Promise.all([app.sincronizarZonas(FINCA), app.sincronizarZonas(FINCA)]);
  ok(r1.enviadas + r2.enviadas === 2, `entre las dos rondas se envían 2, no 4 (${r1.enviadas}+${r2.enviadas})`);
  const zz = app.leerZonas()[0].siembras;
  ok(zz.every(x => x.sync.confirmada != null && x.sync.nueva === false), "las dos quedan confirmadas: ninguna marca retrocede");
  ok((await app.sincronizarZonas(FINCA)).enviadas === 0, "y una tercera ronda no reenvía nada");
}

console.log("\n── 13. BLOQUEANTE 3 · kyliaZonasPendientes es diagnóstico puro ──");
{
  const app = monta({ zonas: zonaCon([siembra("h1"), siembra("n1", { sync: { nueva: true } }),
                                      siembra("s1", { cultivo: null })]), finca: FINCA });
  app.hidratarSyncZonas();
  const antes = JSON.stringify(app.leerZonas());
  const c = app.clasificarSiembras(FINCA);
  ok(app.enviados.length === 0, "0 POST");
  ok(JSON.stringify(app.leerZonas()) === antes, "0 modificaciones de localStorage");
  ok(c.pendientes_reparacion.includes("h1"), "declara la histórica");
  ok(c.pendientes_sincronizacion.some(x => x.id === "n1"), "y la nueva como pendiente de sincronización");
  ok(c.sin_cultivo.includes("s1"), "y la que no tiene cultivo");
  ok(!("enviadas" in c) && !("fallidas" in c), "no inventa enviadas/fallidas: para saberlas habría que ejecutar");
  const cuerpo = recorta("function clasificarSiembras(");
  ok(!cuerpo.includes("registroUsuario") && !cuerpo.includes("guardarZonasSinSubir"),
     "el clasificador no escribe ni pide nada");
}

console.log("\n── 14. BLOQUEANTE 4 · toda alta nace con nueva:true ──");
{
  const app = monta({ zonas: [], finca: FINCA });
  const a = app.nuevaSiembra(500);                       // elegir recinto
  const b = app.nuevaSiembra(300);                       // "añadir otro cultivo"
  ok(a.sync?.nueva === true && b.sync?.nueva === true, "las dos nacen con nueva:true");
  ok(a.id !== b.id, "y con ids distintos");
  const c = app.nuevaSiembra(100, { cultivo: "lechuga", sync: { nueva: false } });
  ok(c.sync.nueva === true, "y `extra` no puede desactivarla por descuido");
  ok(FUENTE.match(/siembras\.push\(/g).length === (FUENTE.match(/siembras\.push\(nuevaSiembra\(/g) || []).length,
     "todos los push de siembra pasan por el constructor único");
}

console.log("\n── 15. BLOQUEANTE 5 · legacy se normaliza ANTES de hidratar ──");
{
  // Fixture legacy: cultivo colgando de la zona, sin siembras[].
  const legacy = [{ referencia: "R1", nombre: "Viejo", geometria: { g: 1 },
                    id: "leg-1", cultivo: "lechuga", superficie_m2: 400, fechaPlantacion: "2026-05-01" }];
  const app = monta({ zonas: legacy, finca: FINCA });
  app.hidratarSyncZonas();
  const s0 = app.leerZonas()[0].siembras[0];
  ok(Array.isArray(app.leerZonas()[0].siembras), "la zona legacy queda normalizada a siembras[]");
  ok(s0.id === "leg-1" && s0.cultivo === "lechuga", "conservando su id y su cultivo");
  ok(s0.sync && s0.sync.nueva === false && s0.sync.confirmada === null, "y CON baseline: nueva:false, confirmada:null");
  ok(typeof s0.sync.vista === "string" && s0.sync.vista.length > 0, "y vista = huella actual");
  const r = await app.sincronizarZonas(FINCA);
  ok(app.enviados.length === 0, "un guardado inocuo NO la crea");
  ok(r.pendientes_reparacion.includes("leg-1"), "queda declarada pendiente de reparación");
}
{
  // Cinturón: una siembra que se escapara sin sync tampoco se envía.
  ok(monta({ zonas: [], finca: FINCA }).decidirSiembra(undefined, "h") === "pendiente_reparacion",
     "sin marcas: pendiente_reparacion, nunca enviar");
  ok(monta({ zonas: [], finca: FINCA }).decidirSiembra(null, "h") === "pendiente_reparacion", "sync null, igual");
}

console.log("\n── 16. BLOQUEANTE 6 · las marcas viajan a config_app en el flujo real ──");
{
  const cuerpoSubir = recorta("function subirConfig(");
  const iSincro = cuerpoSubir.indexOf("sincronizarZonas(");
  const iSubir  = cuerpoSubir.indexOf("guardarConfigServidor");
  ok(iSincro > -1 && iSubir > -1 && iSincro < iSubir,
     "en subirConfig, sincronizar va ANTES de guardarConfigServidor");
  ok(/zonas: zonasGuardadas\(\),\s*\/\/ releídas/.test(cuerpoSubir),
     "y las zonas se releen para que el config_app que sube lleve las marcas");
  ok(!recorta("async function rondaSincro(").includes("subirConfig("),
     "y sincronizar no llama a subirConfig: sería un bucle");
}
{
  // Round-trip por el flujo real: se captura lo que se manda a config_app.
  let subido = null;
  const app = monta({ zonas: zonaCon([siembra("n1", { sync: { nueva: true, vista: null, confirmada: null } })]), finca: FINCA });
  await app.sincronizarZonas(FINCA);
  subido = { finca: FINCA, zonas: app.zonasGuardadas() };      // lo que subirConfig manda después
  ok(subido.zonas[0].siembras[0].sync.confirmada != null, "el config_app que sube YA lleva la marca confirmada");

  const otro = monta({ zonas: JSON.parse(JSON.stringify(subido.zonas)), finca: FINCA });
  otro.hidratarSyncZonas();
  const r = await otro.sincronizarZonas(FINCA);
  ok(r.enviadas === 0, "el dispositivo nuevo no reenvía: la marca llegó con la config");
  ok(r.pendientes_reparacion.length === 0, "ni la confunde con una histórica");
}

console.log(fallos === 0 ? "\n✅ TODOS LOS TESTS VERDES\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos === 0 ? 0 : 1);
