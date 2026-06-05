// ─────────────────────────────────────────────────────────────────
// Generador del reveal — núcleo PURO del informe final del piloto
// ─────────────────────────────────────────────────────────────────
// Cruza lo que KYLIA DECIDIÓ (recomendaciones_log, congelado por el Diario B)
// contra lo que el AGRICULTOR HIZO (acciones / jornadas) y produce el informe
// de cierre del piloto silencioso: las 4 dimensiones que /piloto promete.
//
// Vive sin estado ni red: recibe todo por parámetros (las filas ya leídas de
// Supabase) para poder testearse de forma determinista, igual que _motor-riego.js.
// El endpoint api/reveal.js es quien lee de Supabase y llama aquí.
//
// FRONTERA HONESTA (docs/estrategia/validacion-laboratorio-vs-sombra.md §4.4):
//   solo se traduce a € el AGUA, porque es el único modelo validado vs FAO-56
//   (pyfao56, ETc RMSE 0.000). Plagas/nutrición se reportan de forma CUALITATIVA.
//
// Y por diseño el informe DECLARA lo que aún no puede medir (captura ausente),
// en vez de inventarlo: cada dimensión trae `disponible` + `motivo` cuando falta.

// ── Utilidades de fecha ──────────────────────────────────────────
// Toda fecha entra como 'YYYY-MM-DD' (acciones.fecha_local) o ISO con hora
// (recomendaciones_log.fecha = '...T06:00:00Z'); nos quedamos con el día.
function soloDia(f) {
  if (!f) return null;
  return String(f).slice(0, 10);
}

function diasEntreDias(a, b) {
  return Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
}

// Semana ISO ('YYYY-Www') para agrupar la comparativa de agua.
function semanaISO(diaStr) {
  const d = new Date(`${diaStr}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;          // lunes=0
  d.setUTCDate(d.getUTCDate() - day + 3);        // jueves de esa semana
  const jueves = d.getTime();
  d.setUTCMonth(0, 1);                           // 1 de enero
  const semana = 1 + Math.round((jueves - d.getTime()) / 86400000 / 7);
  return `${new Date(jueves).getUTCFullYear()}-W${String(semana).padStart(2, "0")}`;
}

function suma(arr, f) { return arr.reduce((s, x) => s + (Number(f(x)) || 0), 0); }
function r0(x) { return Math.round(x); }
function r1(x) { return Math.round(x * 10) / 10; }

// ── Dimensión 1 · Horas en decidir cada semana ───────────────────
// /piloto promete "sumamos el tiempo declarado en 'en qué te basaste'". Hoy el
// cierre del diario (jornadas) captura las FUENTES de decisión, no minutos.
// Honesto: reportamos el proxy disponible (mezcla de fuentes, nº de días) y
// declaramos que la estimación en horas necesita capturar tiempo (no se inventa).
function dimHoras(jornadas) {
  const dias = jornadas.length;
  const mezcla = {};
  let heuristicas = 0, informadas = 0;
  for (const j of jornadas) {
    const fuentes = Array.isArray(j.fuente_decision) ? j.fuente_decision : [];
    for (const f of fuentes) mezcla[f] = (mezcla[f] || 0) + 1;
    // heurística = decisión "a ojo / costumbre"; informada = apoyada en dato externo
    if (fuentes.some(f => ["experiencia", "vecino", "rutina"].includes(f))) heuristicas++;
    if (fuentes.some(f => ["meteo", "asesor"].includes(f))) informadas++;
  }
  return {
    titulo: "Horas en decidir cada semana",
    disponible: false,
    motivo: "El cierre del diario captura en qué te basaste, pero no cuántos minutos " +
            "dedicaste. Sin ese dato no estimamos horas (no lo inventamos).",
    pendiente_captura: "Añadir un campo de minutos al cierre del diario (jornadas).",
    datos: {
      dias_registrados: dias,
      mezcla_fuentes: mezcla,
      dias_decision_heuristica: heuristicas,
      dias_decision_informada: informadas,
    },
  };
}

// ── Dimensión 2 · Agua aplicada vs recomendada (la estrella, con €) ──
// Compara solo en el PERIODO con decisiones congeladas de Kylia (sin ese
// solape la comparación sería sesgada: agua real de 60 días contra decisiones
// de 30). Riegos reales anteriores se reportan aparte, no se comparan.
//   riegosReales:  [{ dia, l_m2 }]  de acciones tipo riego
//   riegosKylia:   [{ dia, l_m2, nivel }]  de recomendaciones_log tipo riego
function dimAgua(riegosReales, riegosKylia) {
  const decisiones = riegosKylia.filter(d => d.dia).sort((a, b) => a.dia.localeCompare(b.dia));
  if (decisiones.length === 0) {
    return {
      titulo: "Agua aplicada vs recomendada",
      disponible: false,
      motivo: "Todavía no hay decisiones de riego congeladas por el Diario B. " +
              "Se activa cuando el cron lleva ≥1 día corriendo en producción.",
    };
  }

  const desde = decisiones[0].dia;
  const hasta = decisiones[decisiones.length - 1].dia;

  const realesEnPeriodo = riegosReales.filter(r => r.dia && r.dia >= desde);
  const realesAntes     = riegosReales.filter(r => r.dia && r.dia < desde);

  // Lámina que Kylia habría aplicado = suma de las decisiones "alta" (regar hoy).
  const kyliaAlta = decisiones.filter(d => d.nivel === "alta");
  const aguaKylia = suma(kyliaAlta, d => d.l_m2);
  const aguaReal  = suma(realesEnPeriodo, r => r.l_m2);
  const exceso    = aguaReal - aguaKylia;

  // Comparativa por semana ISO (riego real vs lámina recomendada).
  const semanas = {};
  const acumula = (dia, campo, val) => {
    const w = semanaISO(dia);
    semanas[w] = semanas[w] || { semana: w, aplicada: 0, recomendada: 0 };
    semanas[w][campo] += Number(val) || 0;
  };
  realesEnPeriodo.forEach(r => acumula(r.dia, "aplicada", r.l_m2));
  kyliaAlta.forEach(d => acumula(d.dia, "recomendada", d.l_m2));
  const porSemana = Object.values(semanas)
    .sort((a, b) => a.semana.localeCompare(b.semana))
    .map(s => ({
      semana: s.semana,
      aplicada_l_m2:    r1(s.aplicada),
      recomendada_l_m2: r1(s.recomendada),
      exceso_l_m2:      r1(s.aplicada - s.recomendada),
    }));

  const excesoPct = aguaKylia > 0 ? r0((exceso / aguaKylia) * 100) : null;
  let veredicto;
  if (aguaReal === 0) {
    veredicto = "No registraste riegos en el periodo medido.";
  } else if (exceso > 0.5) {
    veredicto = `Aplicaste ~${r0(exceso)} L/m² más que la lámina FAO-56` +
                (excesoPct != null ? ` (+${excesoPct}%)` : "") + " que Kylia habría recomendado.";
  } else if (exceso < -0.5) {
    veredicto = `Aplicaste ~${r0(-exceso)} L/m² menos que la lámina recomendada: ` +
                "posible déficit hídrico a vigilar en el campo del padre.";
  } else {
    veredicto = "Tu riego coincidió de cerca con la lámina FAO-56.";
  }

  return {
    titulo: "Agua aplicada vs recomendada",
    disponible: true,
    periodo: { desde, hasta },
    aplicada_l_m2:    r1(aguaReal),
    recomendada_l_m2: r1(aguaKylia),
    exceso_l_m2:      r1(exceso),
    exceso_pct:       excesoPct,
    dias_regado_real:  new Set(realesEnPeriodo.map(r => r.dia)).size,
    dias_regar_kylia:  kyliaAlta.length,
    por_semana: porSemana,
    riegos_antes_del_registro: realesAntes.length
      ? { n: realesAntes.length, l_m2: r1(suma(realesAntes, r => r.l_m2)),
          nota: "Anteriores a la primera decisión congelada: no se comparan." }
      : null,
    veredicto,
  };
}

// ── Dimensión 3 · Tratamientos potencialmente evitables (cualitativo) ──
// Por cada aplicación real busca si Kylia veía señal (una recomendación de
// tratamiento/nutrición congelada ±ventana días). Si NO la veía → preventivo /
// potencialmente evitable. CUALITATIVO: plagas/nutrición son heurísticas NO
// validadas, así que no se afirma acierto ni se monetiza.
function dimTratamientos(tratReales, tratKylia, ventanaDias = 3) {
  const senales = tratKylia.filter(t => t.dia).map(t => t.dia);
  const aplicados = tratReales.filter(t => t.dia);

  const detalle = aplicados.map(a => {
    const kyliaVeia = senales.some(s => Math.abs(diasEntreDias(s, a.dia)) <= ventanaDias);
    return {
      dia: a.dia,
      producto: a.producto || null,
      kylia_veia_senal: kyliaVeia,
      lectura: kyliaVeia ? "alineado (Kylia también veía presión)"
                         : "sin señal de Kylia (preventivo / potencialmente evitable)",
    };
  });
  const sinSenal = detalle.filter(d => !d.kylia_veia_senal).length;

  // Si Kylia no tiene NINGUNA señal congelada, no hay contrafactual: el Diario B
  // hoy solo congela riego (ver api/diario-b.js). Lo declaramos en vez de fingir.
  const sinContrafactual = tratKylia.length === 0 && aplicados.length > 0;

  return {
    titulo: "Tratamientos potencialmente evitables",
    disponible: aplicados.length > 0,
    cualitativo: true,
    aplicados: aplicados.length,
    alineados_con_kylia: detalle.filter(d => d.kylia_veia_senal).length,
    sin_senal_kylia: sinSenal,
    detalle,
    sin_contrafactual: sinContrafactual,
    nota: sinContrafactual
      ? "El Diario B hoy solo congela la decisión de RIEGO. Para contrastar " +
        "tratamientos hay que congelar también plagas/nutrición."
      : "Señal cualitativa: el modelo de plagas/nutrición es heurístico y no está " +
        "validado. No afirmamos acierto, solo si Kylia veía o no presión ese día.",
  };
}

// ── Dimensión 4 · Coste económico de la divergencia (solo agua) ──
// Traduce a € SOLO el exceso de agua (modelo validado). Necesita área y tarifa:
//   € = exceso(L/m²) × área(m²) / 1000  ·  tarifa(€/m³)
// Tratamientos NO se monetizan (frontera honesta): se reportan en la dim. 3.
function dimCoste(agua, usuario) {
  const out = {
    titulo: "Coste económico de la divergencia",
    agua_eur: null,
    tratamientos_eur: null,
    nota: "Solo el agua se traduce a € (único modelo validado vs FAO-56). " +
          "Los tratamientos se reportan de forma cualitativa, sin euros.",
  };
  if (!agua.disponible || !(agua.exceso_l_m2 > 0)) {
    out.motivo = !agua.disponible
      ? "Sin datos de agua todavía."
      : "No hubo exceso de agua que traducir a coste.";
    return out;
  }
  const area   = Number(usuario.area_m2) || null;
  const tarifa = Number(usuario.tarifa_agua) || null;
  if (!area || !tarifa) {
    out.motivo = "Falta " + [!area && "el área (m²)", !tarifa && "la tarifa del agua (€/m³)"]
      .filter(Boolean).join(" y ") + " para traducir el exceso a euros.";
    out.exceso_l_m2 = agua.exceso_l_m2;
    return out;
  }
  const m3  = (agua.exceso_l_m2 * area) / 1000;
  const eur = m3 * tarifa;
  out.agua_eur = Math.round(eur * 100) / 100;
  out.base = {
    exceso_l_m2: agua.exceso_l_m2, area_m2: area, exceso_m3: r1(m3), tarifa_eur_m3: tarifa,
  };
  out.supuesto = "Tarifa interpretada como €/m³; coste = exceso de agua del periodo medido.";
  return out;
}

// ── Orquestador ──────────────────────────────────────────────────
//   datos = {
//     usuario:        { id, ciudad, cultivos, metodo_riego, fecha_plantacion, tarifa_agua, area_m2 },
//     riegosReales:   [{ dia, l_m2 }],
//     riegosKylia:    [{ dia, l_m2, nivel }],
//     tratReales:     [{ dia, producto }],
//     tratKylia:      [{ dia }],
//     jornadas:       [{ fuente_decision: [...] }],
//   }
function construirReveal(datos, opts = {}) {
  const u = datos.usuario || {};
  const riegosReales = datos.riegosReales || [];
  const riegosKylia  = datos.riegosKylia || [];
  const jornadas     = datos.jornadas || [];

  const agua  = dimAgua(riegosReales, riegosKylia);
  const horas = dimHoras(jornadas);
  const trat  = dimTratamientos(datos.tratReales || [], datos.tratKylia || [], opts.ventanaTratDias);
  const coste = dimCoste(agua, u);

  // Periodo y cobertura del registro silencioso (días con decisión congelada).
  let periodo = null;
  if (agua.disponible) {
    const dias = Math.max(0, diasEntreDias(agua.periodo.desde, agua.periodo.hasta)) + 1;
    periodo = {
      desde: agua.periodo.desde,
      hasta: agua.periodo.hasta,
      dias,
      dias_con_decision: new Set(riegosKylia.map(d => d.dia).filter(Boolean)).size,
    };
    periodo.cobertura_pct = dias > 0 ? r0((periodo.dias_con_decision / dias) * 100) : null;
  }

  // Avisos: lo que el informe NO puede afirmar todavía (transparencia).
  const avisos = [];
  if (!horas.disponible) avisos.push("Dimensión 'horas en decidir': sin captura de tiempo, solo proxy de fuentes.");
  if (trat.sin_contrafactual) avisos.push("Dimensión 'tratamientos': el Diario B solo congela riego; sin contrafactual de plagas.");
  if (periodo && periodo.cobertura_pct != null && periodo.cobertura_pct < 90) {
    avisos.push(`Cobertura del registro: ${periodo.cobertura_pct}% de los días tienen decisión congelada (huecos del cron).`);
  }

  return {
    generado_en: new Date().toISOString(),
    usuario: {
      id: u.id || null,
      ciudad: u.ciudad || null,
      cultivo: (u.cultivos || [])[0] || null,
      metodo_riego: u.metodo_riego || null,
      fecha_plantacion: u.fecha_plantacion || null,
    },
    periodo,
    dimensiones: { horas, agua, tratamientos: trat, coste },
    avisos,
  };
}

module.exports = {
  construirReveal,
  // exportadas para test unitario
  dimAgua, dimHoras, dimTratamientos, dimCoste, semanaISO, soloDia,
};
