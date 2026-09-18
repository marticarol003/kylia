// Un correo sin canjear es SIEMPRE un dato no acreditado.
//   node tests/test-correo-no-acreditado.mjs
//
// LA REGLA. Solo `api/_acceso.js`, después de canjear un enlace de un solo uso
// y con la sesión firmada emitible, puede asociar o modificar el correo de una
// cuenta. Ningún otro camino —`registro-usuario` incluido, y ningún cliente—
// puede escribirlo, ni aunque ese correo no exista todavía, ni aunque sea el de
// la propia fila, ni aunque el cliente diga que está identificado.
//
// EL DAÑO QUE CIERRA, MEDIDO. `registro-usuario` hace upsert de la fila por el
// UUID que el dispositivo tiene en localStorage y escribía el correo que
// alguien tecleara. Si era el de otra persona, su cuenta pasaba a tener dos
// filas con el mismo correo y propietarios distintos; `propietarioPorEmail`
// devolvía conflicto —correctamente: no elige a dedo— y `_acceso.pedir()`
// dejaba de mandarle el enlace. Se quedaba fuera de su cuenta, en silencio.
//
// ⚠️ LOS CORREOS QUE YA ESTÁN NO SE TOCAN. La regla es dejar de ESCRIBIR; no
// hay limpieza ni migración.
//
// Se ejecutan los handlers REALES. Solo se simula el transporte.
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

// ── La "base de datos" y el correo, simulados. La lógica, real ──────────
let USUARIOS = [], ACCESOS = [], CORREOS = [];
const sb = require(join(RAIZ, "api", "_supabase.js"));
sb.isConfigured = () => true;
sb.parseBody = (req) => req.body || {};          // log.js lo llama SIN await
sb.preludio = () => true;
sb.supabaseSelect = async (tabla, q) => {
  if (tabla === "accesos") {
    const h = /token_hash=eq\.([^&]+)/.exec(q || "");
    if (h) return ACCESOS.filter(a => a.token_hash === h[1]);
    const e = /email=eq\.([^&]+)/.exec(q || "");
    if (e) return ACCESOS.filter(a => a.email === decodeURIComponent(e[1]));
    return ACCESOS;
  }
  if (tabla !== "usuarios") return [];
  const e = /email=eq\.([^&]+)/.exec(q || "");
  if (e) {
    const c = decodeURIComponent(e[1]);
    return USUARIOS.filter(f => f.email === c).map(f => ({ id: f.id, propietario_id: f.propietario_id }));
  }
  const prop = /propietario_id=eq\.([^&]+)/.exec(q || "");
  if (prop) return USUARIOS.filter(f => f.propietario_id === prop[1]);
  const id = /id=eq\.([^&]+)/.exec(q || "");
  if (id) return USUARIOS.filter(f => f.id === id[1]);
  return USUARIOS;
};
sb.supabaseInsert = async (tabla, fila) => {
  if (tabla === "accesos") { ACCESOS.push({ ...fila, id: "acc-" + ACCESOS.length }); return [ACCESOS.at(-1)]; }
  if (tabla !== "usuarios") return [fila];
  const i = USUARIOS.findIndex(f => f.id === fila.id);
  if (i >= 0) USUARIOS[i] = { ...USUARIOS[i], ...fila };
  else USUARIOS.push({ ...fila });
  return [USUARIOS[i >= 0 ? i : USUARIOS.length - 1]];
};
sb.supabaseUpdate = async (tabla, q, datos) => {
  const id = /id=eq\.([^&]+)/.exec(q || "")?.[1];
  if (tabla === "accesos") {
    const a = ACCESOS.find(x => x.id === id);
    if (!a || (/usado_en=is\.null/.test(q) && a.usado_en)) return [];
    Object.assign(a, datos); return [a];
  }
  if (tabla === "usuarios") {
    const f = USUARIOS.find(x => x.id === id);
    if (!f) return [];
    Object.assign(f, datos); return [f];
  }
  return [];
};
// El envío de Resend: se intercepta para quedarse con el ENLACE de verdad.
const http = require(join(RAIZ, "api", "_http.js"));
http.fetchConTimeout = async (url, opts) => {
  if (/resend\.com/.test(url)) {
    const cuerpo = JSON.parse(opts?.body || "{}");
    CORREOS.push({ a: (cuerpo.to || [])[0], html: cuerpo.html || "" });
    return { ok: true, status: 200, text: async () => "" };
  }
  return { ok: false, status: 500, text: async () => "" };
};
const tokenDelUltimoCorreo = () =>
  /\/app\?acceso=([A-Za-z0-9_-]+)/.exec(CORREOS.at(-1)?.html || "")?.[1] || null;

const { propietarioPorEmail } = require(join(RAIZ, "api", "_propietario.js"));
const ACCESO = require(join(RAIZ, "api", "_acceso.js"));
const log = require(join(RAIZ, "api", "log.js"));

async function registrar(cuerpo) {
  let salida = null;
  const res = { status(c) { this._c = c; return this; },
                json(b) { salida = { codigo: this._c ?? 200, cuerpo: b }; return this; },
                setHeader() { return this; }, end() { return this; } };
  await log({ method: "POST", url: "/api/log", headers: {},
              body: { recurso: "registro-usuario", ...cuerpo } }, res);
  return salida;
}

// El entorno COMPLETO: es el único en el que el circuito se cierra.
async function conInfra(fn) {
  const g = { r: process.env.RESEND_API_KEY, s: process.env.SESION_SECRET };
  process.env.RESEND_API_KEY = "re_de_mentira";
  process.env.SESION_SECRET = "secreto-de-prueba-suficientemente-largo";
  try { return await fn(); }
  finally {
    if (g.r === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = g.r;
    if (g.s === undefined) delete process.env.SESION_SECRET; else process.env.SESION_SECRET = g.s;
  }
}

const DUEÑO   = "aaaaaaaa-1111-1111-1111-111111111111";
const ZONA    = "aaaaaaaa-3333-3333-3333-333333333333";
const INTRUSO = "bbbbbbbb-2222-2222-2222-222222222222";
const CORREO  = "agricultor@ejemplo.es";
const copia = (x) => JSON.parse(JSON.stringify(x));

console.log("── 1 · correo NUEVO, que no existe en ninguna fila, sin canje ──");
{
  USUARIOS = []; ACCESOS = []; CORREOS = [];
  const r = await registrar({ id: DUEÑO, email: CORREO, nombre: "Agricultor", ciudad: "Breda" });
  ok(r.codigo === 200, "la petición no falla: su fila se guarda");
  const fila = USUARIOS.find(f => f.id === DUEÑO);
  ok(!!fila && fila.ciudad === "Breda", "con lo que sí mandó");
  ok(fila.email == null, `y CERO escritura de correo, aunque no fuera de nadie (${JSON.stringify(fila.email)})`);
  ok(fila.origen == null, "ni de `origen`, que viaja con él");
  const q = await propietarioPorEmail(CORREO);
  ok(q.vacio === true, "ese correo sigue sin resolver a ningún propietario");
  ok(ACCESOS.length === 0 && CORREOS.length === 0, "y no se ha atribuido ningún enlace");
}

console.log("\n── 2 · el correo de la PROPIA fila, sin canje ──");
{
  USUARIOS = [{ id: DUEÑO, propietario_id: DUEÑO, email: CORREO, nombre: "Agricultor" }];
  const antes = copia(USUARIOS);
  await registrar({ id: DUEÑO, email: CORREO, nombre: "Agricultor J.", ciudad: "Breda" });
  const fila = USUARIOS.find(f => f.id === DUEÑO);
  ok(fila.email === CORREO, "el correo que YA estaba sigue exactamente igual: no se limpia nada");
  ok(fila.email === antes[0].email, "cero modificación del campo");
  ok(fila.nombre === "Agricultor J.", "y lo demás sí se actualiza: no se le rompe la app");
  ok((await propietarioPorEmail(CORREO)).propietario_id === DUEÑO, "y sigue resolviendo a su dueño");
}

console.log("\n── 3 · el correo de OTRO propietario, sin canje ──");
{
  USUARIOS = [{ id: DUEÑO, propietario_id: DUEÑO, email: CORREO },
              { id: ZONA,  propietario_id: DUEÑO, email: CORREO }];
  const antes = copia(USUARIOS);
  await registrar({ id: INTRUSO, email: CORREO, nombre: "Otro", ciudad: "Vic" });
  const suya = USUARIOS.find(f => f.id === INTRUSO);
  ok(!!suya && suya.ciudad === "Vic", "su fila se guarda, con lo suyo");
  ok(suya.email == null, "sin el correo ajeno");
  ok(JSON.stringify(USUARIOS.filter(f => antes.some(a => a.id === f.id))) === JSON.stringify(antes),
     "y ninguna fila del dueño se ha tocado");
  const q = await propietarioPorEmail(CORREO);
  ok(q.propietario_id === DUEÑO && !q.conflicto,
     "el dueño legítimo sigue resolviendo, sin conflicto fabricado");
  await conInfra(async () => {
    ACCESOS = []; CORREOS = [];
    const r = await ACCESO.pedir({ email: CORREO }, "1.2.3.4");
    ok(r.estado === 200, "pedir el enlace le sigue funcionando");
    ok(ACCESOS.length === 1 && ACCESOS[0].propietario_id === DUEÑO,
       `y el acceso se crea contra SU cuenta (${ACCESOS[0]?.propietario_id?.slice(0, 8)}…)`);
    ok(CORREOS.length === 1 && CORREOS[0].a === CORREO, "y el correo sale hacia él");
  });
}

console.log("\n── 4 · canje válido: SOLO entonces se asocia el correo ──");
{
  // La fila del propietario NO tiene correo. Una zona suya sí lo tenía por
  // historia, y una fila de OTRA persona también: ninguna de las dos se toca.
  USUARIOS = [{ id: DUEÑO, propietario_id: DUEÑO, email: null, nombre: "Agricultor", config_app: null },
              { id: ZONA,  propietario_id: DUEÑO, email: "viejo-de-zona@ejemplo.es" },
              { id: INTRUSO, propietario_id: INTRUSO, email: "otra-persona@ejemplo.es" }];
  ACCESOS = [{ id: "acc-0", email: CORREO, propietario_id: DUEÑO, token_hash: null,
               expira: new Date(Date.now() + 9e5).toISOString(), usado_en: null }];
  const antesZona = copia(USUARIOS.find(f => f.id === ZONA));
  const antesOtra = copia(USUARIOS.find(f => f.id === INTRUSO));

  await conInfra(async () => {
    // Se pide un enlace de verdad para tener el token en claro, que es lo único
    // que el sistema entrega: en la base solo vive su huella.
    ACCESOS = []; CORREOS = [];
    USUARIOS.find(f => f.id === DUEÑO).email = CORREO;   // para que `pedir` lo resuelva
    await ACCESO.pedir({ email: CORREO }, "1.2.3.4");
    const token = tokenDelUltimoCorreo();
    ok(!!token, "el enlace llega con su token de un solo uso");

    // Y ahora la situación que importa: la fila del propietario SIN correo.
    USUARIOS.find(f => f.id === DUEÑO).email = null;
    const r = await ACCESO.canjear({ token });
    ok(r.estado === 200 && r.cuerpo.ok === true, "el canje vale");
    ok(r.cuerpo.propietario_id === DUEÑO, "e identifica al propietario correcto");
    ok(USUARIOS.find(f => f.id === DUEÑO).email === CORREO,
       "AHORA sí: el correo queda asociado a su cuenta");
    ok(Array.isArray(r.cookies) && r.cookies.length === 1, "se emite la cookie de sesión");
    ok(/HttpOnly/.test(r.cookies[0]) && /Secure/.test(r.cookies[0]) && /kylia_sesion=/.test(r.cookies[0]),
       "firmada, HttpOnly y Secure");
    ok(JSON.stringify(USUARIOS.find(f => f.id === ZONA)) === JSON.stringify(antesZona),
       "la fila de su ZONA no se toca");
    ok(JSON.stringify(USUARIOS.find(f => f.id === INTRUSO)) === JSON.stringify(antesOtra),
       "y la de otra persona, tampoco");
    // Un solo uso.
    const otra = await ACCESO.canjear({ token });
    ok(otra.estado === 400, "y el enlace ya no vale una segunda vez");
  });
}

console.log("\n── 5 · sin SESION_SECRET o sin RESEND_API_KEY ──");
{
  USUARIOS = [{ id: DUEÑO, propietario_id: DUEÑO, email: CORREO }];
  const antes = copia(USUARIOS);
  const g = { r: process.env.RESEND_API_KEY, s: process.env.SESION_SECRET };
  delete process.env.RESEND_API_KEY; delete process.env.SESION_SECRET;
  ACCESOS = []; CORREOS = [];

  const r1 = await ACCESO.pedir({ email: CORREO }, "1.2.3.4");
  ok(r1.estado === 503 && r1.cuerpo.error === "acceso_no_configurado",
     `pedir responde 503 explícito, no un falso "ya va de camino" (${r1.estado})`);
  ok(r1.cuerpo.falta.includes("RESEND_API_KEY") && r1.cuerpo.falta.includes("SESION_SECRET"),
     `diciendo qué falta: ${JSON.stringify(r1.cuerpo.falta)}`);
  ok(ACCESOS.length === 0 && CORREOS.length === 0, "cero accesos creados, cero correos");

  const r2 = await ACCESO.canjear({ token: "un-token-cualquiera" });
  ok(r2.estado === 503 && r2.cuerpo.error === "acceso_no_configurado", "canjear tampoco: 503");
  ok(!r2.cuerpo.propietario_id && !r2.cuerpo.config, "cero adopción: ni propietario ni configuración");
  ok(!r2.cookies, "y ninguna cookie");
  ok(JSON.stringify(USUARIOS) === JSON.stringify(antes), "cero asociación: ninguna fila cambia");

  process.env.RESEND_API_KEY = "re_de_mentira";
  const r3 = await ACCESO.pedir({ email: CORREO }, "1.2.3.4");
  ok(r3.estado === 503 && r3.cuerpo.falta.join() === "SESION_SECRET",
     "con Resend pero sin SESION_SECRET, tampoco: el canje no podría emitir sesión");
  if (g.r === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = g.r;
  if (g.s === undefined) delete process.env.SESION_SECRET; else process.env.SESION_SECRET = g.s;
}

console.log("\n── un conflicto que YA existiera se sigue viendo ──");
{
  USUARIOS = [{ id: "x-1", propietario_id: "x-1", email: "viejo@ejemplo.es" },
              { id: "y-1", propietario_id: "y-1", email: "viejo@ejemplo.es" }];
  const q = await propietarioPorEmail("viejo@ejemplo.es");
  ok(Array.isArray(q.conflicto) && q.conflicto.length === 2,
     `mismo correo en propietarios distintos → conflicto explícito (${JSON.stringify(q.conflicto)})`);
  ok(q.propietario_id === undefined, "y no se elige uno a dedo");
}

console.log("\n── ningún cliente manda ya correos tecleados ──");
{
  const APP = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
  const sinComentarios = (t) => t.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const gate = sinComentarios(APP.slice(APP.indexOf('document.getElementById("gate-btn")'),
                                        APP.indexOf('// Enter en cualquier campo del gate')));
  ok(!/registroUsuario\s*\(/.test(gate), "el gate del piloto no llama a registroUsuario");
  ok(/waitlist/.test(gate), "y sigue apuntando el interés en /api/waitlist, que es su sitio");
  const pedir = sinComentarios(APP.slice(APP.indexOf('accion: "pedir"') - 1600,
                                         APP.indexOf('accion: "pedir"') + 200));
  ok(!/registroUsuario\s*\(/.test(pedir), "pedir el enlace tampoco escribe el correo en ninguna fila");
  // Ninguna llamada a registroUsuario lleva ya email ni origen.
  const limpio = sinComentarios(APP);
  const conEmail = [...limpio.matchAll(/registroUsuario\s*\(\{([\s\S]{0,700}?)\}\s*\)/g)]
    .filter(m => /\b(email|origen)\s*:/.test(m[1]));
  ok(conEmail.length === 0, `ninguna llamada manda email ni origen (${conEmail.length})`);
  const payload = APP.slice(APP.indexOf("function payloadSiembra("), APP.indexOf("function estable("));
  ok(!/\bemail\b\s*:/.test(payload), "y el payload de una siembra sigue sin llevar correo");
}

console.log(fallos ? `\n${fallos} test(s) FALLARON` : "\n✅ TODOS LOS TESTS VERDES");
process.exit(fallos ? 1 : 0);
