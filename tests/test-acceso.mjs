// Acceso por enlace de correo: la parcela es de la PERSONA, no del móvil.
//   node tests/test-acceso.mjs
//
// Esto es lo más parecido a una llave que tiene Kylia, así que se testea la
// parte que puede fallar en silencio y sin que nadie se entere: cómo se guarda
// el token, qué se filtra en las respuestas y qué pasa con un enlace ya usado.
// La red y la base no se tocan aquí; lo que se ata es el criterio.
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const A = require("../api/_acceso.js");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

console.log("── el token no se puede reconstruir desde lo guardado ──");
const { token, hash } = A.nuevoToken();
ok(token.length >= 40, `token largo de verdad (${token.length} caracteres de aleatorio real)`);
ok(!/[^A-Za-z0-9_-]/.test(token), "base64url: viaja en una URL sin escaparse ni romperse");
ok(hash.length === 64 && /^[0-9a-f]+$/.test(hash), "lo que se guarda es un sha256, no el token");
ok(hash !== token, "el token en claro NUNCA es lo que va a la base");
ok(A.huellaDe(token) === hash, "la huella se recalcula igual al canjear (si no, nadie podría entrar)");
ok(A.nuevoToken().token !== A.nuevoToken().token, "dos tokens seguidos no se parecen");

console.log("── validación de email ──");
ok(A.ES_EMAIL.test("agricultor@finca.es"), "un email normal pasa");
ok(!A.ES_EMAIL.test("agricultor@localhost"), "sin dominio con punto, no");
ok(!A.ES_EMAIL.test("sin-arroba.es") && !A.ES_EMAIL.test("a@b c.es"), "basura, no");

console.log("── los límites que hacen que esto no sea un buzón de spam ──");
ok(A.VIDA_MIN <= 15, `el enlace caduca en ${A.VIDA_MIN} min (queda en el historial del correo para siempre)`);
ok(A.MAX_POR_HORA <= 5, `máximo ${A.MAX_POR_HORA} peticiones por email y hora`);

console.log("── no se filtra quién es cliente y quién no ──");
const src = readFileSync(join(RAIZ, "api", "_acceso.js"), "utf8");
const pedir = src.slice(src.indexOf("async function pedir"), src.indexOf("async function canjear"));
const respuestas = pedir.match(/return respuesta;|return \{ estado: 200/g) || [];
ok(respuestas.length >= 3,
   `email sin parcelas, con parcelas y pasado de tope devuelven lo MISMO (${respuestas.length} salidas idénticas)`);
ok(/enviado: true/.test(pedir) && !/no_existe|sin_parcelas|not_found/.test(pedir),
   "la respuesta no dice nunca si el email existía");
ok(/console\.(log|warn)\("\[acceso\] email sin parcelas/.test(src),
   "el motivo real queda en el log del servidor, que es donde tiene que estar");

console.log("── un enlace usado no vuelve a servir ──");
const canjear = src.slice(src.indexOf("async function canjear"));
ok(/usado_en/.test(canjear) && /if \(a\.usado_en\) return noVale/.test(canjear), "se comprueba que no esté usado");
ok(/new Date\(a\.expira\)\.getTime\(\) < Date\.now\(\)/.test(canjear), "y que no esté caducado");
ok(/usado_en=is\.null/.test(canjear),
   "el quemado va condicionado EN LA BASE: dos canjeos a la vez no pueden ganar los dos");
ok(canjear.indexOf("usado_en=is.null") < canjear.indexOf("supabaseSelect(\"usuarios\""),
   "se quema ANTES de devolver las zonas: si algo peta después, el enlace ya no vale");
ok((canjear.match(/return noVale/g) || []).length >= 4,
   "no existe / ya usado / caducado / carrera perdida dan el MISMO error (no se ayuda a quien pruebe tokens)");

console.log("── qué devuelve al dispositivo ──");
ok(/propietario_id: a\.propietario_id/.test(canjear), "el propietario, que es lo que agrupa todas sus zonas");
ok(/metodo_riego/.test(canjear) && /fecha_plantacion/.test(canjear),
   "y sus zonas con cultivo, área, método de riego y fecha (una misma finca tiene varios)");
// La respuesta de éxito: lo que el dispositivo se queda guardado. Un token que
// volviera aquí acabaría en localStorage y en cualquier log del navegador.
const exito = canjear.slice(canjear.lastIndexOf("estado: 200"));
ok(!/token/.test(exito), "el token no vuelve en la respuesta de éxito");

console.log("── encaje ──");
const log = readFileSync(join(RAIZ, "api", "log.js"), "utf8");
ok(/"acceso":\s*handleAcceso/.test(log), "cuelga de /api/log (no gasta slot de función en Hobby)");
const sql = readFileSync(join(RAIZ, "db", "acceso-por-email-2026-08-07.sql"), "utf8");
ok(/token_hash\s+text\s+not null unique/.test(sql), "la tabla guarda la huella y la fuerza a ser única");
ok(!/token\s+text/.test(sql.replace(/token_hash\s+text/g, "")), "no hay ninguna columna que guarde el token en claro");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
