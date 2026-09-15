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
    ${recorta("function payloadSiembra(")}
    ${recorta("function huellaPayload(")}
    ${recorta("function hidratarSyncZonas(")}
    ${recorta("function decidirSiembra(")}
    ${recorta("async function sincronizarZonas(")}
    return { hidratarSyncZonas, sincronizarZonas, payloadSiembra, huellaPayload, decidirSiembra,
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
  const cuerpo = recorta("async function sincronizarZonas(");
  ok((cuerpo.match(/payloadSiembra\(/g) || []).length === 1, "sincronizarZonas construye el payload UNA vez");
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
  const cuerpo = recorta("async function sincronizarZonas(");
  ok(!cuerpo.includes("zonasSel"), "sincronizarZonas ya no depende de zonasSel");
  ok(cuerpo.includes("zonasGuardadas()"), "itera la verdad persistida");
  ok(!cuerpo.includes("subirConfig("), "y no llama a subirConfig: sería un bucle");
  ok(!recorta("function hidratarSyncZonas(").includes("registroUsuario"), "hidratar no hace ningún POST");
  ok(recorta("function guardarZonasSinSubir(").includes("localStorage.setItem"), "las marcas se escriben sin subir");
  const ficheros = FUENTE.match(/kylia_riegos/g) || [];
  ok(!recorta("async function sincronizarZonas(").includes("riego"), "no toca riegos");
  ok(!recorta("function hidratarSyncZonas(").includes("riego"), "la hidratación tampoco");
}

console.log(fallos === 0 ? "\n✅ TODOS LOS TESTS VERDES\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos === 0 ? 0 : 1);
