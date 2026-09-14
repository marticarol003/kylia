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
const { balanceHidrico, decisionRiego, laminaDeAccion, MOTOR_VERSION, MOTOR_REGLAS } = require("./_motor-riego.js");
const { serieTermica } = require("./_clima-termico.js");
const { climaSerie, hoyISO } = require("./_clima.js");


// hoyISO viene de _clima.js: el día CIVIL en Europe/Madrid, no el día UTC.
// Entre las 00:00 y las 02:00 locales no son el mismo, y de eso dependía qué
// fuente de clima se usaba para el día anterior. Ver assets/js/clima-reglas.js.

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

// El clima sale de _clima.js, el mismo módulo que usa campo.js desde el
// 14-sep-2026. Aquí vivía la segunda copia de climaSerie, con su propio umbral
// para bajar al archivo y con el pronóstico mandando en el solape — o sea, con
// el mismo escalón que costaba un 17,9% de lámina en el piloto de Ferran.
//
// `futuro: 1` es "hoy incluido, y nada más". El Diario B CONGELA lo que Kylia
// habría decidido con la información de esa mañana, y el contrafactual del
// reveal no puede ver el futuro: darle el pronóstico a un lado y no al otro
// inflaría el ahorro publicado. La asimetría está razonada y fijada en
// tests/test-riego-pronostico.mjs.

// Riegos del piloto para el balance. Pasa por laminaDeAccion, que es la puerta
// única de lectura del histórico: si el evento trae su lámina congelada, esa
// manda; si no —riego anterior a la migración del 14-sep— se recalcula con el
// caudal actual y se marca como reconstruida.
//
// Antes se recalculaba SIEMPRE con el caudal actual. Era deliberado (afinar un
// caudal tiene que mover las decisiones de hoy) pero reescribía el pasado: el
// riego de 60 min que valía 15 mm pasaba a 5,4 en cuanto se remedía el caudal, y
// con él se movían el balance del ciclo y el reveal del piloto. Afinar el caudal
// sigue moviendo lo que viene; lo que ya se registró, no.
async function riegosDe(u) {
  const filas = await supabaseSelect(
    "acciones",
    `usuario_id=eq.${u.id}&tipo=eq.riego&select=fecha_local,cantidad_l_m2,duracion_min,lamina_mm,lamina_origen,caudal_mmh&order=fecha_local.asc`
  );
  return (filas || [])
    .filter(f => f.fecha_local)
    .map(f => {
      // LA LÁMINA CONGELADA MANDA. Si el evento la trae, el caudal actual del
      // usuario no la toca: por ahí se reescribía el pasado entero cada vez que
      // se afinaba un caudal con el vaso.
      const L = laminaDeAccion(f, u.caudal);
      return { date: f.fecha_local, litros: L.mm, origen: L.origen, reconstruida: L.reconstruida };
    });
}

// Día de la semana ISO de un 'YYYY-MM-DD': 1 = lunes … 7 = domingo.
function diaSemanaISO(diaStr) {
  const d = new Date(`${diaStr}T12:00:00Z`).getUTCDay();   // 0 = domingo
  return d === 0 ? 7 : d;
}

const NOMBRE_DIA = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

// Qué días cubre una pauta fija entre `desde` y `tope` (ambos incluidos), quitando
// los que ya tienen riego apuntado. Pura (sin red ni BD) para poder testearla.
// Dos formas de expresar la pauta, excluyentes:
//   • diasSemana [1,4] → "todos los lunes y jueves"  (pauta semanal de calendario)
//   • cada N           → "cada N días desde el ancla" (programador de goteo)
// La semanal manda si viene, porque un patrón lun+jue es 3-4-3-4 días y no cabe
// en un intervalo fijo.
// Tope de relleno por corrida. Esto ESCRIBE agua en el cuaderno del agricultor,
// y la escribe sin que nadie la confirme: cuantas más filas de golpe, más lejos
// llega un error antes de que alguien lo vea. Con una pauta de dos días por
// semana, 40 filas son cinco meses de riego — de sobra para el autocurado que
// justifica el relleno (si una corrida se cayó, la siguiente la repone), y poco
// para un `riego_auto_desde` mal puesto.
//
// Medido: con `desde = 2020-01-01` y pauta lunes+jueves, esto insertaba 699
// riegos inventados de una sentada, todos contados luego como agua aplicada en
// el reveal del piloto. Con "0001-01-01" eran 105.696 y 1,8 s solo de calcularlo.
const MAX_RELLENO_POR_CORRIDA = 40;
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function fechasDePauta({ desde, tope, cada, diasSemana }, yaRegistradas) {
  // Una fecha que no es una fecha no entra en el bucle. `"garbage" <= "2026-…"`
  // es false y se salvaba de casualidad; "0001-01-01" no.
  if (!FECHA_ISO.test(String(desde || "")) || !FECHA_ISO.test(String(tope || ""))) return [];
  if (desde > tope) return [];

  const yaHay  = new Set(yaRegistradas || []);
  const semana = new Set((Array.isArray(diasSemana) ? diasSemana : [])
    .map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 7));
  const nuevos = [];

  // Se recorre HACIA ATRÁS desde el tope: si hay que recortar, lo que se queda
  // son los días recientes, que es lo que el balance de hoy necesita. Recortar
  // por delante dejaría el relleno anclado en 2020 y sin llegar nunca a hoy.
  if (semana.size) {
    for (let d = tope; d >= desde && nuevos.length < MAX_RELLENO_POR_CORRIDA; d = sumarDias(d, -1)) {
      if (semana.has(diaSemanaISO(d)) && !yaHay.has(d)) nuevos.push(d);
    }
  } else if (cada > 0) {
    // La pauta "cada N días" está anclada en `desde`, así que las fechas válidas
    // hay que contarlas desde ahí; lo que se recorta es el principio.
    const todas = [];
    for (let d = desde; d <= tope; d = sumarDias(d, cada)) {
      if (!yaHay.has(d)) todas.push(d);
      if (todas.length > 20000) break;          // freno duro ante una fecha absurda
    }
    return todas.slice(-MAX_RELLENO_POR_CORRIDA);
  }
  return nuevos.reverse();
}

// Materializa los riegos de un piloto de PAUTA FIJA. Dos casos:
//   • goteo automático: el programador riega solo (cada N días, M min);
//   • pauta semanal de calendario: el agricultor riega siempre los mismos días
//     de la semana (la cebolleta de El Tros de l'Uri: lunes y jueves, 2 h).
// En ambos, nadie lo apunta en la app; sin esas filas en `acciones`, el balance
// creería el cultivo sin regar y dispararía la recomendación. Aquí generamos las
// que falten desde la fecha ancla hasta hoy (idempotente: salta los días que ya
// tienen un riego registrado) y las devolvemos para incluirlas en el balance de
// ESTA corrida. Autocurativo: si un día se cayó, la siguiente corrida lo rellena.
// En dry-run calcula pero no escribe.
//
// ⚠️ Esto ESCRIBE agua que nadie ha confirmado. Si el agricultor se salta un día,
// la fila se crea igual y el reveal la contará como aplicada. Solo se activa por
// parcela (riego_auto), y solo con la pauta declarada por su dueño.
//
// Lámina por riego = min/60 × caudal (mm/h = L/m²·h), igual que el cuaderno.
async function materializarGoteoAuto(u, riegosExistentes, hoy, dry) {
  if (!u.riego_auto) return [];
  const cada   = Number(u.riego_auto_cada_dias);
  const min    = Number(u.riego_auto_min);
  const caudal = Number(u.caudal);
  const desde  = u.riego_auto_desde ? String(u.riego_auto_desde).slice(0, 10) : null;
  // Se sanea aquí (no solo dentro de fechasDePauta) porque el nombre del día
  // también va a las notas: un 0 o un 9 en la columna pondría "undefined".
  const semana = (Array.isArray(u.riego_auto_dias_semana) ? u.riego_auto_dias_semana : [])
    .map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 7).sort((a, b) => a - b);
  if (!desde || !(min > 0) || !(caudal > 0)) return [];
  if (!semana.length && !(cada > 0)) return [];

  const lamina     = Math.round((min / 60) * caudal * 10) / 10;   // L/m² por riego
  const yaApuntados = (riegosExistentes || []).map(r => r.date);

  // Nadie riega una parcela cosechada: la pauta fija se corta ahí. Si no, el
  // cron seguiría inventando riegos en `acciones` sobre tierra vacía y el
  // contrafactual del reveal los contaría como agua realmente aplicada.
  const cosecha = u.fecha_cosecha ? String(u.fecha_cosecha).slice(0, 10) : null;
  const tope    = cosecha && cosecha < hoy ? cosecha : hoy;

  const nuevos = fechasDePauta({ desde, tope, cada, diasSemana: semana }, yaApuntados);
  if (!nuevos.length) return [];

  const comoEs = semana.length
    ? `pauta semanal ${semana.map(n => NOMBRE_DIA[n]).join("+")}`
    : `pauta fija cada ${cada} d`;

  if (!dry) {
    await supabaseInsert("acciones", nuevos.map(date => ({
      usuario_id:     u.id,
      fecha_local:    date,
      tipo:           "riego",
      cantidad_l_m2:  lamina,
      duracion_min:   min,
      // ⚠️ ESTE TAMBIÉN CONGELA. Es el segundo —y último— escritor de acciones de
      // riego, y se escapaba del mecanismo: insertaba cantidad y duración pero no
      // la lámina, así que estas filas quedaban a merced del caudal actual y
      // remedirlo las reescribía hacia atrás. Y son las MÁS sensibles: las
      // sintetiza el cron, nadie las revisa, y en el piloto de Ferran son 73 de
      // los riegos del ciclo. `lamina` ya está calculada arriba con este mismo
      // caudal; lo único que faltaba era guardarla.
      caudal_mmh:     caudal,
      lamina_mm:      lamina,
      lamina_origen:  "duracion_x_caudal",
      // El goteo automático arranca de madrugada; en la pauta semanal el riego
      // lo abre una persona y no sabemos cuándo → null antes que inventarlo.
      franja_horaria: semana.length ? null : "manana",
      motivo:         "goteo-auto",   // marca "sintetizado, no confirmado" (el nombre viene del goteo, que fue el primer caso)
      notas:          `${comoEs} · ${min} min · ${caudal} mm/h (sintetizado por diario-b)`,
    })));
  }
  // Con su procedencia, igual que riegosDe(): quien reciba esto no tiene que
  // adivinar si la lámina es dato o reconstrucción.
  return nuevos.map(date => ({ date, litros: lamina, origen: "duracion_x_caudal", reconstruida: false }));
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
      // COSECHADO = piloto cerrado. Sin esto, el cron seguía congelando cada
      // mañana una decisión de riego para una parcela VACÍA: el campo de 440 m²
      // se cosechó el 30-jul y siguió acumulando filas diciendo que había que
      // regar una tierra donde ya no había nada. Y `recomendaciones_log` es de
      // donde lee el reveal, así que cada día ensuciaba un poco más el informe
      // —y es append-only, o sea que limpiar después cuesta desactivar el
      // trigger. Mejor no escribirlas.
      const cosecha = u.fecha_cosecha ? String(u.fecha_cosecha).slice(0, 10) : null;
      if (cosecha && cosecha < hoy) {
        r.skip = `cosechado el ${cosecha}`;
        resultados.push(r);
        continue;
      }
      if (!dry && await yaCongelado(u.id, hoy)) { r.skip = "ya congelado hoy"; resultados.push(r); continue; }

      const serie  = await climaSerie(u.lat, u.lon, u.fecha_plantacion, { futuro: 1 });
      const riegos = await riegosDe(u);
      // ⚠️ AQUÍ NO SE MIRA EL PRONÓSTICO, Y ES A PROPÓSITO. El Diario B congela
      // lo que Kylia habría decidido, y el reveal compara contra eso con un
      // contrafactual (simularKylia) que NO puede ver el futuro: darle el
      // pronóstico a un lado y no al otro inflaría el ahorro publicado. La
      // asimetría con /api/campo es deliberada y está fijada en
      // tests/test-riego-pronostico.mjs. Por eso `futuro: 1`, que es "hoy
      // incluido": la serie termina hoy y no hay futuro que recortar.
      //
      // La serie térmica va aparte porque es más larga (proyecta el ciclo), no
      // porque el clima se quede corto: desde el 14-sep el archivo cubre desde
      // la plantación sin tope, así que el reloj ya no cae a calendario en los
      // ciclos largos como pasaba con el corte de 92 días.
      const termica = await serieTermica(u.lat, u.lon, u.fecha_plantacion).catch(() => []);
      // Goteo automático de pauta fija: rellena los riegos que falten (nadie los
      // apunta) y súmalos al balance para que no se quede corto.
      const auto = await materializarGoteoAuto(u, riegos, hoy, dry);
      if (auto.length) r.goteo_auto = auto.length;
      const bal = balanceHidrico(serie, riegos.concat(auto), {
        suelo:           u.suelo,
        cultivoId:       (u.cultivos || [])[0] || null,
        metodoRiego:     u.metodo_riego,
        fechaPlantacion: u.fecha_plantacion,
        serieTermica:    termica,
        // La ventana que el balance NECESITABA (desde que se plantó), no la que
        // le llegó: con `serie[0].date`, un hueco de 18 días al principio del
        // ciclo no encoge la serie —la empieza más tarde— y la cobertura salía
        // 1,000 sobre un balance al que le faltaba un tercio del clima.
        ventana:         { desde: String(u.fecha_plantacion || "").slice(0, 10) || serie[0]?.date,
                           hasta: hoy },
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
        // CON QUÉ SE DECIDIÓ ESTO, para poder reconstruirlo dentro de un año.
        // Un piloto ciego solo vale si se puede volver atrás y comprobar qué
        // sabía Kylia ese día — no qué sabemos hoy. Faltaban seis cosas y las
        // seis hacían falta: el cultivo y la fase (sin ellos no se sabe de qué
        // curva salió el Kc), el CAUDAL del día (laminaRiego usa el caudal
        // ACTUAL del usuario, así que afinar un caudal reescribe la historia de
        // riego hacia atrás), el reloj que se usó, de dónde salió el clima, y de
        // qué supuestos se estaba fiando el balance.
        contexto: {
          fuente:       "diario-b",
          // CON QUÉ CÓDIGO se tomó esta decisión. Sin esto, dentro de un año
          // "el balance decía 38 mm" no se puede comprobar: las tablas y las
          // reglas cambian. No congela la serie climática entera (sería enorme);
          // la propuesta para eso está en docs/tecnico/metricas.md.
          motor_version: MOTOR_VERSION,
          motor_reglas:  MOTOR_REGLAS,
          // — clima del día de la decisión —
          et0:          Number((hoyClima.et0 ?? 0).toFixed(2)),
          // null = no se sabe si llovió ese día. El balance lo cuenta como 0 mm
          // (conservador: no descontar agua que quizá no cayó) pero el LOG tiene
          // que conservar el estado, o la decisión no se puede reconstruir.
          lluvia:       hoyClima.lluvia == null ? null : Number(hoyClima.lluvia.toFixed(1)),
          lluvia_conocida: hoyClima.lluvia != null,
          dias_sin_lluvia_conocida: bal.diasSinLluviaConocida ?? 0,
          clima_fecha:  hoyClima.date || null,
          clima_fuente: hoyClima.fuente || null,          // archivo | pronostico
          clima_cobertura: bal.coberturaClima ?? null,
          clima_dias_sin: bal.diasSinClima ?? null,
          // — cultivo y fase —
          cultivo:      (u.cultivos || [])[0] || null,
          fase:         bal.faseActual ?? null,
          dias_fenologicos: bal.diasFenologicos ?? null,
          gdd_acum:     bal.gddAcum ?? null,
          modo_fenologia: bal.modoFenologia || null,      // termico | calendario
          kc:           Number(bal.kcActual.toFixed(2)),
          // — estado hídrico —
          Dr:           Number(bal.Dr.toFixed(1)),
          RAW:          Number(bal.raw.toFixed(1)),
          TAW:          Number(bal.taw.toFixed(1)),
          etc_acum:     bal.etcAcum == null ? null : Number(bal.etcAcum.toFixed(1)),
          lluvia_util_acum: bal.lluviaUtilAcum ?? null,
          riego_util_acum:  bal.riegoUtilAcum ?? null,
          riego_neto_acum:  bal.riegoNetoAcum ?? null,
          // — la parcela, tal como estaba ESE día —
          metodo_riego: u.metodo_riego || null,
          suelo:        u.suelo || null,
          caudal_mmh:   u.caudal ?? null,
          area_m2:      u.area_m2 ?? null,
          // — de qué se fía este balance —
          sin_fenologia: bal.sinFenologia,
          riegos_sin_cantidad: bal.riegosSinCantidad || 0,
          ultimo_riego_sin_cantidad: bal.ultimoRiegoSinCantidad || null,
          confianza: bal.confianzaBalance || null,
          motivo:       dec.motivo || dec.nivel,
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

  // Si TODOS los pilotos fallaron, responder 500 para que el fallo sea visible
  // en el cron (logs de Vercel) en vez de un 200 que parece un día normal.
  const fallidos = resultados.filter(x => x.error).length;
  if (pilotos.length > 0 && fallidos === pilotos.length) {
    return res.status(500).json({ ok: false, dry, fecha: hoy, n: pilotos.length, error: "todos los pilotos fallaron", resultados });
  }
  return res.status(200).json({ ok: true, dry, fecha: hoy, n: pilotos.length, resultados });
};

// Expuesto para los tests (tests/test-pauta-semanal.mjs): es la pieza pura que
// decide QUÉ días riega una pauta fija, sin red ni base de datos.
module.exports.fechasDePauta = fechasDePauta;
