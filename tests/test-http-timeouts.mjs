// Ninguna llamada a internet espera para siempre.
//   node tests/test-http-timeouts.mjs
//
// NO TOCA LA RED: todo va contra un `fetch` de mentira inyectado. Un test de
// timeouts que dependa de que un servidor real vaya lento no prueba nada y
// además tarda — que es justo el problema que vino a arreglar.
//
// EL CASO REAL: el 9-sep-2026 ninguna de las ~25 llamadas externas del backend
// tenía timeout. Con SoilGrids lento, tests/test-suelo-oferta.mjs pasó de ~1 s a
// 307 s y acabó pasando igual, o sea que ni siquiera fallaba: se quedaba ahí. En
// producción eso es una función serverless colgada gastando tiempo facturable.
// Con el helper puesto, ese mismo test bajó a 18 s degradando limpio.
import { readFileSync, readdirSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { spawnSync } from "child_process";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const H = require(join(RAIZ, "api", "_http.js"));
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

// fetch de mentira: tarda lo que se le diga y respeta la señal de aborto.
const fetchLento = (ms) => (url, opts) => new Promise((resolve, reject) => {
  const t = setTimeout(() => resolve({ ok: true, status: 200, url }), ms);
  opts?.signal?.addEventListener("abort", () => {
    clearTimeout(t);
    const e = new Error("The operation was aborted"); e.name = "AbortError"; reject(e);
  });
});

console.log("── cada proveedor tiene su reloj ──");
const esperados = [
  ["https://rest.isric.org/soilgrids/v2.0/properties/query", 6000, "SoilGrids, el que provocó todo esto"],
  ["https://api.anthropic.com/v1/messages",                 45000, "Claude con búsqueda web"],
  ["https://generativelanguage.googleapis.com/v1beta/x",    30000, "Gemini"],
  ["https://sh.dataspace.copernicus.eu/api/v1/statistics",  25000, "Copernicus procesa escenas"],
  ["https://abcdef.supabase.co/rest/v1/usuarios",            8000, "nuestra propia base de datos"],
  ["https://api.open-meteo.com/v1/forecast",                 8000, "meteo"],
];
for (const [url, ms, por] of esperados) ok(H.limiteDe(url) === ms, `${ms} ms · ${por}`);
ok(H.limiteDe("https://loquesea.example.com/x") === H.POR_DEFECTO,
   `un host desconocido cae en el valor por defecto (${H.POR_DEFECTO} ms), nunca en "sin límite"`);
ok(H.limiteDe("esto-no-es-una-url") === H.POR_DEFECTO, "y una URL inválida tampoco deja la puerta abierta");

console.log("\n── el reloj corta de verdad ──");
const t0 = Date.now();
let err = null;
try { await H.fetchConTimeout("https://rest.isric.org/x", { timeoutMs: 120, fetchImpl: fetchLento(5000) }); }
catch (e) { err = e; }
const tardó = Date.now() - t0;
ok(err && err.name === "TiempoAgotado", "una respuesta que no llega acaba en TiempoAgotado, no en una espera infinita");
ok(tardó < 1000, `y corta cuando toca, no cuando el servidor quiera (${tardó} ms para un límite de 120)`);
ok(err?.timeout_ms === 120 && err?.host === "rest.isric.org",
   `el error dice cuánto esperó y a quién: "${err?.message}"`);

console.log("\n── y no estorba cuando la cosa va bien ──");
const buena = await H.fetchConTimeout("https://api.open-meteo.com/v1/forecast",
                                      { timeoutMs: 5000, fetchImpl: fetchLento(5) });
ok(buena.ok === true && buena.status === 200, "una respuesta rápida pasa igual que siempre");
let señalVista = null;
await H.fetchConTimeout("https://api.open-meteo.com/x", {
  fetchImpl: (u, o) => { señalVista = o?.signal; return Promise.resolve({ ok: true }); },
});
ok(señalVista && typeof señalVista.aborted === "boolean", "al fetch de debajo se le pasa siempre una señal de aborto");
let opcionesVistas = null;
await H.fetchConTimeout("https://api.open-meteo.com/x", {
  method: "POST", headers: { "X-Prueba": "1" },
  fetchImpl: (u, o) => { opcionesVistas = o; return Promise.resolve({ ok: true }); },
});
ok(opcionesVistas.method === "POST" && opcionesVistas.headers["X-Prueba"] === "1",
   "y el método y las cabeceras del que llama llegan intactos");
ok(!("timeoutMs" in opcionesVistas) && !("fetchImpl" in opcionesVistas),
   "sin colar timeoutMs ni fetchImpl al fetch de verdad, que no sabría qué son");

console.log("\n── un fallo que no es un timeout no se disfraza de timeout ──");
let otro = null;
try {
  await H.fetchConTimeout("https://api.open-meteo.com/x", {
    timeoutMs: 5000, fetchImpl: () => Promise.reject(new Error("ECONNREFUSED")),
  });
} catch (e) { otro = e; }
ok(otro && otro.name !== "TiempoAgotado" && /ECONNREFUSED/.test(otro.message),
   "una conexión rechazada sube tal cual: confundirla con un timeout mandaría a mirar el sitio equivocado");

console.log("\n── el temporizador se limpia (si no, la lambda sigue despierta) ──");
// Se comprueba de la única forma que vale: un proceso aparte que hace una
// llamada rápida con un límite largo. Si el temporizador quedara vivo, node no
// podría salir hasta que venciera.
const guion = `
  const { fetchConTimeout } = require(${JSON.stringify(join(RAIZ, "api", "_http.js"))});
  fetchConTimeout("https://api.open-meteo.com/x", {
    timeoutMs: 30000, fetchImpl: () => Promise.resolve({ ok: true }),
  }).then(() => console.log("hecho"));
`;
const t1 = Date.now();
const r = spawnSync(process.execPath, ["-e", guion], { encoding: "utf8", timeout: 20000 });
const salió = Date.now() - t1;
ok(r.stdout.includes("hecho") && salió < 5000,
   `el proceso termina solo en ${salió} ms pese a un límite de 30 s: el temporizador se limpió`);

console.log("\n── el límite cabe DENTRO del presupuesto de la función ──");
// La regla que hace que estos números no sean arbitrarios: Vercel mata la
// función a los maxDuration segundos y devuelve un 504 sin explicación. Un
// timeout más largo que ese presupuesto no llega a dispararse nunca.
const vercel = JSON.parse(leer("vercel.json"));
const conPresupuesto = Object.keys(vercel.functions || {});
const largos = H.LIMITES.filter(([, ms]) => ms > 10000).map(([host]) => host);
ok(largos.length > 0, `hay ${largos.length} proveedores por encima de los 10 s del plan base: ${largos.join(", ")}`);
const ficheros = readdirSync(join(RAIZ, "api")).filter(f => f.endsWith(".js"));
for (const host of largos) {
  const usan = ficheros.filter(f => leer("api", f).includes(`https://${host}`));
  for (const f of usan) {
    // Los módulos con guion bajo no son funciones: corren dentro de quien los requiere.
    if (f.startsWith("_")) continue;
    ok(conPresupuesto.includes(`api/${f}`),
       `api/${f} llama a ${host} (${H.limiteDe("https://" + host)} ms) y tiene maxDuration en vercel.json`);
  }
}

console.log("\n── no queda ninguna llamada sin reloj ──");
const pelados = ficheros.filter(f => /\bawait fetch\(/.test(leer("api", f)));
ok(pelados.length === 0,
   pelados.length ? `todavía sin timeout: ${pelados.join(", ")}`
                  : `ninguno de los ${ficheros.length} ficheros de api/ llama a fetch sin reloj`);
const conFetch = ficheros.filter(f => f !== "_http.js" && /fetchConTimeout\(/.test(leer("api", f)));
for (const f of conFetch) {
  ok(/require\("\.\/_http\.js"\)/.test(leer("api", f)), `api/${f} importa el helper que usa`);
}
ok(/const doFetch = fetchImpl \|\| fetchConTimeout;/.test(leer("api", "_suelo-oferta.js")),
   "y _suelo-oferta.js, que era el del caso de 307 s, ya no cae en globalThis.fetch por defecto");

console.log("\n── no se reintenta a ciegas, y está dicho por qué ──");
ok(/NO HAY REINTENTOS aquí, a propósito/.test(leer("api", "_http.js")),
   "varias de estas llamadas ESCRIBEN: reintentar una escritura que quizá llegó es cómo se duplican cobros y correos");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
