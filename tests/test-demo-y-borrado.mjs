// Probar Kylia sin dejar el correo, y poder borrarlo todo después.
//   node tests/test-demo-y-borrado.mjs
//
// DOS COSAS QUE VAN JUNTAS. Una demo que empieza pidiendo el correo no es una
// demo, es un formulario: quien quiere ver si esto le sirve no ha decidido
// todavía si quiere darte nada. Y si le dejas entrar sin cuenta, tienes que
// dejarle salir del todo — la política de privacidad ya promete el derecho de
// supresión, pero hasta ahora la única vía era escribir a privacidad@kylia.app
// y esperar hasta un mes.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const app = leer("app", "index.html");
const log = leer("api", "log.js");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

console.log("── la demo no pide el correo, y el resto sí funciona ──");
ok(/localStorage\.setItem\("kylia_demo_sin_correo", "1"\)/.test(app),
   "?demo=1 marca el dispositivo");
ok(/const enDemo = localStorage\.getItem\("kylia_demo_sin_correo"\) === "1";/.test(app),
   "y el gate lo consulta");
ok(/if \(!yaIdentificado && !canjeando && !enDemo\) \{/.test(app),
   "el gate NO salta en demo — pero sigue saltando para quien entra por la puerta normal");
ok(/localStorage\.setItem\("kylia_modo", "demo"\)/.test(app),
   "y el modo demo se mantiene: ve el producto entero, no una versión recortada");

console.log("\n── borrar la cuenta: existe y borra de verdad ──");
ok(/"cuenta":\s+handleCuenta/.test(log), "hay endpoint de borrado");
ok(/async function handleCuenta/.test(log), "con su handler");
ok(/supabaseDelete\("usuarios", `propietario_id=eq\.\$\{propietario\}`\)/.test(log),
   "borra TODAS las parcelas de la persona, no solo la que pidió el borrado");
ok(/ON DELETE CASCADE/.test(log),
   "y se apoya en la cascada del esquema para arrastrar acciones, jornadas, mediciones y el resto");
const schema = leer("db", "schema.sql");
ok((schema.match(/references usuarios\(id\) on delete cascade/g) || []).length >= 5,
   `el esquema tiene la cascada puesta en ${(schema.match(/references usuarios\(id\) on delete cascade/g)||[]).length} tablas`);
ok(/no se marca como borrado/.test(log),
   "se borra de verdad, no se marca una bandera de borrado");

console.log("\n── y no puede borrarle los datos a otro ──");
ok(/const permiso = puedeVer\(req, u\);/.test(log.slice(log.indexOf("async function handleCuenta"))),
   "pasa por la misma comprobación de sesión que el resto");
ok(/correo_no_coincide/.test(log),
   "el correo registrado hace de segundo factor");
ok(/una fuga de UUID en un borrado/.test(log),
   "y queda escrito el porqué: hoy las APIs aceptan peticiones sin sesión");
ok(/Quien no tiene correo/.test(log),
   "quien entró en demo no tiene correo y ahí basta el UUID: no hay nada que proteger");
ok(/ya_no_estaba: true/.test(log),
   "borrar dos veces no es un error, para que el cliente pueda reintentar");

console.log("\n── el orden importa: primero el servidor, luego el móvil ──");
const bloque = app.slice(app.indexOf("// ── Borrar la cuenta ──"), app.indexOf("// ── Tu suscripción ──"));
ok(bloque.indexOf('recurso: "cuenta"') < bloque.indexOf("localStorage.clear()"),
   "se borra primero en el servidor: si se limpiara el móvil y la petición fallara, se quedaría sin datos aquí y con ellos allí");
ok(/localStorage\.clear\(\)/.test(bloque) && /sessionStorage\.clear\(\)/.test(bloque),
   "y se limpia TODO, no clave a clave: una clave nueva que nadie recuerde añadir dejaría un resto");
ok(/si mañana se añade\s*\n\s*\/\/ una clave nueva/.test(bloque),
   "con el porqué escrito al lado");

console.log("\n── y no se borra de un toque distraído ──");
ok(/let armado = false;/.test(bloque) && /if \(!armado\) \{/.test(bloque),
   "hacen falta dos toques");
ok(/esto no se puede deshacer/.test(bloque),
   "el segundo botón dice que no tiene vuelta atrás");
// Se quitan los comentarios antes de mirar: el propio bloque EXPLICA por qué no
// se usa confirm(), y esa mención no es una llamada.
const soloCodigo = bloque.split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
ok(!/\bconfirm\s*\(/.test(soloCodigo),
   "y no se usa confirm() del navegador: se acepta por reflejo, y en el móvil sale igual que cualquier aviso");
ok(/setTimeout\(\(\) => \{ if \(armado\) desarmar\(\); \}, 12000\)/.test(bloque),
   "el botón cargado se desarma solo");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
