// Un correo tecleado no puede romperle el acceso a nadie.
//   node tests/test-correo-no-acreditado.mjs
//
// EL DAÑO, MEDIDO. `registro-usuario` hace upsert de la fila por el UUID que
// tiene el dispositivo en localStorage, y escribía el correo que alguien
// tecleara. Si ese correo era el de otra persona, su cuenta pasaba a tener dos
// filas con el mismo correo y propietarios DISTINTOS. Entonces
// `propietarioPorEmail` devuelve conflicto —correctamente: no elige a dedo— y
// `_acceso.pedir()` deja de mandar el enlace. El dueño legítimo se queda sin
// poder entrar en su cuenta, en silencio.
//
// Lo hacían dos sitios del cliente (el gate del piloto y el panel de "mándame
// el enlace") y los dos se han quitado. Pero la guarda que de verdad cierra
// esto está en el SERVIDOR, porque no puede depender de que ningún cliente se
// porte bien.
//
// Se ejecutan los handlers REALES. Solo se simula el transporte a Supabase.
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

// ── La "base de datos": una lista de filas, y las consultas que hace el código ──
let TABLA = [];
const sb = require(join(RAIZ, "api", "_supabase.js"));
sb.isConfigured = () => true;
sb.supabaseSelect = async (tabla, q) => {
  if (tabla !== "usuarios") return [];
  const email = /email=eq\.([^&]+)/.exec(q || "");
  if (email) {
    const c = decodeURIComponent(email[1]);
    return TABLA.filter(f => f.email === c).map(f => ({ id: f.id, propietario_id: f.propietario_id }));
  }
  const id = /id=eq\.([^&]+)/.exec(q || "");
  if (id) return TABLA.filter(f => f.id === id[1]);
  return TABLA;
};
sb.supabaseInsert = async (tabla, fila) => {
  if (tabla !== "usuarios") return [fila];
  const i = TABLA.findIndex(f => f.id === fila.id);
  // El upsert real escribe la fila entera; los campos ausentes no se tocan.
  if (i >= 0) TABLA[i] = { ...TABLA[i], ...fila };
  else TABLA.push({ ...fila });
  return [TABLA[i >= 0 ? i : TABLA.length - 1]];
};
sb.supabaseUpdate = async () => ({});
// ⚠️ SÍNCRONO: `log.js` hace `const body = parseBody(req)` sin await. Con un
// stub async el cuerpo llegaba como Promise y el recurso salía vacío.
sb.parseBody = (req) => req.body || {};
sb.preludio = () => true;

const { propietarioPorEmail } = require(join(RAIZ, "api", "_propietario.js"));
const log = require(join(RAIZ, "api", "log.js"));

async function registrar(cuerpo) {
  let salida = null;
  const res = { status(c) { this._c = c; return this; },
                json(b) { salida = { codigo: this._c ?? 200, cuerpo: b }; return this; },
                setHeader() { return this; }, end() { return this; } };
  await log({ method: "POST", url: "/api/log", headers: {}, body: { recurso: "registro-usuario", ...cuerpo } }, res);
  return salida;
}

const DUEÑO  = "aaaaaaaa-1111-1111-1111-111111111111";
const INTRUSO = "bbbbbbbb-2222-2222-2222-222222222222";
const ZONA_DEL_DUEÑO = "aaaaaaaa-3333-3333-3333-333333333333";
const CORREO = "agricultor@ejemplo.es";

console.log("── el dueño, con su correo ──");
{
  TABLA = [];
  await registrar({ id: DUEÑO, email: CORREO, nombre: "Agricultor" });
  const q = await propietarioPorEmail(CORREO);
  ok(q.propietario_id === DUEÑO, `su correo resuelve a su cuenta (${q.propietario_id?.slice(0, 8)}…)`);
  ok(TABLA.length === 1 && TABLA[0].email === CORREO, "un correo que no es de nadie sí se escribe: así nace una cuenta");
}

console.log("\n── otra parcela SUYA, con el mismo correo ──");
{
  await registrar({ id: ZONA_DEL_DUEÑO, propietario_id: DUEÑO, email: CORREO });
  const q = await propietarioPorEmail(CORREO);
  ok(q.propietario_id === DUEÑO,
     "varias filas del MISMO propietario con el mismo correo siguen resolviendo a él");
  ok(!q.conflicto, "y eso no es un conflicto");
}

console.log("\n── alguien teclea ESE correo en otro dispositivo ──");
{
  const antes = JSON.parse(JSON.stringify(TABLA));
  const r = await registrar({ id: INTRUSO, email: CORREO, nombre: "Otro", ciudad: "Vic" });
  ok(r.codigo === 200, "la petición no falla: su fila se guarda igual");
  const suya = TABLA.find(f => f.id === INTRUSO);
  ok(!!suya, "y existe");
  ok(suya.email == null, `pero SIN el correo ajeno (${JSON.stringify(suya.email)})`);
  ok(suya.ciudad === "Vic", "lo demás que mandó sí se guarda: no se le rompe la app");
  // Y sobre todo: el dueño legítimo no se entera de nada.
  const q = await propietarioPorEmail(CORREO);
  ok(q.propietario_id === DUEÑO, "el correo SIGUE resolviendo al dueño de verdad");
  ok(!q.conflicto, "no se ha fabricado ningún conflicto");
  const suyas = TABLA.filter(f => antes.some(a => a.id === f.id));
  ok(JSON.stringify(suyas) === JSON.stringify(antes),
     "y ninguna fila del dueño se ha tocado");
}

console.log("\n── y el enlace le sigue llegando ──");
{
  // `pedir()` consulta por `propietarioPorEmail`: si hubiera conflicto, callaría.
  const q = await propietarioPorEmail(CORREO);
  ok(!!q.propietario_id && !q.conflicto,
     "hay un propietario único, así que _acceso.pedir() puede mandar el enlace");
}

console.log("\n── un conflicto que YA existiera se sigue viendo ──");
{
  // Filas históricas, de antes de la guarda: el diagnóstico no se esconde.
  TABLA = [{ id: "x-1", propietario_id: "x-1", email: "viejo@ejemplo.es" },
           { id: "y-1", propietario_id: "y-1", email: "viejo@ejemplo.es" }];
  const q = await propietarioPorEmail("viejo@ejemplo.es");
  ok(Array.isArray(q.conflicto) && q.conflicto.length === 2,
     `mismo correo en propietarios distintos → conflicto explícito (${JSON.stringify(q.conflicto)})`);
  ok(q.propietario_id === undefined, "y no se elige uno a dedo");
}

console.log("\n── el cliente ya no escribe correos tecleados ──");
{
  const APP = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
  // El gate del piloto y el panel de "mándame el enlace": ni uno ni otro.
  // ⚠️ SE BUSCAN LLAMADAS, NO MENCIONES. Los comentarios que explican por qué
  // se quitó la llamada contienen la palabra, y una comprobación ingenua se
  // pone roja por la propia explicación.
  const sinComentarios = (t) => t.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const gate = sinComentarios(APP.slice(APP.indexOf('document.getElementById("gate-btn")'),
                                        APP.indexOf('// Enter en cualquier campo del gate')));
  ok(!/registroUsuario\s*\(/.test(gate), "el gate del piloto ya no llama a registroUsuario");
  ok(/waitlist/.test(gate), "y sigue apuntando el interés en /api/waitlist, que es su sitio");
  const pedir = sinComentarios(APP.slice(APP.indexOf('accion: "pedir"') - 1600,
                                         APP.indexOf('accion: "pedir"') + 200));
  ok(!/registroUsuario\s*\(/.test(pedir), "pedir el enlace tampoco escribe el correo en ninguna fila");
  // Y el envío de siembras nunca llevó email: que siga siendo así.
  const payload = APP.slice(APP.indexOf("function payloadSiembra("), APP.indexOf("function estable("));
  ok(!/\bemail\b\s*:/.test(payload), "y el payload de una siembra sigue sin llevar correo");
}

// ══════════════════════════════════════════════════════════════════════
// Sin infraestructura: error explícito, cero adopción, cero escritura
// ══════════════════════════════════════════════════════════════════════
console.log("\n── falta configuración: se dice, no se simula ──");
{
  const ACCESO = require(join(RAIZ, "api", "_acceso.js"));
  const guardadas = { resend: process.env.RESEND_API_KEY, secreto: process.env.SESION_SECRET };
  // Se registra lo que se escribe para poder afirmar que NO se escribe nada.
  const escrituras = [];
  const insertOriginal = sb.supabaseInsert, updateOriginal = sb.supabaseUpdate;
  sb.supabaseInsert = async (t, f) => { escrituras.push(["insert", t]); return insertOriginal(t, f); };
  sb.supabaseUpdate = async (t, q, d) => { escrituras.push(["update", t]); return updateOriginal(t, q, d); };

  delete process.env.RESEND_API_KEY;
  delete process.env.SESION_SECRET;

  const r1 = await ACCESO.pedir({ email: CORREO }, "1.2.3.4");
  ok(r1.estado === 503, `pedir un enlace responde 503, no un falso "ya va de camino" (${r1.estado})`);
  ok(r1.cuerpo.error === "acceso_no_configurado", "con un motivo explícito");
  ok(Array.isArray(r1.cuerpo.falta) && r1.cuerpo.falta.includes("RESEND_API_KEY")
     && r1.cuerpo.falta.includes("SESION_SECRET"),
     `y diciendo qué falta: ${JSON.stringify(r1.cuerpo.falta)}`);
  ok(escrituras.length === 0, "sin escribir ni una fila");

  const r2 = await ACCESO.canjear({ token: "un-token-cualquiera" });
  ok(r2.estado === 503 && r2.cuerpo.error === "acceso_no_configurado",
     "y canjear tampoco adopta: 503 explícito");
  ok(escrituras.length === 0,
     "⚠️ y el enlace NO se quema: sin configuración no se toca la tabla de accesos");
  ok(!r2.cuerpo.propietario_id && !r2.cuerpo.config,
     "no viaja ni propietario ni configuración: cero adopción");

  // Solo el secreto: sigue sin poder cerrarse el circuito.
  process.env.RESEND_API_KEY = "re_de_mentira";
  const r3 = await ACCESO.pedir({ email: CORREO }, "1.2.3.4");
  ok(r3.estado === 503 && r3.cuerpo.falta.join() === "SESION_SECRET",
     "con Resend puesto pero sin SESION_SECRET, tampoco: el canje no podría emitir sesión");

  if (guardadas.resend === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = guardadas.resend;
  if (guardadas.secreto === undefined) delete process.env.SESION_SECRET;
  else process.env.SESION_SECRET = guardadas.secreto;
  sb.supabaseInsert = insertOriginal; sb.supabaseUpdate = updateOriginal;
}

console.log(fallos ? `\n${fallos} test(s) FALLARON` : "\n✅ TODOS LOS TESTS VERDES");
process.exit(fallos ? 1 : 0);
