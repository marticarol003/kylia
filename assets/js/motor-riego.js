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
    // ficial. Adaptado a La Selva en pleno verano (plantada 24-jun): ciclo ~70 d
    // comprimido y adelantado por el calor, arranque corto por ir de plantel, kc
    // med subido a 1.05 por clima seco interior (RHmin~35%, FAO-56 ec. 70) y kc
    // ini a 0.75 por la aspersión frecuente que moja la superficie (más Es).
    cebolla:   { ini: 0.75, med: 1.05, fin: 1.00, L: [15, 25, 20, 10], zr: [0.20, 0.30], p: 0.30 },
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

  // Kc del día por interpolación lineal entre fases (inicial→desarrollo→media→final).
  function kcDelDia(cultivoId, diasDesdePlantacion) {
    const k = FAO_KC[cultivoId];
    if (!k || diasDesdePlantacion == null) return 1; // fallback: ETc = ET₀
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
    if (!k || dias == null) return null;
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
    if (!k || !k.zr || dias == null) return ZR_M;
    const diasCrec = k.L[0] + k.L[1];
    const f = Math.min(1, Math.max(0, dias) / diasCrec);
    return k.zr[0] + (k.zr[1] - k.zr[0]) * f;
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
    const awc = SUELO_AWC[suelo] ?? SUELO_AWC_DEFAULT;
    const zr  = zrDelDia(cultivoId, dias);
    let p     = FAO_KC[cultivoId]?.p ?? P_AGOTAMIENTO;
    if (etcMmDia != null && Number.isFinite(Number(etcMmDia))) {
      p = Math.min(0.8, Math.max(0.1, p + 0.04 * (5 - Number(etcMmDia))));
    }
    const taw = 1000 * awc * zr;
    return { taw, raw: p * taw, awc, p };
  }

  function diasEntre(fechaIso, hasta) {
    if (!fechaIso) return null;
    return Math.round((hasta - new Date(`${fechaIso}T12:00:00`)) / 86400000);
  }

  // Balance hídrico FAO-56 sobre una serie diaria. Réplica del bucle del frontend:
  // recarga por riego neto (litros × eficiencia), ETc = Kc×ET₀, resta lluvia
  // efectiva, acota Dr a [0, TAW].
  //   serie:   [{date:'YYYY-MM-DD', et0:Number, lluvia:Number}]  (ordenada o no)
  //   riegos:  [{date:'YYYY-MM-DD', litros:Number|null}]          (null = recarga completa)
  //   opts:    { suelo, cultivoId, metodoRiego, fechaPlantacion }
  // Devuelve { Dr, taw, raw, efic, kcActual, etcAcum, et0Acum, lluviaAcum, sinFenologia }.
  function balanceHidrico(serie, riegos, opts = {}) {
    const { suelo, cultivoId = null, metodoRiego, fechaPlantacion = null } = opts;
    const efic = EFIC_RIEGO[metodoRiego] ?? EFIC_DEFAULT;

    // fecha → mm netos del día, o null = "regó y no sabemos cuánto" (recarga
    // completa). Un null MANDA sobre las cantidades del mismo día, se lea el array
    // en el orden que se lea: antes esto dependía del orden (un null detrás de un
    // riego cuantificado borraba sus mm y el día pasaba a recarga completa; delante,
    // se perdía el null). Silencioso y no reproducible; ahora es determinista.
    const riegoNeto = {};
    (riegos || []).forEach(r => {
      if (r.litros == null)          { riegoNeto[r.date] = null; return; }
      if (riegoNeto[r.date] === null) return;                    // ya hay un null ese día
      riegoNeto[r.date] = (riegoNeto[r.date] || 0) + r.litros * efic;
    });

    const orden = [...(serie || [])].sort((a, b) => a.date.localeCompare(b.date));
    let Dr = 0, etcAcum = 0, et0Acum = 0, lluviaAcum = 0;
    let taw = aguaSuelo(suelo).taw, raw = aguaSuelo(suelo).raw;
    for (const dia of orden) {
      const dias = diasEntre(fechaPlantacion, new Date(`${dia.date}T12:00:00`));
      // ETc primero: el umbral (RAW) depende de ella por el ajuste de p.
      const kc  = kcDelDia(cultivoId, dias);
      const etc = kc * (dia.et0 ?? 0);
      ({ taw, raw } = aguaSuelo(suelo, cultivoId, dias, etc));  // raíz creciente + p por ETc
      if (dia.date in riegoNeto) {
        const r = riegoNeto[dia.date];
        Dr = r === null ? 0 : Math.max(0, Dr - r);
      }
      const pll = Math.max(0, dia.lluvia ?? 0);
      const pe  = pll >= PE_MIN_MM ? pll : 0;               // lluvia efectiva
      Dr = Math.min(taw, Math.max(0, Dr + etc - pe));
      etcAcum += etc; et0Acum += (dia.et0 ?? 0); lluviaAcum += pe;
    }

    const ultima = orden.length ? new Date(`${orden[orden.length - 1].date}T12:00:00`) : new Date();
    return {
      Dr, taw, raw, efic,
      kcActual: kcDelDia(cultivoId, diasEntre(fechaPlantacion, ultima)),
      etcAcum, et0Acum, lluviaAcum,
      sinFenologia: !fechaPlantacion,
    };
  }

  // Regla de decisión de la card-hoy (idéntica al frontend / motor-de-decision.md §3.2d).
  //   Dr ≥ RAW        → regar (alta), cantidad bruta = Dr/eficiencia
  //   0.75·RAW ≤ Dr   → vigilar (media)
  //   Dr < 0.75·RAW   → todo en orden (baja)
  function decisionRiego(bal, opts = {}) {
    const { Dr, raw, taw, efic } = bal;
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
    const prevista = (opts.lluviaPrevista || [])
      .slice(0, VENTANA_PRONOSTICO_DIAS)
      .reduce((s, d) => {
        const mm = Math.max(0, Number(d && d.lluvia) || 0);
        return s + (mm >= PE_MIN_MM ? mm : 0);
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
    const mm = Math.max(0, Number(mmBruto) || 0);
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

    const caudal = Number(caudalMmh) || CAUDAL_DEFAULT_MMH[metodoRiego];
    if (caudal > 0) {
      const min = (mm / caudal) * 60;
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
    const caudal = Number(caudalMmh);
    if (duracionMin != null && caudal > 0) return Math.round((caudal * duracionMin / 60) * 10) / 10;
    return cantidadGuardada ?? null;
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
    const { suelo, cultivoId = null, metodoRiego, fechaPlantacion = null } = opts;
    const efic = EFIC_RIEGO[metodoRiego] ?? EFIC_DEFAULT;

    const orden = [...(serie || [])].sort((a, b) => a.date.localeCompare(b.date));
    let Dr = 0, acum = 0;
    let taw = aguaSuelo(suelo).taw, raw = aguaSuelo(suelo).raw;
    const puntos = [];
    for (const dia of orden) {
      const dias = diasEntre(fechaPlantacion, new Date(`${dia.date}T12:00:00`));
      // ETc primero: el umbral (RAW) depende de ella por el ajuste de p.
      const kc  = kcDelDia(cultivoId, dias);
      const etc = kc * (dia.et0 ?? 0);
      ({ taw, raw } = aguaSuelo(suelo, cultivoId, dias, etc));  // raíz creciente + p por ETc
      // Decisión de la mañana: con el déficit que arrastra de ayer (misma regla que decisionRiego).
      if (Dr >= raw) { acum += Dr / efic; Dr = 0; }   // riego bruto = Dr/efic → repone Dr neto
      const pll = Math.max(0, dia.lluvia ?? 0);
      const pe  = pll >= PE_MIN_MM ? pll : 0;               // lluvia efectiva
      Dr = Math.min(taw, Math.max(0, Dr + etc - pe));
      puntos.push({ date: dia.date, acum_l_m2: Math.round(acum * 10) / 10 });
    }
    // deficitFinal: agua que Kylia tenía "en cola" al corte (aún no regada porque
    // el depósito no llegó al umbral). Honestidad del reveal: comparar acumulados
    // a igual fecha favorece al que riega menos a menudo; este dato lo explicita.
    return { puntos, total: Math.round(acum * 10) / 10, taw, raw, efic,
             deficitFinal: Math.round((Dr / efic) * 10) / 10 };
  }

  return {
    FAO_KC, SUELO_AWC, ZR_M, P_AGOTAMIENTO, PE_MIN_MM, EFIC_RIEGO, EFIC_DEFAULT, CAUDAL_DEFAULT_MMH,
    VENTANA_PRONOSTICO_DIAS,
    kcDelDia, faseDelDia, zrDelDia, aguaSuelo, diasEntre, balanceHidrico, decisionRiego, presentarRiego, laminaRiego, simularKylia,
  };

});
