// ─────────────────────────────────────────────────────────────────
// Reglas de clima — núcleo PURO, compartido servidor ↔ navegador
// ─────────────────────────────────────────────────────────────────
// UN SOLO FICHERO para los dos lados, igual que motor-riego.js:
//   • servidor  → api/_clima.js hace require() de este fichero
//   • navegador → app/index.html lo carga con <script src="/assets/js/clima-reglas.js">
//
// Aquí NO se hace red. Solo vive la regla de decisión, que es lo que no puede
// derivar entre los dos lados:
//
//   1. qué día es HOY, en la zona horaria en la que se piden los datos
//   2. qué fuente manda en cada día (pasado → archivo, hoy y futuro → pronóstico)
//   3. qué es un dato y qué es un hueco
//
// El 14-sep se unificó el FETCH en api/_clima.js, pero la regla seguía escrita
// cuatro veces. Que hoy coincidan no impide que dentro de tres meses no.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();  // Node / Vercel
  else root.KyliaClima = factory();                                             // navegador
})(typeof self !== "undefined" ? self : this, function () {

  // La zona en la que Kylia pide los datos y en la que vive el agricultor.
  const TZ = "Europe/Madrid";

  // ⚠️ EL DÍA CIVIL NO ES EL DÍA UTC, y aquí eso decidía qué fuente de clima se
  // usaba. `new Date().toISOString().slice(0,10)` da el día en UTC; los datos se
  // piden con timezone=Europe/Madrid. En verano España va en UTC+2, así que
  // entre las 00:00 y las 02:00 hora local el "hoy" en UTC sigue siendo AYER.
  //
  // Consecuencia concreta: a las 00:30 del 15 de julio, hoyISO() devolvía el 14.
  // El corte `date < hoy` dejaba entonces el día 14 —que ya es pasado en el
  // campo— en manos del PRONÓSTICO en vez del archivo. Justo el escalón que se
  // arregló ese mismo día, reaparecido en la franja de medianoche. Y el cron del
  // Diario B corre a las 06:00 UTC, que en invierno son las 07:00 locales: no le
  // tocaba, pero cualquier consulta nocturna del agricultor sí.
  //
  // Intl resuelve CET/CEST solo, con la base de datos de zonas horarias: no hay
  // que acordarse del último domingo de marzo. `en-CA` formatea YYYY-MM-DD.
  const FMT_DIA = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  });

  /** Día civil en Europe/Madrid. `ahora` inyectable para poder testear medianoche. */
  function hoyISO(ahora) {
    return FMT_DIA.format(ahora instanceof Date ? ahora : (ahora ? new Date(ahora) : new Date()));
  }

  /** Hora local (0-23) en Europe/Madrid. Para tests y para decidir si el día está cerrado. */
  function horaLocal(ahora) {
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false });
    return Number(f.format(ahora instanceof Date ? ahora : (ahora ? new Date(ahora) : new Date())));
  }

  // Aritmética sobre fechas CIVILES. Se ancla a mediodía UTC a propósito: con
  // T00:00 un cambio de hora de ±1 h puede saltar de día.
  function sumarDias(iso, n) {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function diasEntre(a, b) {
    return Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
  }

  // ⚠️ UN DATO QUE FALTA NO ES UN CERO, y eso vale para las DOS variables.
  //
  // La ET₀ ausente ya se descartaba desde el 11-sep (costó dos informes de
  // piloto: 39 días del ciclo de Ferran entraron como "ese día no se evaporó
  // nada"). Pero la LLUVIA seguía cayendo a 0 con un `?? 0`, y eso confunde dos
  // cosas que no son la misma: "sé que no llovió" y "no tengo el dato".
  //
  // Ahora la lluvia ausente entra como `null` y quien la use decide. El balance
  // la trata como 0 mm —es la hipótesis conservadora para el riego: si no sabes
  // si llovió, no descuentes agua que a lo mejor no cayó— pero la CUENTA, así
  // que se puede declarar cuántos días del balance se calcularon sin saber si
  // llovió. Descontar una lluvia inventada haría regar de menos, que es el error
  // que cuesta cosecha.
  function diasConDato(daily, fuente) {
    const d = daily || {};
    return (d.time || []).map((date, i) => {
      const lluvia = d.precipitation_sum ? d.precipitation_sum[i] : undefined;
      return {
        date,
        et0:    d.et0_fao_evapotranspiration ? d.et0_fao_evapotranspiration[i] : undefined,
        lluvia: lluvia == null ? null : lluvia,
        tmax:   d.temperature_2m_max ? (d.temperature_2m_max[i] ?? null) : null,
        tmin:   d.temperature_2m_min ? (d.temperature_2m_min[i] ?? null) : null,
        fuente: fuente || null,
      };
    }).filter(x => x.et0 != null);
  }

  /**
   * LA REGLA. El pasado se mira en el archivo y el futuro en el pronóstico.
   *
   * El corte es estricto (`< hoy`): HOY es del pronóstico porque el día no ha
   * terminado y la decisión de riego de hoy se toma junto con los que vienen —
   * que hoy y mañana salgan de fuentes distintas mete el escalón justo donde se
   * decide. Mañana, cuando hoy sea pasado, el archivo lo sustituye solo.
   *
   * Si el archivo no cubre un día pasado (falló la petición, o va por detrás),
   * el pronóstico lo tapa pero el día queda MARCADO con su fuente: degradar en
   * silencio es lo que no se hace aquí.
   */
  function fusionar(pronostico, archivo, hoy, desde) {
    const mapa = new Map();
    for (const d of pronostico || []) mapa.set(d.date, d);
    for (const d of archivo || []) if (d.date < hoy) mapa.set(d.date, d);
    return [...mapa.values()]
      .filter(d => !desde || d.date >= desde)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /** De dónde salió cada día. Para que quien publique un número pueda declararlo. */
  function procedencia(serie, hoy) {
    const s = Array.isArray(serie) ? serie : [];
    const dia = hoy || hoyISO();
    const pasados = s.filter(d => d.date < dia);
    const archivo = pasados.filter(d => d.fuente === "archivo").length;
    const sinLluvia = s.filter(d => d.lluvia == null).length;
    return {
      dias: s.length,
      dias_pasados: pasados.length,
      pasado_archivo: archivo,
      pasado_pronostico: pasados.length - archivo,
      // 1 = todo el pasado salió del histórico, que es la regla. Por debajo,
      // parte del pasado se calculó con pronóstico y hay mezcla.
      coherencia: pasados.length ? Math.round((archivo / pasados.length) * 1000) / 1000 : 1,
      futuro: s.filter(d => d.date > dia).length,
      // Días en los que hay ET₀ pero NO se sabe si llovió. No es lo mismo que
      // saber que no llovió, y el balance los cuenta aparte.
      dias_sin_lluvia_conocida: sinLluvia,
    };
  }

  return { TZ, hoyISO, horaLocal, sumarDias, diasEntre, diasConDato, fusionar, procedencia };
});
