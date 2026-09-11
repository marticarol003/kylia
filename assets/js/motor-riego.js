// ─────────────────────────────────────────────────────────────────
// Motor de riego FAO-56 — núcleo PURO, compartido servidor ↔ navegador
// ─────────────────────────────────────────────────────────────────
// UN SOLO FICHERO para los dos lados:
//   • servidor  → api/_motor-riego.js hace require() de este fichero
//   • navegador → app/index.html lo carga con <script src="/assets/js/motor-riego.js">
//
// Hasta el 28-jul el motor estaba DUPLICADO (aquí y dentro de app/index.html).
// Las tablas no habían derivado, pero la VENTANA del balance sí: la app
// arrancaba en el penúltimo riego y el servidor en la plantación, así que sobre
// los mismos datos daban 10,0 vs 38,4 mm de déficit y decisiones opuestas
// ("vigilar" vs "regar"). Con un solo fichero eso ya no puede volver a pasar.
//
// FAO-56 (Allen et al., 1998), método del coeficiente único de cultivo.
// Todo en mm (= L/m²). Ver docs/tecnico/motor-de-decision.md §3.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();  // Node / Vercel
  else root.KyliaMotor = factory();                                             // navegador
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const FAO_KC = {
    lechuga:   { ini: 0.70, med: 1.00, fin: 0.95, L: [20, 30, 15, 10], zr: [0.20, 0.30], p: 0.30 },
    espinaca:  { ini: 0.70, med: 1.00, fin: 0.95, L: [20, 20, 15,  5], zr: [0.20, 0.30], p: 0.20 },
    brassica:  { ini: 0.70, med: 1.05, fin: 0.95, L: [30, 35, 50, 15], zr: [0.20, 0.50], p: 0.45 },
    tomate:    { ini: 0.60, med: 1.15, fin: 0.80, L: [30, 40, 45, 30], zr: [0.20, 0.70], p: 0.40 },
    pimiento:  { ini: 0.60, med: 1.05, fin: 0.90, L: [30, 35, 40, 20], zr: [0.20, 0.50], p: 0.30 },
    berenjena: { ini: 0.60, med: 1.05, fin: 0.90, L: [30, 40, 40, 20], zr: [0.20, 0.70], p: 0.45 },
    calabacin: { ini: 0.50, med: 0.95, fin: 0.75, L: [25, 35, 25, 15], zr: [0.20, 0.60], p: 0.50 },
    // Cebolla tierna / cebolleta (green onion, FAO-56 Tablas 11-12), TRASPLANTADA
    // y cosechada verde (no bulbifica ni se seca → fin sigue ~1.00). Raíz super-
    // ficial. Arranque corto por ir de plantel, kc med subido a 1.05 por clima
    // seco interior (RHmin~35%, FAO-56 ec. 70) y kc ini a 0.75 por la aspersión
    // frecuente que moja la superficie (más Es).
    //
    // ⚠️ El total (70 d) NO está "comprimido por el calor", como decía este
    // comentario hasta el 8-sep-2026: es EXACTAMENTE el de FAO-56 Tabla 11 para
    // plantación de abril/mayo. Lo que comprime el ciclo es la temperatura, y de
    // eso se encarga ahora FAO_GDD (ver abajo): en el ciclo real de Oriol
    // (plantado el 24-jun) estos 70 días de calendario habrían fallado por 21.
    cebolla:   { ini: 0.75, med: 1.05, fin: 1.00, L: [15, 25, 20, 10], zr: [0.20, 0.30], p: 0.30 },
  };

  // ── Fenología por CALOR, no por calendario (FAO56rev) ──────────────
  // Las L de arriba son días, y los días solo miden bien el desarrollo del
  // cultivo si plantas cuando plantaba la tabla que los publicó. FAO-56 da esas
  // longitudes atadas a una fecha y una región ("Mediterranean, April"); usarlas
  // para otra fecha de plantación es el error que este bloque arregla.
  //
  // EL CASO QUE LO DESTAPÓ. Piloto de cebolleta de El Tros de l'Uri: plantado el
  // 24-jun-2026, primera cosecha el 12-ago-2026 → 49 días. El modelo de
  // calendario decía 70, o sea el 2 de septiembre: 21 días tarde. Y no era un
  // error de la tabla, era un error de UNIDAD — con la temperatura real de su
  // campo, la misma suma térmica que Oriol acumuló en 49 días de verano necesita
  // 70 días plantando el 1 de mayo, que es justo la fecha de referencia de FAO.
  // Los dos números eran correctos; lo que estaba mal era contarlos en días.
  //
  // La revisión de FAO-56 (FAO56rev) hace exactamente esto: sustituye las
  // longitudes fijas en días por grados-día acumulados (GDD). Aquí se sigue ese
  // criterio, y las L de calendario se quedan como EJE de la curva Kc, no como
  // reloj: el reloj es el calor.
  //
  // GDD del día = max(0, (Tmax+Tmin)/2 − Tbase)   [método de la media simple]
  //
  // DE DÓNDE SALEN ESTOS NÚMEROS (reproducible con scripts/derivar-gdd.mjs):
  // no están inventados ni ajustados a nuestros pilotos. Para cada cultivo se
  // toma su fila mediterránea de la Tabla 11 de FAO-56 —sus longitudes de fase y
  // SU FECHA DE PLANTACIÓN DE REFERENCIA— y se integra la temperatura real de 21
  // años (2005-2025, Open-Meteo, 41.674 N 2.766 E) sobre esas mismas fases. El
  // resultado es "cuánto calor pide cada fase", que ya no depende del calendario.
  // Se usa la MEDIANA de los 21 años; el P10-P90 sale en ±7% del total.
  //
  // Tbase por cultivo: Pereira & Paredes (2025), la revisión de umbrales térmicos
  // hecha expresamente para alimentar la curva Kc de FAO56rev.
  //
  // VALIDACIÓN (los dos ciclos cerrados que hay, ninguno usado para calibrar):
  //   cebolleta · La Selva   · plantada 24-jun → real 12-ago : térmico −3 d, calendario +21 d
  //   lechuga   · Sant Boi   · plantada 05-jun → real 30-jul : térmico −6 d, calendario +20 d
  // El sesgo es NEGATIVO en los dos: el modelo dice "ya está lista" unos días
  // antes de que el agricultor la arranque, que es lo que tiene que hacer —
  // predice madurez agronómica, no la decisión comercial de cortar. Por eso lo
  // que se enseña es una VENTANA "a partir de", nunca una fecha de cosecha.
  const FAO_GDD = {
    //            Tbase °C   GDD por fase [inicial, desarrollo, media, final]   ref. FAO-56 Tabla 11
    lechuga:   { tbase:  4.0, gdd: [220, 408, 251, 192] },   // 75 d, abril,       Mediterráneo
    espinaca:  { tbase:  4.0, gdd: [220, 254, 228,  89] },   // 60 d, abril,       Mediterráneo
    brassica:  { tbase:  4.0, gdd: [521, 468, 370,  78] },   // 130 d, septiembre
    tomate:    { tbase: 10.0, gdd: [211, 491, 671, 376] },   // 145 d, abril/mayo, Mediterráneo
    pimiento:  { tbase: 10.0, gdd: [271, 481, 583, 252] },   // 125 d, abril/junio, Europa y Medit.
    berenjena: { tbase: 10.5, gdd: [339, 568, 513, 179] },   // 130 d, mayo/junio, Mediterráneo
    calabacin: { tbase: 10.0, gdd: [128, 307, 335, 219] },   // 100 d, abril,      Mediterráneo
    cebolla:   { tbase:  6.0, gdd: [154, 323, 335, 176] },   // 70 d, abril/mayo,  Mediterráneo
  };
  const SUELO_AWC = { arenoso: 0.08, franco: 0.15, arcilloso: 0.16 }; // θFC−θWP, FAO-56 Tabla 19
  const SUELO_AWC_DEFAULT = 0.15;   // franco
  const ZR_M          = 0.30;       // profundidad radicular (m) — fallback sin cultivo conocido
  const P_AGOTAMIENTO = 0.45;       // fracción de agotamiento — fallback sin cultivo conocido
  const PE_MIN_MM     = 2;          // lluvia diaria < 2 mm: se intercepta/evapora sin infiltrar
                                    // (precipitación efectiva, criterio conservador FAO-56 cap. 8)
  const EFIC_RIEGO    = { goteo: 0.90, aspersion: 0.75, manguera: 0.70, surco: 0.60, regadera: 0.85 };
  const EFIC_DEFAULT  = 0.85;
  const VENTANA_PRONOSTICO_DIAS = 2;  // 48 h: lo único que un modelo acierta con la lluvia de verano

  // Pluviometría/caudal por defecto del sistema (mm/hora = L/m² por hora), para
  // convertir la lámina a minutos cuando el agricultor no declara el suyo.
  // Orientativos; cada piloto puede afinar el suyo en onboarding.
  const CAUDAL_DEFAULT_MMH = { goteo: 4, aspersion: 10, manguera: 20 };

  // Sesión de riego máxima de una tacada (min). Tope operativo, no agronómico:
  // por encima de ~2 h la orden deja de ser ejecutable y se parte en tandas.
  const RIEGO_MAX_MIN = 120;
  // Y cuántas tandas caben en un día de trabajo. Por encima de esto la orden
  // deja de ser una orden: lo que falla es el caudal, no el riego de hoy.
  // Medio día de riego. Por debajo de eso, partir en tandas sigue siendo una
  // orden ejecutable; por encima, lo que falla es el caudal.
  const SESIONES_MAX = 6;

  // ⚠️⚠️ EL AGUJERO QUE MÁS VECES HA MORDIDO EN ESTE FICHERO: Number(null) es 0.
  // Y Number("") también, y Number([]) también, y Number(false) también.
  //
  // Lleva CUATRO defectos distintos, todos encontrados en la auditoría del
  // 11-sep y todos con la misma forma — alguien escribe la comprobación a mano
  // en su función y se le cuela el null:
  //   · gradosDia    lo documenta desde el 8-sep (un día sin dato = día a 0 °C)
  //   · laminaRiego  "sin cantidad" salía como 0 mm en vez de null
  //   · sanearSerie  el primer intento usaba Number.isFinite(Number(x)): no
  //                  filtraba nada, así que el saneado no saneaba
  //   · zrDelDia     zrDelDia("tomate", null) daba 0,20 m en vez del fallback
  //
  // Por eso está aquí arriba y la usan TODAS. Escribirla a mano otra vez es
  // pedir el quinto.
  const finito = x => x != null && x !== "" && typeof x !== "boolean"
                      && !Array.isArray(x) && Number.isFinite(Number(x));

  // Kc del día por interpolación lineal entre fases (inicial→desarrollo→media→final).
  function kcDelDia(cultivoId, diasDesdePlantacion) {
    const k = FAO_KC[cultivoId];
    // `!Number.isFinite` y no `== null`: un NaN colado aquí devolvía Kc NaN y
    // envenenaba la ETc de todos los días siguientes.
    if (!k || !finito(diasDesdePlantacion)) return 1; // fallback: ETc = ET₀
    const [Li, Ld, Lm, Lf] = k.L;
    const d = Math.max(0, diasDesdePlantacion);
    if (d < Li)                return k.ini;
    if (d < Li + Ld)           return k.ini + (k.med - k.ini) * (d - Li) / Ld;
    if (d < Li + Ld + Lm)      return k.med;
    if (d < Li + Ld + Lm + Lf) return k.med + (k.fin - k.med) * (d - Li - Ld - Lm) / Lf;
    return k.fin;
  }

  // Nombre de la fase fenológica del día (inicial→desarrollo→media→final), para
  // explicar en pantalla por qué el Kc es el que es. Misma partición que kcDelDia.
  function faseDelDia(cultivoId, dias) {
    const k = FAO_KC[cultivoId];
    if (!k || !finito(dias)) return null;
    const [Li, Ld, Lm] = k.L;
    const d = Math.max(0, dias);
    if (d < Li)           return "inicial";
    if (d < Li + Ld)      return "desarrollo";
    if (d < Li + Ld + Lm) return "media";
    return "final";
  }

  // Profundidad radicular efectiva (m) del día: crece linealmente de zr[0] al
  // trasplante hasta zr[1] al inicio de la fase media (FAO-56 §8.3). Sin cultivo
  // o sin fecha → ZR_M fijo (comportamiento legacy).
  function zrDelDia(cultivoId, dias) {
    const k = FAO_KC[cultivoId];
    // Sin días válidos, la raíz de referencia. Un NaN aquí salía como zr NaN y
    // de ahí a TAW = NaN, RAW = NaN y el balance entero perdido.
    if (!k || !k.zr || !finito(dias)) return ZR_M;
    const diasCrec = k.L[0] + k.L[1];
    const f = Math.min(1, Math.max(0, dias) / diasCrec);
    return k.zr[0] + (k.zr[1] - k.zr[0]) * f;
  }

  // ── Grados-día: el reloj real del cultivo ─────────────────────────
  // Método de la media simple, que es el que usan las tablas de Tbase de las que
  // salen nuestros umbrales. Sin las dos temperaturas del día no hay GDD: se
  // devuelve null y quien llame decide, en vez de colar un 0 que parecería un
  // día frío de verdad.
  function gradosDia(tmax, tmin, tbase) {
    // Ojo con el hueco: Number(null) es 0 y Number("") también, o sea que un día
    // SIN dato colaría como un día a 0 °C — frío inventado que retrasaría la
    // madurez. Los null se descartan antes de convertir.
    if (tmax == null || tmin == null || tmax === "" || tmin === "") return null;
    const a = Number(tmax), b = Number(tmin), t = Number(tbase);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(t)) return null;
    return Math.max(0, (a + b) / 2 - t);
  }

  // Calor total que pide el ciclo entero (mm de fenología, por así decirlo).
  function gddDelCiclo(cultivoId) {
    const g = FAO_GDD[cultivoId];
    return g ? g.gdd.reduce((a, b) => a + b, 0) : null;
  }

  // Pasa un calor acumulado al DÍA del eje de FAO (el de las L), fase por fase.
  // Se hace por fases y no con una regla de tres sobre el total porque el calor
  // no se reparte igual que los días: una fase de abril acumula mucho menos por
  // día que la misma fase en julio, y aplanar eso deformaría la curva Kc.
  // Devolver el día del eje —y no un Kc— es lo que deja intactas a kcDelDia,
  // faseDelDia y zrDelDia: siguen siendo las mismas funciones de siempre, solo
  // que el número que reciben ya no es un día de calendario.
  function diasFenologicos(cultivoId, gddAcum) {
    const k = FAO_KC[cultivoId], g = FAO_GDD[cultivoId];
    if (!k || !g || !finito(gddAcum)) return null;
    let resto = Math.max(0, Number(gddAcum)), dias = 0;
    for (let f = 0; f < 4; f++) {
      if (resto >= g.gdd[f]) { resto -= g.gdd[f]; dias += k.L[f]; continue; }
      return dias + (g.gdd[f] > 0 ? k.L[f] * (resto / g.gdd[f]) : 0);
    }
    // Pasado el ciclo se sigue extrapolando al ritmo de la última fase, para que
    // el Kc no dé un salto el día que se cruza la madurez.
    return dias + (g.gdd[3] > 0 ? k.L[3] * (resto / g.gdd[3]) : 0);
  }

  // Curva fenológica de una parcela: fecha → día del eje de FAO.
  //
  // Devuelve null —y entonces todo el motor vuelve al calendario de siempre, sin
  // cambiar ni un decimal— si falta la tabla térmica del cultivo, si no hay
  // fecha de plantación, si la serie no trae temperaturas, o si LA SERIE NO
  // LLEGA A LA PLANTACIÓN. Esto último importa: con el arranque del ciclo sin
  // contar, la suma térmica va corta y el cultivo parecería más joven de lo que
  // es, que es exactamente el defecto que veníamos a arreglar. Mejor calendario
  // honesto que termómetro a medias.
  function curvaFenologica(cultivoId, serie, fechaPlantacion) {
    const g = FAO_GDD[cultivoId];
    if (!g || !fechaPlantacion) return null;
    const plant = String(fechaPlantacion).slice(0, 10);
    const dias = [...(serie || [])]
      .filter(d => d && d.date && d.date >= plant && gradosDia(d.tmax, d.tmin, g.tbase) != null)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!dias.length || dias[0].date > plant) return null;

    // ⚠️ UN DÍA QUE FALTA NO ES UN DÍA SIN CALOR. Antes se sumaba solo lo que
    // hubiera en la serie, así que un hueco se tragaba su calor en silencio: con
    // 15 días ausentes de 41, el acumulado caía de 492 a 300 °C·día. El cultivo
    // parecía 15 días más joven, el Kc bajaba y Kylia regaba de menos — que es
    // justo el defecto que este bloque vino a arreglar, reaparecido por la otra
    // puerta.
    //
    // Un hueco CORTO se rellena interpolando entre los días conocidos, que es
    // gap-filling estándar y con error acotado. Uno largo no: ahí se devuelve
    // null y todo el motor vuelve al reloj de calendario, que es honesto.
    const HUECO_MAX_DIAS = 3;
    const unDia = 86400000;
    const completos = [];
    for (let i = 0; i < dias.length; i++) {
      completos.push(dias[i]);
      if (i === dias.length - 1) break;
      const a = new Date(`${dias[i].date}T12:00:00Z`), b = new Date(`${dias[i + 1].date}T12:00:00Z`);
      const faltan = Math.round((b - a) / unDia) - 1;
      if (faltan <= 0) continue;
      if (faltan > HUECO_MAX_DIAS) return null;      // serie rota: mejor calendario
      for (let k = 1; k <= faltan; k++) {
        const f = (k) / (faltan + 1);
        completos.push({
          date: new Date(a.getTime() + k * unDia).toISOString().slice(0, 10),
          tmax: Number(dias[i].tmax) + (Number(dias[i + 1].tmax) - Number(dias[i].tmax)) * f,
          tmin: Number(dias[i].tmin) + (Number(dias[i + 1].tmin) - Number(dias[i].tmin)) * f,
          rellenado: true,
        });
      }
    }

    const mapa = new Map();
    let acum = 0;
    for (const d of completos) {
      acum += gradosDia(d.tmax, d.tmin, g.tbase);
      mapa.set(d.date, { gdd: acum, dias: diasFenologicos(cultivoId, acum) });
    }
    const dias2 = completos;
    const ultima = dias2[dias2.length - 1].date;
    const ult    = mapa.get(ultima);
    // Ritmo de los últimos 7 días, para estirar la curva a los días de pronóstico
    // que el balance sí tiene y la serie térmica no. Sin esto habría un salto
    // justo en el día de hoy, que es el que se enseña en pantalla.
    const atras  = mapa.get(dias2[Math.max(0, dias2.length - 8)].date);
    const pasos  = Math.max(1, Math.min(7, dias2.length - 1));
    const ritmo  = Math.max(0, (ult.dias - atras.dias) / pasos);
    const ritmoGdd = Math.max(0, (ult.gdd - atras.gdd) / pasos);

    return {
      desde: plant, hasta: ultima,
      // OJO: `gddAcum` es el calor al FINAL DE LA SERIE, y la serie normalmente
      // trae pronóstico — 16 días de futuro. Para saber cuánto calor lleva el
      // cultivo HOY hay que pedir `gddEn(hoy)`, no leer esto.
      //
      // No es teoría: el 8-sep-2026, el tomate de Ferran salía en producción con
      // 1823 °C·día sobre un objetivo de 1749, o sea "lista", cuando lo acumulado
      // de verdad eran 1653 y le faltaban seis días. La ventana de madurez se
      // adelantaba justo lo que durase el pronóstico.
      gddAcum: ult.gdd, gddObjetivo: gddDelCiclo(cultivoId),
      tbase: g.tbase,
      // Calor acumulado a una fecha concreta. Misma partición que diaDe: antes de
      // plantar 0, más allá de la serie se extrapola al ritmo reciente, y un
      // hueco en medio devuelve null para que decida quien llama.
      gddEn(fechaISO) {
        const hit = mapa.get(fechaISO);
        if (hit) return hit.gdd;
        if (fechaISO < plant) return 0;
        if (fechaISO > ultima) {
          const n = Math.round((new Date(`${fechaISO}T12:00:00`) - new Date(`${ultima}T12:00:00`)) / 86400000);
          return ult.gdd + ritmoGdd * n;
        }
        return null;
      },
      diaDe(fechaISO) {
        const hit = mapa.get(fechaISO);
        if (hit) return hit.dias;
        if (fechaISO < plant) return 0;
        if (fechaISO > ultima) {
          const n = Math.round((new Date(`${fechaISO}T12:00:00`) - new Date(`${ultima}T12:00:00`)) / 86400000);
          return ult.dias + ritmo * n;
        }
        return null;   // hueco en medio de la serie: que decida quien llama
      },
    };
  }

  // Ventana de MADUREZ — no de cosecha. Kylia no sabe cuándo va a cortar el
  // agricultor: eso lo deciden el precio de la semana, el comprador y si tiene
  // gente. Lo que sí puede decir es a partir de cuándo el cultivo está hecho.
  //
  //   gddAcum:     calor acumulado hasta hoy (de curvaFenologica)
  //   pronostico:  [{date, tmax, tmin}] de los próximos días (real, ~16 d)
  //   normales:    {1..12: {tmax, tmin}} medias mensuales del sitio, para el
  //                horizonte largo (un tomate a 100 días no tiene pronóstico)
  //
  // La ANCHURA de la ventana no es un adorno, y sus dos términos tienen fuente:
  //   · 4 días fijos     → error del propio modelo. Los dos ciclos validados
  //                        fallaron 3 y 6 días, y ese error no se encoge porque
  //                        falte menos: sigue ahí el día antes de cosechar.
  //   · 8% de lo que falta → el calor que aún no ha caído. El P10-P90 interanual
  //                        del calor del ciclo, medido sobre 21 años, es ±7-8%.
  // Una fecha sola sería una promesa que no se puede cumplir; una ventana es un
  // dato con el que se puede planificar.
  function ventanaMadurez(cultivoId, opts = {}) {
    const { gddAcum = null, desdeISO = null, pronostico = [], normales = null } = opts;
    const objetivo = gddDelCiclo(cultivoId);
    const g = FAO_GDD[cultivoId];
    if (!g || objetivo == null || gddAcum == null) return null;

    // Ojo: sin desdeISO esto toma el día UTC, que a partir de las 22:00 en España
    // ya es "mañana". Quien llama debería pasar su día; se deja el aviso aquí.
    const hoy = desdeISO || new Date().toISOString().slice(0, 10);
    if (gddAcum >= objetivo) {
      return { estado: "lista", desde: hoy, probable: hoy, hasta: hoy, dias_restantes: 0,
               gdd_acum: Math.round(gddAcum), gdd_objetivo: objetivo, fraccion: 1, metodo: "termico" };
    }

    const prev = new Map((pronostico || []).filter(d => d && d.date).map(d => [d.date, d]));
    // UTC de punta a punta. Construir la fecha en hora LOCAL y luego imprimirla
    // con toISOString() (que es UTC) desplaza el día en los husos por encima de
    // UTC+12: en Kiritimati la ventana de madurez salía dos días antes. En
    // España no se nota —UTC+1/+2, el mediodía local sigue siendo el mismo día
    // en UTC— pero esto corre EN EL NAVEGADOR del agricultor, y una fecha no
    // puede depender de dónde esté mirando.
    const sumar = (f, n) => {
      const d = new Date(`${f}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };

    let acum = gddAcum, fecha = hoy, n = 0, usadoPronostico = 0;
    while (acum < objetivo && n < 400) {
      fecha = sumar(hoy, ++n);
      const p = prev.get(fecha);
      let dg = p ? gradosDia(p.tmax, p.tmin, g.tbase) : null;
      if (dg != null) usadoPronostico++;
      else if (normales) {
        const m = normales[Number(fecha.slice(5, 7))];
        dg = m ? gradosDia(m.tmax, m.tmin, g.tbase) : null;
      }
      if (dg == null) return null;         // sin forma de proyectar, no se inventa
      acum += dg;
    }
    if (acum < objetivo) return null;

    const medio = 4 + Math.round(n * 0.08);
    return {
      estado: "en_curso",
      desde:    sumar(fecha, -medio),
      probable: fecha,
      hasta:    sumar(fecha,  medio),
      dias_restantes: n,
      gdd_acum: Math.round(gddAcum), gdd_objetivo: objetivo,
      fraccion: Math.min(1, gddAcum / objetivo),
      metodo: usadoPronostico >= n ? "pronostico" : (usadoPronostico > 0 ? "pronostico+normales" : "normales"),
    };
  }

  // Medias mensuales de Tmax/Tmin a partir de una serie histórica diaria. Es lo
  // que alimenta el horizonte largo de ventanaMadurez cuando el pronóstico se
  // acaba. Puro: la descarga la hace quien llame.
  function normalesMensuales(serie) {
    const acc = {};
    for (const d of serie || []) {
      if (!d || !d.date) continue;
      const m = Number(d.date.slice(5, 7));
      const a = Number(d.tmax), b = Number(d.tmin);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      (acc[m] = acc[m] || { tmax: 0, tmin: 0, n: 0 });
      acc[m].tmax += a; acc[m].tmin += b; acc[m].n++;
    }
    const out = {};
    for (const [m, v] of Object.entries(acc)) {
      if (!v.n) continue;
      out[Number(m)] = { tmax: Math.round((v.tmax / v.n) * 10) / 10, tmin: Math.round((v.tmin / v.n) * 10) / 10 };
    }
    return Object.keys(out).length ? out : null;
  }

  // Agua total (TAW) y fácilmente disponible (RAW), en mm, según textura, cultivo
  // y día del ciclo (la raíz crece → el depósito crece). Compatible hacia atrás:
  // sin cultivo/día usa los fallbacks fijos (ZR_M, P_AGOTAMIENTO).
  //
  // `etcMmDia` (opcional) activa el AJUSTE DE p POR DEMANDA EVAPORATIVA. La nota
  // al pie de la Tabla 22 de FAO-56 dice que sus valores de p valen para
  // ETc ≈ 5 mm/día y que hay que corregirlos:
  //
  //     p_adj = p_tabla + 0,04 × (5 − ETc)      acotado a [0,1 ; 0,8]
  //
  // La física: con mucha demanda evaporativa el suelo no consigue entregar a la
  // raíz el caudal que la planta pide aunque le quede agua, así que el cultivo
  // sufre ANTES (p baja). Con poca demanda aguanta más seco (p sube).
  // Hasta el 30-jul Kylia usaba p constante, que es justo el modo NO por defecto
  // de pyfao56 —nuestra referencia de validación, que aplica esta corrección de
  // serie (`model.py`: io.p = sorted([0.1, io.pbase+0.04*(5.0-io.ETc), 0.8])[1])—.
  // Ojo: p NO entra en la recursión del agotamiento, solo mueve el UMBRAL (RAW).
  function aguaSuelo(suelo, cultivoId = null, dias = null, etcMmDia = null) {
    // Un suelo que no está en la tabla cae a franco, que es el término medio —
    // pero se DICE, para que un "Franco" con mayúscula o un typo no se convierta
    // en una suposición invisible: el AWC va de 0,08 a 0,16, casi el doble.
    const reconocido = Object.prototype.hasOwnProperty.call(SUELO_AWC, suelo);
    const awc = reconocido ? SUELO_AWC[suelo] : SUELO_AWC_DEFAULT;
    const zr  = zrDelDia(cultivoId, dias);
    let p     = FAO_KC[cultivoId]?.p ?? P_AGOTAMIENTO;
    if (finito(etcMmDia)) {
      p = Math.min(0.8, Math.max(0.1, p + 0.04 * (5 - Number(etcMmDia))));
    }
    // Red de seguridad: si algo de lo anterior se fuera a NaN, aquí se para. Un
    // TAW no finito convierte el balance en NaN y la decisión en una mentira.
    const zrOk = Number.isFinite(zr) && zr > 0 ? zr : ZR_M;
    const pOk  = Number.isFinite(p) && p > 0 ? p : P_AGOTAMIENTO;
    const taw = 1000 * awc * zrOk;
    return { taw, raw: pOk * taw, awc, p: pOk, sueloReconocido: reconocido };
  }

  // ── Saneado de la entrada ─────────────────────────────────────────
  // UN SOLO SITIO, y a propósito. Hasta el 11-sep cada rama se defendía sola —
  // o no se defendía— y el motor tragaba cosas que producían decisiones
  // silenciosamente falsas. Las tres que más dolían, todas reproducidas:
  //
  //   · litros = NaN o texto  → Dr = NaN, y decisionRiego responde
  //     "Todo en orden · déficit NaN mm". Con el balance corrupto, Kylia
  //     TRANQUILIZA. Es el peor modo de fallo posible.
  //   · litros negativos      → Dr sube: un riego SECA el suelo (32,2 → 50,2).
  //   · et0 = null            → contaba como 0, o sea un día en el que el
  //     cultivo no gastó agua (32,2 → 18,4 con tres días sin dato). Es el mismo
  //     defecto que costó dos informes de piloto publicados mal, pero aquí
  //     dentro, donde lo hereda cualquiera que llame al motor.
  //
  // La regla: UN DATO QUE FALTA NO ES UN CERO. El día sin ET₀ se descarta —no
  // hay demanda que calcular— y lo que no es un número finito no entra.

  function sanearSerie(serie) {
    // Dedupe por fecha: una serie con el mismo día repetido contaba su ETc dos
    // veces (32,2 → 34,3 con un día triplicado). Manda la última aparición, que
    // es la lectura más fresca cuando se mezclan archivo y pronóstico.
    const porFecha = new Map();
    for (const d of serie || []) {
      if (!d || typeof d.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
      if (!finito(d.et0)) continue;                 // sin ET₀ no hay día que calcular
      const et0 = Math.max(0, Number(d.et0));       // una ET₀ negativa no existe
      const ll  = finito(d.lluvia) ? Math.max(0, Number(d.lluvia)) : 0;
      porFecha.set(d.date, { ...d, et0, lluvia: ll });
    }
    return [...porFecha.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  // Cuántos días FALTAN entre el primero y el último de la serie.
  //
  // Esto importa más de lo que parece, y se descubrió auditando el propio
  // arreglo de arriba: descartar un día sin ET₀ y contarlo como cero dan EL
  // MISMO déficit — en los dos casos el cultivo no gasta agua ese día. O sea que
  // sanear la entrada no arregla el problema de fondo, solo deja de tragar
  // basura. Lo único que lo arregla es DECIR que la serie está incompleta, para
  // que quien publique un número sepa sobre cuánto clima real se ha calculado.
  //
  // Es exactamente lo que faltaba el 11-sep: dos informes de piloto salieron con
  // el 39% y el 29% de su campaña sin clima, y nada en el resultado lo decía.
  //
  // ⚠️ Y LA VENTANA SE PASA DESDE FUERA, o esto no sirve para nada. La primera
  // versión medía la serie contra SÍ MISMA: primer día a último día. Con eso,
  // los huecos del principio y del final son INVISIBLES — al descartar los días
  // sin dato la serie simplemente empieza más tarde y no queda agujero que
  // contar.
  //
  // Y ese es justo el caso real: en el reveal de Ferran los 29 días sin ET₀ eran
  // los MÁS ANTIGUOS (la API de pronóstico solo guarda ~64 días de pasado), así
  // que la cobertura calculada contra sí misma daba 1,000 y la guarda no habría
  // parado nada. Lo comprobé reproduciendo el caso: publicable=true, ahorro
  // publicado, exactamente el fallo que la guarda venía a impedir.
  //
  // Quien llama SÍ sabe qué ventana esperaba cubrir (plantación → corte). Se la
  // pasa, y entonces la cobertura mide lo que tiene que medir.
  function huecosDeSerie(orden, ventana = null) {
    const d0 = ventana?.desde && /^\d{4}-\d{2}-\d{2}$/.test(ventana.desde)
      ? (orden.length && orden[0].date < ventana.desde ? orden[0].date : ventana.desde)
      : (orden.length ? orden[0].date : null);
    const d1 = ventana?.hasta && /^\d{4}-\d{2}-\d{2}$/.test(ventana.hasta)
      ? (orden.length && orden[orden.length - 1].date > ventana.hasta ? orden[orden.length - 1].date : ventana.hasta)
      : (orden.length ? orden[orden.length - 1].date : null);
    if (!d0 || !d1) return { dias: orden.length, faltan: 0, cobertura: orden.length ? 1 : 0 };
    const esperados = Math.round(
      (new Date(`${d1}T12:00:00Z`) - new Date(`${d0}T12:00:00Z`)) / 86400000) + 1;
    if (!Number.isFinite(esperados) || esperados <= 0) {
      return { dias: orden.length, faltan: 0, cobertura: orden.length ? 1 : 0 };
    }
    const faltan = Math.max(0, esperados - orden.length);
    return { dias: orden.length, faltan, cobertura: Math.min(1, orden.length / esperados) };
  }

  // Riegos: fecha válida y lámina finita y NO negativa. Un `litros` nulo sigue
  // significando "regó y no sabemos cuánto" (recarga completa), que es distinto
  // de un dato roto.
  function sanearRiegos(riegos) {
    const out = [];
    for (const r of riegos || []) {
      if (!r || typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
      if (r.litros == null) { out.push({ date: r.date, litros: null }); continue; }
      if (!finito(r.litros)) continue;              // NaN, Infinity, "mucha"…
      const l = Number(r.litros);
      if (l < 0) continue;                          // un riego no puede restar agua
      out.push({ ...r, litros: l });
    }
    return out;
  }

  // Días entre una fecha y otra. Devuelve null —no NaN— cuando la fecha no es
  // una fecha, porque un NaN aquí se propaga a TODO: zrDelDia(NaN) da zr NaN,
  // aguaSuelo da TAW y RAW NaN, y el balance entero sale NaN. En la ronda
  // adversarial eso pasaba en el 7,4% de los escenarios.
  //
  // Y acepta un timestamp completo, no solo YYYY-MM-DD: "2026-05-01T00:00:00Z"
  // daba NaN porque se le pegaba un segundo "T12:00:00" detrás. Eso no es un
  // caso rebuscado — es lo que llega si una columna de fecha vuelve como
  // timestamp.
  // ── Coeficiente de estrés hídrico Ks (FAO-56 ec. 84) ──────────────
  // Hasta la auditoría del 11-sep el motor calculaba ETc = Kc · ET₀ SIEMPRE,
  // también con el suelo agotado. Eso es físicamente imposible: una planta con
  // el depósito vacío no transpira a pleno ritmo, cierra estomas.
  //
  // Lo medido sobre un tomate en franco regado 10 mm cada 7 días (90 días):
  //     ETc sin Ks   416 mm        ETc con Ks   200 mm       −52%
  //
  // Y ese número NO se queda dentro: la app le dice al agricultor "el cultivo ha
  // consumido unos X mm". Se le estaba enseñando el doble de lo que su cultivo
  // pudo consumir.
  //
  //     Ks = (TAW − Dr) / (TAW − RAW)      acotado a [0, 1]
  //
  // Por encima de RAW el suelo no entrega el caudal que la planta pide y la
  // transpiración cae linealmente hasta 0 en el punto de marchitez (Dr = TAW).
  // POR DEBAJO DE RAW, Ks = 1 y NADA cambia — que es la condición en la que se
  // validó el motor contra pyfao56 (ETc RMSE 0.000), así que esa validación
  // sigue en pie tal cual.
  function ksEstres(Dr, taw, raw) {
    if (!(taw > raw) || !finito(Dr)) return 1;
    if (Dr <= raw) return 1;
    return Math.max(0, Math.min(1, (taw - Dr) / (taw - raw)));
  }

  function diasEntre(fechaIso, hasta) {
    if (!fechaIso) return null;
    const f = String(fechaIso).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return null;
    const desde = new Date(`${f}T12:00:00`);
    if (Number.isNaN(desde.getTime()) || Number.isNaN(new Date(hasta).getTime())) return null;
    return Math.round((hasta - desde) / 86400000);
  }

  // Balance hídrico FAO-56 sobre una serie diaria. Réplica del bucle del frontend:
  // recarga por riego neto (litros × eficiencia), ETc = Kc×ET₀, resta lluvia
  // efectiva, acota Dr a [0, TAW].
  //   serie:   [{date:'YYYY-MM-DD', et0:Number, lluvia:Number}]  (ordenada o no)
  //   riegos:  [{date:'YYYY-MM-DD', litros:Number|null}]          (null = recarga completa)
  //   opts:    { suelo, cultivoId, metodoRiego, fechaPlantacion }
  // Devuelve { Dr, taw, raw, efic, kcActual, etcAcum, et0Acum, lluviaAcum, sinFenologia }.
  function balanceHidrico(serie, riegos, opts = {}) {
    const { suelo, cultivoId = null, metodoRiego, fechaPlantacion = null,
            serieTermica = null, termico = true, ventana = null } = opts;
    const efic = EFIC_RIEGO[metodoRiego] ?? EFIC_DEFAULT;
    // Reloj del cultivo: calor si se puede, calendario si no. curvaFenologica
    // devuelve null en cuanto falta algo, y entonces esto se comporta EXACTAMENTE
    // como antes del 8-sep-2026 — la validación contra pyfao56 sigue en pie.
    const curva = termico ? curvaFenologica(cultivoId, serieTermica || serie, fechaPlantacion) : null;
    const diaFen = (fecha, caeEn) => {
      const t = curva ? curva.diaDe(fecha) : null;
      return t == null ? diasEntre(fechaPlantacion, caeEn) : t;
    };

    // fecha → mm netos del día, o null = "regó y no sabemos cuánto" (recarga
    // completa). Un null MANDA sobre las cantidades del mismo día, se lea el array
    // en el orden que se lea: antes esto dependía del orden (un null detrás de un
    // riego cuantificado borraba sus mm y el día pasaba a recarga completa; delante,
    // se perdía el null). Silencioso y no reproducible; ahora es determinista.
    const riegoNeto = {};
    sanearRiegos(riegos).forEach(r => {
      if (r.litros == null)          { riegoNeto[r.date] = null; return; }
      if (riegoNeto[r.date] === null) return;                    // ya hay un null ese día
      riegoNeto[r.date] = (riegoNeto[r.date] || 0) + r.litros * efic;
    });

    const orden = sanearSerie(serie);
    let Dr = 0, etcAcum = 0, et0Acum = 0, lluviaAcum = 0, lluviaUtilAcum = 0, diasEstres = 0;
    let taw = aguaSuelo(suelo).taw, raw = aguaSuelo(suelo).raw;
    for (const dia of orden) {
      const dias = diaFen(dia.date, new Date(`${dia.date}T12:00:00`));
      // ETc primero: el umbral (RAW) depende de ella por el ajuste de p.
      const kc  = kcDelDia(cultivoId, dias);
      const etcPot = kc * dia.et0;            // ya saneado: siempre número ≥ 0
      ({ taw, raw } = aguaSuelo(suelo, cultivoId, dias, etcPot));  // raíz creciente + p por ETc
      // Estrés: con el suelo por debajo del umbral la planta no transpira todo
      // lo que pide la atmósfera. Ks vale 1 mientras esté bien regada.
      const ks  = ksEstres(Dr, taw, raw);
      const etc = etcPot * ks;
      if (ks < 1) diasEstres++;
      if (dia.date in riegoNeto) {
        const r = riegoNeto[dia.date];
        Dr = r === null ? 0 : Math.max(0, Dr - r);
      }
      const pe = dia.lluvia >= PE_MIN_MM ? dia.lluvia : 0;   // lluvia efectiva
      // De la lluvia que infiltra, solo se QUEDA la que cabe en el déficit: el
      // resto percola por debajo de la raíz. Contar los 180 mm de una tormenta
      // como agua aprovechada sobre un suelo de 86 mm de capacidad es falso, y
      // ese número sale en los informes.
      const lluviaUtil = Math.min(pe, Math.max(0, Dr + etc));
      Dr = Math.min(taw, Math.max(0, Dr + etc - pe));
      etcAcum += etc; et0Acum += dia.et0; lluviaAcum += pe; lluviaUtilAcum += lluviaUtil;
    }

    const ultimaISO = orden.length ? orden[orden.length - 1].date : new Date().toISOString().slice(0, 10);
    const ultima    = new Date(`${ultimaISO}T12:00:00`);
    const diasFin   = diaFen(ultimaISO, ultima);
    // Plantación POSTERIOR al último día del balance: todavía no hay cultivo en
    // la tierra. Antes se devolvía un balance normal con kc de fase inicial, o
    // sea que Kylia podía mandar regar un campo sin plantar. Se dice lo que hay.
    const sinPlantar = diasFin != null && diasFin < 0;
    // ── ¿El ciclo ya ha terminado? ──────────────────────────────────
    // El balance no sabe de cosechas: sigue acumulando déficit sobre tierra
    // vacía. Una lechuga a 120 días (ciclo ~75) salía con Kc 0,95 y "regar hoy".
    // Ya pasó en producción —el campo de 440 m² recibía órdenes de riego un mes
    // después de arrancarlo— y se parcheó en la vista de hoy con fecha_cosecha.
    // Pero ese parche solo protege a UN consumidor, y la fecha de cosecha casi
    // nunca está puesta: nadie la rellena hasta que cosecha.
    //
    // El motor no puede decidir si hay que dejar de regar —eso depende de si el
    // agricultor ha arrancado el cultivo o no, y de eso no sabe nada— pero sí
    // puede DECIR que el ciclo está cumplido, para que quien enseñe el aviso lo
    // tenga en cuenta en vez de descubrirlo por su cuenta.
    const cicloDias = FAO_KC[cultivoId] ? FAO_KC[cultivoId].L.reduce((a, b) => a + b, 0) : null;
    const cicloCompletado = cicloDias != null && diasFin != null && diasFin >= cicloDias;
    const cob = huecosDeSerie(orden, ventana);
    return {
      Dr: sinPlantar ? 0 : Dr, taw, raw, efic, sinPlantar,
      cicloCompletado,
      // Cuánto se ha pasado del ciclo. A los pocos días no significa nada (las
      // longitudes de FAO son orientativas); a los 45 significa que ahí ya no
      // hay cultivo que regar.
      diasTrasCiclo: cicloCompletado ? Math.round(diasFin - cicloDias) : 0,
      // Sobre cuánto clima REAL se ha calculado esto. Un balance con cobertura
      // 0,61 no es un balance del que se pueda publicar un ahorro.
      diasSerie: cob.dias, diasSinClima: cob.faltan,
      coberturaClima: Math.round(cob.cobertura * 1000) / 1000,
      // Y los extremos: huecosDeSerie solo ve los agujeros de EN MEDIO — si
      // faltan los últimos días, el tramo simplemente se encoge y no hay nada
      // que contar. El que llama sí sabe hasta cuándo esperaba tener clima, así
      // que se le dan las fechas para que lo compruebe.
      desdeSerie: orden.length ? orden[0].date : null,
      hastaSerie: ultimaISO,
      kcActual: kcDelDia(cultivoId, diasFin),
      etcAcum, et0Acum, lluviaAcum,
      // La que de verdad se quedó en la zona radicular; el resto percoló.
      lluviaUtilAcum: Math.round(lluviaUtilAcum * 10) / 10,
      // Días en los que el cultivo transpiró por debajo de su potencial.
      diasEstres,
      sinFenologia: !fechaPlantacion,
      // Trazabilidad: en qué reloj se ha calculado todo esto.
      modoFenologia: curva ? "termico" : "calendario",
      diasFenologicos: diasFin == null ? null : Math.round(diasFin * 10) / 10,
      // Al último día DEL BALANCE, no al final de la serie térmica: esa suele
      // llevar pronóstico y sumaría calor que todavía no ha caído.
      gddAcum: curva ? Math.round(curva.gddEn(ultimaISO) ?? curva.gddAcum) : null,
      // Un cultivo por debajo de su Tbase no acumula NADA y se queda en el día 0
      // del eje para siempre: un tomate (Tbase 10 °C) plantado en diciembre sale
      // eternamente "recién plantado", con Kc de fase inicial. El modelo térmico
      // está haciendo lo correcto —ese cultivo no se desarrolla— pero decir
      // "modo térmico" y callar que el contador está parado engaña. Se declara.
      sinAcumularCalor: !!curva && (curva.gddEn(ultimaISO) ?? curva.gddAcum) <= 0 && orden.length >= 14,
      faseActual: faseDelDia(cultivoId, diasFin),
    };
  }

  // Regla de decisión de la card-hoy (idéntica al frontend / motor-de-decision.md §3.2d).
  //   Dr ≥ RAW        → regar (alta), cantidad bruta = Dr/eficiencia
  //   0.75·RAW ≤ Dr   → vigilar (media)
  //   Dr < 0.75·RAW   → todo en orden (baja)
  function decisionRiego(bal, opts = {}) {
    const { Dr, raw, taw, efic } = bal || {};
    // NO SE DECIDE SOBRE UN BALANCE ROTO. Con Dr = NaN, `NaN >= raw` es false y
    // se caía por las dos ramas hasta "Todo en orden · déficit NaN mm": el peor
    // modo de fallo imaginable, porque TRANQUILIZA con los datos corrompidos.
    // Ahora se dice que no se sabe, que es lo único honesto.
    if (![Dr, raw, taw, efic].every(x => Number.isFinite(Number(x))) || raw <= 0 || efic <= 0) {
      return { nivel: "desconocido", cantidad_l_m2: null,
               texto: "No se puede calcular el riego: faltan datos del balance." };
    }
    const r0 = (x) => Math.round(x);

    // Lluvia efectiva PREVISTA en la ventana corta. Mismo criterio que el balance
    // (por debajo de PE_MIN_MM no infiltra), aplicado día a día.
    //
    // Por qué 48 h y no la semana: la regla actual llena el depósito hasta arriba
    // y, si mañana llueve, el sobrante se pierde por debajo de la raíz llevándose
    // nitrógeno (se ve en el propio balance: Dr = min(taw, …) recorta el exceso).
    // Mirar adelante lo evita. Pero el error es ASIMÉTRICO: retrasar un riego por
    // una lluvia que no cae se corrige mañana; regar de menos en agosto con el
    // suelo en el umbral, no. Y la tormenta de verano a 4-5 días es justo la peor
    // previsión que da un modelo. De ahí la ventana corta y las dos guardas de
    // abajo. No se usa la ET₀ prevista para regar de MÁS: eso sería adelantar
    // agua sobre un pronóstico, y FAO-56 ya lo recoge el día que el calor llega.
    // TOPE DE CORDURA. Sin él, un valor corrupto en el pronóstico cancelaba el
    // riego: con lluvia = 1.000.000 la app decía "esperar a la lluvia · se
    // prevén 1000000 mm en 48 h". El récord diario de España anda por 800 mm, y
    // por encima de 200 en 48 h el dato es basura, no un temporal. Un dato
    // absurdo se descarta; no se deja que decida.
    const LLUVIA_MAX_DIA_MM = 200;
    const prevista = (opts.lluviaPrevista || [])
      .slice(0, VENTANA_PRONOSTICO_DIAS)
      .reduce((s, d) => {
        const v = Number(d && d.lluvia);
        if (!Number.isFinite(v) || v < 0 || v > LLUVIA_MAX_DIA_MM) return s;
        return s + (v >= PE_MIN_MM ? v : 0);
      }, 0);

    if (Dr >= raw) {
      // Guarda: con el suelo casi vacío no se apuesta a un pronóstico. Ahí el
      // coste de equivocarse es el cultivo, no unos litros.
      const puedeFiarse = prevista > 0 && Dr < 0.9 * taw;

      if (puedeFiarse && prevista >= Dr) {
        return {
          nivel: "media", cantidad_l_m2: null, lluvia_prevista_mm: Math.round(prevista * 10) / 10,
          texto: `Esperar a la lluvia · se prevén ${r0(prevista)} mm en 48 h y cubren el déficit de ${r0(Dr)} mm`,
        };
      }

      const neto  = puedeFiarse ? Dr - prevista : Dr;

      // "Regar hoy ~0 L/m²" es una orden absurda, y salía sola: cuando la lluvia
      // prevista casi cubre el déficit, lo que queda por regar se redondea a
      // cero y la app mandaba abrir el riego para echar nada. Por debajo de
      // PE_MIN_MM —el mismo umbral con el que el motor decide que una lluvia no
      // llega a infiltrar— no hay riego que dar: es esperar a la lluvia.
      if (neto < PE_MIN_MM) {
        return {
          nivel: "media", cantidad_l_m2: null, lluvia_prevista_mm: Math.round(prevista * 10) / 10,
          texto: `Esperar a la lluvia · se prevén ${r0(prevista)} mm en 48 h y el déficit es de ${r0(Dr)} mm`,
        };
      }

      const bruto = Math.round((neto / efic) * 10) / 10;
      return {
        nivel: "alta",
        cantidad_l_m2: bruto,
        lluvia_prevista_mm: puedeFiarse ? Math.round(prevista * 10) / 10 : 0,
        texto: puedeFiarse
          ? `Regar hoy ~${r0(bruto)} L/m² · déficit ${r0(Dr)} mm − ${r0(prevista)} mm de lluvia prevista`
          : `Regar hoy ~${r0(bruto)} L/m² · déficit ${r0(Dr)} mm ≥ umbral ${r0(raw)}`,
      };
    }
    if (Dr >= 0.75 * raw) {
      return { nivel: "media", cantidad_l_m2: null,
               texto: `Vigilar el riego · déficit ${r0(Dr)} mm, cerca del umbral ${r0(raw)}` };
    }
    return { nivel: "baja", cantidad_l_m2: null,
             texto: `Todo en orden · déficit ${r0(Dr)} mm < umbral ${r0(raw)}` };
  }

  // Convierte la lámina BRUTA (mm = L/m²) a la unidad del sistema del agricultor.
  //   regadera → nº de regaderas (= mm × área ÷ capacidad) + litros totales
  //   goteo/aspersión/manguera → minutos (= mm ÷ caudal mm/h × 60)
  //   surco / sin datos → L/m² (no hay modelo de caudal fiable)
  // Siempre devuelve también `mm` para trazabilidad (todo el motor habla en mm).
  function presentarRiego(mmBruto, opts = {}) {
    const { metodoRiego, caudalMmh, areaM2, capacidadRegaderaL } = opts;
    // `Number(Infinity) || 0` es Infinity, así que esto salía en pantalla como
    // "Infinity min · mejor en Infinity tandas de NaN min". Y un caudal
    // minúsculo daba "600000000000 min en 5000000000 tandas", que es finito
    // pero igual de inservible.
    const bruto = Number(mmBruto);
    const mm = Number.isFinite(bruto) ? Math.max(0, bruto) : 0;
    const r0 = (x) => Math.round(x);
    const r1 = (x) => Math.round(x * 10) / 10;

    if (metodoRiego === "regadera") {
      if (areaM2 > 0 && capacidadRegaderaL > 0) {
        const litros = mm * areaM2;                       // L para todo el bancal
        const n = litros / capacidadRegaderaL;
        const nTxt = n >= 10 ? r0(n) : r1(n);
        return { unidad: "regaderas", valor: nTxt, mm: r1(mm),
                 litrosTotales: r0(litros),
                 texto: `${nTxt} regadera${nTxt === 1 ? "" : "s"} (${r0(litros)} L)` };
      }
      return { unidad: "l_m2", valor: r0(mm), mm: r1(mm), texto: `${r0(mm)} L/m²` };
    }

    const caudalDado = Number(caudalMmh);
    // Por debajo de 0,1 mm/h no hay instalación de riego, hay un error de
    // tecleo: con 1e-9 salían 600.000 millones de minutos.
    const caudalEstimado = !(Number.isFinite(caudalDado) && caudalDado >= 0.1);
    const caudal = caudalEstimado ? CAUDAL_DEFAULT_MMH[metodoRiego] : caudalDado;
    if (caudal > 0) {
      const min = (mm / caudal) * 60;
      if (!Number.isFinite(min)) return { unidad: "l_m2", valor: r0(mm), mm: r1(mm), texto: `${r0(mm)} L/m²` };
      // Tope PRÁCTICO de sesión, no agronómico: cuando el déficit se ha acumulado
      // (o el caudal es bajo) la lámina bruta sale en sesiones de horas — el bancal
      // de las 33, con 5,4 mm/h, pidió 331 min de una tacada el 28-jul. Un
      // agricultor no está 5 h con el aspersor puesto, así que la orden se ignora
      // entera y el déficit sigue creciendo. Partirla en tandas de ≤2 h la hace
      // ejecutable y, de paso, le da al suelo tiempo de infiltrar. Los mm y la
      // decisión NO cambian: es la misma agua, presentada de forma realizable.
      if (min > RIEGO_MAX_MIN) {
        const sesiones = Math.ceil(min / RIEGO_MAX_MIN);
        const porSesion = Math.round(min / sesiones);
        // Partir en tandas hace ejecutable una orden larga. Pero a partir de
        // cierto número deja de serlo otra vez: "38 tandas de 118 min" son 75
        // horas de riego y es tan inútil como los 4.500 minutos que venía a
        // arreglar. Cuando hace falta más de un día entero de riego, el problema
        // no es el riego de hoy — es que la instalación no da para ese cultivo,
        // y eso es lo que hay que decirle.
        if (sesiones > SESIONES_MAX) {
          // OJO CON CULPAR A LA INSTALACIÓN. Si el caudal no lo ha declarado él,
          // el que estamos usando es el POR DEFECTO de la tabla —4 mm/h en
          // goteo— y decirle "tu instalación no da" sería un diagnóstico sacado
          // de un número que nos hemos inventado nosotros. Con un caudal
          // estimado, lo que toca es pedirle que lo mida: son diez minutos y
          // cambia esta cuenta entera.
          return { unidad: "min", valor: r0(min), mm: r1(mm),
                   fraccionar: { sesiones, min_por_sesion: porSesion },
                   caudalInsuficiente: !caudalEstimado,
                   caudalEstimado,
                   texto: caudalEstimado
                     ? `Salen ${r0(min / 60)} h de riego, y eso es mucho. Estamos suponiendo `
                       + `${caudal} L/m²·h porque no sabemos el tuyo: mídelo y esta cuenta cambia.`
                     : `Harían falta ${r0(min / 60)} h de riego: tu instalación no da para reponer `
                       + `${r0(mm)} L/m² de una vez. Riega lo que puedas hoy y sigue mañana.` };
        }
        return { unidad: "min", valor: r0(min), mm: r1(mm),
                 fraccionar: { sesiones, min_por_sesion: porSesion },
                 texto: `${r0(min)} min · mejor en ${sesiones} tandas de ${porSesion} min` };
      }
      return { unidad: "min", valor: r0(min), mm: r1(mm), texto: `${r0(min)} min` };
    }
    return { unidad: "l_m2", valor: r0(mm), mm: r1(mm), texto: `${r0(mm)} L/m²` };
  }

  // Lámina (mm = L/m²) de un riego YA REGISTRADO — la inversa de presentarRiego.
  // La DURACIÓN es la fuente de verdad: si el riego se apuntó por tiempo
  // (aspersión/goteo) y conocemos el caudal, lámina = duración(min) × caudal / 60.
  // Así todo lo que consume riegos (lista, balance FAO-56, comparativa, Diario B)
  // sigue al caudal ACTUAL y no se queda clavado en el que hubiera el día del
  // riego: los caudales se afinan (truco del vaso, geometría real de la malla) y
  // el `cantidad_l_m2` que se guardó entonces se desfasa. Sin duración o sin
  // caudal (p. ej. regadera por cubos) → la lámina guardada tal cual.
  function laminaRiego(cantidadGuardada, duracionMin, caudalMmh) {
    const caudal = Number(caudalMmh), min = Number(duracionMin);
    // `duracionMin > 0`, no `!= null`. Con `!= null`, una duración de 0 —que es
    // lo que llega de la base de datos cuando el campo existe pero nadie lo
    // rellenó— devolvía 0 mm y BORRABA del balance un riego que sí tenía su
    // cantidad apuntada. Y una duración negativa devolvía una lámina negativa,
    // que aguas abajo secaba el suelo. Ninguna de las dos es una duración.
    if (Number.isFinite(min) && min > 0 && caudal > 0) {
      return Math.round((caudal * min / 60) * 10) / 10;
    }
    // Y aquí otra vez el mismo agujero que vigila gradosDia: Number(null) es 0,
    // así que un riego SIN cantidad habría devuelto 0 mm en vez de null —
    // "regó y no sabemos cuánto" convertido en "no echó nada".
    if (cantidadGuardada == null || cantidadGuardada === "") return null;
    const c = Number(cantidadGuardada);
    return Number.isFinite(c) ? c : null;
  }

  // Simula el manejo del riego "según Kylia" sobre una serie climática: cada día,
  // si el déficit acumulado alcanza el umbral RAW, riega la lámina BRUTA que
  // recomienda la regla (Dr/eficiencia) y repone el suelo; si no, no riega. Es la
  // rama contrafactual del campo del padre: "lo que habría hecho si hubiera
  // seguido a Kylia", para contrastarla con lo que aplicó de verdad.
  //   serie: [{date, et0, lluvia}]   opts: { suelo, cultivoId, metodoRiego, fechaPlantacion }
  // Devuelve { puntos:[{date, acum_l_m2}], total, taw, raw, efic } — todo BRUTO (L/m²),
  // para comparar manzanas con manzanas contra el agua realmente vertida (que también
  // es bruta: lo que sale del aspersor/regadera, antes de pérdidas).
  function simularKylia(serie, opts = {}) {
    const { suelo, cultivoId = null, metodoRiego, fechaPlantacion = null,
            serieTermica = null, termico = true, ventana = null } = opts;
    const efic = EFIC_RIEGO[metodoRiego] ?? EFIC_DEFAULT;
    const curva = termico ? curvaFenologica(cultivoId, serieTermica || serie, fechaPlantacion) : null;

    const orden = sanearSerie(serie);
    let Dr = 0, acum = 0;
    let taw = aguaSuelo(suelo).taw, raw = aguaSuelo(suelo).raw;
    const puntos = [];
    for (const dia of orden) {
      const tf   = curva ? curva.diaDe(dia.date) : null;
      const dias = tf == null ? diasEntre(fechaPlantacion, new Date(`${dia.date}T12:00:00`)) : tf;
      // ETc primero: el umbral (RAW) depende de ella por el ajuste de p.
      const kc  = kcDelDia(cultivoId, dias);
      const etcPot = kc * dia.et0;            // ya saneado
      ({ taw, raw } = aguaSuelo(suelo, cultivoId, dias, etcPot));  // raíz creciente + p por ETc
      // Mismo Ks que el balance. Aquí casi nunca actúa —Kylia riega antes de
      // llegar al estrés— y por eso el contrafactual apenas se mueve (−0,6% en
      // tomate, −6,9% en lechuga sobre arenoso). Va igualmente: los dos lados de
      // la comparación tienen que calcularse con la misma física.
      const etc = etcPot * ksEstres(Dr, taw, raw);
      // Decisión de la mañana: con el déficit que arrastra de ayer (misma regla que decisionRiego).
      if (Dr >= raw) { acum += Dr / efic; Dr = 0; }   // riego bruto = Dr/efic → repone Dr neto
      const pe = dia.lluvia >= PE_MIN_MM ? dia.lluvia : 0;   // lluvia efectiva
      Dr = Math.min(taw, Math.max(0, Dr + etc - pe));
      puntos.push({ date: dia.date, acum_l_m2: Math.round(acum * 10) / 10 });
    }
    // deficitFinal: agua que Kylia tenía "en cola" al corte (aún no regada porque
    // el depósito no llegó al umbral). Honestidad del reveal: comparar acumulados
    // a igual fecha favorece al que riega menos a menudo; este dato lo explicita.
    const cobS = huecosDeSerie(orden, ventana);
    return { puntos, total: Math.round(acum * 10) / 10, taw, raw, efic,
             desdeSerie: orden.length ? orden[0].date : null,
             hastaSerie: orden.length ? orden[orden.length - 1].date : null,
             diasSerie: cobS.dias, diasSinClima: cobS.faltan,
             coberturaClima: Math.round(cobS.cobertura * 1000) / 1000,
             modoFenologia: curva ? "termico" : "calendario",
             deficitFinal: Math.round((Dr / efic) * 10) / 10 };
  }

  return {
    FAO_KC, FAO_GDD, SUELO_AWC, ZR_M, P_AGOTAMIENTO, PE_MIN_MM, EFIC_RIEGO, EFIC_DEFAULT, CAUDAL_DEFAULT_MMH,
    VENTANA_PRONOSTICO_DIAS,
    kcDelDia, faseDelDia, zrDelDia, aguaSuelo, ksEstres, diasEntre, balanceHidrico, decisionRiego, presentarRiego, laminaRiego, simularKylia,
    sanearSerie, sanearRiegos, huecosDeSerie,
    gradosDia, gddDelCiclo, diasFenologicos, curvaFenologica, ventanaMadurez, normalesMensuales,
  };

});
