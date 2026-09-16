// PUNTO 2 · FASE B.1 — crear las siembras históricas que faltan en `usuarios`.
//
//   node scripts/reparar-siembras-2026-09-16.mjs            → DRY-RUN (por defecto)
//   node scripts/reparar-siembras-2026-09-16.mjs --aplicar  → escribe
//
// QUÉ HACE Y QUÉ NO. Crea filas de parcela que faltan, una a una, y verifica cada
// una antes de seguir. NO toca riegos, ni config_app, ni s.sync, ni el motor, ni
// la migración de láminas. La confirmación de s.sync es la FASE B.2 y va desde el
// navegador, por la razón que explica el bloque de abajo.
//
// ⚠️ POR QUÉ B.2 NO ESTÁ AQUÍ. `payloadSiembra()` incluye `email` y `origen`, que
// en la app salen de localStorage. La huella del Punto 1 se calcula sobre ESE
// payload. Si este script escribiera `s.sync.confirmada` con una huella calculada
// aquí —sin localStorage— no coincidiría con la que calcule el navegador, y la
// app volvería a considerar la siembra modificada. La confirmación tiene que
// calcularla quien después la va a comparar.
import { readFileSync } from "fs";

const BASE  = process.env.KYLIA_BASE || "https://kylia.app";
const OWNER = "c46e9d6d-577f-47ab-8a67-eebadcec7109";
const APLICAR = process.argv.includes("--aplicar");
// Censo del dry-run (Fase A). Si el servidor no coincide con esto, se para.
const ESPERADAS = [
  "264c2a43-8a64-4a0e-ad98-07cbf76c438d",
  "ba603bc6-6f39-4c76-ad06-f7ca4b723d86",
  "62dcd2da-6b93-4761-9cae-727c5315d22c",
  "eff32768-b032-401b-add1-82ca30337134",
];

const RAIZ = new URL("..", import.meta.url).pathname;
const APP = readFileSync(`${RAIZ}app/index.html`, "utf8");
function trozo(marca) {
  const i = APP.indexOf(marca);
  if (i < 0) throw new Error("no encuentro: " + marca);
  let k = APP.indexOf("{", APP.indexOf("(", i)), prof = 0;
  for (let j = k; j < APP.length; j++) {
    if (APP[j] === "{") prof++;
    else if (APP[j] === "}" && --prof === 0) return APP.slice(i, j + 1);
  }
  throw new Error("sin cerrar: " + marca);
}
// La MISMA lógica del Punto 1. No se reinterpreta el payload.
const motor = new Function("localStorage", `
  ${/const CULTIVOS = \[[\s\S]*?\n    \];/.exec(APP)[0]}
  ${trozo("function nombreCultivo(")}
  ${trozo("function payloadSiembra(")}
  return { payloadSiembra };
`)({ getItem: () => null });

const pedir = async (url, opts) => {
  const r = await fetch(url, opts);
  let cuerpo = null;
  try { cuerpo = JSON.parse(await r.text()); } catch (_) {}
  return { status: r.status, cuerpo };
};
const existe = async (id) => (await pedir(`${BASE}/api/campo?vista=hoy&usuario_id=${id}`)).status === 200;
const parar = (msg) => { console.error(`\n⛔ PARADO: ${msg}\n`); process.exit(1); };

console.log(APLICAR ? "── MODO APLICAR: se va a escribir ──" : "── DRY-RUN: no se escribe nada ──");

// ── 0 · precondición fuerte ───────────────────────────────────────────
const cfg = await pedir(`${BASE}/api/campo?vista=config&usuario_id=${OWNER}`);
if (cfg.status !== 200 || !cfg.cuerpo?.ok) parar(`vista=config devolvió ${cfg.status}`);
const p = cfg.cuerpo.propietario;
if (!p || p.id !== OWNER) parar(`el bloque propietario no es el esperado: ${p?.id}`);
if (typeof p.config_version !== "number") parar(`config_version no es un número: ${p.config_version}`);
const config = p.config;
if (!config || !Array.isArray(config.zonas)) parar("config_app sin zonas: no hay censo del que partir");

const siembras = [];
for (const z of config.zonas) for (const s of (z.siembras || [])) if (s?.id) siembras.push({ z, s });
console.log(`\nconfig_version = ${p.config_version} · zonas = ${config.zonas.length} · siembras = ${siembras.length}`);

if (siembras.length !== ESPERADAS.length) parar(`el censo son ${siembras.length} siembras y el dry-run vio ${ESPERADAS.length}`);
const ids = siembras.map(x => x.s.id).sort();
if (JSON.stringify(ids) !== JSON.stringify([...ESPERADAS].sort())) parar("los UUID del censo no son los del dry-run");
console.log("precondición: censo idéntico al dry-run ✓");

// ── 1 · payloads, solo del servidor ───────────────────────────────────
// email y origen NO se mandan: el servidor los hereda de la fila del propietario.
const plan = siembras.map(({ z, s }) => {
  const { email, origen, ...resto } = motor.payloadSiembra(z, s, config.finca || {}, OWNER);
  return { id: s.id, cultivo: s.cultivo, zona: z.nombre || z.referencia || "(sin referencia)", payload: resto };
});

// ── 2 y 3 · revalidar y crear, una a una ──────────────────────────────
const informe = [];
for (const item of plan) {
  process.stdout.write(`\n${item.id}  ${item.cultivo}\n`);
  if (await existe(item.id)) {
    console.log("   ya existe → NO se toca. Se relee y se clasifica.");
    const hoy = await pedir(`${BASE}/api/campo?vista=hoy&usuario_id=${item.id}`);
    const u = hoy.cuerpo?.usuario || {};
    const coherente = (u.cultivo || null) === (item.payload.cultivos?.[0] || null);
    informe.push({ ...item, resultado: coherente ? "YA_CREADA" : "CONFLICTO",
                   detalle: coherente ? "cultivo coincide" : `cultivo servidor="${u.cultivo}" ≠ "${item.payload.cultivos?.[0]}"` });
    if (!coherente) parar(`${item.id} existe y contradice el payload esperado`);
    continue;
  }
  if (!APLICAR) { console.log("   FALTA → se crearía (dry-run, no se escribe)"); informe.push({ ...item, resultado: "SE_CREARIA" }); continue; }

  const r = await pedir(`${BASE}/api/log`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recurso: "crear-parcela", ...item.payload }),
  });
  if (r.status === 409) {
    console.log("   409 ya_existe → alguien la creó mientras tanto. NO se sobrescribe; se relee.");
    informe.push({ ...item, resultado: "CARRERA_RELEIDA" });
    continue;
  }
  if (r.status !== 201 || !r.cuerpo?.ok) parar(`creación fallida (${r.status}): ${JSON.stringify(r.cuerpo)}`);
  console.log("   creada ✓");

  // ── 4 · verificar inmediatamente, antes de seguir ──
  const perfil = await pedir(`${BASE}/api/campo?vista=perfil&usuario_id=${item.id}`);
  const hoy    = await pedir(`${BASE}/api/campo?vista=hoy&usuario_id=${item.id}`);
  if (perfil.status !== 200 || hoy.status !== 200) parar(`creada pero no verifica: perfil=${perfil.status} hoy=${hoy.status}`);
  const u = hoy.cuerpo.usuario || {};
  const choques = [];
  if ((u.cultivo || null) !== (item.payload.cultivos?.[0] || null)) choques.push(`cultivo ${u.cultivo}`);
  if (item.payload.area_m2 != null && Math.abs(Number(u.area_m2) - Number(item.payload.area_m2)) > 1) choques.push(`area ${u.area_m2}`);
  if (item.payload.metodo_riego && u.metodo_riego !== item.payload.metodo_riego) choques.push(`metodo ${u.metodo_riego}`);
  if (item.payload.caudal != null && Number(u.caudal) !== Number(item.payload.caudal)) choques.push(`caudal ${u.caudal}`);
  if (choques.length) parar(`${item.id} creada pero no coincide: ${choques.join(", ")}`);
  console.log(`   verificada: perfil 200 · hoy 200 · cultivo=${u.cultivo} area=${u.area_m2} metodo=${u.metodo_riego} caudal=${u.caudal}`);
  informe.push({ ...item, resultado: "CREADA_Y_VERIFICADA" });
}

console.log("\n═══ RESUMEN ═══");
for (const i of informe) console.log(`  ${i.id}  ${i.resultado}${i.detalle ? " · " + i.detalle : ""}`);
const cuenta = informe.reduce((a, i) => ({ ...a, [i.resultado]: (a[i.resultado] || 0) + 1 }), {});
console.log(" ", JSON.stringify(cuenta));
console.log(APLICAR
  ? "\nFASE B.1 terminada. La confirmación de s.sync (B.2) va desde el navegador."
  : "\nDRY-RUN terminado. Nada escrito. Para aplicar: --aplicar");
