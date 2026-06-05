// ─────────────────────────────────────────────────────────────────
// /api/riego-hoy — recomendación de riego de HOY, legible y en cubos
// ─────────────────────────────────────────────────────────────────
// Para visualizar el campo del padre (laboratorio abierto) desde /campo:
// baja el clima en vivo (Open-Meteo), reconstruye el balance FAO-56 con los
// riegos reales registrados y devuelve la decisión de hoy ya convertida a la
// unidad del agricultor (nº de cubos), más el pronóstico del próximo riego y
// los riegos recientes. Mismo motor que la app y el Diario B (_motor-riego.js).
//
// Uso:  GET /api/riego-hoy?usuario_id=<uuid>
//       (la página /campo trae por defecto el id del campo del padre)
//
// Solo lectura: no escribe nada. El congelado para el reveal lo hace diario-b.js.

const { isConfigured, supabaseSelect, preludio } = require("./_supabase.js");
const { balanceHidrico, decisionRiego, presentarRiego } = require("./_motor-riego.js");

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const ES_UUID = /^[0-9a-f-]{36}$/i;

function hoyISO() { return new Date().toISOString().slice(0, 10); }

function diasDesde(fechaIso) {
  if (!fechaIso) return null;
  return Math.floor((Date.now() - new Date(`${fechaIso}T12:00:00Z`)) / 86400000);
}

// Clima diario (ET₀ FAO + lluvia) desde la plantación hasta +7 días de previsión.
async function climaSerie(lat, lon, desde) {
  const past = desde ? Math.min(92, Math.max(1, diasDesde(desde) + 1)) : 30;
  const url = `${OPEN_METEO}?latitude=${lat}&longitude=${lon}`
    + `&daily=et0_fao_evapotranspiration,precipitation_sum`
    + `&past_days=${past}&forecast_days=7&timezone=Europe%2FMadrid`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const d = (await res.json()).daily || {};
  return (d.time || []).map((date, i) => ({
    date,
    et0:    d.et0_fao_evapotranspiration?.[i] ?? 0,
    lluvia: d.precipitation_sum?.[i] ?? 0,
  }));
}

async function riegosDe(usuarioId) {
  const filas = await supabaseSelect(
    "acciones",
    `usuario_id=eq.${usuarioId}&tipo=eq.riego&select=fecha_local,cantidad_l_m2&order=fecha_local.asc`
  );
  return (filas || [])
    .filter(f => f.fecha_local)
    .map(f => ({ date: f.fecha_local, litros: f.cantidad_l_m2 ?? null }));
}

module.exports = async (req, res) => {
  if (!preludio(req, res, "GET")) return;

  const usuarioId = (req.query?.usuario_id || "").toString().trim();
  if (!ES_UUID.test(usuarioId)) return res.status(400).json({ error: "usuario_id inválido (UUID)" });
  if (!isConfigured()) return res.status(200).json({ ok: false, reason: "supabase_not_configured" });

  try {
    const usuarios = await supabaseSelect("usuarios",
      `id=eq.${usuarioId}&select=id,ciudad,cultivos,lat,lon,suelo,metodo_riego,fecha_plantacion,area_m2,capacidad_regadera`);
    const u = (usuarios || [])[0];
    if (!u) return res.status(404).json({ ok: false, error: "usuario no encontrado (¿ejecutaste el alta?)" });
    if (u.lat == null || u.lon == null) return res.status(200).json({ ok: false, error: "sin coordenadas" });

    const hoy    = hoyISO();
    const serie  = await climaSerie(u.lat, u.lon, u.fecha_plantacion);
    const riegos = await riegosDe(u.id);
    const opts = {
      suelo: u.suelo, cultivoId: (u.cultivos || [])[0] || null,
      metodoRiego: u.metodo_riego, fechaPlantacion: u.fecha_plantacion,
    };
    const presOpts = { metodoRiego: u.metodo_riego, areaM2: u.area_m2, capacidadRegaderaL: u.capacidad_regadera };

    const idxHoy = serie.findIndex(s => s.date === hoy);
    const corte  = idxHoy >= 0 ? idxHoy : serie.length - 1;

    // Balance hasta hoy → decisión del día.
    const balHoy = balanceHidrico(serie.slice(0, corte + 1), riegos, opts);
    const decHoy = decisionRiego(balHoy);
    const presHoy = decHoy.nivel === "alta"
      ? presentarRiego(decHoy.cantidad_l_m2, presOpts) : null;
    const climaHoy = serie[corte] || {};

    // Pronóstico: proyecta el balance día a día (sin más riegos) hasta el primer "alta".
    let proximo = null;
    for (let i = corte + 1; i < serie.length; i++) {
      const b = balanceHidrico(serie.slice(0, i + 1), riegos, opts);
      if (decisionRiego(b).nivel === "alta") {
        const p = presentarRiego(decisionRiego(b).cantidad_l_m2, presOpts);
        proximo = { fecha: serie[i].date, presentacion: p, Dr: Number(b.Dr.toFixed(1)) };
        break;
      }
    }

    // Riegos reales recientes (para el histórico de la tarjeta).
    const recientes = riegos.slice(-5).reverse().map(r => ({
      fecha: r.date, l_m2: r.litros,
      cubos: (u.capacidad_regadera && u.area_m2 && r.litros != null)
        ? Math.round((r.litros * u.area_m2 / u.capacidad_regadera) * 10) / 10 : null,
    }));

    return res.status(200).json({
      ok: true,
      usuario: { ciudad: u.ciudad, cultivo: (u.cultivos || [])[0] || null,
                 area_m2: u.area_m2, capacidad_regadera: u.capacidad_regadera },
      hoy: {
        fecha: hoy,
        nivel: decHoy.nivel,                       // alta | media | baja
        regar: decHoy.nivel === "alta",
        texto: decHoy.texto,
        presentacion: presHoy,                     // { texto:"1 cubo (16 L)", ... } o null
        deficit_mm: Number(balHoy.Dr.toFixed(1)),
        umbral_mm:  Number(balHoy.raw.toFixed(1)),
        et0:    Number((climaHoy.et0 ?? 0).toFixed(1)),
        lluvia: Number((climaHoy.lluvia ?? 0).toFixed(1)),
      },
      proximo,
      riegos_recientes: recientes,
    });
  } catch (err) {
    console.error("[riego-hoy] error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
