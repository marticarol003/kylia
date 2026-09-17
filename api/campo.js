// ─────────────────────────────────────────────────────────────────
// /api/campo — lecturas del campo del padre / piloto (router)
// ─────────────────────────────────────────────────────────────────
// Un solo endpoint con dos vistas (un Serverless Function en vez de dos, para
// no rebasar el límite del plan Vercel). Ambas son SOLO LECTURA:
//
//   GET /api/campo?vista=hoy&usuario_id=<uuid>     → riego de HOY en cubos
//        (clima Open-Meteo en vivo + balance FAO-56 + pronóstico). Lo consume /campo.
//   GET /api/campo?vista=reveal&usuario_id=<uuid>  → informe final del piloto
//        (cruza recomendaciones_log vs acciones; las 4 dimensiones de /piloto).
//
// El cálculo vive en los módulos puros _motor-riego.js y _reveal.js (testeados);
// aquí solo se leen las filas y se ensambla.

const { isConfigured, supabaseSelect, supabaseUpdate, preludio } = require("./_supabase.js");
const { balanceHidrico, decisionRiego, presentarRiego, laminaRiego, laminaDeAccion, simularKylia, faseDelDia, ventanaMadurez, curvaFenologica } = require("./_motor-riego.js");
// La puerta que decide si se pueden dar MINUTOS. Vive fuera del motor porque el
// motor no sabe de dónde viene el caudal que le pasan: ante uno ausente rellena
// con CAUDAL_DEFAULT_MMH y devuelve unos minutos con la misma cara de seguridad
// que si estuvieran medidos. El bancal real medía 5,4 mm/h donde esa tabla dice
// 10, o sea el doble de agua. Con `caudal` nulo esto devuelve L/m².
const { presentarRiegoSeguro, evaluarCapacidadRiego } = require("../assets/js/riego-capacidad.js");
const presentar = (mm, opts) => presentarRiegoSeguro(presentarRiego, mm, opts);

// La PROCEDENCIA de la capacidad no vive en la fila: vive en `config_app` del
// propietario, dentro de la siembra. La fila solo tiene el número, así que el
// servidor no podía distinguir un caudal derivado de la geometría de uno
// tecleado a mano — y daba minutos exactos para los dos.
//
// Esto la recupera de la configuración canónica que YA existe. Sin migración:
// solo una lectura más, y si falla se cae al lado conservador (provisional).
// ⚠️ DEVUELVE LAS DOS COSAS EN UNA SOLA LECTURA: la capacidad de riego y desde
// cuándo hay registro de riegos. La segunda faltaba, y por eso el servidor —que
// alimenta /campo, los recordatorios y el cron— seguía presentando como
// confirmada una necesidad de riego calculada sobre un periodo del que no
// sabemos nada. El cliente ya lo declaraba; este camino perdía la marca.
async function contextoDeSiembra(u) {
  const riego = { capacidad_mmh: u.caudal, fuente: "heredado_finca", confianza: "baja" };
  let registradoEl = null;
  try {
    const dueno = u.propietario_id || u.id;
    const filas = await supabaseSelect("usuarios", `id=eq.${dueno}&select=config_app`);
    const cfg = filas?.[0]?.config_app;
    for (const z of (cfg?.zonas || [])) {
      for (const sb of (z.siembras || [])) {
        if (sb.id !== u.id) continue;
        registradoEl = sb.registradoEl || null;
        // Declaró su riego: manda lo suyo, sea lo que sea.
        if (sb.riego) return { capacidad: evaluarCapacidadRiego(sb.riego, u.metodo_riego), registradoEl };
        if (sb.caudal != null) {
          return { capacidad: evaluarCapacidadRiego({ capacidad_mmh: sb.caudal, fuente: "declarado", confianza: "media" }, u.metodo_riego), registradoEl };
        }
        return { capacidad: evaluarCapacidadRiego(riego, u.metodo_riego), registradoEl };
      }
    }
    // Parcela principal: su riego vive en `finca`.
    if (u.propietario_id == null || u.propietario_id === u.id) {
      registradoEl = cfg?.finca?.registradoEl || null;
      if (cfg?.finca?.riego) {
        return { capacidad: evaluarCapacidadRiego(cfg.finca.riego, u.metodo_riego), registradoEl };
      }
    }
  } catch (_) { /* sin config: se queda en lo conservador */ }
  return { capacidad: evaluarCapacidadRiego(riego, u.metodo_riego), registradoEl };
}
const { construirReveal, motivoClimaNoPublicable } = require("./_reveal.js");
const { necesidadNutrientes, creditoResiduosN } = require("./_motor-nutricion.js");
const { cuadernoFertilizacion } = require("./_motor-cuaderno-fert.js");
const { ofertaSuelo } = require("./_suelo-oferta.js");
const { rendimientoEsperadoT } = require("./_rendimiento.js");
const { configDesdeFila, COLUMNAS_FINCA } = require("./_config-app.js");
const { puedeVer } = require("./_sesion.js");
const { serieTermica, normalesMensuales } = require("./_clima-termico.js");

const ES_UUID = /^[0-9a-f-]{36}$/i;

// hoyISO viene de _clima.js: el día CIVIL en Europe/Madrid, no el día UTC.
// Entre las 00:00 y las 02:00 locales no son el mismo, y de eso dependía qué
// fuente de clima se usaba para el día anterior. Ver assets/js/clima-reglas.js.

// Último día que cuenta para este piloto: el de la cosecha si ya pasó, si no hoy.
// Todo lo que mira "hasta cuándo" tiene que pasar por aquí — el contrafactual
// incluido. Contar días DESPUÉS de arrancar el cultivo mete en la comparación
// jornadas en las que Kylia "recomendaba regar" y el agricultor lógicamente no
// regaba, y eso diluye el ahorro que se publica.
function ultimoDiaDe(u) {
  const hoy     = hoyISO();
  const cosecha = u && u.fecha_cosecha ? String(u.fecha_cosecha).slice(0, 10) : null;
  return cosecha && cosecha < hoy ? cosecha : hoy;
}
function dia(f) { return f ? String(f).slice(0, 10) : null; }
function diasDesde(fechaIso) {
  if (!fechaIso) return null;
  return Math.floor((Date.now() - new Date(`${fechaIso}T12:00:00Z`)) / 86400000);
}

// El clima vive en _clima.js desde el 14-sep, y con UNA sola regla: el pasado se
// mira en el archivo y el futuro en el pronóstico. Aquí había una copia que
// dejaba mandar al pronóstico en el solape, y sobre el piloto de Ferran eso
// costaba +17,9% de lámina (463,9 contra 393,6 L/m²) y 17 puntos de ahorro
// publicado. El porqué entero, con las medidas, está en la cabecera de _clima.js.
const { climaSerie, procedencia, diasConDato, hoyISO } = require("./_clima.js");

// ── Vista "hoy": recomendación de riego del día en cubos ─────────
async function vistaHoy(res, u) {
  if (u.lat == null || u.lon == null) return res.status(200).json({ ok: false, error: "sin coordenadas" });

  const hoy = hoyISO();

  // Parcela cosechada: no hay cultivo al que regar. Sin esto, /campo le seguía
  // diciendo "riega hoy" al campo de 440 m² un mes después de arrancarlo — el
  // balance FAO-56 no sabe de cosechas, sigue acumulando déficit sobre tierra
  // vacía y la orden crece sola cada día.
  const cosecha = u.fecha_cosecha ? String(u.fecha_cosecha).slice(0, 10) : null;
  if (cosecha && cosecha < hoy) {
    return res.status(200).json({
      ok: true, vista: "hoy",
      usuario: { ciudad: u.ciudad, cultivo: (u.cultivos || [])[0] || null,
                 area_m2: u.area_m2, metodo_riego: u.metodo_riego, caudal: u.caudal },
      cosechado: true, fecha_cosecha: cosecha,
      hoy: { fecha: hoy, nivel: "baja", regar: false,
             texto: `Cosechado el ${cosecha}. Sin cultivo, no hay riego que calcular.` },
      proximo: null, riegos_recientes: [],
    });
  }

  const serie  = await climaSerie(u.lat, u.lon, u.fecha_plantacion, { futuro: 7 });
  const accs   = await supabaseSelect("acciones",
    `usuario_id=eq.${u.id}&tipo=eq.riego` +
    `&select=id,fecha_local,cantidad_l_m2,duracion_min,lamina_mm,lamina_origen,caudal_mmh&order=fecha_local.asc`);
  const riegos = (accs || []).filter(f => f.fecha_local)
    .map(f => ({ id: f.id, date: f.fecha_local, duracion_min: f.duracion_min ?? null,
                 // El cantidad_l_m2 guardado se congeló con el caudal del día del
                 // riego; el balance tiene que ver la lámina del caudal de HOY.
                 litros: laminaDeAccion(f, u.caudal).mm }));

  // Reloj fenológico: la temperatura de TODO el ciclo, que puede empezar antes
  // de donde llega `serie` (el pronóstico solo da 92 días de pasado y un tomate
  // son 145). Si esto falla o viene vacío, el motor vuelve solo al calendario.
  const termica = await serieTermica(u.lat, u.lon, u.fecha_plantacion).catch(() => []);

  // MISMA evaluación que el cliente: fiable | provisional | no_ejecutable. Y de
  // paso, desde cuándo hay registro de riegos — las dos salen de la misma
  // lectura de config_app. Va ANTES de `opts` porque `opts` lo usa.
  const ctxSiembra = await contextoDeSiembra(u);
  const cap = ctxSiembra.capacidad;

  const opts = { suelo: u.suelo, cultivoId: (u.cultivos || [])[0] || null,
                 metodoRiego: u.metodo_riego, fechaPlantacion: u.fecha_plantacion,
                 serieTermica: termica,
                 // La ventana viene de FUERA a propósito: medir la cobertura de
                 // la serie contra la propia serie hace invisibles justo los
                 // huecos que importan, los de los extremos.
                 ventana: { desde: u.fecha_plantacion ? String(u.fecha_plantacion).slice(0, 10) : (serie[0]?.date || null),
                            hasta: hoy },
                 // Desde cuándo hay registro de sus riegos. Si plantó antes de
                 // darse de alta y no hay nada apuntado en ese tramo, el balance
                 // lo declara incierto en vez de contar esos días como si no
                 // hubiera entrado agua.
                 historialDesde: ctxSiembra.registradoEl };
  const presOpts = { metodoRiego: u.metodo_riego, caudalMmh: cap.capacidad_mmh,
                     clase: cap.clase,
                     areaM2: u.area_m2, capacidadRegaderaL: u.capacidad_regadera };

  const idxHoy = serie.findIndex(s => s.date === hoy);
  const corte  = idxHoy >= 0 ? idxHoy : serie.length - 1;

  const balHoy  = balanceHidrico(serie.slice(0, corte + 1), riegos, opts);
  // Los días POSTERIORES a hoy de la misma serie son el pronóstico. El balance
  // corta en hoy (arriba); esto solo ajusta la cantidad por la lluvia que viene,
  // para no llenar el depósito y que el agua de mañana se pierda. Ver decisionRiego.
  const decHoy  = decisionRiego(balHoy, { lluviaPrevista: serie.slice(corte + 1) });
  let presHoy = decHoy.nivel === "alta" ? presentar(decHoy.cantidad_l_m2, presOpts) : null;
  // ⚠️ SI NO CONOCEMOS LOS APORTES ANTERIORES, ESTO NO ES UNA ORDEN.
  //
  // El cliente ya lo decía; este camino no, y es el que alimentan /campo y los
  // recordatorios: `presentacion.texto` es literalmente el titular que lee el
  // agricultor ("Riega ~330 min"). Dejarlo afirmando con un campo aparte que
  // avise es confiar en que alguien mire el campo aparte.
  //
  // Se toca el TEXTO y se marca, no la decisión: el déficit calculado es el que
  // es. Lo que deja de ser firme es lo que podemos afirmar sobre él.
  const balanceIncierto = (balHoy.aportesPreviosDesconocidos || 0) > 0;
  if (balanceIncierto && presHoy) {
    presHoy = { ...presHoy, balance_incierto: true,
                texto: `quizá ${presHoy.texto}`,
                aviso: `Sin saber lo que regaste en los ${balHoy.aportesPreviosDesconocidos} días `
                     + `entre la plantación y el alta, esto es orientativo.` };
  }
  const climaHoy = serie[corte] || {};

  // El PRÓXIMO riego se proyecta con las mismas reglas que el de hoy, incluida
  // la lluvia que se espera para ESE día. Hasta el 11-sep esta proyección no
  // recibía pronóstico —solo el de hoy lo recibía— y anunciaba un riego para el
  // jueves aunque el miércoles cayeran 20 mm. El correo del piloto lo repetía
  // tal cual ("Próximo riego previsto: 14/09").
  let proximo = null;
  for (let i = corte + 1; i < serie.length; i++) {
    const b = balanceHidrico(serie.slice(0, i + 1), riegos, opts);
    const d = decisionRiego(b, { lluviaPrevista: serie.slice(i + 1) });
    if (d.nivel === "alta") {
      proximo = { fecha: serie[i].date,
                  presentacion: presentar(d.cantidad_l_m2, presOpts),
                  Dr: Number(b.Dr.toFixed(1)) };
      break;
    }
  }

  const recientes = riegos.slice(-5).reverse().map(r => ({
    id: r.id, fecha: r.date, l_m2: r.litros, duracion_min: r.duracion_min,
    cubos: (u.capacidad_regadera && u.area_m2 && r.litros != null)
      ? Math.round((r.litros * u.area_m2 / u.capacidad_regadera) * 10) / 10 : null,
  }));

  // Desglose del "porqué de hoy": de dónde sale la decisión (para la tarjeta explicativa).
  const cultivoId = (u.cultivos || [])[0] || null;
  const et0Hoy = Number(climaHoy.et0 ?? 0);
  const desglose = {
    suelo: u.suelo || "franco", cultivo: cultivoId,
    dias_planta: diasDesde(u.fecha_plantacion),
    // La fase sale del reloj que de verdad ha usado el balance. Con el de
    // calendario, la cebolleta de Oriol se pasó el ciclo entero una fase por
    // detrás de donde estaba (ver FAO_GDD en el motor).
    dias_fenologicos: balHoy.diasFenologicos,
    reloj: balHoy.modoFenologia,
    gdd: balHoy.gddAcum,
    fase: balHoy.faseActual ?? faseDelDia(cultivoId, diasDesde(u.fecha_plantacion)),
    kc:  Number(balHoy.kcActual.toFixed(2)),
    et0: Number(et0Hoy.toFixed(1)),
    etc: Number((balHoy.kcActual * et0Hoy).toFixed(1)),    // gasto de la planta hoy
    // null = no se sabe si llovió. No es 0 mm. El balance lo trata como 0 (la
    // hipótesis conservadora) pero la API no puede afirmarlo como medida.
    lluvia: climaHoy.lluvia == null ? null : Number(climaHoy.lluvia.toFixed(1)),
    lluvia_conocida: climaHoy.lluvia != null,
    dr:  Number(balHoy.Dr.toFixed(1)),                      // déficit acumulado
    taw: Number(balHoy.taw.toFixed(1)),                     // agua que cabe en el suelo
    raw: Number(balHoy.raw.toFixed(1)),                     // umbral para regar (45% de TAW)
    raw_vigilar: Number((0.75 * balHoy.raw).toFixed(1)),
    efic: balHoy.efic, metodo: u.metodo_riego,
  };

  // ── ¿Cuándo estará lista? ────────────────────────────────────────
  // No es "cuándo cosechar": eso lo deciden el precio de la semana, el comprador
  // y si tiene gente. Es a partir de cuándo el cultivo está hecho, en ventana y
  // nunca en fecha suelta. Solo sale si el balance ha ido por calor: con el
  // reloj de calendario el número sería justo el que falla por tres semanas.
  let madurez = null;
  if (balHoy.modoFenologia === "termico" && balHoy.gddAcum != null) {
    const normales = await normalesMensuales(u.lat, u.lon).catch(() => null);
    madurez = ventanaMadurez(cultivoId, {
      gddAcum: balHoy.gddAcum,
      desdeISO: hoy,
      pronostico: termica.filter(d => d.date > hoy),
      normales,
    });
  }

  return res.status(200).json({
    ok: true, vista: "hoy", madurez,
    usuario: { ciudad: u.ciudad, cultivo: cultivoId,
               area_m2: u.area_m2, capacidad_regadera: u.capacidad_regadera,
               metodo_riego: u.metodo_riego, caudal: u.caudal },
    // La clasificación, explícita, para que cliente y servidor se puedan
    // comparar en vez de esperar que coincidan por casualidad.
    capacidad_riego: { clase: cap.clase, capacidad_mmh: cap.capacidad_mmh,
                       fuente: cap.fuente, confianza: cap.confianza,
                       puede_ejecutar: cap.puede_ejecutar, motivo: cap.motivo },
    // ⚠️ LA CONFIANZA DEL BALANCE ES OTRA COSA que la de la capacidad. Se puede
    // saber a qué ritmo riega y no tener ni idea de cuánto regó antes de darse
    // de alta. Quien consuma esto tiene que poder distinguirlas.
    balance_confianza: {
      confianza: balHoy.confianzaBalance || null,
      aportes_previos_desconocidos: balHoy.aportesPreviosDesconocidos ?? 0,
      reanclado_en: balHoy.balanceReancladoEn || null,
      riegos_sin_cantidad: balHoy.riegosSinCantidad ?? 0,
    },
    hoy: {
      fecha: hoy, nivel: decHoy.nivel, regar: decHoy.nivel === "alta",
      texto: balanceIncierto
        ? decHoy.texto.replace(/^Regar hoy/, "Quizá toque regar") + " · sin saber lo que regaste antes del alta"
        : decHoy.texto,
      presentacion: presHoy,
      // La confianza del BALANCE, aparte de la de la capacidad: se puede saber a
      // qué ritmo riega y no saber cuánto regó.
      balance_incierto: balanceIncierto,
      aportes_previos_desconocidos: balHoy.aportesPreviosDesconocidos ?? 0,
      deficit_mm: Number(balHoy.Dr.toFixed(1)), umbral_mm: Number(balHoy.raw.toFixed(1)),
      et0: Number((climaHoy.et0 ?? 0).toFixed(1)),
      // null = no se sabe si llovió, que no es lo mismo que 0 mm medidos.
      lluvia: climaHoy.lluvia == null ? null : Number(climaHoy.lluvia.toFixed(1)),
      lluvia_conocida: climaHoy.lluvia != null,
      dias_sin_lluvia_conocida: balHoy.diasSinLluviaConocida ?? null,
      // DE QUÉ DÍA SON ESOS NÚMEROS. `serie` puede no llegar hasta hoy si las dos
      // fuentes fallan, y entonces el balance se queda donde llegó: el déficit
      // sale corto —le faltan los días sin contar— y eso empuja hacia "no toca
      // regar", que es la dirección que no se nota. Antes esto se devolvía como
      // si fuera de hoy y nadie podía saberlo.
      clima_fecha: climaHoy.date || null,
      clima_al_dia: climaHoy.date === hoy,
      cobertura_clima: balHoy.coberturaClima ?? null,
      dias_sin_clima: balHoy.diasSinClima ?? null,
      // Y DE DÓNDE SALIERON. `coherencia: 1` = todo el pasado se calculó con el
      // archivo, que es la regla. Por debajo, parte del pasado salió del
      // pronóstico porque el archivo no respondió, y eso mete un escalón.
      procedencia_clima: procedencia(serie, hoy),
      // DE QUÉ SE ESTÁ FIANDO. Un riego apuntado sin cantidad entra al balance
      // como recarga completa —el suelo a capacidad de campo—, que es la
      // hipótesis más optimista posible y empuja hacia "no toca regar". Si el
      // déficit de hoy se apoya en uno de esos, quien lo lea tiene que poder
      // saberlo.
      riegos_sin_cantidad: balHoy.riegosSinCantidad || null,
      ultimo_riego_sin_cantidad: balHoy.ultimoRiegoSinCantidad,
      // DE QUÉ CONFIANZA ES ESTA RECOMENDACIÓN. Decisión del 14-sep: mientras un
      // riego sin cantidad siga entrando como recarga completa (hipótesis A), la
      // decisión que se apoye en uno NO se presenta como de alta confianza. La
      // estrategia buena —mantener el intervalo de estados posibles— va en rama
      // aparte para no mezclarla con estas correcciones.
      confianza: balHoy.confianzaBalance || null,
    },
    desglose, proximo, riegos_recientes: recientes,
  });
}

// ── Vista "madurez": ¿cuándo estará lista? ────────────────────────
// La consume /app, que calcula su propio balance en el navegador pero no puede
// bajarse diez años de temperatura para proyectar el final del ciclo. Aquí ya
// están la serie térmica y las normales, cacheadas y compartidas entre pilotos.
//
// Es deliberadamente barata: NO calcula el balance de agua, solo el reloj del
// cultivo. Y devuelve `null` sin drama cuando no se puede saber (sin fecha de
// plantación, sin cultivo con tabla térmica, o sin temperatura que cubra el
// arranque del ciclo): en pantalla eso es "no se enseña la tarjeta", que es
// mejor que una fecha inventada.
async function vistaMadurez(res, u) {
  const cultivoId = (u.cultivos || [])[0] || null;
  const vacio = { ok: true, vista: "madurez", madurez: null, cultivo: cultivoId, reloj: "calendario" };
  if (!cultivoId || !u.fecha_plantacion || u.lat == null || u.lon == null) return res.status(200).json(vacio);

  const cosecha = u.fecha_cosecha ? String(u.fecha_cosecha).slice(0, 10) : null;
  if (cosecha) return res.status(200).json({ ...vacio, cosechado: true, fecha_cosecha: cosecha });

  const termica = await serieTermica(u.lat, u.lon, u.fecha_plantacion).catch(() => []);
  const curva   = curvaFenologica(cultivoId, termica, u.fecha_plantacion);
  if (!curva) return res.status(200).json(vacio);

  const hoy       = hoyISO();
  const normales  = await normalesMensuales(u.lat, u.lon).catch(() => null);
  const madurez   = ventanaMadurez(cultivoId, {
    // gddEn(hoy) y no gddAcum: la serie térmica trae 16 días de pronóstico y
    // ese calor todavía no ha caído sobre la planta.
    gddAcum: curva.gddEn(hoy) ?? curva.gddAcum, desdeISO: hoy,
    pronostico: termica.filter(d => d.date > hoy), normales,
  });
  const diaFen = curva.diaDe(hoy);

  return res.status(200).json({
    ok: true, vista: "madurez", madurez, cultivo: cultivoId, reloj: "termico",
    fase: faseDelDia(cultivoId, diaFen),
    dias_calendario:  diasDesde(u.fecha_plantacion),
    dias_fenologicos: diaFen == null ? null : Math.round(diaFen),
    gdd: Math.round(curva.gddEn(hoy) ?? curva.gddAcum), gdd_objetivo: curva.gddObjetivo, tbase: curva.tbase,
  });
}

// ── Vista "perfil": config del piloto para su cuaderno (SIN recomendación) ──
// La consume /piloto/diario, la superficie de registro del piloto silencioso.
// A propósito NO calcula ni devuelve la decisión de riego: el piloto silencioso
// no debe ver lo que Kylia recomienda (sesgaría el experimento). Solo la config
// para adaptar el registro (cubos vs horas) y lo que ya lleva apuntado.
// La configuración de /app guardada en el servidor, para que un dispositivo que
// no tiene nada pueda restaurarla. Es lo que hace útil el enlace por correo:
// sin esto, el móvil nuevo adopta al propietario y aun así ve la app en blanco.
//
// Si la fila consultada no tiene foto pero es una ZONA (su propietario es otra
// fila), se mira la del propietario — que es donde vive siempre. Así funciona
// aunque el dispositivo pregunte con el id de una zona.
// Los campos ESTRUCTURALES de una parcela, geometría incluida, para poder
// contrastarla contra la configuración canónica sin adivinar. `vista=hoy` no
// devuelve el contorno —y no debe: es el endpoint que más se llama y un polígono
// por respuesta lo engorda— así que esto va aparte y solo lo pide quien verifica.
// No calcula nada: es un espejo de la fila.
function vistaVerificar(res, u) {
  return res.status(200).json({
    ok: true, vista: "verificar",
    parcela: {
      id:               u.id,
      propietario_id:   u.propietario_id || null,
      nombre:           u.nombre || null,
      ciudad:           u.ciudad || null,
      lat:              u.lat ?? null,
      lon:              u.lon ?? null,
      cultivos:         u.cultivos || [],
      parcela:          u.parcela || null,        // el contorno, tal cual
      area_m2:          u.area_m2 ?? null,
      fecha_plantacion: u.fecha_plantacion || null,
      suelo:            u.suelo || null,
      metodo_riego:     u.metodo_riego || null,
      caudal:           u.caudal ?? null,
    },
  });
}

// Versión válida o NADA. Nunca se fabrica un 0: un 0 inventado es una base de
// CAS falsa, y con ella el cliente escribiría creyendo que parte de cero cuando
// en realidad no sabe de dónde parte. PostgREST puede devolver un bigint como
// número o como cadena, así que se acepta cualquiera de los dos y se normaliza a
// número; lo que no sea una versión de verdad sale como null.
function versionValida(v) {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? v : null;
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

async function vistaConfig(res, u) {
  // ─── EL BLOQUE DEL PROPIETARIO, que es el único válido para el CAS ───
  // La config global es del PROPIETARIO, y el compare-and-set se hace contra SU
  // fila. Antes la respuesta podía mezclar: `config` de una zona y
  // `config_version` de otra fila, o un 0 fabricado. Con una base que no
  // corresponde a la foto, el CAS deja de proteger nada. Lo cazó Codex.
  //
  // Por eso estos tres campos salen SIEMPRE de la misma fila, y si el propietario
  // no tiene config se devuelve null con SU versión — sin buscarla en otro sitio.
  const propietarioId = u.propietario_id || u.id;
  let filaDueno = u;
  if (propietarioId !== u.id) {
    const dueños = await supabaseSelect("usuarios", `id=eq.${propietarioId}&select=*`);
    filaDueno = dueños?.[0] || null;
  }
  // La foto del dueño. Si nunca guardó `config_app`, se reconstruye DESDE SU
  // PROPIA FILA: sigue siendo la misma fila, así que la tupla no se mezcla. Sin
  // esto, quien configuró su campo antes de que existiera config_app no tendría
  // tupla adoptable y abriría la app en blanco teniendo la parcela guardada.
  const propietario = {
    id:             propietarioId,
    config:         filaDueno ? (filaDueno.config_app || configDesdeFila(filaDueno) || null) : null,
    config_version: filaDueno ? versionValida(filaDueno.config_version) : null,
  };

  // ─── La foto para RESTAURAR, que es otra cosa y puede venir de más sitios ───
  // Esto no se usa como base de escritura: solo para que un dispositivo nuevo
  // abra con algo en vez de en blanco.
  let config = u.config_app || null;
  let de = u.id;
  if (!config && filaDueno && filaDueno.id !== u.id) {
    const suya = filaDueno.config_app || configDesdeFila(filaDueno);
    if (suya) { config = suya; de = filaDueno.id; }
  }
  // Último recurso: la finca reconstruida desde la propia fila. `config_app` solo
  // se escribe cuando el agricultor cambia algo, así que quien configuró su campo
  // antes de que existiera esa columna la tiene vacía — y sin esto abriría la app
  // en blanco teniendo la parcela guardada. Ver _config-app.js.
  if (!config) config = configDesdeFila(u);

  return res.status(200).json({
    ok: true, vista: "config",
    propietario_id: propietarioId,
    config,                                   // foto para RESTAURAR (puede venir de otra fila)
    guardado: config?.guardado || null,
    de,                                       // de qué fila salió esa foto
    // Lo único que vale para guardar: los tres de la fila del propietario.
    propietario,
    // null = versión desconocida. El cliente NO debe escribir con esto.
    config_version: propietario.config_version,
  });
}

async function vistaPerfil(res, u, opts = {}) {
  // `limite` lo sube la RECONCILIACIÓN de la app: para copiar las láminas
  // congeladas a su historial local necesita el ciclo entero, no los 8 últimos.
  const limite = Math.min(400, Math.max(8, Number(opts.limite) || 8));
  const [accs, aplics] = await Promise.all([
    supabaseSelect("acciones",
      `usuario_id=eq.${u.id}&tipo=eq.riego` +
      `&select=id,fecha_local,cantidad_l_m2,duracion_min,lamina_mm,lamina_origen,caudal_mmh&order=fecha_local.desc&limit=${limite}`),
    supabaseSelect("acciones",
      `usuario_id=eq.${u.id}&tipo=eq.aplicacion&select=id,fecha_local,producto_nombre,dosis,motivo&order=fecha_local.desc&limit=8`),
  ]);
  const recientes = (accs || []).filter(f => f.fecha_local).map(f => {
    const l_m2 = laminaDeAccion(f, u.caudal).mm;
    return {
      id: f.id, fecha: f.fecha_local, l_m2, duracion_min: f.duracion_min ?? null,
      // Los campos CONGELADOS, tal cual: son lo que la app copia a su historial
      // local para dejar de recalcular con el caudal actual. `cantidad_l_m2` va
      // también porque forma parte de la clave de correspondencia.
      cantidad_l_m2: f.cantidad_l_m2 ?? null,
      lamina_mm:     f.lamina_mm ?? null,
      lamina_origen: f.lamina_origen ?? null,
      caudal_mmh:    f.caudal_mmh ?? null,
      cubos: (u.capacidad_regadera && u.area_m2 && l_m2 != null)
        ? Math.round((l_m2 * u.area_m2 / u.capacidad_regadera) * 10) / 10 : null,
    };
  });
  // Abonados y tratamientos del cuaderno (motivo "abonado" los distingue).
  const aplicaciones = (aplics || []).filter(f => f.fecha_local).map(f => ({
    id: f.id, fecha: f.fecha_local, producto: f.producto_nombre || null,
    dosis: f.dosis || null, motivo: f.motivo || null,
  }));
  return res.status(200).json({
    ok: true, vista: "perfil",
    usuario: { ciudad: u.ciudad, cultivo: (u.cultivos || [])[0] || null,
               metodo_riego: u.metodo_riego, caudal: u.caudal, area_m2: u.area_m2,
               capacidad_regadera: u.capacidad_regadera, fecha_plantacion: u.fecha_plantacion },
    riegos_recientes: recientes,
    aplicaciones_recientes: aplicaciones,
  });
}

// Oferta de nutrientes del suelo (SoilGrids), con caché persist-once en la fila
// del usuario: el suelo no cambia, así que se calcula UNA vez y se guarda en
// usuarios.suelo_oferta. Solo se llama a SoilGrids (red, varios segundos) si la
// caché está vacía y hay coordenadas. Nunca revienta la vista: ante cualquier
// fallo devuelve null y el cuaderno cae a extracción bruta.
async function obtenerOfertaSuelo(u) {
  if (u.suelo_oferta && typeof u.suelo_oferta === "object") return u.suelo_oferta;
  if (!(Number.isFinite(u.lat) && Number.isFinite(u.lon))) return null;

  let oferta;
  try {
    oferta = await ofertaSuelo(u.lat, u.lon, u.area_m2);
  } catch (e) {
    console.warn("[campo] ofertaSuelo falló:", e.message);
    return null;
  }
  // Cacheamos también el "no disponible" para no reintentar en cada carga.
  const cache = { ...oferta, calculado: hoyISO() };
  try {
    await supabaseUpdate("usuarios", `id=eq.${u.id}`, { suelo_oferta: cache });
  } catch (e) {
    console.warn("[campo] no se pudo cachear suelo_oferta:", e.message);
  }
  return cache;
}

// NDVI más reciente cacheado de la parcela (tabla mediciones), para el estimador
// de rendimiento. null si no hay ninguna medición o falla la lectura (el estimador
// cae entonces al rinde de referencia sin ajuste de vigor).
async function ultimoNdvi(usuarioId) {
  try {
    const filas = await supabaseSelect("mediciones",
      `usuario_id=eq.${usuarioId}&ndvi=not.is.null&select=ndvi,fecha&order=fecha.desc&limit=1`);
    const v = filas && filas[0] ? Number(filas[0].ndvi) : null;
    return Number.isFinite(v) ? v : null;
  } catch (e) {
    console.warn("[campo] ultimoNdvi:", e.message);
    return null;
  }
}

// ── Vista "cuaderno": cuaderno de fertilización (pilar fertilizantes) ──
// Dos mitades honestas:
//   1. Lo REGISTRADO: abonados apuntados en el diario (tipo=aplicacion,
//      motivo=abonado) — la base del cuaderno RD 1051/2022.
//   2. El PLAN (opcional): necesidad de nutrientes + coste €, SOLO si llega el
//      rendimiento esperado (?rend_t= toneladas). Sin rendimiento no se estima:
//      el motor devuelve disponible:false con su motivo, y así se muestra.
// Kilos de nutriente ya aportados EN ESTE CICLO, para que el plan no vuelva a
// pedirlos. La ventana arranca 45 días antes de la plantación a propósito: el
// abonado de FONDO se echa antes de plantar, así que una ventana que empezara el
// día 0 se lo dejaría fuera — que es exactamente el caso que destapó esto (el
// Labinor del bancal, aplicado antes de las 33 lechugas).
//
// Solo cuenta lo que trae `nutrientes` con números. Un abonado apuntado sin esa
// cifra NO descuenta nada: la `dosis` es texto libre ("2 sacos", "un puñado") y
// deducir kilos de ahí sería adivinar un número que entra en un balance. Pedir
// de más es recuperable; descontar de menos, no.
function yaAplicadoEnCiclo(abonados, fechaPlantacion) {
  const total = { N: 0, P2O5: 0, K2O: 0 };
  if (!Array.isArray(abonados) || !abonados.length) return total;

  const desde = fechaPlantacion
    ? new Date(`${String(fechaPlantacion).slice(0, 10)}T12:00:00Z`).getTime() - 45 * 86400000
    : null;

  for (const a of abonados) {
    if (!a.nutrientes || typeof a.nutrientes !== "object") continue;
    if (desde && a.fecha_local) {
      if (new Date(`${a.fecha_local}T12:00:00Z`).getTime() < desde) continue;
    }
    for (const n of ["N", "P2O5", "K2O"]) {
      const v = Number(a.nutrientes[n]);
      if (Number.isFinite(v) && v > 0) total[n] += v;
    }
  }
  return total;
}

async function vistaCuaderno(req, res, u) {
  // motivo=neq.abonado a secas dejaría fuera los motivo NULL (SQL de 3 valores):
  // los tratamientos sin motivo también son tratamientos.
  const [abonados, riegos, trats] = await Promise.all([
    supabaseSelect("acciones",
      `usuario_id=eq.${u.id}&tipo=eq.aplicacion&motivo=eq.abonado` +
      `&select=id,fecha_local,producto_nombre,dosis,coste_estimado_eur,notas,nutrientes&order=fecha_local.asc`),
    supabaseSelect("acciones",
      `usuario_id=eq.${u.id}&tipo=eq.riego` +
      `&select=fecha_local,cantidad_l_m2,duracion_min,lamina_mm,lamina_origen,caudal_mmh,franja_horaria&order=fecha_local.asc`),
    supabaseSelect("acciones",
      `usuario_id=eq.${u.id}&tipo=in.(aplicacion,tratamiento)&or=(motivo.neq.abonado,motivo.is.null)` +
      `&select=id,fecha_local,producto_nombre,sustancia_activa,dosis,plazo_seguridad_dias,motivo,notas&order=fecha_local.asc`),
  ]);

  const cultivo = (u.cultivos || [])[0] || null;

  // Rendimiento esperado: manda el del onboarding (?rend_t). Si no llega, se estima
  // por satélite (rinde de referencia × factor de vigor NDVI) para que el plan de
  // abonado funcione sin que el agricultor teclee nada. Ver _rendimiento.js.
  const rendOnboarding = Number(req.query?.rend_t) || null;
  let rendEstimado = null;
  if (rendOnboarding == null && cultivo) {
    const ndvi = await ultimoNdvi(u.id);
    // La FASE decide si el NDVI significa rinde. En fase inicial un cultivo
    // tiene el índice bajo por pequeño, no por ir mal, y penalizarlo ahí movía
    // los kilos de nitrógeno de todo el plan. Ver factorVigor.
    const fase = faseDelDia(cultivo, diasDesde(u.fecha_plantacion));
    rendEstimado = rendimientoEsperadoT(cultivo, u.area_m2, { ndvi, fase });
  }
  const rendT = rendOnboarding != null
    ? rendOnboarding
    : (rendEstimado && rendEstimado.disponible ? rendEstimado.rendimiento_t : null);

  // Oferta del suelo (SoilGrids): descuenta lo que ya aporta el suelo del plan.
  const oferta = await obtenerOfertaSuelo(u);
  const ofertaMotor = oferta && oferta.disponible
    ? { N: oferta.N, P2O5: oferta.P2O5, K2O: oferta.K2O }
    : null;

  // Crédito de residuos del cultivo anterior (MAPA): solo si el onboarding capturó
  // el cultivo previo Y que se incorporaron los restos. Si no, queda en 0.
  const creditoResiduos = creditoResiduosN(u.cultivo_anterior || null, !!u.restos_incorporados);

  const plan = cuadernoFertilizacion(
    // area_m2 activa los términos de N de MAPA (colchón final + crédito de residuos).
    necesidadNutrientes(cultivo, rendT, ofertaMotor, {
      area_m2: u.area_m2 ?? null,
      credito_residuos_n_kg_ha: creditoResiduos,
    }),
    // El manejo elige la tabla de precios: en ecológico el mismo nitrógeno
    // cuesta ~20 veces más, y hasta ahora se le enseñaba el precio de la urea.
    { superficie_m2: u.area_m2 ?? null, metodo_riego: u.metodo_riego || null,
      manejo: u.manejo || null,
      ya_aplicado: yaAplicadoEnCiclo(abonados, u.fecha_plantacion) },
  );

  return res.status(200).json({
    ok: true, vista: "cuaderno", cultivo,
    suelo: oferta && oferta.disponible
      ? {
          fuente: oferta.fuente,
          fuente_punto: oferta.fuente_punto,
          n_disponible_kg: oferta.N,
          observado: oferta.observado,
          nota: oferta.nota,
        }
      : { disponible: false, nota: (oferta && oferta.motivo) || "Sin prior de suelo; plan sobre extracción bruta." },
    parcela: {
      nombre: u.nombre || null, ciudad: u.ciudad || null, cultivo,
      area_m2: u.area_m2 ?? null, metodo_riego: u.metodo_riego || null,
      manejo: u.manejo || null, fecha_plantacion: u.fecha_plantacion || null,
    },
    // El plan dice GRAMOS DE NUTRIENTE; el agricultor pesa GRAMOS DE PRODUCTO.
    // El puente es la búsqueda de mercado ya cacheada (su %N), así que viaja
    // aquí para que /campo pueda decir "pesa 63 g de esto" sin buscar otra vez.
    producto: u.producto_fert?.recomendado
      ? {
          nombre: u.producto_fert.recomendado.producto || null,
          pct_nutriente: u.producto_fert.recomendado.pct_nutriente ?? null,
          certificado_eco: u.producto_fert.recomendado.certificado_eco ?? null,
          url: u.producto_fert.recomendado.url || null,
          consultado: u.producto_fert.consultado || null,
          // El razonamiento viaja con la recomendación. Los DESCARTADOS son la
          // mitad del valor: dicen por qué no es lo que sale primero al buscar.
          por_que: u.producto_fert.recomendado.por_que || null,
          eur_kg_nutriente: u.producto_fert.recomendado.eur_kg_nutriente ?? null,
          descartados: (u.producto_fert.descartados || []).slice(0, 4),
          alternativas: (u.producto_fert.alternativas || []).slice(0, 3),
          avisos: (u.producto_fert.avisos || []).filter(Boolean).slice(0, 3),
          fuentes: (u.producto_fert.citas || []).slice(0, 6),
        }
      : null,
    // Ensayo declarado sobre esta parcela, si lo hay: parte la dosis entre las
    // plantas tratadas y recuerda qué hay que apuntar. Ver preferencias.ensayo.
    ensayo: (u.preferencias && u.preferencias.ensayo) || null,
    // Rendimiento con el que se calcula el plan y de dónde sale (onboarding manda;
    // si no, estimación por satélite declarada como peldaño 1, no un B1 calibrado).
    rendimiento: {
      usado_t: rendT,
      origen: rendOnboarding != null ? "onboarding"
            : (rendEstimado && rendEstimado.disponible ? "estimado_satelite" : "sin_dato"),
      estimacion: rendEstimado || null,
    },
    riegos: (riegos || []).filter(r => r.fecha_local).map(r => ({
      fecha: r.fecha_local, duracion_min: r.duracion_min ?? null,
      l_m2: laminaDeAccion(r, u.caudal).mm,
      franja: r.franja_horaria || null,
    })),
    tratamientos: (trats || []).filter(t => t.fecha_local).map(t => ({
      id: t.id, fecha: t.fecha_local, producto: t.producto_nombre || null,
      sustancia: t.sustancia_activa || null, dosis: t.dosis || null,
      plazo_seguridad_dias: t.plazo_seguridad_dias ?? null,
      motivo: t.motivo || null, notas: t.notas || null,
    })),
    abonados: (abonados || []).map(a => ({
      id: a.id, fecha: a.fecha_local, producto: a.producto_nombre || null,
      nutrientes: a.nutrientes || null,
      dosis: a.dosis || null, coste_eur: a.coste_estimado_eur ?? null, notas: a.notas || null,
    })),
    plan,
  });
}

// Ensambla el reveal de UN usuario (cruza recomendaciones_log vs acciones +
// contrafactual FAO-56). Reutilizado por vistaReveal (uno) y vistaPilotos (todos).
async function revealDeUsuario(u) {
  // Inicio efectivo del piloto: el reveal solo cuenta decisiones y riegos desde
  // esta fecha. Sirve para dejar fuera un arranque contaminado (p.ej. días en que
  // Kylia congeló sin tener aún el riego real cargado) SIN tocar el log, que es
  // append-only por diseño. Si no está fijado, cuenta todo el historial.
  const desde   = u.piloto_inicio ? String(u.piloto_inicio).slice(0, 10) : null;
  // Y FINAL: el día de la cosecha. Sin este tope la ventana se cerraba en el
  // último día con decisión congelada, o sea "hoy", así que el reveal seguía
  // contando días DESPUÉS de arrancar el cultivo — días en los que Kylia
  // "recomendaba regar" y el agricultor lógicamente no regaba. Eso diluye el
  // ahorro: el campo de 440 m² publicaba ~20% cuando el rango honesto es 20-30%.
  const hasta   = u.fecha_cosecha ? String(u.fecha_cosecha).slice(0, 10) : null;
  const fRec    = (desde ? `&fecha=gte.${desde}T00:00:00Z` : "")
                + (hasta ? `&fecha=lte.${hasta}T23:59:59Z` : "");
  const fAcc    = (desde ? `&fecha_local=gte.${desde}` : "")
                + (hasta ? `&fecha_local=lte.${hasta}` : "");

  const [recs, acciones, jornadas] = await Promise.all([
    supabaseSelect("recomendaciones_log",
      `usuario_id=eq.${u.id}${fRec}&select=fecha,tipo,cantidad_l_m2,nivel&order=fecha.asc`),
    supabaseSelect("acciones",
      `usuario_id=eq.${u.id}${fAcc}&select=fecha_local,tipo,cantidad_l_m2,duracion_min,lamina_mm,lamina_origen,caudal_mmh,producto_nombre,motivo&order=fecha_local.asc`),
    supabaseSelect("jornadas", `usuario_id=eq.${u.id}&select=fuente_decision`),
  ]);

  const riegosKylia = (recs || []).filter(r => r.tipo === "riego")
    .map(r => ({ dia: dia(r.fecha), l_m2: r.cantidad_l_m2, nivel: r.nivel }));
  const tratKylia = (recs || []).filter(r => r.tipo === "tratamiento" || r.tipo === "nutricion")
    .map(r => ({ dia: dia(r.fecha) }));
  const riegosReales = (acciones || []).filter(a => a.tipo === "riego")
    .map(a => ({ dia: dia(a.fecha_local), l_m2: laminaDeAccion(a, u.caudal).mm }));
  // Los abonados (motivo="abonado") NO son tratamientos fitosanitarios: van al
  // cuaderno de fertilización (vista=cuaderno), no a la dimensión de plagas.
  const tratReales = (acciones || [])
    .filter(a => (a.tipo === "tratamiento" || a.tipo === "aplicacion") && a.motivo !== "abonado")
    .map(a => ({ dia: dia(a.fecha_local), producto: a.producto_nombre }));

  // Contrafactual FAO-56 INDEPENDIENTE (simularKylia), la MISMA referencia que la
  // comparativa del campo del padre. Es la comparación honesta para el agua: la
  // lámina de Kylia se simula sobre el clima/cultivo/suelo de la parcela SIN ver
  // el riego real. Evita el sesgo de leer recomendaciones_log, que en goteo de
  // pauta fija ve el agua ya aplicada y nunca dispara (daba "Kylia = 0"). El suelo
  // arranca lleno (Dr=0) en `desde`, igual que la comparativa. Sin coordenadas o
  // sin clima → no se pasa contrafactual y el reveal cae al método heredado.
  let contrafactual = null;
  if (u.lat != null && u.lon != null) {
    try {
      const serie  = await climaSerie(u.lat, u.lon, u.fecha_plantacion, { futuro: 7 });
      const corte  = ultimoDiaDe(u);                     // cosecha si ya pasó, si no hoy
      const idxFin = serie.findIndex(s => s.date === corte);
      const hasta  = serie.slice(0, (idxFin >= 0 ? idxFin : serie.length - 1) + 1);
      const dias   = desde ? hasta.filter(d => d.date >= desde) : hasta;
      // El reloj fenológico va APARTE de la ventana simulada, y a propósito: la
      // comparación puede arrancar después de la plantación (`desde`), pero el
      // cultivo lleva creciendo desde el día 0. Si el calor se contara solo sobre
      // el trozo simulado, el contrafactual creería joven a una planta hecha y
      // regaría de menos — y encima el resultado dependería de cuántos días hace
      // que se plantó, porque climaSerie corta a 92. Así es determinista.
      const termica = await serieTermica(u.lat, u.lon, u.fecha_plantacion).catch(() => []);
      if (dias.length) {
        const sim = simularKylia(dias, {
          suelo: u.suelo, cultivoId: (u.cultivos || [])[0] || null,
          metodoRiego: u.metodo_riego, fechaPlantacion: u.fecha_plantacion,
          serieTermica: termica,
          // LA VENTANA QUE SE ESPERABA CUBRIR. Sin esto, la cobertura de clima
          // se mide contra la propia serie y los huecos del PRINCIPIO son
          // invisibles: los 29 días sin ET₀ del reveal de Ferran quedaban fuera
          // por delante, la serie empezaba más tarde y la cobertura daba 1,000.
          // Con la ventana declarada, da 0,67 y el informe se niega a publicar
          // un porcentaje.
          // ⚠️ LA VENTANA ES LA QUE EL BALANCE NECESITABA, no la que le llegó.
          // Aquí se pasaba `dias[0].date` —el primer día CON DATO— así que si
          // faltaban los 18 primeros días del ciclo, la cobertura se medía
          // contra el día 19 y daba 1,000. La guardia que impide publicar sin
          // clima quedaba ciega justo en el caso que más la necesita: un hueco
          // al principio no encoge la serie, la empieza más tarde.
          ventana: { desde: desde || String(u.fecha_plantacion || "").slice(0, 10) || dias[0].date,
                     hasta: corte },
        });
        // LA COBERTURA VIAJA CON EL NÚMERO. El motor la declara desde la
        // auditoría del 11-sep y _reveal.js la exige antes de publicar un
        // porcentaje, pero aquí se quedaba fuera del objeto: llegaba `null`, la
        // comprobación no llegaba a ejecutarse y el informe volvía a decir
        // `publicable: true` sin haber mirado el clima. La guardia que se
        // escribió para que no se repitiera lo de los dos pilotos estaba
        // inerte en producción. Un número sin su cobertura es un número que
        // alguien va a publicar.
        contrafactual = { puntos: sim.puntos, total: sim.total, deficitFinal: sim.deficitFinal,
                          coberturaClima: sim.coberturaClima, diasSinClima: sim.diasSinClima,
                          diasEsperadosClima: sim.diasEsperadosClima,
                          ventanaClimaDeclarada: sim.ventanaClimaDeclarada,
                          diasSinLluviaConocida: sim.diasSinLluviaConocida,
                          modoFenologia: sim.modoFenologia };
      }
    } catch (_) { /* sin clima → método heredado (recomendaciones_log) */ }
  }

  const informe = construirReveal({
    usuario: u, riegosReales, riegosKylia, tratReales, tratKylia,
    jornadas: jornadas || [], contrafactual,
  });
  return { informe, crudo: { riegosKylia, tratKylia, riegosReales, tratReales, jornadas } };
}

// ── Vista "reveal": informe final del piloto ─────────────────────
async function vistaReveal(req, res, u) {
  const { informe, crudo } = await revealDeUsuario(u);
  const payload = { ok: true, vista: "reveal", informe };
  if (String(req.query?.dump || "") === "1") payload.crudo = crudo;
  return res.status(200).json(payload);
}

// ── Vista "pilotos": panel de TODOS los pilotos silenciosos ──────
// No lleva usuario_id; se protege con PILOTOS_KEY (expone datos de varios
// agricultores → RGPD). Reutiliza revealDeUsuario: no duplica la máquina.
async function vistaPilotos(req, res) {
  const expected = (process.env.PILOTOS_KEY || "").trim();
  if (!expected) return res.status(200).json({ ok: false, reason: "pilotos_key_not_configured" });
  if ((req.query?.key || "").toString() !== expected) return res.status(403).json({ ok: false, error: "key inválida" });
  if (!isConfigured()) return res.status(200).json({ ok: false, reason: "supabase_not_configured" });

  // El bancal de las 33 lechugas lleva piloto_sombra=true SOLO para que el Diario B
  // congele la decisión diaria — pero NO es un piloto silencioso: ahí Kylia decide y
  // el padre ejecuta, así que hecho = recomendado y el contrafactual daría siempre 0.
  // No pinta nada en un panel que es puramente "agua real del agricultor vs Kylia".
  const usuarios = (await supabaseSelect("usuarios", "piloto_sombra=eq.true&select=*&order=ciudad.asc"))
    .filter(u => u.origen !== "lechugas-33-aspersion");
  const pilotos = await Promise.all((usuarios || []).map(async (u) => {
    try {
      const { informe } = await revealDeUsuario(u);
      const a = (informe.dimensiones || {}).agua || {};
      return {
        id: u.id, nombre: u.nombre || null, email: u.email || null,
        ciudad: u.ciudad || null, cultivo: (u.cultivos || [])[0] || null,
        metodo: u.metodo_riego || null, manejo: u.manejo || null,
        fecha_plantacion: u.fecha_plantacion || null, periodo: informe.periodo || null,
        // Para el registro admin del panel: L/m² = min/60 × caudal, y la pauta
        // del goteo automático (editable vía recurso pauta-goteo de /api/log).
        caudal: u.caudal ?? null,
        pauta: u.riego_auto
          ? { min: u.riego_auto_min ?? null, cada_dias: u.riego_auto_cada_dias ?? null,
              dias_semana: u.riego_auto_dias_semana ?? null, desde: u.riego_auto_desde ?? null }
          : null,
        // ⚠️ `publicable` VIAJA. El panel pintaba su propio veredicto con estas
        // cifras y no tenía forma de saber que el informe no se sostiene: con
        // publicable=false las cifras llegan a null, `exceso > 0.5` da falso y
        // caía al último caso — "su riego coincidió con la lámina FAO-56", que
        // es una CONCLUSIÓN sobre datos que no la sostienen. Y `clase_metrica` /
        // `ahorro_demostrado` van con ellas para que nadie que lea esta API
        // pueda confundir un contrafactual con un ahorro medido.
        agua: a.disponible
          ? { disponible: true, publicable: a.publicable !== false,
              motivo_no_publicable: a.motivo_no_publicable || null,
              clase_metrica: a.clase_metrica || null,
              ahorro_demostrado: a.ahorro_demostrado === true,
              aplicada_l_m2: a.aplicada_l_m2, recomendada_l_m2: a.recomendada_l_m2,
              exceso_l_m2: a.exceso_l_m2, ahorro_pct: a.ahorro_pct ?? null,
              ahorro_potencial_pct: a.ahorro_potencial_pct ?? a.ahorro_pct ?? null,
              dias_regado_real: a.dias_regado_real, veredicto: a.veredicto, serie: a.serie || [],
              nota_pendiente: a.nota_pendiente || null }
          : { disponible: false, publicable: false, motivo: a.motivo || null,
              clase_metrica: a.clase_metrica || null, ahorro_demostrado: false },
        avisos: informe.avisos || [],
      };
    } catch (e) {
      return { id: u.id, nombre: u.nombre || null, ciudad: u.ciudad || null, error: e.message };
    }
  }));
  return res.status(200).json({ ok: true, generado_en: new Date().toISOString(), n: pilotos.length, pilotos });
}

// ── Vista "comparativa": Kylia (FAO-56) vs lo real del padre, con BANDA de caudal ──
// Dos curvas de agua ACUMULADA por m² sobre el mismo clima y cultivo:
//   🟢 Kylia  → contrafactual FAO-56 (simularKylia): lo que habría aplicado.
//   🟤 Padre  → su riego real. Como apunta por DURACIÓN, el agua aplicada depende
//      del caudal del aspersor (aún no medido). En vez de fijar un caudal supuesto,
//      mostramos una BANDA: escenario bajo y alto. Recibe los inputs del aspersor
//      por query (?aspersores=&lh_bajo=&lh_alto=) y deriva el caudal:
//        caudal(mm/h) = aspersores × (L/h por aspersor) / área(m²)
//      Riegos apuntados con cantidad manual (sin duración) no se reescalan: cuentan
//      igual en ambos escenarios. Sin esos inputs → un solo caudal (u.caudal) y la
//      banda colapsa a una línea (compatibilidad). La verde NO depende del caudal.
// El cultivo/suelo/zona/fecha son los del campo cargado, así la referencia de Kylia
// es la que le tocaría a SU parcela. Orientativa por m² (no es un ensayo controlado).
async function vistaComparativa(req, res, u) {
  if (u.lat == null || u.lon == null) return res.status(200).json({ ok: false, error: "sin coordenadas" });

  const r1    = x => Math.round(x * 10) / 10;
  const numOr = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  // Se va en la respuesta, y llevaba sin existir desde el 1-ago: `264539e` quitó
  // esta línea al meter ultimoDiaDe() y dejó la referencia en el objeto de
  // abajo. Seis semanas respondiendo {"ok":false,"error":"hoy is not defined"}:
  // la pantalla "Kylia vs tu padre" estaba muerta y no se notó porque ningún
  // test EJECUTA la vista — los que hay leen el fuente.
  const hoy = hoyISO();

  const serie = await climaSerie(u.lat, u.lon, u.fecha_plantacion, { futuro: 7 });
  const [riegos, aplics] = await Promise.all([
    supabaseSelect("acciones",
      `usuario_id=eq.${u.id}&tipo=eq.riego&select=fecha_local,cantidad_l_m2,duracion_min,lamina_mm,lamina_origen,caudal_mmh&order=fecha_local.asc`),
    supabaseSelect("acciones",
      `usuario_id=eq.${u.id}&tipo=eq.aplicacion&select=fecha_local,producto_nombre&order=fecha_local.asc`),
  ]);

  // La comparación NO cuenta el riego de asentamiento del trasplante (riego de
  // establecimiento, no una decisión de manejo). Arranca el día SIGUIENTE a la
  // plantación, con el suelo a capacidad de campo (Dr=0: tras el asentamiento +
  // lluvia el suelo quedó lleno). Así ambas ramas parten de 0 y solo divergen
  // por las decisiones posteriores → el hueco = agua ahorrada siguiendo a Kylia.
  const plant  = u.fecha_plantacion ? dia(u.fecha_plantacion) : null;
  const inicio = plant
    ? new Date(new Date(`${plant}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10)
    : null;

  // Solo días pasados (sin pronóstico), desde el inicio de la comparación y
  // hasta la cosecha si ya se cosechó.
  const corte  = ultimoDiaDe(u);
  const idxFin = serie.findIndex(s => s.date === corte);
  const hasta  = serie.slice(0, (idxFin >= 0 ? idxFin : serie.length - 1) + 1);
  const dias   = inicio ? hasta.filter(d => d.date >= inicio) : hasta;

  // 🟢 Kylia: contrafactual sobre el campo del padre (Dr arranca en 0 = suelo lleno tras el asentamiento).
  // La serie térmica va aparte de `dias` porque la comparación arranca el día
  // DESPUÉS de plantar y el calor hay que contarlo desde el día 0 (ver el mismo
  // razonamiento en el reveal).
  const termica = await serieTermica(u.lat, u.lon, u.fecha_plantacion).catch(() => []);
  const kylia = simularKylia(dias, {
    suelo: u.suelo, cultivoId: (u.cultivos || [])[0] || null,
    metodoRiego: u.metodo_riego, fechaPlantacion: u.fecha_plantacion,
    serieTermica: termica,
    // La ventana que se esperaba cubrir, igual que en el reveal: sin ella los
    // huecos del PRINCIPIO son invisibles —la serie empieza más tarde y la
    // cobertura sale 1— y son justo los que rompieron los dos informes.
    // El periodo esperado es desde el arranque de la comparación (el día
    // siguiente a plantar), no desde el primer día con dato.
    ventana: { desde: inicio || String(u.fecha_plantacion || "").slice(0, 10) || dias[0]?.date || null,
               hasta: corte },
  });
  const acumKylia = {};
  kylia.puntos.forEach(p => { acumKylia[p.date] = p.acum_l_m2; });

  // 🟤 Banda de caudal del padre. Con los inputs del aspersor (y área) derivamos
  // bajo/alto; si no, un único caudal (u.caudal o 10) y la banda colapsa.
  const area        = u.area_m2 || null;
  const aspersores  = numOr(req.query?.aspersores);
  const lhBajo      = numOr(req.query?.lh_bajo);
  const lhAlto      = numOr(req.query?.lh_alto);
  const caudalMedido = numOr(req.query?.caudal);   // mm/h medido con el truco del vaso → línea única
  const caudalUnico  = caudalMedido || numOr(u.caudal) || 10;
  let caudalBajo, caudalAlto;
  if (caudalMedido) {
    caudalBajo = caudalAlto = caudalMedido;
  } else if (aspersores && lhBajo && lhAlto && area) {
    caudalBajo = (aspersores * lhBajo) / area;
    caudalAlto = (aspersores * lhAlto) / area;
  } else {
    caudalBajo = caudalAlto = caudalUnico;
  }

  // L/m² de un riego bajo un caudal dado (misma regla que el resto: la duración
  // manda). Sin duración (cantidad apuntada a mano) → el valor guardado, que es
  // idéntico en ambos escenarios de la banda.
  // Aquí el caudal es un ESCENARIO (la banda bajo/alto), así que recalcular es
  // el propósito. Pero si el riego trae su lámina congelada, esa es el dato y la
  // banda no se la inventa: se devuelve tal cual en los dos escenarios.
  const lm2DeRiego = (r, caudal) =>
    (r.lamina_mm != null && r.lamina_origen !== "backfill_caudal_actual")
      ? Number(r.lamina_mm)
      : laminaRiego(r.cantidad_l_m2, r.duracion_min ?? null, caudal);

  const bajoPorDia = {}, altoPorDia = {};
  let nRiegosPadre = 0, sinCantidad = 0;
  (riegos || []).forEach(r => {
    const f = dia(r.fecha_local);
    if (!f || (inicio && f < inicio)) return;
    nRiegosPadre++;
    const bajo = lm2DeRiego(r, caudalBajo);
    // UN RIEGO SIN CANTIDAD NO SON CERO LITROS. Aquí había un `?? 0`, así que un
    // riego apuntado sin cifra ni duración entraba como "no echó nada" y el
    // padre salía gastando menos de lo que gastó — o sea, inflando el ahorro que
    // se le enseña. Es el mismo defecto que se corrigió en el reveal, en su
    // tercera copia. Se cuentan aparte y se declaran.
    if (bajo == null) { sinCantidad++; return; }
    bajoPorDia[f] = (bajoPorDia[f] || 0) + bajo;
    altoPorDia[f] = (altoPorDia[f] || 0) + (lm2DeRiego(r, caudalAlto) ?? 0);
  });

  let accBajo = 0, accAlto = 0;
  const puntos = dias.map(d => {
    accBajo += bajoPorDia[d.date] || 0;
    accAlto += altoPorDia[d.date] || 0;
    return { date: d.date,
             kylia_l_m2:      acumKylia[d.date] ?? 0,
             padre_bajo_l_m2: r1(accBajo),
             padre_alto_l_m2: r1(accAlto) };
  });

  const ultimo    = puntos[puntos.length - 1] || { kylia_l_m2: 0, padre_bajo_l_m2: 0, padre_alto_l_m2: 0 };
  const ahorroPct = padre => padre > 0 ? Math.round(((padre - ultimo.kylia_l_m2) / padre) * 100) : null;
  const litros    = lm2 => area ? Math.round(lm2 * area) : null;
  const totales = {
    kylia_l_m2:      r1(ultimo.kylia_l_m2),
    padre_bajo_l_m2: r1(ultimo.padre_bajo_l_m2),
    padre_alto_l_m2: r1(ultimo.padre_alto_l_m2),
    // dif/ahorro siguiendo a Kylia, sobre lo que usa el padre (la base que se reduce).
    dif_bajo_l_m2:   r1(ultimo.padre_bajo_l_m2 - ultimo.kylia_l_m2),
    dif_alto_l_m2:   r1(ultimo.padre_alto_l_m2 - ultimo.kylia_l_m2),
    ahorro_pct_bajo: ahorroPct(ultimo.padre_bajo_l_m2),
    ahorro_pct_alto: ahorroPct(ultimo.padre_alto_l_m2),
    kylia_litros:      litros(ultimo.kylia_l_m2),
    padre_bajo_litros: litros(ultimo.padre_bajo_l_m2),
    padre_alto_litros: litros(ultimo.padre_alto_l_m2),
    // Para el caso "Kylia aún no regaría" / datos escasos: el % de ahorro no es
    // significativo si la lámina de Kylia es 0 o hay muy pocos días.
    riegos_padre: nRiegosPadre,
    // De esos, cuántos no se pueden cuantificar. Sin esto, los que se apuntaron
    // sin cifra desaparecían del total como si no se hubiera regado.
    riegos_sin_cantidad: sinCantidad || null,
    dias: dias.length,
    // ESTA PANTALLA TAMBIÉN PUBLICA UN PORCENTAJE, y era la única de las dos que
    // no miraba con cuánto clima se había calculado. Es la del campo de 440 m²,
    // de donde salió el "ahorro del 25%". Mismo umbral y mismo helper que el
    // reveal: si el contrafactual no se sostiene, el ahorro no se pinta.
    cobertura_clima:  kylia.coberturaClima ?? null,
    dias_sin_clima:   kylia.diasSinClima ?? null,
    publicable:       motivoClimaNoPublicable(kylia) === null,
    motivo_no_publicable: motivoClimaNoPublicable(kylia),
  };

  // Fertilizantes/tratamientos: solo cualitativo (producto + nº de veces).
  const ferts = {};
  (aplics || []).forEach(a => {
    const p = (a.producto_nombre || "sin nombre").trim();
    ferts[p] = (ferts[p] || 0) + 1;
  });
  const fertilizantes = Object.entries(ferts).map(([producto, veces]) => ({ producto, veces }));

  return res.status(200).json({
    ok: true, vista: "comparativa",
    campo: { ciudad: u.ciudad, cultivo: (u.cultivos || [])[0] || null,
             area_m2: area, metodo: u.metodo_riego, caudal_mmh: r1(caudalBajo) },
    escenarios: { banda: caudalBajo !== caudalAlto, aspersores, lh_bajo: lhBajo, lh_alto: lhAlto,
                  caudal_bajo_mmh: r1(caudalBajo), caudal_alto_mmh: r1(caudalAlto) },
    desde: dias[0]?.date || inicio || null, hoy, excluye_asentamiento: true,
    serie: puntos, totales, fertilizantes,
  });
}

module.exports = async (req, res) => {
  if (!preludio(req, res, "GET")) return;

  const vista = (req.query?.vista || "hoy").toString();

  // "pilotos" no lleva usuario_id (lista todos): se enruta antes del check de UUID.
  if (vista === "pilotos") {
    try { return await vistaPilotos(req, res); }
    catch (err) { console.error("[campo] pilotos:", err.message); return res.status(500).json({ ok: false, error: err.message }); }
  }

  // "textura" tampoco lleva usuario: traduce un punto a la clase de suelo que el
  // balance necesita (arenoso|franco|arcilloso). Es para el ALTA, donde todavía
  // no hay usuario y el suelo estaba cableado a "franco" sin ningún dato — y esa
  // suposición cambia el umbral casi a la mitad (7,4 mm en arenoso contra 13,8
  // en franco para una lechuga), o sea que mueve el riego entre uno y tres días.
  // No se le pregunta al agricultor: se deduce de sus coordenadas, que ya ha
  // dado, con la MISMA consulta a SoilGrids que ya alimenta el abonado.
  if (vista === "textura") {
    const lat = Number(req.query?.lat), lon = Number(req.query?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
        Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return res.status(400).json({ ok: false, error: "lat/lon inválidos" });
    }
    try {
      const o = await ofertaSuelo(lat, lon, null);
      const t = o?.observado?.textura || null;
      // Sin dato NO se devuelve "franco" disfrazado: se dice que no se sabe y el
      // cliente decide (hoy: se queda con el defecto y lo dice).
      return res.status(200).json({
        ok: true, textura: t,
        arcilla_pct: o?.observado?.arcilla_pct ?? null,
        arena_pct: o?.observado?.arena_pct ?? null,
        // Si la parcela está en el filo entre dos clases, la textura deducida no
        // aguanta el error del mapa (250 m) y conviene confirmarla. Con margen
        // de sobra no se le pregunta nada a nadie: el alta sigue igual de corta.
        fragil: o?.observado?.fragilidad?.fragil ?? null,
        margen_pp: o?.observado?.fragilidad?.margen_pp ?? null,
        fuente: t ? "SoilGrids v2.0 (ISRIC), 250 m" : null,
        motivo: t ? null : (o?.motivo || "sin_dato"),
      });
    } catch (err) {
      console.warn("[campo] textura:", err.message);
      return res.status(200).json({ ok: false, textura: null, motivo: "error" });
    }
  }

  const usuarioId = (req.query?.usuario_id || "").toString().trim();
  if (!ES_UUID.test(usuarioId)) return res.status(400).json({ error: "usuario_id inválido (UUID)" });
  if (!isConfigured()) return res.status(200).json({ ok: false, reason: "supabase_not_configured" });

  try {
    // select=* a propósito: tras un ALTER reciente, el caché de esquema de
    // PostgREST puede no conocer aún las columnas nuevas y un select explícito
    // falla. Con * traemos lo que haya; el motor cae a defaults si algo falta.
    const usuarios = await supabaseSelect("usuarios", `id=eq.${usuarioId}&select=*`);
    const u = (usuarios || [])[0];
    if (!u) return res.status(404).json({ ok: false, error: "usuario no encontrado (¿ejecutaste el alta?)" });

    // Quien trae sesión solo puede mirar lo suyo. Sin sesión se deja pasar,
    // porque hoy nadie la tiene todavía y el cron de avisos llama por HTTP sin
    // cookie; queda contado en el log para poder cerrar esto con datos. El
    // porqué entero y el plan de cierre están en _sesion.js.
    const permiso = puedeVer(req, u);
    if (!permiso.permitido) {
      console.warn("[campo] sesión ajena:", JSON.stringify({ pedido: usuarioId, sesion: permiso.sesion }));
      return res.status(403).json({ ok: false, error: "esa parcela no es tuya" });
    }
    if (permiso.motivo === "sin_sesion") console.log("[campo] acceso sin sesión:", vista);

    if (vista === "verificar")   return vistaVerificar(res, u);
    if (vista === "config")      return await vistaConfig(res, u);
    if (vista === "reveal")      return await vistaReveal(req, res, u);
    if (vista === "comparativa") return await vistaComparativa(req, res, u);
    if (vista === "perfil")      return await vistaPerfil(res, u, { limite: req.query?.limite });
    if (vista === "cuaderno")    return await vistaCuaderno(req, res, u);
    if (vista === "madurez")     return await vistaMadurez(res, u);
    return await vistaHoy(res, u);
  } catch (err) {
    console.error("[campo] error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

// Reutilizado por api/informe-cientifico.js: reconstruye el reveal en servidor
// a partir del usuario, sin confiar en números que vengan del cliente.
module.exports.revealDeUsuario = revealDeUsuario;

// Expuestas para los tests: la frontera entre "no hay dato" y "cero" es
// justo lo que rompió dos informes publicados, y tiene que quedar fijada.
module.exports.diasConDato = diasConDato;
module.exports.climaSerie  = climaSerie;
module.exports.procedencia = procedencia;
