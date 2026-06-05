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

const { isConfigured, supabaseSelect, preludio } = require("./_supabase.js");
const { balanceHidrico, decisionRiego, presentarRiego } = require("./_motor-riego.js");
const { construirReveal } = require("./_reveal.js");

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const ES_UUID = /^[0-9a-f-]{36}$/i;

function hoyISO() { return new Date().toISOString().slice(0, 10); }
function dia(f) { return f ? String(f).slice(0, 10) : null; }
function diasDesde(fechaIso) {
  if (!fechaIso) return null;
  return Math.floor((Date.now() - new Date(`${fechaIso}T12:00:00Z`)) / 86400000);
}

async function climaSerie(lat, lon, desde) {
  const past = desde ? Math.min(92, Math.max(1, diasDesde(desde) + 1)) : 30;
  const url = `${OPEN_METEO}?latitude=${lat}&longitude=${lon}`
    + `&daily=et0_fao_evapotranspiration,precipitation_sum`
    + `&past_days=${past}&forecast_days=7&timezone=Europe%2FMadrid`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const d = (await res.json()).daily || {};
  return (d.time || []).map((date, i) => ({
    date, et0: d.et0_fao_evapotranspiration?.[i] ?? 0, lluvia: d.precipitation_sum?.[i] ?? 0,
  }));
}

// ── Vista "hoy": recomendación de riego del día en cubos ─────────
async function vistaHoy(res, u) {
  if (u.lat == null || u.lon == null) return res.status(200).json({ ok: false, error: "sin coordenadas" });

  const hoy    = hoyISO();
  const serie  = await climaSerie(u.lat, u.lon, u.fecha_plantacion);
  const accs   = await supabaseSelect("acciones",
    `usuario_id=eq.${u.id}&tipo=eq.riego&select=fecha_local,cantidad_l_m2&order=fecha_local.asc`);
  const riegos = (accs || []).filter(f => f.fecha_local)
    .map(f => ({ date: f.fecha_local, litros: f.cantidad_l_m2 ?? null }));

  const opts = { suelo: u.suelo, cultivoId: (u.cultivos || [])[0] || null,
                 metodoRiego: u.metodo_riego, fechaPlantacion: u.fecha_plantacion };
  const presOpts = { metodoRiego: u.metodo_riego, areaM2: u.area_m2, capacidadRegaderaL: u.capacidad_regadera };

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

  const recientes = riegos.slice(-5).reverse().map(r => ({
    fecha: r.date, l_m2: r.litros,
    cubos: (u.capacidad_regadera && u.area_m2 && r.litros != null)
      ? Math.round((r.litros * u.area_m2 / u.capacidad_regadera) * 10) / 10 : null,
  }));

  return res.status(200).json({
    ok: true, vista: "hoy",
    usuario: { ciudad: u.ciudad, cultivo: (u.cultivos || [])[0] || null,
               area_m2: u.area_m2, capacidad_regadera: u.capacidad_regadera },
    hoy: {
      fecha: hoy, nivel: decHoy.nivel, regar: decHoy.nivel === "alta",
      texto: decHoy.texto, presentacion: presHoy,
      deficit_mm: Number(balHoy.Dr.toFixed(1)), umbral_mm: Number(balHoy.raw.toFixed(1)),
      et0: Number((climaHoy.et0 ?? 0).toFixed(1)), lluvia: Number((climaHoy.lluvia ?? 0).toFixed(1)),
    },
    proximo, riegos_recientes: recientes,
  });
}

// ── Vista "reveal": informe final del piloto ─────────────────────
async function vistaReveal(req, res, u) {
  const [recs, acciones, jornadas] = await Promise.all([
    supabaseSelect("recomendaciones_log",
      `usuario_id=eq.${u.id}&select=fecha,tipo,cantidad_l_m2,nivel&order=fecha.asc`),
    supabaseSelect("acciones",
      `usuario_id=eq.${u.id}&select=fecha_local,tipo,cantidad_l_m2,producto_nombre&order=fecha_local.asc`),
    supabaseSelect("jornadas", `usuario_id=eq.${u.id}&select=fuente_decision`),
  ]);

  const riegosKylia = (recs || []).filter(r => r.tipo === "riego")
    .map(r => ({ dia: dia(r.fecha), l_m2: r.cantidad_l_m2, nivel: r.nivel }));
  const tratKylia = (recs || []).filter(r => r.tipo === "tratamiento" || r.tipo === "nutricion")
    .map(r => ({ dia: dia(r.fecha) }));
  const riegosReales = (acciones || []).filter(a => a.tipo === "riego")
    .map(a => ({ dia: dia(a.fecha_local), l_m2: a.cantidad_l_m2 }));
  const tratReales = (acciones || []).filter(a => a.tipo === "tratamiento" || a.tipo === "aplicacion")
    .map(a => ({ dia: dia(a.fecha_local), producto: a.producto_nombre }));

  const informe = construirReveal({
    usuario: u, riegosReales, riegosKylia, tratReales, tratKylia, jornadas: jornadas || [],
  });

  const payload = { ok: true, vista: "reveal", informe };
  if (String(req.query?.dump || "") === "1") {
    payload.crudo = { riegosKylia, tratKylia, riegosReales, tratReales, jornadas };
  }
  return res.status(200).json(payload);
}

module.exports = async (req, res) => {
  if (!preludio(req, res, "GET")) return;

  const usuarioId = (req.query?.usuario_id || "").toString().trim();
  if (!ES_UUID.test(usuarioId)) return res.status(400).json({ error: "usuario_id inválido (UUID)" });
  if (!isConfigured()) return res.status(200).json({ ok: false, reason: "supabase_not_configured" });

  const vista = (req.query?.vista || "hoy").toString();

  try {
    const usuarios = await supabaseSelect("usuarios",
      `id=eq.${usuarioId}&select=id,ciudad,cultivos,lat,lon,suelo,metodo_riego,`
      + `fecha_plantacion,area_m2,capacidad_regadera,tarifa_agua`);
    const u = (usuarios || [])[0];
    if (!u) return res.status(404).json({ ok: false, error: "usuario no encontrado (¿ejecutaste el alta?)" });

    if (vista === "reveal") return await vistaReveal(req, res, u);
    return await vistaHoy(res, u);
  } catch (err) {
    console.error("[campo] error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
