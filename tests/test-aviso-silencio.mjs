// El silencio del aviso tiene que significar algo.
//   node tests/test-aviso-silencio.mjs
//
// /api/aviso-lechugas solo habla los días que toca regar. Esa decisión es buena
// —el padre recibe algo únicamente cuando hay algo que hacer— pero convierte la
// AUSENCIA de correo en un mensaje: "hoy no hace falta". Y un mensaje que se
// emite sin comprobar nada es un mensaje que miente el día que el cálculo falla.
//
// Ciclo 12 de la auditoría (11-sep-2026). Dos formas de callar mal, las dos
// reales y ninguna detectada:
//
//   · el motor devuelve nivel "desconocido" (balance roto) → `regar` es false,
//     igual que un día tranquilo, y salía por la misma puerta;
//   · el clima no llega hasta hoy. Si el pronóstico falla y solo responde el
//     archivo, la serie se queda 6 días atrás y al balance le faltan 6 días de
//     ETc. Medido sobre el tomate del piloto (franco, regado hace una semana):
//     41 mm y "Regar ~45 L/m²" con el clima al día; 6 mm y "Todo en orden" sin
//     él. Falso negativo silencioso.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const aviso = require(join(RAIZ, "api", "aviso-lechugas.js"));
const M = require(join(RAIZ, "assets", "js", "motor-riego.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

// ── El agujero, medido con el motor de verdad ────────────────────
console.log("── por qué el clima atrasado no puede pasar en silencio ──");
const dias = (desde, n) => {
  const out = [], d0 = new Date(`${desde}T12:00:00Z`).getTime();
  for (let i = 0; i < n; i++)
    out.push({ date: new Date(d0 + i * 86400000).toISOString().slice(0, 10),
               et0: 5, lluvia: 0, tmax: 28, tmin: 16 });
  return out;
};
const PLANT = "2026-07-01", HOY = "2026-09-11";
const opts = { suelo: "franco", cultivoId: "tomate", metodoRiego: "goteo",
               fechaPlantacion: PLANT, ventana: { desde: PLANT, hasta: HOY } };
const riegos = [{ date: "2026-09-04", litros: null }];
const serie  = dias(PLANT, 73);
const alDia  = M.balanceHidrico(serie, riegos, opts);
const corta  = M.balanceHidrico(serie.slice(0, 67), riegos, opts);   // 6 días menos
ok(M.decisionRiego(alDia, {}).nivel === "alta", `con el clima al día: regar (${alDia.Dr.toFixed(1)} mm)`);
ok(M.decisionRiego(corta, {}).nivel === "baja", `con 6 días de hueco: "todo en orden" (${corta.Dr.toFixed(1)} mm)`);
ok(alDia.Dr - corta.Dr > 30, "34 mm de déficit que desaparecen sin que nada lo diga");
ok(corta.coberturaClima < 1 && corta.diasSinClima === 6,
   "el balance SÍ lo sabe: cobertura 0,92 y 6 días sin dato. Solo había que mirarlo");

// ── El handler: qué hace ahora con cada caso ─────────────────────
console.log("\n── el endpoint comprueba antes de callar ──");
const respuesta = () => {
  const r = { código: null, cuerpo: null };
  r.status = (c) => { r.código = c; return { json: (b) => { r.cuerpo = b; return r; } }; };
  return r;
};
const peticion = (fase = "manana") => ({ query: { fase }, headers: { host: "kylia.app" } });

// Se sustituye la llamada de red por datos: lo que se prueba es la decisión de
// callar o no, no Open-Meteo.
const original = globalThis.fetch;
const responder = (hoy) => {
  globalThis.fetch = async () => ({ ok: true, status: 200,
    json: async () => ({ ok: true, hoy, proximo: null, usuario: {} }) });
};
const correr = async (hoy, fase = "manana") => {
  responder(hoy);
  const res = respuesta();
  await aviso(peticion(fase), res);
  return res;
};

const BASE = { fecha: HOY, deficit_mm: 6.3, umbral_mm: 39, et0: 5, lluvia: 0,
               clima_fecha: HOY, clima_al_dia: true, cobertura_clima: 1, dias_sin_clima: 0 };

let r = await correr({ ...BASE, nivel: "baja", regar: false });
ok(r.código === 200 && r.cuerpo.omitido, "día tranquilo de verdad → 200 y silencio, como siempre");

r = await correr({ ...BASE, nivel: "desconocido", regar: false, texto: "No se puede calcular el riego" });
ok(r.código === 500, "balance roto → 500, NO silencio");
ok(/no puede decidir/.test(r.cuerpo.error), "y el 500 dice que el motor no pudo decidir");

r = await correr({ ...BASE, nivel: "baja", regar: false,
                   clima_fecha: "2026-09-05", clima_al_dia: false, cobertura_clima: 0.918, dias_sin_clima: 6 });
ok(r.código === 500, "clima 6 días atrasado → 500, NO silencio");
ok(/2026-09-05/.test(r.cuerpo.error), "y dice hasta qué día llega el clima");

const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
r = await correr({ ...BASE, nivel: "baja", regar: false,
                   clima_fecha: ayer, clima_al_dia: false, dias_sin_clima: 1 });
ok(r.código === 200 && r.cuerpo.omitido,
   "un solo día de retraso se tolera: a las 06:45 el dato del día puede no estar publicado");

// Lo que se mide es el retraso de la COLA, no el total de huecos: un agujero de
// tres días en julio ya está dentro del déficit y no invalida la decisión de hoy.
r = await correr({ ...BASE, nivel: "baja", regar: false, clima_al_dia: true, dias_sin_clima: 3 });
ok(r.código === 200 && r.cuerpo.omitido,
   "huecos antiguos con la serie llegando hasta hoy → se decide igual");
globalThis.fetch = original;

// ── Los correos no pueden contradecir a la decisión ──────────────
console.log("\n── el correo dice lo mismo que la decisión ──");
const hoyRiega = { ...BASE, nivel: "alta", regar: true, deficit_mm: 41,
                   presentacion: { texto: "40 min", mm: 45 } };
const conPres = aviso.emailManana({ hoy: hoyRiega });
ok(/riega 40 min/.test(conPres.subject) && !/no toca/.test(conPres.subject),
   "toca regar → el asunto lo dice, y en su unidad (40 min de aspersor)");

// El caso que contradecía: toca regar pero la presentación no se puede calcular.
const sinPresentacion = { ...hoyRiega, presentacion: null };
const mail = aviso.emailManana({ hoy: sinPresentacion });
ok(!/no toca regar/.test(mail.subject),
   "sin presentación NO se cae a '✅ hoy no toca regar' — que era el asunto que llegaba justo el día que tocaba");
ok(/TOCA REGAR/.test(mail.texto) && /41/.test(mail.texto),
   "sigue mandando regar, en L/m², y avisa de que falta el caudal para dar minutos");
ok(/caudal/.test(mail.html), "y explica por qué no hay minutos");

console.log("\n── nada de correos que no se envían nunca ──");
// Las dos ramas de mediodía para los días sin riego eran inalcanzables: el
// handler corta antes. Leerlas hacía creer que el padre recibía un aviso al
// registrar un riego fuera de pauta. No lo recibía.
ok(aviso.emailMediodia({ hoy: { ...BASE, regar: false } }, null) === null,
   "mediodía sin riego que avisar devuelve null en vez de un correo fantasma");
ok(aviso.emailMediodia({ hoy: { ...BASE, regar: false } }, { cantidad_l_m2: 10 }) === null,
   "tampoco inventa uno por un riego fuera de pauta: eso se ve en la lista, con su ✕");
const hecho = aviso.emailMediodia({ hoy: { ...BASE, regar: true }, usuario: { caudal: 11 } },
                                  { duracion_min: 45, cantidad_l_m2: 8.2 });
ok(hecho && /registrado/i.test(hecho.subject), "y el caso que sí ocurre sigue saliendo");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
