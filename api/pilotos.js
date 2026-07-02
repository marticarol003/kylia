// ─────────────────────────────────────────────────────────────────
// /api/pilotos — panel de pilotos silenciosos (vista de fundador)
// ─────────────────────────────────────────────────────────────────
// Lista TODOS los usuarios piloto_sombra=true y, por cada uno, su evolución
// "agua real del agricultor vs contrafactual FAO-56 de Kylia" — la misma
// máquina que /api/campo?vista=reveal, pero para todos a la vez.
//
// PROTEGIDO por PILOTOS_KEY: expone datos de varios agricultores (emails, agua)
// → no puede ser público (RGPD). Sin la clave correcta, no devuelve nada.
//   GET /api/pilotos?key=<PILOTOS_KEY>
//
// DEUDA (consolidar tras la demo): `revealDeUsuario` duplica el ensamblaje de
// api/campo.js → vistaReveal. Se replica AQUÍ a propósito para NO tocar campo.js
// (sirve el dashboard del padre en prod y la demo es inminente). Cuando calme,
// extraer el gemelo a un módulo compartido e importarlo desde ambos.

const { isConfigured, supabaseSelect, preludio } = require("./_supabase.js");
const { simularKylia } = require("./_motor-riego.js");
const { construirReveal } = require("./_reveal.js");

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
function hoyISO() { return new Date().toISOString().slice(0, 10); }
function dia(f) { return f ? String(f).slice(0, 10) : null; }
function diasDesde(f) { return f ? Math.floor((Date.now() - new Date(`${f}T12:00:00Z`)) / 86400000) : null; }
function laminaMostrada(cant, dur, caudal) {
  if (dur != null && caudal) return Math.round((caudal * dur / 60) * 10) / 10;
  return cant ?? null;
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

// Gemelo de vistaReveal en api/campo.js (ver DEUDA arriba). Devuelve el informe.
async function revealDeUsuario(u) {
  const desde = u.piloto_inicio ? String(u.piloto_inicio).slice(0, 10) : null;
  const fRec  = desde ? `&fecha=gte.${desde}T00:00:00Z` : "";
  const fAcc  = desde ? `&fecha_local=gte.${desde}` : "";

  const [recs, acciones, jornadas] = await Promise.all([
    supabaseSelect("recomendaciones_log",
      `usuario_id=eq.${u.id}${fRec}&select=fecha,tipo,cantidad_l_m2,nivel&order=fecha.asc`),
    supabaseSelect("acciones",
      `usuario_id=eq.${u.id}${fAcc}&select=fecha_local,tipo,cantidad_l_m2,duracion_min,producto_nombre&order=fecha_local.asc`),
    supabaseSelect("jornadas", `usuario_id=eq.${u.id}&select=fuente_decision`),
  ]);

  const riegosKylia  = (recs || []).filter(r => r.tipo === "riego")
    .map(r => ({ dia: dia(r.fecha), l_m2: r.cantidad_l_m2, nivel: r.nivel }));
  const tratKylia    = (recs || []).filter(r => r.tipo === "tratamiento" || r.tipo === "nutricion")
    .map(r => ({ dia: dia(r.fecha) }));
  const riegosReales = (acciones || []).filter(a => a.tipo === "riego")
    .map(a => ({ dia: dia(a.fecha_local), l_m2: laminaMostrada(a.cantidad_l_m2, a.duracion_min ?? null, u.caudal) }));
  const tratReales   = (acciones || []).filter(a => a.tipo === "tratamiento" || a.tipo === "aplicacion")
    .map(a => ({ dia: dia(a.fecha_local), producto: a.producto_nombre }));

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
        contrafactual = { puntos: sim.puntos, total: sim.total };
      }
    } catch (_) { /* sin clima → método heredado */ }
  }

  return construirReveal({
    usuario: u, riegosReales, riegosKylia, tratReales, tratKylia,
    jornadas: jornadas || [], contrafactual,
  });
}

module.exports = async (req, res) => {
  if (!preludio(req, res, "GET")) return;

  // Guarda: sin PILOTOS_KEY no se expone nada (datos de varios agricultores).
  const expected = (process.env.PILOTOS_KEY || "").trim();
  if (!expected) return res.status(200).json({ ok: false, reason: "pilotos_key_not_configured" });
  const key = (req.query?.key || "").toString();
  if (key !== expected) return res.status(403).json({ ok: false, error: "key inválida" });

  if (!isConfigured()) return res.status(200).json({ ok: false, reason: "supabase_not_configured" });

  const usuarios = await supabaseSelect("usuarios",
    "piloto_sombra=eq.true&select=id,email,nombre,ciudad,lat,lon,cultivos,metodo_riego," +
    "manejo,suelo,fecha_plantacion,area_m2,caudal,piloto_inicio,tarifa_agua&order=ciudad.asc");

  const pilotos = await Promise.all((usuarios || []).map(async (u) => {
    try {
      const inf = await revealDeUsuario(u);
      const a = (inf.dimensiones || {}).agua || {};
      return {
        id: u.id, nombre: u.nombre || null, email: u.email || null,
        ciudad: u.ciudad || null, cultivo: (u.cultivos || [])[0] || null,
        metodo: u.metodo_riego || null, manejo: u.manejo || null,
        fecha_plantacion: u.fecha_plantacion || null,
        periodo: inf.periodo || null,
        agua: a.disponible
          ? {
              disponible: true,
              aplicada_l_m2: a.aplicada_l_m2, recomendada_l_m2: a.recomendada_l_m2,
              exceso_l_m2: a.exceso_l_m2, ahorro_pct: a.ahorro_pct ?? null,
              dias_regado_real: a.dias_regado_real, veredicto: a.veredicto,
              serie: a.serie || [],
            }
          : { disponible: false, motivo: a.motivo || null },
        avisos: inf.avisos || [],
      };
    } catch (e) {
      return { id: u.id, nombre: u.nombre || null, ciudad: u.ciudad || null, error: e.message };
    }
  }));

  return res.status(200).json({ ok: true, generado_en: new Date().toISOString(), n: pilotos.length, pilotos });
};
