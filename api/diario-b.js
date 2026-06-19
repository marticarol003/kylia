// ─────────────────────────────────────────────────────────────────
// Diario B — congela cada día la decisión de riego de Kylia por piloto
// ─────────────────────────────────────────────────────────────────
// Cron Vercel diario (~06:00 UTC = primera hora). Para cada piloto con
// coordenadas, baja el clima del día (ET₀ + lluvia, Open-Meteo), reconstruye
// el balance FAO-56 con sus riegos reales (tabla `acciones`) y CONGELA la
// decisión de hoy en `recomendaciones_log` — abra el agricultor la app o no.
//
// Es la pieza que hace fiable el reveal del piloto silencioso: registro
// diario, con la fecha de la decisión y sin retrovisor (usa ET₀ observada
// de los días pasados + previsión de hoy, lo disponible esta mañana).
// Ver docs/tecnico/shadow-log-recomendaciones.md §5.
//
// SEGURIDAD: por defecto corre en DRY-RUN (calcula y loguea, NO escribe).
// Solo persiste si process.env.DIARIO_B_LIVE === "1" y la request no trae ?dry=1.
//
// Test manual:  GET /api/diario-b?dry=1   (devuelve qué congelaría, sin escribir)
//
// Usa el MISMO motor que la app (api/_motor-riego.js) para que no deriven.

const { isConfigured, supabaseSelect, supabaseInsert } = require("./_supabase.js");
const { balanceHidrico, decisionRiego } = require("./_motor-riego.js");

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function diasDesde(fechaIso) {
  if (!fechaIso) return null;
  return Math.floor((Date.now() - new Date(`${fechaIso}T12:00:00Z`)) / 86400000);
}

// Suma n días a un 'YYYY-MM-DD' y devuelve 'YYYY-MM-DD'.
function sumarDias(diaStr, n) {
  const d = new Date(`${diaStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Clima diario para un punto: ET₀ FAO + lluvia, desde `desde` hasta hoy (incluido).
async function climaSerie(lat, lon, desde) {
  const dias = desde ? Math.min(92, Math.max(1, diasDesde(desde) + 1)) : 30;
  const url = `${OPEN_METEO}?latitude=${lat}&longitude=${lon}`
    + `&daily=et0_fao_evapotranspiration,precipitation_sum`
    + `&past_days=${dias}&forecast_days=1&timezone=Europe%2FMadrid`;
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

// Materializa los riegos de un piloto de GOTEO AUTOMÁTICO de pauta fija.
// El goteo riega solo (cada N días, M min) y nadie lo apunta en la app; sin
// esas filas en `acciones`, el balance creería el cultivo sin regar y dispararía
// la recomendación. Aquí generamos las que falten desde la fecha ancla hasta hoy
// (idempotente: salta los días que ya tienen un riego registrado) y las devolvemos
// para incluirlas en el balance de ESTA corrida. Autocurativo: si un día se cayó,
// la siguiente corrida lo rellena. En dry-run calcula pero no escribe.
//
// Lámina por riego = min/60 × caudal (mm/h = L/m²·h), igual que el cuaderno.
async function materializarGoteoAuto(u, riegosExistentes, hoy, dry) {
  if (!u.riego_auto) return [];
  const cada   = Number(u.riego_auto_cada_dias);
  const min    = Number(u.riego_auto_min);
  const caudal = Number(u.caudal);
  const desde  = u.riego_auto_desde ? String(u.riego_auto_desde).slice(0, 10) : null;
  if (!desde || !(cada > 0) || !(min > 0) || !(caudal > 0)) return [];

  const lamina = Math.round((min / 60) * caudal * 10) / 10;   // L/m² por riego
  const yaHay  = new Set((riegosExistentes || []).map(r => r.date));

  const nuevos = [];
  for (let d = desde; d <= hoy; d = sumarDias(d, cada)) {
    if (!yaHay.has(d)) nuevos.push(d);
  }
  if (!nuevos.length) return [];

  if (!dry) {
    await supabaseInsert("acciones", nuevos.map(date => ({
      usuario_id:     u.id,
      fecha_local:    date,
      tipo:           "riego",
      cantidad_l_m2:  lamina,
      duracion_min:   min,
      franja_horaria: "manana",
      motivo:         "goteo-auto",
      notas:          `pauta fija ${min} min · ${caudal} mm/h (sintetizado por diario-b)`,
    })));
  }
  return nuevos.map(date => ({ date, litros: lamina }));
}

// ¿Ya hay una decisión de riego congelada para este usuario hoy?
async function yaCongelado(usuarioId, hoy) {
  const filas = await supabaseSelect(
    "recomendaciones_log",
    `usuario_id=eq.${usuarioId}&tipo=eq.riego&fecha=gte.${hoy}T00:00:00Z&select=id&limit=1`
  );
  return Array.isArray(filas) && filas.length > 0;
}

module.exports = async (req, res) => {
  // Auth opcional (token del cron). Vercel manda Authorization: Bearer <CRON_SECRET>.
  if (process.env.DIARIO_B_TOKEN) {
    const token   = (req.query?.token || req.headers["x-diario-token"] || "").toString();
    const authHdr = (req.headers.authorization || "").toString();
    if (token !== process.env.DIARIO_B_TOKEN && authHdr !== `Bearer ${process.env.DIARIO_B_TOKEN}`) {
      return res.status(401).json({ error: "no autorizado" });
    }
  }

  const dry = String(req.query?.dry || "") === "1" || process.env.DIARIO_B_LIVE !== "1";
  const hoy = hoyISO();

  if (!isConfigured()) {
    return res.status(200).json({ ok: true, persisted: false, reason: "supabase_not_configured" });
  }

  // Pilotos silenciosos marcados (piloto_sombra=true) con coordenadas. La decisión
  // de riego corre sobre clima, no satélite. Requiere db/diario-b-produccion.sql.
  let pilotos = [];
  try {
    // select=* (no explícito): incluye caudal y los campos riego_auto_* del goteo
    // automático, y evita que un ALTER reciente rompa el select por caché de esquema.
    pilotos = await supabaseSelect(
      "usuarios",
      "select=*&piloto_sombra=eq.true&lat=not.is.null&lon=not.is.null"
    );
  } catch (err) {
    return res.status(500).json({ ok: false, error: `no se pudieron leer pilotos: ${err.message}` });
  }

  const resultados = [];
  for (const u of pilotos) {
    const r = { usuario_id: u.id, ciudad: u.ciudad || null };
    try {
      if (!dry && await yaCongelado(u.id, hoy)) { r.skip = "ya congelado hoy"; resultados.push(r); continue; }

      const serie  = await climaSerie(u.lat, u.lon, u.fecha_plantacion);
      const riegos = await riegosDe(u.id);
      // Goteo automático de pauta fija: rellena los riegos que falten (nadie los
      // apunta) y súmalos al balance para que no se quede corto.
      const auto = await materializarGoteoAuto(u, riegos, hoy, dry);
      if (auto.length) r.goteo_auto = auto.length;
      const bal = balanceHidrico(serie, riegos.concat(auto), {
        suelo:           u.suelo,
        cultivoId:       (u.cultivos || [])[0] || null,
        metodoRiego:     u.metodo_riego,
        fechaPlantacion: u.fecha_plantacion,
      });
      const dec  = decisionRiego(bal);
      const hoyClima = serie[serie.length - 1] || {};

      const fila = {
        usuario_id:    u.id,
        fecha:         `${hoy}T06:00:00Z`,                 // fecha de la DECISIÓN, no del insert
        tipo:          "riego",
        texto:         dec.texto,
        cantidad_l_m2: dec.cantidad_l_m2,
        nivel:         dec.nivel,
        contexto: {
          fuente:       "diario-b",
          et0:          Number((hoyClima.et0 ?? 0).toFixed(2)),
          lluvia:       Number((hoyClima.lluvia ?? 0).toFixed(1)),
          kc:           Number(bal.kcActual.toFixed(2)),
          Dr:           Number(bal.Dr.toFixed(1)),
          RAW:          Number(bal.raw.toFixed(1)),
          TAW:          Number(bal.taw.toFixed(1)),
          metodo_riego: u.metodo_riego || null,
          suelo:        u.suelo || null,
          sin_fenologia: bal.sinFenologia,
        },
      };

      r.decision = { nivel: dec.nivel, cantidad_l_m2: dec.cantidad_l_m2, Dr: fila.contexto.Dr, texto: dec.texto };
      if (!dry) {
        await supabaseInsert("recomendaciones_log", [fila]);
        r.persisted = true;
      } else {
        r.persisted = false;
      }
    } catch (err) {
      r.error = err.message;
    }
    resultados.push(r);
  }

  console.log(`[diario-b] hoy=${hoy} dry=${dry} pilotos=${pilotos.length} ` +
              `congelados=${resultados.filter(x => x.persisted).length}`);
  return res.status(200).json({ ok: true, dry, fecha: hoy, n: pilotos.length, resultados });
};
