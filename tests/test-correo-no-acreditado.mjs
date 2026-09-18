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
let USUARIOS = [], ACCESOS = [], CORREOS = [], RESERVAS = [];
let SIN_TABLA_RESERVAS = false;   // el estado ANTES de ejecutar la migración

// ⚠️ BARRERA, para forzar el intercalado. Sin esto la carrera depende de que el
// planificador tenga a bien alternar, y un test que gana por casualidad no
// prueba nada. Aquí NADIE pasa de la lectura hasta que han llegado los N.
function barrera(n) {
  let llegados = 0, soltar;
  const puerta = new Promise(r => { soltar = r; });
  return async () => { if (++llegados >= n) soltar(); await puerta; };
}
let puertaLectura = null;   // si está puesta, toda lectura espera en la barrera
const sb = require(join(RAIZ, "api", "_supabase.js"));
sb.isConfigured = () => true;
sb.parseBody = (req) => req.body || {};          // log.js lo llama SIN await
sb.preludio = () => true;
sb.supabaseSelect = async (tabla, q) => {
  if (puertaLectura) await puertaLectura();
  if (tabla === "reservas_alta") {
    if (SIN_TABLA_RESERVAS) throw new Error('relation "reservas_alta" does not exist (42P01)');
    const e = /email=eq\.([^&]+)/.exec(q || "");
    const c = e ? decodeURIComponent(e[1]) : null;
    return RESERVAS.filter(r => !c || r.email === c);
  }
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
let fallarAltaUsuario = false;     // para simular la caída justo tras quemar
sb.supabaseInsert = async (tabla, fila) => {
  // ⚠️ LA CLAVE PRIMARIA, MODELADA COMO LA DE VERDAD. No se regala unicidad:
  // se rechaza el duplicado con el MISMO error que devuelve PostgREST, que es
  // el mecanismo del que depende la corrección. Si el código no lo usara bien,
  // este mock no lo taparía.
  if (tabla === "reservas_alta") {
    if (SIN_TABLA_RESERVAS) throw new Error('relation "reservas_alta" does not exist (42P01)');
    if (RESERVAS.some(r => r.email === fila.email)) {
      throw new Error('Supabase insert reservas_alta 409: duplicate key value violates unique constraint "reservas_alta_pkey" (23505)');
    }
    RESERVAS.push({ creado: new Date().toISOString(), ...fila });
    return [RESERVAS.at(-1)];
  }
  // `creado` lo pone la base por defecto (db/acceso-por-email-2026-08-07.sql).
  // Sin él aquí, el tope por hora no vería nada y estaríamos probando el arnés.
  if (tabla === "accesos") {
    ACCESOS.push({ creado: new Date().toISOString(), ...fila, id: "acc-" + ACCESOS.length });
    return [ACCESOS.at(-1)];
  }
  if (tabla !== "usuarios") return [fila];
  if (fallarAltaUsuario) throw new Error("la base no responde");
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
// El tope declarado en _acceso.js. Se usa para DECIR que no es atómico, no para
// fingir que lo es.
const MAX_ESPERADO_SI_FUERA_ATOMICO = 5;

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

console.log("\n── A · correo NUEVO: el enlace llega, y la cuenta nace en el canje ──");
{
  USUARIOS = []; ACCESOS = []; CORREOS = [];
  await conInfra(async () => {
    const r = await ACCESO.pedir({ email: "nuevo@ejemplo.es" }, "1.2.3.4");
    ok(r.estado === 200 && r.cuerpo.enviado === true, "se manda enlace a un correo que no es de nadie");
    ok(USUARIOS.length === 0, "y ANTES del canje no existe ni una fila de usuarios");
    ok(ACCESOS.length === 1, "hay un acceso pendiente");
    const a = ACCESOS[0];
    ok(!!a.token_hash && a.token_hash.length === 64, "con la HUELLA del token, nunca el token");
    ok(!CORREOS[0].html.includes(a.token_hash), "y la huella no viaja en el correo");
    ok(a.email === "nuevo@ejemplo.es", "el correo, normalizado");
    ok(!!a.expira && new Date(a.expira) > new Date(), "con caducidad");
    ok(a.usado_en == null, "y sin consumir");

    const token = tokenDelUltimoCorreo();
    const c = await ACCESO.canjear({ token });
    ok(c.estado === 200 && c.cuerpo.ok === true, "el canje vale");
    ok(USUARIOS.length === 1, `y AHORA nace exactamente un propietario (${USUARIOS.length})`);
    const dueño = USUARIOS[0];
    ok(dueño.id === c.cuerpo.propietario_id && dueño.propietario_id === dueño.id,
       "que es dueño de sí mismo");
    ok(dueño.email === "nuevo@ejemplo.es", "con el correo asociado SOLO a esa fila");
    ok(Array.isArray(c.cookies) && /kylia_sesion=/.test(c.cookies[0] || "")
       && /HttpOnly/.test(c.cookies[0]) && /Secure/.test(c.cookies[0]),
       "y una cookie firmada, HttpOnly y Secure");
    ok(ACCESOS[0].usado_en != null, "el acceso queda consumido");
  });
}

console.log("\n── B · correo de un ÚNICO propietario ──");
{
  USUARIOS = [{ id: DUEÑO, propietario_id: DUEÑO, email: null, nombre: "Agricultor" },
              { id: ZONA,  propietario_id: DUEÑO, email: CORREO }];
  const antesZona = copia(USUARIOS[1]);
  const cuantos = USUARIOS.length;
  ACCESOS = []; CORREOS = [];
  await conInfra(async () => {
    await ACCESO.pedir({ email: CORREO }, "1.2.3.4");
    ok(ACCESOS[0].propietario_id === DUEÑO, "el acceso apunta a su propietario, no a uno nuevo");
    const c = await ACCESO.canjear({ token: tokenDelUltimoCorreo() });
    ok(c.cuerpo.propietario_id === DUEÑO, "el canje devuelve el MISMO propietario");
    ok(USUARIOS.length === cuantos, `cero propietarios nuevos (${USUARIOS.length})`);
    ok(USUARIOS.find(f => f.id === DUEÑO).email === CORREO,
       "el correo se asocia a la fila propietaria, que no lo tenía");
    ok(JSON.stringify(USUARIOS.find(f => f.id === ZONA)) === JSON.stringify(antesZona),
       "y la fila de su ZONA no se toca");
  });
}

console.log("\n── C · correo ambiguo entre propietarios ──");
{
  USUARIOS = [{ id: "x-1", propietario_id: "x-1", email: "ambiguo@ejemplo.es" },
              { id: "y-1", propietario_id: "y-1", email: "ambiguo@ejemplo.es" }];
  const antes = copia(USUARIOS);
  ACCESOS = []; CORREOS = [];
  await conInfra(async () => {
    const r = await ACCESO.pedir({ email: "ambiguo@ejemplo.es" }, "1.2.3.4");
    ok(r.estado === 200 && r.cuerpo.enviado === true,
       "por fuera la respuesta es la de siempre: no se confirma ni se desmiente");
    ok(ACCESOS.length === 0, "pero NO se crea acceso: no se elige un propietario a dedo");
    ok(CORREOS.length === 0, "ni se manda enlace");
    ok(USUARIOS.length === 2 && JSON.stringify(USUARIOS) === JSON.stringify(antes),
       "cero propietarios nuevos y cero asociación");
    const q = await propietarioPorEmail("ambiguo@ejemplo.es");
    ok(Array.isArray(q.conflicto), "el conflicto sigue siendo explícito, para poder verlo");
  });
}

console.log("\n── D · el mismo enlace, dos veces y a la vez ──");
{
  USUARIOS = []; ACCESOS = []; CORREOS = [];
  await conInfra(async () => {
    await ACCESO.pedir({ email: "carrera@ejemplo.es" }, "1.2.3.4");
    const token = tokenDelUltimoCorreo();
    const [a, b] = await Promise.all([ACCESO.canjear({ token }), ACCESO.canjear({ token })]);
    const buenos = [a, b].filter(r => r.estado === 200 && r.cuerpo.ok);
    ok(buenos.length === 1, `solo UNO de los dos canjeos vale (${buenos.length})`);
    ok(USUARIOS.length === 1, `y nace como mucho un propietario (${USUARIOS.length})`);
    const malo = [a, b].find(r => !(r.estado === 200 && r.cuerpo.ok));
    ok(malo.estado === 400 && !malo.cuerpo.propietario_id,
       "el otro no adopta nada, con un mensaje genérico");
    ok(!malo.cookies, "ni recibe cookie");
    const tercera = await ACCESO.canjear({ token });
    ok(tercera.estado === 400 && USUARIOS.length === 1,
       "reintentar el enlace ya usado no crea nada");
  });
}

console.log("\n── D bis · enlace caducado o manipulado ──");
{
  USUARIOS = []; ACCESOS = []; CORREOS = [];
  await conInfra(async () => {
    await ACCESO.pedir({ email: "caduca@ejemplo.es" }, "1.2.3.4");
    const token = tokenDelUltimoCorreo();
    ACCESOS[0].expira = new Date(Date.now() - 1000).toISOString();
    const r = await ACCESO.canjear({ token });
    ok(r.estado === 400 && USUARIOS.length === 0, "un enlace caducado no crea propietario");
    const m = await ACCESO.canjear({ token: token.slice(0, -3) + "zzz" });
    ok(m.estado === 400 && USUARIOS.length === 0, "y uno manipulado, tampoco");
    ok(JSON.stringify(r.cuerpo) === JSON.stringify(m.cuerpo),
       `con el MISMO motivo genérico: no se dice cuál de las tres cosas pasó (${JSON.stringify(m.cuerpo)})`);
  });
}

console.log("\n── G · el canje se cae DESPUÉS de quemar el enlace ──");
{
  USUARIOS = []; ACCESOS = []; CORREOS = [];
  await conInfra(async () => {
    await ACCESO.pedir({ email: "remate@ejemplo.es" }, "1.2.3.4");
    const token = tokenDelUltimoCorreo();
    const reservado = ACCESOS[0].propietario_id;

    // La base se cae justo cuando toca crear el propietario.
    fallarAltaUsuario = true;
    const roto = await ACCESO.canjear({ token });
    fallarAltaUsuario = false;
    ok(roto.estado === 500, `el canje falla y lo dice (${roto.estado})`);
    ok(USUARIOS.length === 0, "no hay cuenta");
    ok(ACCESOS[0].usado_en != null, "y el enlace YA está consumido: este es el caso feo");

    // Un duplicado EN VUELO no remata: podría ser la misma petición dos veces.
    const enVuelo = await ACCESO.canjear({ token });
    ok(enVuelo.estado === 400 && USUARIOS.length === 0,
       "un reintento inmediato no remata: podría ser un duplicado simultáneo");

    // ⚠️ Y AQUÍ ESTABA EL AGUJERO: con `usado_en` puesto y sin cuenta, el enlace
    // quedaba muerto para siempre. Pasada la ventana de vuelo —una persona que
    // lee el error y vuelve a pulsar tarda mucho más—, se puede rematar.
    ACCESOS[0].usado_en = new Date(Date.now() - 30_000).toISOString();
    const bueno = await ACCESO.canjear({ token });
    ok(bueno.estado === 200 && bueno.cuerpo.ok === true, "el mismo enlace remata el canje");
    ok(USUARIOS.length === 1, `y nace UNA cuenta, no dos (${USUARIOS.length})`);
    ok(USUARIOS[0].id === reservado,
       "que es EXACTAMENTE el propietario reservado al pedir el enlace, no otro");
    ok(USUARIOS[0].email === "remate@ejemplo.es", "con el correo del acceso, no otro");
    ok(Array.isArray(bueno.cookies) && /kylia_sesion=/.test(bueno.cookies[0] || ""),
       "y se emite su sesión");

    // Rematado una vez, ya no vale más: un enlace usado no vuelve a identificar.
    const tercera = await ACCESO.canjear({ token });
    ok(tercera.estado === 400 && USUARIOS.length === 1,
       "y a partir de ahí el enlace está gastado: cero replay");
  });
}

console.log("\n── G bis · el remate, también concurrente ──");
{
  USUARIOS = []; ACCESOS = []; CORREOS = [];
  await conInfra(async () => {
    await ACCESO.pedir({ email: "carrera2@ejemplo.es" }, "1.2.3.4");
    const token = tokenDelUltimoCorreo();
    fallarAltaUsuario = true;
    await ACCESO.canjear({ token });          // se cae y deja el enlace quemado
    fallarAltaUsuario = false;
    ACCESOS[0].usado_en = new Date(Date.now() - 30_000).toISOString();   // ya no está en vuelo

    // Dos reintentos a la vez sobre un canje a medias.
    const [a, b] = await Promise.all([ACCESO.canjear({ token }), ACCESO.canjear({ token })]);
    ok(USUARIOS.length === 1, `como máximo UNA cuenta (${USUARIOS.length})`);
    const ids = new Set(USUARIOS.map(u => u.id));
    ok(ids.size === 1, "y un solo propietario, el reservado");
    const correos = new Set(USUARIOS.map(u => u.email));
    ok(correos.size === 1 && USUARIOS[0].email === "carrera2@ejemplo.es",
       "con un solo correo asociado, el del acceso");
    ok([a, b].some(r => r.estado === 200 && r.cuerpo.ok), "al menos uno completa");
    ok([a, b].every(r => r.estado === 200 ? r.cuerpo.propietario_id === USUARIOS[0].id : true),
       "y si completan los dos, es la MISMA cuenta");
  });
}

console.log("\n── G ter · el remate NO resucita un enlace caducado ──");
{
  USUARIOS = []; ACCESOS = []; CORREOS = [];
  await conInfra(async () => {
    await ACCESO.pedir({ email: "tarde@ejemplo.es" }, "1.2.3.4");
    const token = tokenDelUltimoCorreo();
    fallarAltaUsuario = true;
    await ACCESO.canjear({ token });
    fallarAltaUsuario = false;
    ACCESOS[0].usado_en = new Date(Date.now() - 30_000).toISOString();
    // Pasa la ventana de validez.
    ACCESOS[0].expira = new Date(Date.now() - 1000).toISOString();
    const r = await ACCESO.canjear({ token });
    ok(r.estado === 400 && USUARIOS.length === 0,
       "fuera de la ventana no se remata nada: la caducidad manda");
    // Y la salida es pedir otro enlace, que sigue funcionando.
    ACCESOS = []; CORREOS = [];
    const otro = await ACCESO.pedir({ email: "tarde@ejemplo.es" }, "1.2.3.4");
    ok(otro.estado === 200 && ACCESOS.length === 1,
       "se puede pedir otro enlace: el usuario no queda sin salida");
  });
}

console.log("\n── G quater · si la cuenta SÍ se creó, el enlace está gastado ──");
{
  USUARIOS = []; ACCESOS = []; CORREOS = [];
  await conInfra(async () => {
    await ACCESO.pedir({ email: "completo@ejemplo.es" }, "1.2.3.4");
    const token = tokenDelUltimoCorreo();
    const primera = await ACCESO.canjear({ token });
    ok(primera.estado === 200 && USUARIOS.length === 1, "el canje completa a la primera");
    const otra = await ACCESO.canjear({ token });
    ok(otra.estado === 400, "y el enlace ya no vale: no hay replay por la puerta del remate");
    ok(!otra.cookies, "sin cookie");
    ok(USUARIOS.length === 1, "y sigue habiendo una sola cuenta");
  });
}

console.log("\n── BLOQUEANTE 2 · dos enlaces del mismo correo, UNA cuenta ──");
{
  USUARIOS = []; ACCESOS = []; CORREOS = [];
  await conInfra(async () => {
    // Se piden DOS enlaces antes de canjear ninguno. Es lo más normal: no llega
    // el primero, o llega a spam, y se vuelve a pedir.
    await ACCESO.pedir({ email: "dos@ejemplo.es" }, "1.2.3.4");
    const token1 = tokenDelUltimoCorreo();
    await ACCESO.pedir({ email: "dos@ejemplo.es" }, "1.2.3.4");
    const token2 = tokenDelUltimoCorreo();
    ok(ACCESOS.length === 2 && token1 !== token2, "hay dos enlaces distintos");
    ok(ACCESOS[0].propietario_id === ACCESOS[1].propietario_id,
       "pero los dos apuntan al MISMO propietario reservado");

    const a = await ACCESO.canjear({ token: token1 });
    ok(a.estado === 200, "el primero canjea");
    ok(USUARIOS.length === 1, `y nace una cuenta (${USUARIOS.length})`);
    const b = await ACCESO.canjear({ token: token2 });
    ok(USUARIOS.length === 1, `el segundo NO crea otra: sigue habiendo una (${USUARIOS.length})`);
    // Y SÍ le deja entrar, que es lo correcto: es un enlace válido, sin usar y
    // sin caducar, que llegó a SU buzón. Pedir el enlace dos veces y abrir el
    // segundo es lo que hace cualquiera cuando el primero tarda.
    ok(b.estado === 200 && b.cuerpo.propietario_id === USUARIOS[0].id,
       "y le deja entrar en la MISMA cuenta: es su enlace, sin usar y sin caducar");

    // Y lo que de verdad importa: ese correo NO queda en conflicto.
    const q = await propietarioPorEmail("dos@ejemplo.es");
    ok(!q.conflicto && q.propietario_id === USUARIOS[0].id,
       "el correo sigue resolviendo a un único dueño");
    ACCESOS = []; CORREOS = [];
    const otro = await ACCESO.pedir({ email: "dos@ejemplo.es" }, "1.2.3.4");
    ok(otro.estado === 200 && CORREOS.length === 1,
       "así que puede seguir pidiendo enlaces: no se ha roto su cuenta");
  });
}

console.log("\n── …y tres enlaces canjeados en orden inverso, igual ──");
{
  USUARIOS = []; ACCESOS = []; CORREOS = [];
  await conInfra(async () => {
    const tokens = [];
    for (let i = 0; i < 3; i++) {
      await ACCESO.pedir({ email: "tres@ejemplo.es" }, "1.2.3.4");
      tokens.push(tokenDelUltimoCorreo());
    }
    ok(new Set(ACCESOS.map(a => a.propietario_id)).size === 1,
       "los tres reservan el mismo propietario");
    const res = [];
    for (const t of tokens.reverse()) res.push(await ACCESO.canjear({ token: t }));
    ok(USUARIOS.length === 1, `una sola cuenta (${USUARIOS.length})`);
    ok(res.every(r => r.estado === 200), "los tres enlaces valen: son suyos y ninguno estaba usado");
    ok(new Set(res.map(r => r.cuerpo.propietario_id)).size === 1,
       "y los tres llevan al MISMO propietario");
    // Cada uno se gasta al usarse.
    const repetido = await ACCESO.canjear({ token: tokens[0] });
    ok(repetido.estado === 400, "y cada enlace sigue siendo de un solo uso");
  });
}

console.log("\n── BLOQUEANTE 3 · el remate también es de un solo uso ──");
{
  USUARIOS = []; ACCESOS = []; CORREOS = [];
  await conInfra(async () => {
    await ACCESO.pedir({ email: "remate2@ejemplo.es" }, "1.2.3.4");
    const token = tokenDelUltimoCorreo();
    fallarAltaUsuario = true;
    await ACCESO.canjear({ token });             // se cae con el enlace ya quemado
    fallarAltaUsuario = false;
    ACCESOS[0].usado_en = new Date(Date.now() - 30_000).toISOString();

    // DOS reintentos a la vez. Antes pasaban los dos y daban cookie los dos.
    const [a, b] = await Promise.all([ACCESO.canjear({ token }), ACCESO.canjear({ token })]);
    const conSesion = [a, b].filter(r => r.estado === 200 && r.cookies?.length);
    ok(conSesion.length === 1,
       `solo UNO de los dos reintentos identifica (${conSesion.length})`);
    ok(USUARIOS.length === 1, "y sigue habiendo una sola cuenta");
    const otro = [a, b].find(r => !(r.estado === 200 && r.cookies?.length));
    ok(otro.estado === 400 && !otro.cookies, "el otro sale sin sesión y con el motivo genérico");
  });
}

console.log("\n── …y la petición original que termina TARDE tampoco duplica ──");
{
  USUARIOS = []; ACCESOS = []; CORREOS = [];
  await conInfra(async () => {
    await ACCESO.pedir({ email: "tarde2@ejemplo.es" }, "1.2.3.4");
    const token = tokenDelUltimoCorreo();
    const reservado = ACCESOS[0].propietario_id;

    // La original se queda colgada creando la cuenta; mientras, alguien remata.
    fallarAltaUsuario = true;
    await ACCESO.canjear({ token });
    fallarAltaUsuario = false;
    ACCESOS[0].usado_en = new Date(Date.now() - 30_000).toISOString();
    const remate = await ACCESO.canjear({ token });
    ok(remate.estado === 200 && USUARIOS.length === 1, "el remate completa la cuenta");

    // Y ahora llega la original, tardísimo: la fila ya está.
    ACCESOS[0].usado_en = new Date(Date.now() - 30_000).toISOString();
    const original = await ACCESO.canjear({ token });
    ok(original.estado === 400 && !original.cookies,
       "la original llega tarde, se encuentra la cuenta hecha y NO identifica");
    ok(USUARIOS.length === 1 && USUARIOS[0].id === reservado,
       "una sola cuenta, la reservada");
  });
}

console.log("\n══ CONCURRENCIA · la reserva del propietario ══");

const limpio = () => { USUARIOS = []; ACCESOS = []; CORREOS = []; RESERVAS = []; };
const tokenDe = (i) => /\/app\?acceso=([A-Za-z0-9_-]+)/.exec(CORREOS[i]?.html || "")?.[1] || null;
const canjearTodos = async () => {
  const res = [];
  for (let i = 0; i < CORREOS.length; i++) {
    const t = tokenDe(i);
    if (t) res.push(await ACCESO.canjear({ token: t }));
  }
  return res;
};

console.log("\n── A · dos solicitudes simultáneas, correo nuevo ──");
{
  limpio();
  await conInfra(async () => {
    // ⚠️ LAS DOS LEEN ANTES DE QUE NINGUNA ESCRIBA. Es el intercalado exacto que
    // rompía: ambas ven que no hay reserva y ambas se inventan un uuid.
    puertaLectura = barrera(2);
    await Promise.all([
      ACCESO.pedir({ email: "a@ejemplo.es" }, "1.2.3.4"),
      ACCESO.pedir({ email: "a@ejemplo.es" }, "1.2.3.4"),
    ]);
    puertaLectura = null;
    ok(ACCESOS.length === 2, `se crean los dos accesos (${ACCESOS.length})`);
    const reservas = [...new Set(ACCESOS.map(a => a.propietario_id))];
    ok(reservas.length === 1, `pero apuntan al MISMO propietario (${reservas.length} reserva)`);
    ok(RESERVAS.length === 1, `y solo hay una reserva en la base (${RESERVAS.length})`);

    const res = await canjearTodos();
    ok(USUARIOS.length === 1, `al canjear los dos, UNA sola cuenta (${USUARIOS.length})`);
    const q = await propietarioPorEmail("a@ejemplo.es");
    ok(!q.conflicto && q.propietario_id === USUARIOS[0].id,
       "el correo resuelve a un único dueño: cero conflicto");
    ok(res.filter(r => r.estado === 200).length >= 1, "y puede entrar");
  });
}

console.log("\n── B · veinte solicitudes concurrentes ──");
{
  limpio();
  await conInfra(async () => {
    puertaLectura = barrera(20);
    const rs = await Promise.all(Array.from({ length: 20 },
      () => ACCESO.pedir({ email: "b@ejemplo.es" }, "1.2.3.4")));
    puertaLectura = null;
    ok(RESERVAS.length === 1, `una sola identidad de propietario (${RESERVAS.length})`);
    ok(new Set(ACCESOS.map(a => a.propietario_id)).size <= 1,
       "y todos los accesos creados apuntan a ella");
    const res = await canjearTodos();
    ok(USUARIOS.length === 1, `una sola cuenta (${USUARIOS.length})`);
    ok(!(await propietarioPorEmail("b@ejemplo.es")).conflicto, "sin conflicto de correo");
    // ⚠️ EL TOPE POR HORA NO ES ATÓMICO, y no se va a afirmar que lo sea: son
    // SELECT + contar + INSERT, y con 20 peticiones que leen a la vez todas ven
    // cero. Se dice lo que se observa.
    ok(ACCESOS.length > MAX_ESPERADO_SI_FUERA_ATOMICO,
       `el tope por hora NO es atómico: con 20 simultáneas pasan ${ACCESOS.length}, no ${MAX_ESPERADO_SI_FUERA_ATOMICO}`);
    ok(rs.every(r => r.estado === 200), "por fuera todas responden igual: no enumera");
  });
}

console.log("\n── C · dos enlaces distintos, canje SIMULTÁNEO ──");
{
  limpio();
  await conInfra(async () => {
    await ACCESO.pedir({ email: "c@ejemplo.es" }, "1.2.3.4");
    await ACCESO.pedir({ email: "c@ejemplo.es" }, "1.2.3.4");
    ok(new Set(ACCESOS.map(a => a.propietario_id)).size === 1, "los dos enlaces, misma reserva");
    const [x, y] = await Promise.all([
      ACCESO.canjear({ token: tokenDe(0) }),
      ACCESO.canjear({ token: tokenDe(1) }),
    ]);
    ok(USUARIOS.length === 1, `una sola cuenta (${USUARIOS.length})`);
    const estados = [x, y].map(r => r.estado).sort();
    ok(estados.filter(e => e === 200).length >= 1, `alguno entra (estados: ${estados.join(", ")})`);
    // Lo que NO puede pasar: que la carrera le deje sin acceso para siempre.
    const q = await propietarioPorEmail("c@ejemplo.es");
    ok(!q.conflicto, "y el correo NO queda en conflicto");
    CORREOS.length = 0;
    const otro = await ACCESO.pedir({ email: "c@ejemplo.es" }, "1.2.3.4");
    ok(otro.estado === 200 && CORREOS.length === 1,
       "puede pedir otro enlace: la carrera no le inutiliza el acceso");
    const ultimo = await ACCESO.canjear({ token: tokenDe(0) });
    ok(ultimo.estado === 200 && ultimo.cuerpo.propietario_id === USUARIOS[0].id,
       "y entra en su cuenta de siempre");
  });
}

console.log("\n── D · solicitud con timeout y escritura TARDÍA ──");
{
  limpio();
  await conInfra(async () => {
    // La primera se queda colgada justo antes de insertar su acceso; mientras,
    // llega la segunda y termina. Después la primera despierta y escribe.
    let soltar; const colgada = new Promise(r => { soltar = r; });
    const insertOriginal = sb.supabaseInsert;
    let primera = true;
    sb.supabaseInsert = async (tabla, fila) => {
      if (tabla === "accesos" && primera) { primera = false; await colgada; }
      return insertOriginal(tabla, fila);
    };
    const tarde = ACCESO.pedir({ email: "d@ejemplo.es" }, "1.2.3.4");
    await new Promise(r => setTimeout(r, 30));
    const pronto = await ACCESO.pedir({ email: "d@ejemplo.es" }, "1.2.3.4");
    ok(pronto.estado === 200, "la segunda termina");
    soltar();
    await tarde;
    sb.supabaseInsert = insertOriginal;
    ok(RESERVAS.length === 1, `una sola reserva pese a la escritura tardía (${RESERVAS.length})`);
    ok(new Set(ACCESOS.map(a => a.propietario_id)).size === 1, "y los dos accesos comparten propietario");
    await canjearTodos();
    ok(USUARIOS.length === 1, `una sola cuenta (${USUARIOS.length})`);
  });
}

console.log("\n── G · cuenta YA existente: ninguna reserva la desvía ──");
{
  limpio();
  const YA = "eeeeeeee-1111-1111-1111-111111111111";
  USUARIOS = [{ id: YA, propietario_id: YA, email: "g@ejemplo.es" }];
  // Y una reserva vieja, de cuando ese correo no tenía cuenta.
  RESERVAS = [{ email: "g@ejemplo.es", propietario_id: "ffffffff-2222-2222-2222-222222222222" }];
  await conInfra(async () => {
    puertaLectura = barrera(3);
    await Promise.all([
      ACCESO.pedir({ email: "g@ejemplo.es" }, "1.2.3.4"),
      ACCESO.pedir({ email: "g@ejemplo.es" }, "1.2.3.4"),
      ACCESO.pedir({ email: "g@ejemplo.es" }, "1.2.3.4"),
    ]);
    puertaLectura = null;
    ok(ACCESOS.every(a => a.propietario_id === YA),
       "todos los enlaces apuntan al propietario que YA existe");
    const res = await canjearTodos();
    ok(USUARIOS.length === 1, `no nace ninguna cuenta alternativa (${USUARIOS.length})`);
    ok(res.every(r => r.estado !== 200 || r.cuerpo.propietario_id === YA),
       "y quien entra, entra en la suya");
  });
}

console.log("\n── H · dos propietarios históricos con el mismo correo ──");
{
  limpio();
  USUARIOS = [{ id: "h-1", propietario_id: "h-1", email: "h@ejemplo.es" },
              { id: "h-2", propietario_id: "h-2", email: "h@ejemplo.es" }];
  const antes = copia(USUARIOS);
  await conInfra(async () => {
    puertaLectura = barrera(2);
    const rs = await Promise.all([
      ACCESO.pedir({ email: "h@ejemplo.es" }, "1.2.3.4"),
      ACCESO.pedir({ email: "h@ejemplo.es" }, "1.2.3.4"),
    ]);
    puertaLectura = null;
    ok(rs.every(r => r.estado === 200), "por fuera, la respuesta de siempre");
    ok(ACCESOS.length === 0 && CORREOS.length === 0, "cero accesos y cero enlaces");
    ok(RESERVAS.length === 0, "y CERO reservas: no se inventa un dueño para desatascarlo");
    ok(JSON.stringify(USUARIOS) === JSON.stringify(antes), "cero modificación de datos");
  });
}

console.log("\n── sin la tabla de reservas: error explícito, no carrera abierta ──");
{
  limpio();
  SIN_TABLA_RESERVAS = true;
  await conInfra(async () => {
    const r = await ACCESO.pedir({ email: "sintabla@ejemplo.es" }, "1.2.3.4");
    ok(r.estado === 503 && r.cuerpo.falta?.includes("reservas_alta"),
       `sin la migración no se dan altas nuevas: ${JSON.stringify(r.cuerpo)}`);
    ok(ACCESOS.length === 0 && CORREOS.length === 0, "cero accesos, cero enlaces");
    ok(USUARIOS.length === 0, "y cero cuentas");
    // Pero una cuenta que YA existe sigue pudiendo entrar: ese camino no reserva.
    USUARIOS = [{ id: "z-1", propietario_id: "z-1", email: "z@ejemplo.es" }];
    const bueno = await ACCESO.pedir({ email: "z@ejemplo.es" }, "1.2.3.4");
    ok(bueno.estado === 200 && CORREOS.length === 1,
       "y quien ya tiene cuenta no se ve afectado por la migración pendiente");
  });
  SIN_TABLA_RESERVAS = false;
}

console.log("\n── F · tope por hora y no enumeración ──");
{
  await conInfra(async () => {
    USUARIOS = [{ id: DUEÑO, propietario_id: DUEÑO, email: CORREO }];
    ACCESOS = []; CORREOS = [];
    const existe = await ACCESO.pedir({ email: CORREO }, "1.2.3.4");
    USUARIOS = []; ACCESOS = []; CORREOS = [];
    const noExiste = await ACCESO.pedir({ email: "no-existe@ejemplo.es" }, "1.2.3.4");
    USUARIOS = [{ id: "x-1", propietario_id: "x-1", email: "amb@ejemplo.es" },
                { id: "y-1", propietario_id: "y-1", email: "amb@ejemplo.es" }];
    ACCESOS = []; CORREOS = [];
    const ambiguo = await ACCESO.pedir({ email: "amb@ejemplo.es" }, "1.2.3.4");
    const cuerpos = [existe, noExiste, ambiguo].map(r => JSON.stringify({ e: r.estado, c: r.cuerpo }));
    ok(new Set(cuerpos).size === 1,
       `la respuesta es IDÉNTICA exista, no exista o sea ambiguo: ${cuerpos[0]}`);

    USUARIOS = [{ id: DUEÑO, propietario_id: DUEÑO, email: CORREO }];
    ACCESOS = []; CORREOS = [];
    let ultima = null;
    for (let i = 0; i < 8; i++) ultima = await ACCESO.pedir({ email: CORREO }, "1.2.3.4");
    ok(CORREOS.length < 8, `el tope por hora corta los envíos (${CORREOS.length} de 8)`);
    ok(JSON.stringify({ e: ultima.estado, c: ultima.cuerpo }) === cuerpos[0],
       "y la respuesta del que se corta es la misma: tampoco enumera por ahí");
  });
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

console.log("\n── H · la interfaz tampoco delata el conflicto ──");
{
  const APP = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
  const NEUTRO = "Si no lo recibes, contacta con soporte";
  // Los DOS sitios que piden enlace dicen lo mismo, y ofrecen la salida.
  const dice = (APP.match(/Si no lo recibes, contacta con soporte/g) || []).length;
  ok(dice === 2, `los dos caminos de "mándame el enlace" ofrecen soporte (${dice})`);
  // Y en ningún sitio se nombra el conflicto delante del usuario.
  const visible = APP.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!/varios propietarios|conflicto de correo|correo duplicado|duplicad[oa] .*cuenta/i.test(visible),
     "y ningún texto de pantalla menciona que el correo esté en conflicto");
  // El servidor sí lo deja en su log, que es donde tiene que estar.
  const src = readFileSync(join(RAIZ, "api", "_acceso.js"), "utf8");
  ok(/console\.error\("\[acceso\] email con varios propietarios/.test(src),
     "el motivo real queda en el log del servidor");
  // Y existe el procedimiento escrito para resolverlo.
  const doc = readFileSync(join(RAIZ, "docs", "tecnico", "correo-ambiguo-soporte.md"), "utf8");
  ok(/no se sobrescribe ninguna cuenta/i.test(doc),
     "la nota de soporte parte de no sobrescribir cuentas");
  ok(/update usuarios set email = null/i.test(doc) && /propietario_id, id\) <> /.test(doc),
     "y da la escritura mínima: quitar el correo del lado que no es suyo");
  ok(/No\*\* se borra la cuenta/i.test(doc), "sin borrar la cuenta sobrante");
}

console.log("\n── la migración y el código dicen lo mismo ──");
{
  // ⚠️ SI ESTO SE SEPARA, LA GARANTÍA DESAPARECE SIN RUIDO. La unicidad la da la
  // clave primaria de `reservas_alta`; si la migración dejara de declararla, o
  // el código escribiera en otra tabla u otra columna, la carrera volvería a
  // estar abierta y los tests —que modelan la PK— seguirían en verde.
  const mig = readFileSync(join(RAIZ, "db", "reserva-alta-2026-09-18.sql"), "utf8");
  ok(/create table if not exists\s+reservas_alta/i.test(mig), "la migración es idempotente");
  ok(/email\s+text\s+primary key/i.test(mig),
     "y la clave primaria es el CORREO: ahí vive la exclusión");
  ok(/propietario_id\s+uuid\s+not null/i.test(mig), "con el propietario reservado, obligatorio");
  ok(!/unique\s*\(\s*email\s*\)/i.test(mig) || !/on\s+usuarios/i.test(mig),
     "y NO se impone unique(email) sobre usuarios: las zonas legacy comparten correo");

  const src = readFileSync(join(RAIZ, "api", "_acceso.js"), "utf8");
  ok(/supabaseInsert\("reservas_alta",\s*\{ email, propietario_id/.test(src),
     "el código inserta en esa tabla, con esas dos columnas");
  ok(/supabaseSelect\("reservas_alta"/.test(src), "y lee de ella al perder la carrera");
  ok(/23505|duplicate key/.test(src.slice(src.indexOf("async function reservarPropietario"),
                                          src.indexOf("async function pedir"))),
     "el camino bueno de la carrera es el 23505, no una comprobación previa");
  ok(/42P01/.test(src), "y si la tabla no está, se dice en vez de seguir sin garantía");
  // Y que no quede un randomUUID suelto decidiendo la identidad.
  const pedirSrc = src.slice(src.indexOf("async function pedir"), src.indexOf("async function canjear"));
  ok(!/crypto\.randomUUID\(\)/.test(pedirSrc),
     "pedir() ya no se inventa la identidad por su cuenta");
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
