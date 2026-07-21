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
const { balanceHidrico, decisionRiego, presentarRiego, simularKylia, faseDelDia } = require("./_motor-riego.js");
const { construirReveal } = require("./_reveal.js");
const { necesidadNutrientes } = require("./_motor-nutricion.js");
const { cuadernoFertilizacion } = require("./_motor-cuaderno-fert.js");
const { ofertaSuelo } = require("./_suelo-oferta.js");

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const ES_UUID = /^[0-9a-f-]{36}$/i;

function hoyISO() { return new Date().toISOString().slice(0, 10); }
function dia(f) { return f ? String(f).slice(0, 10) : null; }
function diasDesde(fechaIso) {
  if (!fechaIso) return null;
  return Math.floor((Date.now() - new Date(`${fechaIso}T12:00:00Z`)) / 86400000);
}

// Lámina (L/m²) a MOSTRAR de un riego registrado. La duración es la fuente de
// verdad: cuando el riego se apuntó por tiempo (aspersión/goteo) y conocemos el
// caudal, la lámina = duración(min) × caudal(mm/h) / 60. Así la lista sigue al
// caudal ACTUAL y no se queda desfasada si se afina con el truco del vaso
// (mismo criterio que la comparativa, lm2DeRiego). Sin duración o sin caudal
// (p. ej. regadera por cubos) → se usa la lámina guardada tal cual.
function laminaMostrada(cantidadGuardada, duracionMin, caudal) {
  if (duracionMin != null && caudal) return Math.round((caudal * duracionMin / 60) * 10) / 10;
  return cantidadGuardada ?? null;
}

// Caché en memoria de series de clima (TTL 30 min). El panel /pilotos y el
// informe científico piden la MISMA serie por piloto en cada carga; sin caché
// cada refresco son N llamadas a open-meteo y al crecer los pilotos acabaría
// en rate-limit. Clave por coordenadas redondeadas + ventana pedida.
const cacheClima = new Map();
const CLIMA_TTL_MS = 30 * 60 * 1000;

async function climaSerie(lat, lon, desde) {
  const past = desde ? Math.min(92, Math.max(1, diasDesde(desde) + 1)) : 30;
  const clave = `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)},${past}`;
  const hit = cacheClima.get(clave);
  if (hit && Date.now() - hit.t < CLIMA_TTL_MS) return hit.serie;

  const url = `${OPEN_METEO}?latitude=${lat}&longitude=${lon}`
    + `&daily=et0_fao_evapotranspiration,precipitation_sum`
    + `&past_days=${past}&forecast_days=7&timezone=Europe%2FMadrid`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const d = (await res.json()).daily || {};
  const serie = (d.time || []).map((date, i) => ({
    date, et0: d.et0_fao_evapotranspiration?.[i] ?? 0, lluvia: d.precipitation_sum?.[i] ?? 0,
  }));
  cacheClima.set(clave, { t: Date.now(), serie });
  return serie;
}

// ── Vista "hoy": recomendación de riego del día en cubos ─────────
async function vistaHoy(res, u) {
  if (u.lat == null || u.lon == null) return res.status(200).json({ ok: false, error: "sin coordenadas" });

  const hoy    = hoyISO();
  const serie  = await climaSerie(u.lat, u.lon, u.fecha_plantacion);
  const accs   = await supabaseSelect("acciones",
    `usuario_id=eq.${u.id}&tipo=eq.riego&select=id,fecha_local,cantidad_l_m2,duracion_min&order=fecha_local.asc`);
  const riegos = (accs || []).filter(f => f.fecha_local)
    .map(f => ({ id: f.id, date: f.fecha_local, litros: f.cantidad_l_m2 ?? null, duracion_min: f.duracion_min ?? null }));

  const opts = { suelo: u.suelo, cultivoId: (u.cultivos || [])[0] || null,
                 metodoRiego: u.metodo_riego, fechaPlantacion: u.fecha_plantacion };
  const presOpts = { metodoRiego: u.metodo_riego, caudalMmh: u.caudal,
                     areaM2: u.area_m2, capacidadRegaderaL: u.capacidad_regadera };

  const idxHoy = serie.findIndex(s => s.date === hoy);
  const corte  = idxHoy >= 0 ? idxHoy : serie.length - 1;

  const balHoy  = balanceHidrico(serie.slice(0, corte + 1), riegos, opts);
  const decHoy  = decisionRiego(balHoy);
  const presHoy = decHoy.nivel === "alta" ? presentarRiego(decHoy.cantidad_l_m2, presOpts) : null;
  const climaHoy = serie[corte] || {};

  let proximo = null;
  for (let i = corte + 1; i < serie.length; i++) {
    const b = balanceHidrico(serie.slice(0, i + 1), riegos, opts);
    if (decisionRiego(b).nivel === "alta") {
      proximo = { fecha: serie[i].date,
                  presentacion: presentarRiego(decisionRiego(b).cantidad_l_m2, presOpts),
                  Dr: Number(b.Dr.toFixed(1)) };
      break;
    }
  }

  const recientes = riegos.slice(-5).reverse().map(r => {
    const l_m2 = laminaMostrada(r.litros, r.duracion_min, u.caudal);
    return {
      id: r.id, fecha: r.date, l_m2, duracion_min: r.duracion_min,
      cubos: (u.capacidad_regadera && u.area_m2 && l_m2 != null)
        ? Math.round((l_m2 * u.area_m2 / u.capacidad_regadera) * 10) / 10 : null,
    };
  });

  // Desglose del "porqué de hoy": de dónde sale la decisión (para la tarjeta explicativa).
  const cultivoId = (u.cultivos || [])[0] || null;
  const et0Hoy = Number(climaHoy.et0 ?? 0);
  const desglose = {
    suelo: u.suelo || "franco", cultivo: cultivoId,
    dias_planta: diasDesde(u.fecha_plantacion),
    fase: faseDelDia(cultivoId, diasDesde(u.fecha_plantacion)),
    kc:  Number(balHoy.kcActual.toFixed(2)),
    et0: Number(et0Hoy.toFixed(1)),
    etc: Number((balHoy.kcActual * et0Hoy).toFixed(1)),    // gasto de la planta hoy
    lluvia: Number((climaHoy.lluvia ?? 0).toFixed(1)),
    dr:  Number(balHoy.Dr.toFixed(1)),                      // déficit acumulado
    taw: Number(balHoy.taw.toFixed(1)),                     // agua que cabe en el suelo
    raw: Number(balHoy.raw.toFixed(1)),                     // umbral para regar (45% de TAW)
    raw_vigilar: Number((0.75 * balHoy.raw).toFixed(1)),
    efic: balHoy.efic, metodo: u.metodo_riego,
  };

  return res.status(200).json({
    ok: true, vista: "hoy",
    usuario: { ciudad: u.ciudad, cultivo: cultivoId,
               area_m2: u.area_m2, capacidad_regadera: u.capacidad_regadera,
               metodo_riego: u.metodo_riego, caudal: u.caudal },
    hoy: {
      fecha: hoy, nivel: decHoy.nivel, regar: decHoy.nivel === "alta",
      texto: decHoy.texto, presentacion: presHoy,
      deficit_mm: Number(balHoy.Dr.toFixed(1)), umbral_mm: Number(balHoy.raw.toFixed(1)),
      et0: Number((climaHoy.et0 ?? 0).toFixed(1)), lluvia: Number((climaHoy.lluvia ?? 0).toFixed(1)),
    },
    desglose, proximo, riegos_recientes: recientes,
  });
}

// ── Vista "perfil": config del piloto para su cuaderno (SIN recomendación) ──
// La consume /piloto/diario, la superficie de registro del piloto silencioso.
// A propósito NO calcula ni devuelve la decisión de riego: el piloto silencioso
// no debe ver lo que Kylia recomienda (sesgaría el experimento). Solo la config
// para adaptar el registro (cubos vs horas) y lo que ya lleva apuntado.
async function vistaPerfil(res, u) {
  const [accs, aplics] = await Promise.all([
    supabaseSelect("acciones",
      `usuario_id=eq.${u.id}&tipo=eq.riego&select=id,fecha_local,cantidad_l_m2,duracion_min&order=fecha_local.desc&limit=8`),
    supabaseSelect("acciones",
      `usuario_id=eq.${u.id}&tipo=eq.aplicacion&select=id,fecha_local,producto_nombre,dosis,motivo&order=fecha_local.desc&limit=8`),
  ]);
  const recientes = (accs || []).filter(f => f.fecha_local).map(f => {
    const l_m2 = laminaMostrada(f.cantidad_l_m2, f.duracion_min ?? null, u.caudal);
    return {
      id: f.id, fecha: f.fecha_local, l_m2, duracion_min: f.duracion_min ?? null,
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

// ── Vista "cuaderno": cuaderno de fertilización (pilar fertilizantes) ──
// Dos mitades honestas:
//   1. Lo REGISTRADO: abonados apuntados en el diario (tipo=aplicacion,
//      motivo=abonado) — la base del cuaderno RD 1051/2022.
//   2. El PLAN (opcional): necesidad de nutrientes + coste €, SOLO si llega el
//      rendimiento esperado (?rend_t= toneladas). Sin rendimiento no se estima:
//      el motor devuelve disponible:false con su motivo, y así se muestra.
async function vistaCuaderno(req, res, u) {
  // motivo=neq.abonado a secas dejaría fuera los motivo NULL (SQL de 3 valores):
  // los tratamientos sin motivo también son tratamientos.
  const [abonados, riegos, trats] = await Promise.all([
    supabaseSelect("acciones",
      `usuario_id=eq.${u.id}&tipo=eq.aplicacion&motivo=eq.abonado` +
      `&select=id,fecha_local,producto_nombre,dosis,coste_estimado_eur,notas&order=fecha_local.asc`),
    supabaseSelect("acciones",
      `usuario_id=eq.${u.id}&tipo=eq.riego` +
      `&select=fecha_local,cantidad_l_m2,duracion_min,franja_horaria&order=fecha_local.asc`),
    supabaseSelect("acciones",
      `usuario_id=eq.${u.id}&tipo=in.(aplicacion,tratamiento)&or=(motivo.neq.abonado,motivo.is.null)` +
      `&select=id,fecha_local,producto_nombre,sustancia_activa,dosis,plazo_seguridad_dias,motivo,notas&order=fecha_local.asc`),
  ]);

  const cultivo = (u.cultivos || [])[0] || null;
  const rendT   = Number(req.query?.rend_t) || null;

  // Oferta del suelo (SoilGrids): descuenta lo que ya aporta el suelo del plan.
  const oferta = await obtenerOfertaSuelo(u);
  const ofertaMotor = oferta && oferta.disponible
    ? { N: oferta.N, P2O5: oferta.P2O5, K2O: oferta.K2O }
    : null;

  const plan = cuadernoFertilizacion(
    // area_m2 activa los términos de N de MAPA (colchón final + crédito de residuos).
    // El crédito de residuos entrará cuando el onboarding capture el cultivo anterior.
    necesidadNutrientes(cultivo, rendT, ofertaMotor, { area_m2: u.area_m2 ?? null }),
    { superficie_m2: u.area_m2 ?? null },
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
    riegos: (riegos || []).filter(r => r.fecha_local).map(r => ({
      fecha: r.fecha_local, duracion_min: r.duracion_min ?? null,
      l_m2: laminaMostrada(r.cantidad_l_m2, r.duracion_min ?? null, u.caudal),
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
  const fRec    = desde ? `&fecha=gte.${desde}T00:00:00Z` : "";
  const fAcc    = desde ? `&fecha_local=gte.${desde}` : "";

  const [recs, acciones, jornadas] = await Promise.all([
    supabaseSelect("recomendaciones_log",
      `usuario_id=eq.${u.id}${fRec}&select=fecha,tipo,cantidad_l_m2,nivel&order=fecha.asc`),
    supabaseSelect("acciones",
      `usuario_id=eq.${u.id}${fAcc}&select=fecha_local,tipo,cantidad_l_m2,duracion_min,producto_nombre,motivo&order=fecha_local.asc`),
    supabaseSelect("jornadas", `usuario_id=eq.${u.id}&select=fuente_decision`),
  ]);

  const riegosKylia = (recs || []).filter(r => r.tipo === "riego")
    .map(r => ({ dia: dia(r.fecha), l_m2: r.cantidad_l_m2, nivel: r.nivel }));
  const tratKylia = (recs || []).filter(r => r.tipo === "tratamiento" || r.tipo === "nutricion")
    .map(r => ({ dia: dia(r.fecha) }));
  const riegosReales = (acciones || []).filter(a => a.tipo === "riego")
    .map(a => ({ dia: dia(a.fecha_local), l_m2: laminaMostrada(a.cantidad_l_m2, a.duracion_min ?? null, u.caudal) }));
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
      const serie  = await climaSerie(u.lat, u.lon, u.fecha_plantacion);
      const idxHoy = serie.findIndex(s => s.date === hoyISO());
      const hasta  = serie.slice(0, (idxHoy >= 0 ? idxHoy : serie.length - 1) + 1);
      const dias   = desde ? hasta.filter(d => d.date >= desde) : hasta;
      if (dias.length) {
        const sim = simularKylia(dias, {
          suelo: u.suelo, cultivoId: (u.cultivos || [])[0] || null,
          metodoRiego: u.metodo_riego, fechaPlantacion: u.fecha_plantacion,
        });
        contrafactual = { puntos: sim.puntos, total: sim.total, deficitFinal: sim.deficitFinal };
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
          ? { min: u.riego_auto_min ?? null, cada_dias: u.riego_auto_cada_dias ?? null, desde: u.riego_auto_desde ?? null }
          : null,
        agua: a.disponible
          ? { disponible: true, aplicada_l_m2: a.aplicada_l_m2, recomendada_l_m2: a.recomendada_l_m2,
              exceso_l_m2: a.exceso_l_m2, ahorro_pct: a.ahorro_pct ?? null,
              dias_regado_real: a.dias_regado_real, veredicto: a.veredicto, serie: a.serie || [],
              nota_pendiente: a.nota_pendiente || null }
          : { disponible: false, motivo: a.motivo || null },
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

  const hoy   = hoyISO();
  const serie = await climaSerie(u.lat, u.lon, u.fecha_plantacion);
  const [riegos, aplics] = await Promise.all([
    supabaseSelect("acciones",
      `usuario_id=eq.${u.id}&tipo=eq.riego&select=fecha_local,cantidad_l_m2,duracion_min&order=fecha_local.asc`),
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

  // Solo días pasados/hoy (sin pronóstico) y desde el inicio de la comparación.
  const idxHoy = serie.findIndex(s => s.date === hoy);
  const hasta  = serie.slice(0, (idxHoy >= 0 ? idxHoy : serie.length - 1) + 1);
  const dias   = inicio ? hasta.filter(d => d.date >= inicio) : hasta;

  // 🟢 Kylia: contrafactual sobre el campo del padre (Dr arranca en 0 = suelo lleno tras el asentamiento).
  const kylia = simularKylia(dias, {
    suelo: u.suelo, cultivoId: (u.cultivos || [])[0] || null,
    metodoRiego: u.metodo_riego, fechaPlantacion: u.fecha_plantacion,
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

  // L/m² de un riego bajo un caudal dado: duración × mm/h / 60. Sin duración
  // (cantidad apuntada a mano) → el valor guardado, idéntico en ambos escenarios.
  const lm2DeRiego = (r, caudal) =>
    r.duracion_min != null ? (caudal * r.duracion_min) / 60 : (r.cantidad_l_m2 ?? 0);

  const bajoPorDia = {}, altoPorDia = {};
  let nRiegosPadre = 0;
  (riegos || []).forEach(r => {
    const f = dia(r.fecha_local);
    if (!f || (inicio && f < inicio)) return;
    nRiegosPadre++;
    bajoPorDia[f] = (bajoPorDia[f] || 0) + lm2DeRiego(r, caudalBajo);
    altoPorDia[f] = (altoPorDia[f] || 0) + lm2DeRiego(r, caudalAlto);
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
    dias: dias.length,
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

    if (vista === "reveal")      return await vistaReveal(req, res, u);
    if (vista === "comparativa") return await vistaComparativa(req, res, u);
    if (vista === "perfil")      return await vistaPerfil(res, u);
    if (vista === "cuaderno")    return await vistaCuaderno(req, res, u);
    return await vistaHoy(res, u);
  } catch (err) {
    console.error("[campo] error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

// Reutilizado por api/informe-cientifico.js: reconstruye el reveal en servidor
// a partir del usuario, sin confiar en números que vengan del cliente.
module.exports.revealDeUsuario = revealDeUsuario;
