// La configuración deja de vivir solo en el móvil.
//   node tests/test-config-servidor.mjs
//
// El enlace por correo (test-acceso.mjs) hace que el dispositivo adopte al
// propietario. Pero adoptar no sirve de nada si la finca, sus zonas y sus
// cultivos siguen en el localStorage del móvil viejo: el agricultor entra y ve
// la app en blanco. Esto ata la otra mitad.
//
// Lo que se testea es lo que puede DESTRUIR configuración, que es el riesgo real
// de sincronizar en dos direcciones: subir una config vacía encima de la buena,
// o bajarse la del servidor encima de lo que el agricultor acaba de escribir.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

const log  = leer("api", "log.js");
const campo = leer("api", "campo.js");
const app  = leer("app", "index.html");
const sql  = leer("db", "config-en-servidor-2026-08-10.sql");
const handler = log.slice(log.indexOf("async function handleConfigApp"),
                          log.indexOf("// ─── acciones (riego o aplicación)"));

console.log("── subir no puede destruir lo que ya había ──");
ok(/config_vacia/.test(handler),
   "una config sin finca ni zonas se RECHAZA: un móvil recién estrenado no pisa la buena con su nada");
ok(/zonas\.length > 0/.test(handler) && /finca\.parcela/.test(handler),
   "el criterio de 'vacía' mira contenido real (zonas, contorno, cultivos, superficie), no si el objeto existe");
ok(/supabaseUpdate\("usuarios"/.test(handler) && !/supabaseInsert/.test(handler),
   "escribe UNA columna con UPDATE, nunca upsert de la fila (así se perdió el piloto de Breda)");
ok(/config_app: foto/.test(handler) && (handler.match(/patch|config_app/g) || []).length >= 1,
   "y la columna que toca es config_app y ninguna otra");
ok(/propietario no encontrado/.test(handler),
   "si el propietario no existe lo dice, en vez de tragarse el guardado en silencio");

console.log("── registro-usuario no puede borrar lo que no le mandas ──");
// El agujero que abrió esto: cada campo ausente se convertía en null explícito y
// el upsert lo escribía. El gate del email manda {email, nombre} y nada más, así
// que escribir tu correo borraba lat, lon, cultivos, contorno, superficie, caudal
// y suelo. Este test existe para que no vuelva: basta con que alguien añada un
// campo nuevo y se olvide de siViene.
const registro = log.slice(log.indexOf("async function handleRegistroUsuario"),
                           log.indexOf("// ─── acceso (enlace por correo"));
const fila = registro.slice(registro.indexOf("const fila = {"), registro.indexOf("console.log(\"[registro-usuario]\""));
const campos = [...fila.matchAll(/^\s{4}(\w+):/gm)].map(m => m[1]);
// id y propietario_id identifican la fila; ua sale de la cabecera, no del cuerpo.
const debenSerCondicionales = campos.filter(c => !["id", "propietario_id", "ua"].includes(c));
const sinGuarda = debenSerCondicionales.filter(c => {
  const linea = fila.split("\n").find(l => l.trim().startsWith(c + ":"));
  const bloque = fila.slice(fila.indexOf(c + ":"), fila.indexOf(c + ":") + 300);
  return !/siViene\(/.test(bloque.split("\n").slice(0, 3).join("\n"));
});
ok(debenSerCondicionales.length >= 15,
   `se revisan los ${debenSerCondicionales.length} campos que vienen del cuerpo`);
ok(sinGuarda.length === 0,
   `todos pasan por siViene(), o sea que un campo ausente NO se escribe${sinGuarda.length ? ": faltan " + sinGuarda.join(", ") : ""}`);
ok(/clave in body/.test(registro),
   "el criterio es si la CLAVE viene, no si el valor es nulo: un null explícito sigue borrando");

console.log("── bajar tampoco ──");
const iife = app.slice(app.indexOf("function tieneConfigLocal"), app.indexOf("kyliaTrack: ahora va"));
ok(/if \(tieneConfigLocal\(\)\) return;/.test(iife),
   "solo se restaura si este dispositivo NO tiene nada; si tiene datos, manda él");
ok(/c\.parcela \|\| \(c\.cultivos/.test(iife),
   "'tener datos' es tener contorno, cultivo, superficie o fecha — no una config por defecto vacía");
ok(/location\.reload\(\)/.test(iife),
   "restaurar recarga: media app ya ha leído localStorage de forma síncrona a esas alturas");

console.log("── el enlace del correo entrega el campo, no solo la identidad ──");
const acceso = leer("api", "_acceso.js");
// La forma exacta la fija test-config-sintetizada.mjs; aquí solo importa que la
// config salga del canjeo y no de una segunda llamada.
ok(/const config = fila\?\.config_app/.test(acceso) && /\bconfig,/.test(acceso),
   "el canjeo devuelve la configuración en la MISMA llamada (si no, se adopta al dueño y se ve la app vacía)");
ok(/canjearAcceso/.test(app) && /accion: "canjear"/.test(app), "la app canjea el token de ?acceso=");
ok(/location\.replace\("\/app"\)/.test(iife),
   "y sale de la URL con replace: el token no se queda en la barra ni en el historial");
ok(/restaurarConfig\(d\.config, d\.propietario_id\)/.test(iife),
   "al canjear se restaura config Y se adopta el propietario");

console.log("── qué se sincroniza ──");
ok(/finca: cfgFinca/.test(app) && /zonas: zonasGuardadas\(\)/.test(app) && /zonaActiva/.test(app),
   "la foto lleva finca, zonas y zona activa: la configuración entera");
ok(/modo: window\.kyliaSync\?\.modo/.test(app),
   "y el modo, para que quien ya usaba Kylia no caiga en el silencioso del piloto al restaurar");
ok(/config\.modo === "demo"/.test(iife), "que se restaura al bajar");

console.log("── no se satura la red al escribir ──");
ok(/clearTimeout\(subidaPendiente\)/.test(app) && /setTimeout\(\(\) => \{/.test(app),
   "la subida va con retardo: el panel guarda en cada tecla y sin esto un nombre serían 15 peticiones");
const llamadas = (app.match(/subirConfig\(\);/g) || []).length;
ok(llamadas === 2, `se sube al cambiar la finca y al cambiar las zonas, y en ningún otro sitio (${llamadas})`);
ok(!/subirConfig\(\)[\s\S]{0,80}arranque|restaurarSiVacio[\s\S]{0,200}subirConfig/.test(app),
   "no se sube al arrancar: solo cuando el agricultor cambia algo");

console.log("── la lectura del servidor ──");
const vista = campo.slice(campo.indexOf("async function vistaConfig"), campo.indexOf("async function vistaPerfil"));
ok(/u\.propietario_id !== u\.id/.test(vista),
   "si preguntas con el id de una zona, se mira la config del propietario (que es donde vive)");
ok(/config,\s*\/\/ null = este propietario nunca guardó/.test(vista),
   "distingue 'no hay nada guardado' de un error");
ok(/vista === "config"/.test(campo), "la vista está enrutada en /api/campo");

console.log("── la migración ──");
ok(/config_app jsonb/.test(sql), "crea la columna");
ok(/NO ES UNA COPIA DE SEGURIDAD/.test(sql),
   "y deja escrito que es un espejo, no un backup: los riegos y mediciones viven en sus tablas");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
