// Las dos fuentes de capacidad NUEVAS, con el contrato de siempre.
//   node tests/test-capacidad-fuentes-nuevas.mjs
//
// El onboarding añadió `derivado_aspersion` (malla fija y regular) y
// `medido_vasos` (varios recipientes repartidos). Entrar en la whitelist NO
// puede bastar para habilitar minutos: la puerta canónica sigue exigiendo valor
// válido, método compatible, datos suficientes y confianza.
//
// Y hay dos decisiones que se comprueban aquí porque son el fondo del asunto:
//
//   · un caudal NOMINAL de la ficha de un aspersor no es una medición. El
//     aspersor da su caudal a la presión de la ficha, y en la parcela hay otra;
//     además solapa, así que lo que cae no es uniforme. Sale PROVISIONAL.
//   · una medición con recipientes muy DESIGUALES no describe la parcela: si
//     donde menos cae hay menos de la mitad que donde más, la media no
//     representa nada. También sale provisional, y se dice.
//
// Lo legacy NO se toca: `derivado_goteo` y `medido_vaso` siguen dando
// exactamente lo mismo que antes.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const R = require(join(RAIZ, "assets", "js", "riego-capacidad.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };
const clase = (riego, metodo) => R.evaluarCapacidadRiego(riego, metodo).clase;
const motivo = (riego, metodo) => R.evaluarCapacidadRiego(riego, metodo).motivo;

console.log("── estar en la whitelist NO basta ──");
{
  const F = "derivado_aspersion";
  // Ningún valor que no sea un número dentro del rango agronómico pasa.
  for (const [etiqueta, v] of [["null", null], ["undefined", undefined], ["0", 0], ['"0"', "0"],
                               ["cadena vacía", ""], ["negativo", -5], ["NaN", NaN],
                               ["Infinity", Infinity], ["-Infinity", -Infinity], ["true", true],
                               ["false", false], ["0.2 (bajo MMH_MIN)", 0.2], ["95 (sobre MMH_MAX)", 95]]) {
    const c = clase({ capacidad_mmh: v, fuente: F, confianza: "alta" }, "aspersion");
    ok(c === "no_ejecutable", `${etiqueta} → no ejecutable (${c})`);
  }
  ok(clase({ capacidad_mmh: 6.3, fuente: F, confianza: "alta" }, "aspersion") === "fiable",
     "y un valor válido con confianza alta sí");
}

console.log("\n── método incompatible: el número no vale ni de provisional ──");
{
  ok(motivo({ capacidad_mmh: 6.3, fuente: "derivado_aspersion", confianza: "alta" }, "goteo") === "metodo_incompatible",
     "derivado_aspersion no sirve para goteo");
  ok(motivo({ capacidad_mmh: 6.3, fuente: "derivado_aspersion", confianza: "alta" }, "manguera") === "metodo_incompatible",
     "ni para manguera");
  ok(motivo({ capacidad_mmh: 36, fuente: "medido_vasos", confianza: "alta" }, "goteo") === "metodo_incompatible",
     "medido_vasos no sirve para goteo (un vaso bajo un gotero sobreestima ×29)");
  ok(clase({ capacidad_mmh: 36, fuente: "medido_vasos", confianza: "alta" }, "manguera") === "fiable",
     "y sí para manguera y aspersión, que es donde se mide lo que cae");
  ok(motivo({ capacidad_mmh: 6.3, fuente: "derivado_aspersion", confianza: "alta" }, null) === "sin_metodo",
     "sin método no hay capacidad");
}

console.log("\n── confianza: una fuente admitida con confianza baja no ejecuta ──");
{
  for (const f of ["derivado_aspersion", "medido_vasos"]) {
    const e = R.evaluarCapacidadRiego({ capacidad_mmh: 6.3, fuente: f, confianza: "baja" }, "aspersion");
    ok(e.clase === "provisional" && e.puede_ejecutar === false && e.motivo === "confianza_insuficiente",
       `${f} con confianza baja → provisional`);
    ok(e.capacidad_mmh === 6.3, "  …pero el número sigue cruzando al motor: se calcula el agua igual");
  }
}

console.log("\n── el supuesto de la instalación, comprobado ANTES de la fórmula ──");
{
  const base = { l_h_aspersor: 900, sep_aspersores_m: 12, sep_lineas_m: 12 };
  ok(R.derivar("aspersion", { ...base, disposicion: "movil" }).motivo === "disposicion_no_soportada",
     "a unos aspersores que se mueven NO se les aplica la malla");
  ok(R.derivar("aspersion", { ...base, disposicion: "irregular" }).motivo === "disposicion_no_soportada",
     "ni a unos puestos a ojo");
  ok(R.derivar("aspersion", base).ok === false,
     "y sin declarar la disposición tampoco se calcula por la malla");
  ok(R.derivar("aspersion", { ...base, disposicion: "fija_regular" }).ok === true,
     "solo con la disposición declarada fija y regular");
  // Goteo: igual, y sin declarar nada se comporta como SIEMPRE.
  const g = { l_h_gotero: 2, sep_goteros_m: 0.3, sep_lineas_m: 1 };
  ok(R.derivar("goteo", g).valor === 6.7, "el goteo sin declarar disposición da lo de siempre (6,7)");
  ok(R.derivar("goteo", { ...g, disposicion: "regular" }).valor === 6.7, "declarado regular, lo mismo");
  ok(R.derivar("goteo", { ...g, disposicion: "irregular" }).motivo === "disposicion_no_soportada",
     "y con cintas distintas no se le devuelve un número");
}

console.log("\n── datos, unidades y valores imposibles ──");
{
  const fr = (e) => R.derivar("aspersion", { disposicion: "fija_regular", ...e });
  ok(fr({ l_h_aspersor: 900, sep_aspersores_m: 12 }).motivo === "datos_incompletos", "falta una separación → no hay número");
  ok(fr({ sep_aspersores_m: 12, sep_lineas_m: 12 }).motivo === "datos_incompletos", "falta el caudal → tampoco");
  ok(fr({ l_h_aspersor: 900, sep_aspersores_m: 0, sep_lineas_m: 12 }).motivo === "valores_no_positivos", "una separación de 0 no es una separación");
  ok(fr({ l_h_aspersor: -900, sep_aspersores_m: 12, sep_lineas_m: 12 }).motivo === "valores_no_positivos", "ni un caudal negativo");
  ok(fr({ l_h_aspersor: Infinity, sep_aspersores_m: 12, sep_lineas_m: 12 }).motivo === "datos_incompletos", "ni uno no finito");
  ok(fr({ l_h_aspersor: 90000, sep_aspersores_m: 1, sep_lineas_m: 1 }).motivo === "fuera_de_rango",
     "y un resultado imposible se rechaza aunque los datos parezcan números");
  // 900 L/h sobre 12×12 m = 144 m² → 6,25 mm/h. La unidad importa.
  ok(fr({ l_h_aspersor: 900, sep_aspersores_m: 12, sep_lineas_m: 12 }).valor === 6.3,
     "900 L/h en una malla de 12×12 m son 6,3 mm/h: litros/hora entre metros cuadrados");
}

console.log("\n── medido_vasos: la muestra tiene que ser suficiente y consistente ──");
{
  const v = (cm, min = 15) => R.derivar("aspersion", { cm_varios: cm, minutos: min });
  ok(R.MIN_RECIPIENTES === 3, `hacen falta al menos ${R.MIN_RECIPIENTES} recipientes`);
  ok(v([1.0]).motivo === "pocos_recipientes", "con uno no: mide ese punto, no la parcela");
  ok(v([1.0, 0.8]).motivo === "pocos_recipientes", "con dos, tampoco");
  ok(v([]).motivo === "datos_incompletos", "una lista vacía no es una medición");
  ok(R.derivar("aspersion", { cm_varios: "1,2", minutos: 15 }).motivo === "datos_incompletos",
     "ni algo que no sea una lista");
  ok(v([1.2, 0, 0.6]).motivo === "valores_no_positivos", "un recipiente a 0 invalida la medición");
  ok(v([1.2, -1, 0.6]).motivo === "valores_no_positivos", "y uno negativo");
  ok(v([1.2, 0.9, 0.6], 0).motivo === "valores_no_positivos", "regar 0 minutos no mide nada");
  // Unidades: cm en el recipiente, durante N minutos → mm/h. 1 cm = 10 mm.
  const r = v([1.0, 1.0, 1.0], 15);
  ok(r.ok && r.valor === 40, `1 cm en 15 min son 40 mm/h (${r.valor})`);
  ok(v([1.0, 1.0, 1.0], 30).valor === 20, "y en 30 min, la mitad: el tiempo se aplica una sola vez");
  // Consistencia.
  const bueno = v([1.2, 0.9, 0.6]);
  ok(bueno.confianza === "alta" && clase({ capacidad_mmh: bueno.valor, fuente: bueno.fuente, confianza: bueno.confianza }, "aspersion") === "fiable",
     `una muestra pareja sí habilita minutos (uniformidad ${bueno.datos.uniformidad})`);
  const malo = v([2.0, 1.0, 0.3]);
  ok(malo.ok === true && malo.confianza === "media",
     `una muestra muy desigual NO (uniformidad ${malo.datos.uniformidad})`);
  ok(malo.datos.reparto_desigual === true, "y queda dicho en los datos, no escondido");
  ok(clase({ capacidad_mmh: malo.valor, fuente: malo.fuente, confianza: malo.confianza }, "aspersion") === "provisional",
     "llamarse `medido_vasos` no la hace fiable");
}

console.log("\n── una ficha nominal no es una medición ──");
{
  const nominal = R.derivar("aspersion", { disposicion: "fija_regular", l_h_aspersor: 900, sep_aspersores_m: 12, sep_lineas_m: 12 });
  ok(nominal.confianza === "media", "el caudal de la ficha del aspersor da confianza media");
  ok(nominal.datos.nominal === true, "y se marca como nominal en los datos guardados");
  ok(clase({ capacidad_mmh: nominal.valor, fuente: nominal.fuente, confianza: nominal.confianza }, "aspersion") === "provisional",
     "así que NO habilita minutos fiables: orienta");
  const medido = R.derivar("aspersion", { cm_varios: [1.2, 0.9, 0.6], minutos: 15 });
  ok(clase({ capacidad_mmh: medido.valor, fuente: medido.fuente, confianza: medido.confianza }, "aspersion") === "fiable",
     "lo que sí los habilita es medir cuánta agua cae");
}

console.log("\n── lo legacy, intacto ──");
{
  ok(R.derivar("goteo", { l_h_gotero: 2, sep_goteros_m: 0.3, sep_lineas_m: 1 }).confianza === "alta",
     "derivado_goteo desde la cinta sigue siendo confianza alta");
  ok(R.derivar("goteo", { litros_botella_10min: 0.33, sep_goteros_m: 0.3, sep_lineas_m: 1 }).confianza === "media",
     "y desde la botella, media, como antes");
  const vaso = R.derivar("aspersion", { cm: 0.5, minutos: 15 });
  ok(vaso.fuente === "medido_vaso" && vaso.valor === 20 && vaso.confianza === "alta",
     "medido_vaso (uno solo) da exactamente lo de siempre: ninguna siembra existente cambia de clase");
  ok(R.FUENTES_OPERATIVAS.includes("derivado_goteo") && R.FUENTES_OPERATIVAS.includes("medido_vaso"),
     "las dos fuentes de siempre siguen en la whitelist");
  ok(R.FUENTES_PROVISIONALES.join() === "declarado,heredado_finca",
     "y las provisionales no han cambiado");
}

console.log("\n── cambiar de método no reutiliza la capacidad del anterior ──");
{
  const siembra = { metodoRiego: "aspersion", caudal: 6.3,
    riego: { capacidad_mmh: 6.3, fuente: "derivado_aspersion", confianza: "media" } };
  const tras = R.riegoTrasCambioDeMetodo(siembra, "goteo");
  ok(tras.riego.capacidad_mmh === null || tras.riego.fuente !== "derivado_aspersion",
     `al pasar a goteo no se conserva la capacidad de aspersión (${JSON.stringify(tras.riego?.fuente)})`);
  ok(R.caudalOperativo({ ...siembra, metodoRiego: "goteo" }, {}) === null,
     "y una capacidad de aspersores no cruza al motor como si fuera de goteo");
}

// ══════════════════════════════════════════════════════════════════════
// El SERVIDOR clasifica igual que el cliente
// ══════════════════════════════════════════════════════════════════════
// La fila de `usuarios` solo guarda el NÚMERO; la procedencia vive en
// `config_app`. Si el servidor no la leyera, daría minutos exactos para un
// caudal que el cliente considera provisional, y las dos pantallas del mismo
// agricultor dirían cosas distintas. Se ejecuta el handler REAL de /api/campo.
console.log("\n── cliente y servidor, la misma clasificación ──");
{
  const { hoyISO } = require(join(RAIZ, "assets", "js", "clima-reglas.js"));
  const dia = n => hoyISO(Date.now() - n * 86400000);
  const UID = "11111111-2222-3333-4444-555555555555";

  // Dos siembras del alta nueva: una con la malla de la ficha (provisional) y
  // otra medida con tres recipientes (fiable). MISMO número de partida.
  const casos = [
    { etiqueta: "malla fija desde la ficha", metodo: "aspersion",
      riego: R.derivar("aspersion", { disposicion: "fija_regular", l_h_aspersor: 900,
                                      sep_aspersores_m: 12, sep_lineas_m: 12 }) },
    { etiqueta: "medido con tres recipientes", metodo: "aspersion",
      riego: R.derivar("aspersion", { cm_varios: [1.2, 0.9, 0.6], minutos: 15 }) },
  ];

  // ⚠️ EL MOCK SE INSTALA UNA SOLA VEZ Y LEE UNA VARIABLE. `api/campo.js`
  // desestructura `supabaseSelect` al cargarse, así que reasignarlo después de
  // requerirlo no surte ningún efecto: se queda con la primera función. Con el
  // mock fijo leyendo `caso`, cada vuelta ve lo suyo.
  let caso = null;
  const sb = require(join(RAIZ, "api", "_supabase.js"));
  sb.isConfigured = () => true;
  sb.supabaseUpdate = async () => ({});
  sb.supabaseSelect = async (tabla, q) => {
    if (tabla !== "usuarios" || !caso) return [];
    if (/select=config_app/.test(q || "")) {
      return [{ config_app: { zonas: [{ siembras: [caso.siembra] }] } }];
    }
    return [{ id: UID, propietario_id: UID, ciudad: "Sant Boi", lat: 41.343, lon: 2.037,
              cultivos: ["lechuga"], metodo_riego: caso.metodo, caudal: caso.caudalFila,
              area_m2: 1500, suelo: "franco", fecha_plantacion: dia(30) }];
  };
  const http = require(join(RAIZ, "api", "_http.js"));
  const n = 40;
  const fechas = [], et0 = [], pp = [], tx = [], tn = [];
  for (let i = 0; i < n; i++) {
    fechas.push(hoyISO(Date.now() - (n - 1 - i) * 86400000));
    et0.push(4.8); pp.push(0); tx.push(28); tn.push(16);
  }
  // ⚠️ SE SIMULA `fetchConTimeout`, QUE ES LO QUE USA EL CÓDIGO. Esto simulaba
  // `getJSON`, que no lo llama nadie: el clima y el suelo salían por
  // `fetchConTimeout` y este test pedía de verdad a Open-Meteo y a SoilGrids.
  // De ahí su inestabilidad —verde o rojo según la red, sin tocar una línea— y
  // por eso salió rojo una vez en la suite. Lo localizó la auditoría.
  //
  // Devuelve la forma de una respuesta de fetch, que es lo que esperan los
  // llamantes: `ok`, `json()` y `text()`.
  const respuesta = (cuerpo) => ({ ok: true, status: 200,
    json: async () => cuerpo, text: async () => JSON.stringify(cuerpo) });
  let pedidasFuera = [];
  http.fetchConTimeout = async (url) => {
    pedidasFuera.push(String(url));
    if (/soilgrids/i.test(url)) return respuesta({ properties: { layers: [] } });
    if (/open-meteo|archive-api/i.test(url)) {
      return respuesta({ daily: { time: fechas, et0_fao_evapotranspiration: et0,
                                  precipitation_sum: pp, temperature_2m_max: tx,
                                  temperature_2m_min: tn } });
    }
    return respuesta({});
  };

  for (const c of casos) {
    const siembraCfg = { id: UID, cultivo: "lechuga", area_m2: 1500,
      fechaPlantacion: dia(30), registradoEl: dia(30),
      metodoRiego: c.metodo, riegoPendiente: false,
      riego: { capacidad_mmh: c.riego.valor, unidad: "mm/h", fuente: c.riego.fuente,
               confianza: c.riego.confianza, datos: c.riego.datos } };
    // La fila lleva el número que CRUZA AL MOTOR, que es lo que manda
    // `payloadSiembra`. No es "el caudal fiable": la fiabilidad la decide la
    // procedencia, que viaja en config_app.
    const caudalFila = R.caudalOperativo(siembraCfg, {});
    caso = { siembra: siembraCfg, metodo: c.metodo, caudalFila };

    // El cliente, con la MISMA siembra.
    const enCliente = R.evaluarCapacidadRiego(siembraCfg.riego, c.metodo).clase;

    // El servidor, por su camino real.
    const handler = require(join(RAIZ, "api", "campo.js"));
    let cuerpo = null;
    const res = { status(){ return this; }, setHeader(){ return this; },
                  json(b){ cuerpo = b; return this; }, end(){ return this; } };
    await handler({ method: "GET", url: `/api/campo?vista=hoy&usuario_id=${UID}`,
                    query: { vista: "hoy", usuario_id: UID }, headers: {} }, res);
    const enServidor = cuerpo?.capacidad_riego?.clase ?? null;

    ok(enCliente === enServidor,
       `${c.etiqueta}: cliente "${enCliente}" = servidor "${enServidor}"`);
    // El número viaja en los dos casos —el agua se calcula igual—, pero la
    // fiabilidad NO se deduce de él: se deduce de la procedencia, que el
    // servidor lee de config_app. Por eso las dos clasificaciones coinciden
    // aunque la fila sea idéntica.
    ok(caudalFila === c.riego.valor,
       `  …el número cruza al motor en los dos casos (${caudalFila} mm/h)`);
    const minutos = cuerpo?.capacidad_riego?.puede_ejecutar === true;
    ok(minutos === (enCliente === "fiable"),
       `  …y los minutos fiables se habilitan solo si la clase es fiable (${minutos})`);
    // Que el transporte esté DE VERDAD controlado: si alguna petición se
    // escapara a la red, este test volvería a ser inestable sin avisar.
    const sueltas = pedidasFuera.filter(u => !/soilgrids|open-meteo|archive-api/i.test(u));
    ok(sueltas.length === 0,
       `  …y ninguna petición se escapa a la red sin simular (${sueltas.join(", ") || "ninguna"})`);
    ok(pedidasFuera.length > 0, "  …con el transporte simulado de verdad en uso");
  }
}

console.log(fallos ? `\n${fallos} test(s) FALLARON` : "\n✅ TODOS LOS TESTS VERDES");
process.exit(fallos ? 1 : 0);
