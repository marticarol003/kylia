// Canjear un acceso NO puede costarle un cultivo al agricultor.
//   node tests/test-adopcion-sin-perder.mjs
//
// EL FALLO QUE CIERRA. `escribirConfigLocal` sobrescribe `kylia_zonas` con las
// zonas de la cuenta que se adopta. Un dispositivo que había dado de alta sus
// cultivos sin identificarse y luego entraba por el enlace del correo los
// perdía: medido, 1 → 0. Y al revés también: conservar los locales pero adoptar
// la base del CAS haría que la siguiente subida mandara la foto local ENTERA y
// borrara los de la cuenta.
//
// La política, que es la que se prueba aquí: con cultivos a los dos lados no se
// escribe NADA —ni foto ni base, o sea cero POST— hasta que el agricultor elija.
// Y las dos salidas conservan lo que había.
//
// Se ejecutan las funciones REALES recortadas del fuente, no copias.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const FUENTE = readFileSync(join(RAIZ, "app", "index.html"), "utf8");
let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

// ⚠️ SE CIERRA LA LISTA DE PARÁMETROS ANTES DE BUSCAR EL CUERPO. Una versión
// ingenua saltaba al primer `{` tras el `(` y con `function f(a, opciones = {})`
// se quedaba con ESE `{}` como cuerpo entero: la función salía truncada y el
// arnés petaba con un error de sintaxis a diez líneas de distancia.
function trozo(marca) {
  const i = FUENTE.indexOf(marca);
  if (i < 0) throw new Error("no encuentro: " + marca);
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
  throw new Error("sin cerrar: " + marca);
}
const linea = (re) => re.exec(FUENTE)[0];

function almacen(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: k => (m.has(k) ? m.get(k) : null),
           setItem: (k, v) => m.set(k, String(v)),
           removeItem: k => m.delete(k),
           _claves: () => [...m.keys()] };
}

// Monta las piezas reales de la adopción sobre un localStorage de mentira.
function montar(ls) {
  const cuerpo = `
    ${linea(/const BASE_KEY\s+= "[^"]+";/)}
    ${linea(/const PENDIENTE_KEY = "[^"]+";/)}
    ${linea(/const ZONAS_PREVIAS_KEY = "[^"]+";/)}
    ${linea(/const CUENTA_REMOTA_KEY = "[^"]+";/)}
    ${linea(/const esVersion = [^\n]+/)}
    ${linea(/const esOwner   = [^\n]+/)}
    ${linea(/const siembrasDe = \(zonas\) => \{[\s\S]*?\n      \};/)}
    ${trozo("function zonasLocales(")}
    ${trozo("function conflictoDeAdopcion(")}
    ${linea(/const leerPendiente = \(\) => \{[\s\S]*?\n      \};/)}
    ${linea(/const borrarPendiente = [^\n]+/)}
    ${trozo("function leerBase(")}
    ${trozo("function guardarBase(")}
    ${trozo("function escribirConfigLocal(")}
    ${trozo("function adoptarConfigPropietario(")}
    ${trozo("function resolverAdopcion(")}
    ${trozo("function subirEstosAMiCuenta(")}
    ${trozo("function restaurarZonasPrevias(")}
    ${linea(/const leerZonasPrevias = \(\) => \{[\s\S]*?\n      \};/)}
    ${linea(/const leerCuentaRemota = \(\) => \{[\s\S]*?\n      \};/)}
    ${trozo("function tieneConfigLocal(")}
    return { adoptar: adoptarConfigPropietario, resolver: resolverAdopcion,
             conflicto: conflictoDeAdopcion, pendiente: leerPendiente,
             base: leerBase, tieneConfigLocal,
             subir: subirEstosAMiCuenta, restaurar: restaurarZonasPrevias,
             cuentaRemota: leerCuentaRemota,
             zonas: () => JSON.parse(localStorage.getItem("kylia_zonas") || "[]"),
             previas: () => JSON.parse(localStorage.getItem(ZONAS_PREVIAS_KEY) || "null"),
             dueno: () => localStorage.getItem("kylia_user_id") };
  `;
  return new Function("localStorage", cuerpo)(ls);
}

const geom = { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] };
const siembra = (id, cultivo) => ({ id, cultivo, area_m2: 1500, geometria: geom,
  sync: { nueva: true, vista: null, confirmada: null, token: "t-" + id } });
const zona = (ref, ...ss) => ({ referencia: ref, superficie_m2: 5000, geometria: geom, siembras: ss });
const OWNER = "11111111-2222-3333-4444-555555555555";
const remota = (zonas) => ({ finca: { lat: 41.3, lon: 2.0, suelo: "franco" }, zonas, zonaActiva: null });
const tupla = (zonas, v = 7) => ({ owner_id: OWNER, config: remota(zonas), config_version: v });

console.log("── el caso obligatorio: A tiene cultivos, la cuenta también ──");
{
  const ls = almacen({ kylia_zonas: JSON.stringify([zona("R1", siembra("local-1", "lechuga"))]) });
  const app = montar(ls);
  const r = app.adoptar(tupla([zona("R9", siembra("remota-1", "tomate"))]));
  ok(r === "pendiente", `no se adopta: queda pendiente de decisión (${r})`);
  ok(app.zonas().length === 1 && app.zonas()[0].siembras[0].id === "local-1",
     "el cultivo local sigue EXACTAMENTE donde estaba");
  ok(app.base() === null, "y NO se adopta base: sin base no sale ni un POST");
  const p = app.pendiente();
  ok(!!p && p.owner_id === OWNER, "la foto de la cuenta se guarda aparte, sin aplicarla");
  ok(p.choque.aqui === 1 && p.choque.alla === 1, `y se sabe qué hay a cada lado (${p.choque.aqui}/${p.choque.alla})`);
}

console.log("\n── la cuenta está VACÍA: no hay nada que decidir ──");
{
  const ls = almacen({ kylia_zonas: JSON.stringify([zona("R1", siembra("local-1", "lechuga"))]) });
  const app = montar(ls);
  const r = app.adoptar(tupla([]));
  ok(r === true, "se adopta sin preguntar");
  ok(app.zonas().length === 1 && app.zonas()[0].siembras[0].id === "local-1",
     "y el cultivo local SIGUE: una cuenta vacía no puede borrarlo");
  ok(app.base()?.base_version === 7, "con su base, porque no hay conflicto");
}

console.log("\n── el dispositivo está vacío: se adopta la cuenta ──");
{
  const ls = almacen({});
  const app = montar(ls);
  const r = app.adoptar(tupla([zona("R9", siembra("remota-1", "tomate"))]));
  ok(r === true, "se adopta, que es lo que se espera en un móvil nuevo");
  ok(app.zonas()[0].siembras[0].id === "remota-1", "con los cultivos de la cuenta");
  ok(app.pendiente() === null, "y sin nada pendiente");
}

console.log("\n── lo local YA ESTÁ en la cuenta: tampoco hay que preguntar ──");
{
  const ls = almacen({ kylia_zonas: JSON.stringify([zona("R1", siembra("s-1", "lechuga"))]) });
  const app = montar(ls);
  const r = app.adoptar(tupla([zona("R1", siembra("s-1", "lechuga"), siembra("s-2", "tomate"))]));
  ok(r === true, "es el mismo trabajo visto desde el otro lado: se adopta");
  ok(app.zonas()[0].siembras.length === 2, "y llega además lo que faltaba");
}

console.log("\n── elegir LA CUENTA: se aplica, y lo local queda a salvo ──");
{
  const ls = almacen({ kylia_zonas: JSON.stringify([zona("R1", siembra("local-1", "lechuga"))]) });
  const app = montar(ls);
  app.adoptar(tupla([zona("R9", siembra("remota-1", "tomate"))]));
  ok(app.resolver("cuenta") === true, "la decisión se aplica");
  ok(app.zonas()[0].siembras[0].id === "remota-1", "ahora se ven los de la cuenta");
  ok(app.previas()?.zonas?.[0]?.siembras?.[0]?.id === "local-1",
     "y los de este dispositivo quedan guardados aparte: no se borran, se apartan");
  ok(app.base()?.owner_id === OWNER && app.base()?.base_version === 7,
     "con la base de la cuenta, que es la que le corresponde");
  ok(app.pendiente() === null, "y la decisión ya no está pendiente");
}

console.log("\n── elegir ESTE DISPOSITIVO: no se pisa la cuenta, y NO se sube solo ──");
{
  const ls = almacen({ kylia_zonas: JSON.stringify([zona("R1", siembra("local-1", "lechuga"))]) });
  const app = montar(ls);
  app.adoptar(tupla([zona("R9", siembra("remota-1", "tomate"))], 7));
  ok(app.resolver("dispositivo") === true, "la decisión se aplica");
  ok(app.zonas()[0].siembras[0].id === "local-1", "los cultivos de aquí siguen intactos");
  ok(app.dueno() === OWNER, "el dispositivo pasa a ser de esa cuenta");
  // ⚠️ LO QUE IMPIDE LA DESTRUCCIÓN EN LA OTRA DIRECCIÓN. Con base adoptada, el
  // siguiente guardado subiría la foto local entera y reemplazaría los cultivos
  // de la cuenta. Sin base, `guardarConfigServidor` no manda nada.
  ok(app.base() === null,
     "y NO coge base: sin ella no se puede reemplazar lo de la cuenta");
  ok(app.pendiente() === null, "sin nada pendiente");
  ok(app.zonas().length === 1 && app.zonas()[0].referencia === "R1",
     "no se ha mezclado la zona de la cuenta con la de aquí");
  // La foto de la cuenta se conserva.
  const c = app.cuentaRemota();
  ok(!!c && c.owner_id === OWNER && c.config_version === 7,
     "y la foto de la cuenta queda guardada, no descartada");

  // Reemplazarla exige una ACCIÓN EXPLÍCITA.
  ok(app.subir() === true, "subir los de aquí a la cuenta es una acción aparte");
  ok(app.base()?.base_version === 7,
     "solo entonces se coge la base, y el CAS sigue protegiendo de una versión vieja");
  ok(app.cuentaRemota() !== null, "y la copia de la cuenta NO se borra al subir");
}

console.log("\n── las copias no se borran nunca, y se puede volver ──");
{
  const ls = almacen({ kylia_zonas: JSON.stringify([zona("R1", siembra("local-1", "lechuga"))]) });
  const app = montar(ls);
  app.adoptar(tupla([zona("R9", siembra("remota-1", "tomate"))]));
  app.resolver("cuenta");
  ok(app.zonas()[0].siembras[0].id === "remota-1", "se ven los de la cuenta");
  ok(app.previas()?.zonas?.[0]?.siembras?.[0]?.id === "local-1", "y los de aquí están guardados");

  // Volver atrás: es un INTERCAMBIO, no un borrado.
  ok(app.restaurar() === true, "se puede volver a los de este dispositivo");
  ok(app.zonas()[0].siembras[0].id === "local-1", "y vuelven a verse");
  ok(app.previas()?.zonas?.[0]?.siembras?.[0]?.id === "remota-1",
     "con los de la cuenta guardados en su lugar: no desaparece ninguno de los dos");
  ok(app.restaurar() === true && app.zonas()[0].siembras[0].id === "remota-1",
     "y se puede ir y volver las veces que haga falta");
}

console.log("\n── RELOAD con la decisión sin tomar ──");
{
  const ls = almacen({ kylia_zonas: JSON.stringify([zona("R1", siembra("local-1", "lechuga"))]) });
  const app = montar(ls);
  app.adoptar(tupla([zona("R9", siembra("remota-1", "tomate"))]));
  // Recargar = instancia nueva sobre el MISMO almacenamiento.
  const otra = montar(ls);
  ok(otra.pendiente()?.owner_id === OWNER, "la decisión sigue pendiente tras recargar");
  ok(otra.zonas()[0].siembras[0].id === "local-1", "y lo local sigue ahí");
  ok(otra.base() === null, "sigue sin base: no se ha escrito nada en el servidor");
  ok(otra.resolver("cuenta") === true, "y se puede decidir después de recargar");
  ok(otra.previas()?.zonas?.[0]?.siembras?.[0]?.id === "local-1", "con la copia de lo local hecha");
}

console.log("\n── DOBLE CANJE: el segundo no duplica ni pierde ──");
{
  const ls = almacen({ kylia_zonas: JSON.stringify([zona("R1", siembra("local-1", "lechuga"))]) });
  const app = montar(ls);
  const r1 = app.adoptar(tupla([zona("R9", siembra("remota-1", "tomate"))]));
  const r2 = app.adoptar(tupla([zona("R9", siembra("remota-1", "tomate"))]));
  ok(r1 === "pendiente" && r2 === "pendiente", "los dos canjeos quedan pendientes");
  ok(app.zonas()[0].siembras.length === 1, "sin duplicar el cultivo local");
  ok(app.base() === null, "y sin escribir nada");
  ok(app.resolver("cuenta") === true, "se resuelve una vez");
  ok(app.resolver("cuenta") === false, "y la segunda no hace nada: ya no hay pendiente");
  ok(app.zonas()[0].siembras.length === 1, "el resultado no se duplica");
}

console.log("\n── FALLO al guardar la copia: no se adopta ──");
{
  // Un localStorage lleno, o en navegación privada: setItem lanza.
  const base = almacen({ kylia_zonas: JSON.stringify([zona("R1", siembra("local-1", "lechuga"))]) });
  const ls = { ...base, setItem: (k, v) => {
    if (k === "kylia_zonas_previas") throw new Error("lleno");
    return base.setItem(k, v);
  } };
  const app = montar(ls);
  app.adoptar(tupla([zona("R9", siembra("remota-1", "tomate"))]));
  ok(app.resolver("cuenta") === false, "si no se puede poner a salvo lo local, NO se adopta");
  ok(app.zonas()[0].siembras[0].id === "local-1", "y lo local sigue intacto");
  ok(app.pendiente() !== null, "la decisión sigue pendiente, para poder reintentarla");
}

console.log("\n── el conflicto no se inventa cuando no lo hay ──");
{
  const ls = almacen({});
  const app = montar(ls);
  ok(app.conflicto(remota([])) === null, "nada aquí, nada allí");
  ok(app.conflicto(remota([zona("R9", siembra("r", "tomate"))])) === null, "nada aquí");
  ok(app.conflicto(null) === null, "una config remota vacía no rompe nada");
  ok(app.conflicto({ zonas: "no es una lista" }) === null, "ni una malformada");
}

console.log(fallos ? `\n${fallos} test(s) FALLARON` : "\n✅ TODOS LOS TESTS VERDES");
process.exit(fallos ? 1 : 0);
