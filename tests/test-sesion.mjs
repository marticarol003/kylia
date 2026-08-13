// La sesión firmada: quién pregunta, no solo por quién.
//   node tests/test-sesion.mjs
//
// El backend habla con Supabase con la service_role key, así que no hay RLS
// debajo que pare nada: lo único que separaba la parcela de uno de la de otro
// era conocer un UUID. Y los UUID no son secretos — campo/index.html lleva tres
// en texto plano y esa página se despliega.
//
// Lo que se prueba aquí es el criptográfico (que una firma no se pueda falsear)
// y, sobre todo, LA COMPATIBILIDAD: sin sesión todo tiene que seguir pasando,
// porque el cron de avisos llama por HTTP sin cookie y hoy nadie tiene una. Si
// esto se rompiera, se rompen los avisos en producción sin avisar — que es
// exactamente lo que pasó el 28-jul con la auth fail-closed de los crons.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

process.env.SESION_SECRET = "secreto-de-pruebas-largo-y-suficiente";
const S = require(join(RAIZ, "api", "_sesion.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

const YO    = "d5475c3d-365b-47ff-b31e-fa659a8362fb";
const OTRO  = "23567ff1-7368-4dc9-b777-fdeaab9f8714";
const conCookie = (t) => ({ headers: { cookie: `kylia_sesion=${encodeURIComponent(t)}` } });

console.log("── emitir y leer ──");
const token = S.emitir(YO);
ok(typeof token === "string" && token.includes("."), "se emite un token con cuerpo y firma");
ok(S.leerToken(token) === YO, "y se vuelve a leer el propietario");
ok(!token.includes(YO), "el UUID no viaja en claro dentro del token");

console.log("── no se puede falsear ──");
ok(S.leerToken(token.slice(0, -1) + "x") === null, "una firma cambiada no vale");
const [cuerpo, mac] = token.split(".");
const otroCuerpo = Buffer.from(JSON.stringify({ p: OTRO, e: Date.now() + 1e9 })).toString("base64url");
ok(S.leerToken(`${otroCuerpo}.${mac}`) === null,
   "ni cambiar el propietario conservando la firma ajena, que es el ataque obvio");
ok(S.leerToken(cuerpo) === null, "ni mandar el cuerpo sin firma");
ok(S.leerToken("basura") === null && S.leerToken("") === null && S.leerToken(null) === null,
   "y la basura no lanza: esto corre en el camino de lectura de todas las vistas");
const caducado = (() => {
  const c = Buffer.from(JSON.stringify({ p: YO, e: Date.now() - 1000 })).toString("base64url");
  // firmado de verdad con el secreto, para que lo único inválido sea la fecha
  const crypto = require("crypto");
  return `${c}.${crypto.createHmac("sha256", process.env.SESION_SECRET).update(c).digest("base64url")}`;
})();
ok(S.leerToken(caducado) === null, "un token caducado no vale aunque su firma sea buena");

console.log("── sin secreto configurado, no se emite nada (fail-safe) ──");
const guardado = process.env.SESION_SECRET;
process.env.SESION_SECRET = "";
ok(S.emitir(YO) === null, "sin SESION_SECRET no hay sesión…");
ok(S.puedeVer(conCookie(token), { id: OTRO }).permitido === true,
   "…y todo se comporta como antes: un despliegue sin configurar no deja a nadie fuera");
process.env.SESION_SECRET = guardado;

console.log("── quien tiene sesión solo ve lo suyo ──");
ok(S.puedeVer(conCookie(token), { id: YO }).permitido === true, "su propia fila, sí");
ok(S.puedeVer(conCookie(token), { id: "zona-1", propietario_id: YO }).permitido === true,
   "una zona cuyo propietario es él, también");
const ajena = S.puedeVer(conCookie(token), { id: OTRO, propietario_id: OTRO });
ok(ajena.permitido === false && ajena.motivo === "ajena",
   "la parcela de otro, NO — aunque conozca su UUID, que es el caso realista");

console.log("── sin sesión sigue pasando todo (compatibilidad, a propósito) ──");
ok(S.puedeVer({ headers: {} }, { id: OTRO }).motivo === "sin_sesion",
   "una petición sin cookie pasa, y queda marcada como tal para poder contarla");
ok(S.puedeVer({ headers: { cookie: "otra=1; kylia_sesion=corrupto" } }, { id: OTRO }).permitido === true,
   "una cookie corrupta se trata como 'sin sesión', no como intento de intrusión");
ok(S.puedeVer({}, { id: OTRO }).permitido === true, "y una petición sin headers no revienta");

console.log("── la cookie ──");
const set = S.cabeceraSetCookie(token);
ok(/HttpOnly/.test(set), "HttpOnly: ningún script de la página puede leerla");
ok(/Secure/.test(set), "Secure");
ok(/SameSite=Lax/.test(set),
   "SameSite=Lax, no Strict: con Strict no viajaría en el salto desde el enlace del correo");
ok(/Path=\//.test(set) && /Max-Age=/.test(set), "con Path y caducidad");

console.log("── conectado donde importa ──");
const acceso = leer("api", "_acceso.js");
const campo  = leer("api", "campo.js");
const log    = leer("api", "log.js");
ok(/SESION\.emitir\(a\.propietario_id\)/.test(acceso),
   "la sesión nace en el canjeo del enlace, el único punto donde alguien demuestra quién es");
ok(/res\.setHeader\("Set-Cookie", r\.cookies\)/.test(log), "y log.js la manda en la respuesta");
ok(/const permiso = puedeVer\(req, u\);/.test(campo) && /esa parcela no es tuya/.test(campo),
   "/api/campo comprueba la sesión contra la fila que acaba de leer");
ok(/const permiso = puedeVer\(req, previa\);/.test(log),
   "y registro-usuario también, que es el upsert que puede DESTRUIR una parcela");
ok(/sin_sesion/.test(campo), "los accesos sin sesión quedan en el log, para cerrar esto con datos");

console.log("── el cron de avisos no se rompe ──");
const aviso = leer("api", "aviso-lechugas.js");
ok(/api\/campo\?vista=hoy&usuario_id=/.test(aviso) && !/cookie/i.test(aviso),
   "sigue llamando sin cookie: por eso 'sin sesión' TIENE que pasar hasta el paso 2");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
