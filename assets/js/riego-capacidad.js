// ─────────────────────────────────────────────────────────────────
// Capacidad de aplicación del riego — núcleo PURO, servidor ↔ navegador
// ─────────────────────────────────────────────────────────────────
// QUÉ ES ESTO. El motor FAO-56 decide en milímetros (= L/m²). Para convertir
// esos milímetros en una orden que el agricultor pueda ejecutar —"riega 45
// minutos"— hace falta saber a qué ritmo moja su instalación: mm/h. Ese número
// es el input más frágil de todo Kylia y el que el agricultor NUNCA sabe de
// memoria. Este fichero es el único sitio donde se deriva, y el único que dice
// de dónde ha salido.
//
// POR QUÉ VIVE FUERA DE app/index.html. La derivación por geometría ya existía,
// pero dentro de un IIFE del HTML: no se podía cargar desde un test, así que la
// única cobertura posible era leer el fuente con una expresión regular. Los tres
// defectos grandes del 13-sep sobrevivieron a tests así. Aquí se ejecuta.
//
// LA UNIDAD, QUE ES DONDE ESTÁ LA TRAMPA. El agricultor habla en L/h (lo que
// pone impreso en la cinta de goteo) y Kylia decide en mm/h. No hay constante de
// conversión que equivocar: 1 L repartido sobre 1 m² ES 1 mm. Lo que convierte
// L/h en mm/h no es un factor, es un ÁREA — la que moja cada emisor. De ahí que
// las preguntas sean separaciones y no caudales.
//
//   • goteo      → mm/h = (L/h de un gotero) / (sep. goteros × sep. líneas)
//   • aspersión  → mm/h medidos con un vaso, que ahí SÍ es un pluviómetro
//   • regadera   → no hay mm/h: la orden se cuenta en viajes
//   • surco      → no hay modelo de caudal fiable: la orden se da en L/m²
//
// ⚠️ EL VASO NO VALE EN GOTEO y este fichero no lo ofrece. Bajo un gotero el
// vaso recoge todo lo que suelta ese gotero en sus ~38 cm², cuando el gotero
// moja el marco entero: con la geometría de Ferran son 10,9 mm/h reales contra
// 312 de lectura (×29). Y el número depende de lo ancho que sea el vaso, que no
// es una medida de nada.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();  // Node / Vercel
  else root.KyliaRiego = factory();                                              // navegador
})(typeof self !== "undefined" ? self : this, function () {

  // Rango de credibilidad, el MISMO que ya aplicaban el alta y la calculadora.
  // Los pilotos reales van de 5,4 a 15 mm/h. Por debajo de 0,5 no hay
  // instalación, hay un error de tecleo; por encima de 80 hay un error de
  // lectura casi seguro. Fuera de rango NO se ofrece el número: un valor
  // increíble es peor que reconocer que no se sabe.
  const MMH_MIN = 0.5;
  const MMH_MAX = 80;

  // Con qué unidad se le da la orden al agricultor. Determina QUÉ dato hace
  // falta para poder dársela, que es de lo que va `estadoSiembra`.
  const UNIDAD_ORDEN = {
    goteo:     "min",
    aspersion: "min",
    manguera:  "min",
    regadera:  "regaderas",
    surco:     "l_m2",
  };

  // Una regadera de 1.000 L no es una regadera. Mismos topes que el motor.
  const REGADERA_MIN_L = 1;
  const REGADERA_MAX_L = 100;

  // ⚠️ `Number(null)` es 0, y `Number("")` también. Con la versión ingenua de
  // esto, una capacidad ausente (`capacidad_mmh: null`) se convertía en un
  // caudal operativo de 0 — o sea, en un dato. Es el mismo tropiezo que hizo que
  // `base_version: null` fuera un UPDATE incondicional en el CAS. Aquí solo
  // pasan números de verdad y cadenas que contengan uno.
  // ─── LA WHITELIST ────────────────────────────────────────────────────────
  // Qué PROCEDENCIAS pueden declarar los minutos como fiables. Es una lista
  // blanca, no negra, a propósito: con `fuente !== "estimado_metodo"` cualquier
  // fuente nueva que alguien añada mañana entraría sola, y entraría en silencio.
  // Aquí, para que una fuente habilite minutos hay que escribirla aquí.
  //
  // Están las dos en las que SABEMOS cómo se obtuvo el número:
  //   · derivado_goteo → de la geometría real de la instalación
  //   · medido_vaso    → medido por el agricultor con un pluviómetro improvisado
  //
  // NO está `declarado` (tecleado a mano en mm/h, sin saber de dónde salió), ni
  // `heredado_finca`, ni `estimado_metodo`, ni `no_lo_se`, ni `sin_datos`.
  // ─── LA EVALUACIÓN CANÓNICA ──────────────────────────────────────────────
  // Una capacidad no es un número: es número + método + fuente + confianza. Las
  // cuatro cosas o ninguna. Todo lo que decide algo sobre el riego —
  // capacidadVigente, caudalOperativo, estadoSiembra, presentarRiegoSeguro y
  // payloadSiembra— pasa por `evaluarCapacidadRiego` y por nada más.
  //
  // Qué fuente da FIABILIDAD, y para qué métodos. Whitelist: una fuente nueva
  // que nadie ha revisado no entra sola.
  const FUENTES_FIABLES = {
    derivado_goteo:     ["goteo"],                    // geometría real de la cinta
    medido_vaso:        ["aspersion", "manguera"],    // pluviómetro improvisado
    // ── AÑADIDAS, no sustituidas ──────────────────────────────────────────
    // `derivado_aspersion` es la misma geometría que el goteo aplicada a una
    // malla de aspersores FIJA Y REGULAR: caudal por aspersor repartido entre
    // el rectángulo que cubre. Solo se ofrece cuando él ha dicho que están
    // fijos y en malla; a un aspersor que se va moviendo esta fórmula no se le
    // aplica, porque no describe su instalación.
    derivado_aspersion: ["aspersion"],
    // `medido_vasos` (plural) es la medición con VARIOS recipientes repartidos.
    // Existe aparte de `medido_vaso` a propósito: un solo vaso en un punto
    // cualquiera de una malla de aspersores mide ESE punto, no la parcela, y
    // el solape entre aspersores hace que el centro y el borde no se parezcan.
    // Las siembras que ya llevan `medido_vaso` NO cambian de clase: su fuente
    // sigue en la lista y su fila sigue dando exactamente los mismos minutos.
    medido_vasos:       ["aspersion", "manguera"],
  };
  // Fuentes cuyo número puede CRUZAR al motor sin ser fiable. Es lo que mantiene
  // vivo a quien tecleó su caudal o lo hereda de su finca: sigue recibiendo
  // minutos, pero marcados como provisionales.
  const FUENTES_PROVISIONALES = ["declarado", "heredado_finca"];

  const FUENTES_OPERATIVAS = Object.keys(FUENTES_FIABLES);
  const FUENTES_AL_MOTOR   = [...FUENTES_OPERATIVAS, ...FUENTES_PROVISIONALES];

  // ─── LA PUERTA, y solo una ───────────────────────────────────────────────
  // Todo lo que decide si una capacidad vale —`capacidadVigente`,
  // `caudalOperativo`, `puedeDarMinutos`, `estadoSiembra` y la presentación—
  // pasa por AQUÍ. Cuatro validaciones parecidas es cómo se acaba teniendo
  // `estado: completa` con capacidad 0 y una presentación que no puede dar
  // minutos: cada una decidía por su cuenta y decidían distinto.
  //
  // Rechaza, y esto es la lista entera: null, undefined, "", 0, "0", NaN,
  // Infinity, negativos, booleanos y cualquier cosa fuera del rango agronómico.
  function capacidadOperativa(valor) {
    const n = num(valor);
    if (n === null) return null;
    if (!(n > MMH_MIN && n < MMH_MAX)) return null;
    return Math.round(n * 10) / 10;
  }

  // Devuelve SIEMPRE la misma forma:
  //   capacidad_mmh  → lo que puede cruzar al motor (null si nada puede)
  //   puede_ejecutar → si los minutos se pueden llamar fiables
  //   clase          → fiable | provisional | no_ejecutable
  //   motivo         → por qué, para poder decirlo en pantalla
  function evaluarCapacidadRiego(riego, metodo) {
    const r = riego || {};
    const valor = capacidadOperativa(r.capacidad_mmh);
    const no = (motivo) => ({ capacidad_mmh: null, puede_ejecutar: false,
                              clase: "no_ejecutable", fuente: r.fuente || null,
                              confianza: r.confianza || null, motivo });
    // SIN MÉTODO NO HAY CAPACIDAD, y no hay excepción. Antes la compatibilidad
    // solo se comprobaba si venía método (`if (metodo && ...)`), así que un
    // método ausente se saltaba el chequeo entero y 6,7 salía fiable sin que
    // supiéramos con qué se riega. Una capacidad es valor + método + fuente +
    // confianza: si falta una de las cuatro, no es nada.
    if (!metodo || !UNIDAD_ORDEN[metodo]) return no("sin_metodo");
    if (valor === null) {
      return no(r.capacidad_mmh === null || r.capacidad_mmh === undefined
                ? "sin_capacidad" : "valor_no_valido");
    }
    const fuente = r.fuente || null;
    const confianza = r.confianza || null;
    const metodosOk = FUENTES_FIABLES[fuente];

    if (metodosOk) {
      // Una capacidad derivada de una cinta de goteo no dice NADA sobre un
      // aspersor: si el método no cuadra con la fuente, el número no vale ni
      // como provisional.
      if (!metodosOk.includes(metodo)) return no("metodo_incompatible");
      if (confianza !== "alta") {
        return { capacidad_mmh: valor, puede_ejecutar: false, clase: "provisional",
                 fuente, confianza, motivo: "confianza_insuficiente" };
      }
      return { capacidad_mmh: valor, puede_ejecutar: true, clase: "fiable",
               fuente, confianza, motivo: null };
    }
    if (FUENTES_PROVISIONALES.includes(fuente)) {
      return { capacidad_mmh: valor, puede_ejecutar: false, clase: "provisional",
               fuente, confianza, motivo: "fuente_sin_validar" };
    }
    // estimado_metodo, no_lo_se, sin_datos, invalidada_por_cambio_de_metodo y
    // cualquier fuente que alguien añada mañana.
    return no("fuente_no_admitida");
  }

  const num = (v) => {
    if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const r1  = (x) => Math.round(x * 10) / 10;

  // ─── Derivaciones ────────────────────────────────────────────────────────
  // Todas devuelven la MISMA forma, con la procedencia dentro. Nunca un número
  // pelado: un mm/h sin fuente no se puede distinguir de un valor por defecto,
  // y esa confusión es exactamente la deuda que esto viene a cerrar.
  const fallo = (motivo, extra = {}) => ({ ok: false, motivo, ...extra });

  function capacidad(valor, fuente, confianza, datos) {
    if (valor == null || !Number.isFinite(valor)) return fallo("datos_incompletos");
    if (!(valor > MMH_MIN && valor < MMH_MAX)) return fallo("fuera_de_rango", { valor: r1(valor) });
    return { ok: true, valor: r1(valor), unidad: "mm/h", fuente, confianza, datos };
  }

  // GOTEO. Tres cosas que se ven mirando el bancal, ninguna de ellas un caudal.
  // La separación entre líneas se puede dar directa o dejar que salga del ancho
  // del bancal repartido entre sus mangueras, que es más fácil de contestar.
  function capacidadGoteo(d = {}) {
    // ⚠️ EL SUPUESTO, COMPROBADO ANTES DE LA FÓRMULA. `q / (sep × sep)` describe
    // una instalación REGULAR: todas las cintas iguales, una por línea, todos
    // los goteros con el mismo caudal. Si él dice que la suya no es así, no se
    // le devuelve un número: se le manda a medir o a dejarlo pendiente.
    //
    // Cuando `disposicion` no viene, se comporta EXACTAMENTE como antes — es lo
    // que mantiene funcionando a las siembras y a las pantallas que ya existían.
    if (d.disposicion != null && d.disposicion !== "regular") {
      return fallo("disposicion_no_soportada", { disposicion: d.disposicion });
    }
    const sepGoteros = num(d.sep_goteros_m);
    const anchoM     = num(d.ancho_m);
    const nLineas    = num(d.lineas);
    const sepLineas  = num(d.sep_lineas_m) != null ? num(d.sep_lineas_m)
                     : (anchoM > 0 && nLineas > 0) ? anchoM / nLineas
                     : null;
    // Lo que suelta UN gotero en una hora. Tres formas de saberlo, por orden de
    // fiabilidad: impreso en la cinta por gotero, impreso por metro de manguera
    // (entonces hay que multiplicarlo por la separación), o medido con una
    // botella debajo durante 10 minutos (×6 → L/h).
    const q = num(d.l_h_gotero) != null ? num(d.l_h_gotero)
            : (num(d.l_h_metro) != null && sepGoteros > 0) ? num(d.l_h_metro) * sepGoteros
            : num(d.litros_botella_10min) != null ? num(d.litros_botella_10min) * 6
            : null;

    if (q == null || sepGoteros == null || sepLineas == null) return fallo("datos_incompletos");
    if (!(q > 0) || !(sepGoteros > 0) || !(sepLineas > 0))    return fallo("valores_no_positivos");

    // Se guardan los datos ORIGINALES, no solo el resultado. Si mañana se
    // descubre que la fórmula se quedaba corta, un número suelto no se puede
    // recalcular y estos tres sí. Y si el agricultor cambia la cinta, se ve qué
    // había antes.
    return capacidad(q / (sepGoteros * sepLineas), "derivado_goteo",
                     d.litros_botella_10min != null ? "media" : "alta",
                     { l_h_gotero: r1(q), sep_goteros_m: sepGoteros,
                       sep_lineas_m: Math.round(sepLineas * 100) / 100,
                       medido_con_botella: d.litros_botella_10min != null });
  }

  // ASPERSIÓN / MANGUERA. El vaso es un pluviómetro: lo que se acumula dentro es
  // lo que cae sobre el suelo. Es una MEDIDA, no una derivación.
  function capacidadVaso(d = {}) {
    const cm  = num(d.cm);
    const min = num(d.minutos) != null ? num(d.minutos) : 15;   // el guion dice 15
    if (cm == null || min == null) return fallo("datos_incompletos");
    if (!(cm > 0) || !(min > 0))   return fallo("valores_no_positivos");
    return capacidad((cm * 10) / (min / 60), "medido_vaso", "alta",
                     { cm, minutos: min });
  }

  // ─── ASPERSIÓN FIJA Y EN MALLA ───────────────────────────────────────────
  // Misma aritmética que el goteo y por la misma razón: un emisor reparte su
  // caudal sobre el rectángulo que le toca. Aquí el emisor es el aspersor.
  //
  // ⚠️ `disposicion` NO ES DECORATIVA: sin "fija_regular" declarado, esta
  // fórmula no se aplica. Aplicarla a unos aspersores que se van moviendo, o a
  // un reparto irregular, produce un número con toda la pinta de estar medido
  // y que no describe nada. Antes de calcular se comprueba el supuesto.
  function capacidadAspersion(d = {}) {
    if (d.disposicion !== "fija_regular") {
      return fallo("disposicion_no_soportada", { disposicion: d.disposicion ?? null });
    }
    const q       = num(d.l_h_aspersor);
    const sepAsp  = num(d.sep_aspersores_m);
    const sepLin  = num(d.sep_lineas_m);
    if (q == null || sepAsp == null || sepLin == null) return fallo("datos_incompletos");
    if (!(q > 0) || !(sepAsp > 0) || !(sepLin > 0))    return fallo("valores_no_positivos");
    // Los datos originales, no solo el resultado: si mañana hay que rehacer la
    // cuenta, un mm/h suelto no se puede y estos tres sí.
    return capacidad(q / (sepAsp * sepLin), "derivado_aspersion", "alta",
                     { l_h_aspersor: r1(q), sep_aspersores_m: sepAsp, sep_lineas_m: sepLin,
                       disposicion: "fija_regular" });
  }

  // ─── MEDICIÓN CON VARIOS RECIPIENTES ─────────────────────────────────────
  // Lo que de verdad vale para una instalación que no es regular, y lo único
  // que vale para unos aspersores que se mueven.
  //
  // Se piden AL MENOS TRES repartidos por la zona regada. Con uno solo no se
  // sabe si ese punto es el que más recibe o el que menos: en una malla de
  // aspersores el solape hace que entre el centro y el borde haya el doble.
  // Por eso el resultado es la MEDIA, y por eso con menos de tres esto falla en
  // vez de devolver un número más pequeño con la misma cara de seguridad.
  const MIN_RECIPIENTES = 3;
  function capacidadVasos(d = {}) {
    const lista = Array.isArray(d.cm_varios) ? d.cm_varios.map(num).filter(v => v != null) : [];
    const min   = num(d.minutos) != null ? num(d.minutos) : 15;
    if (!lista.length || min == null) return fallo("datos_incompletos");
    if (lista.length < MIN_RECIPIENTES) {
      return fallo("pocos_recipientes", { recipientes: lista.length, minimo: MIN_RECIPIENTES });
    }
    if (lista.some(v => !(v > 0)) || !(min > 0)) return fallo("valores_no_positivos");
    const media = lista.reduce((a, b) => a + b, 0) / lista.length;
    // La dispersión se GUARDA, no se esconde: un reparto con el triple en un
    // punto que en otro es una instalación que riega mal, y eso se puede decir
    // más adelante sin volver a pedirle que mida.
    const menor = Math.min(...lista), mayor = Math.max(...lista);
    return capacidad((media * 10) / (min / 60), "medido_vasos", "alta",
                     { cm_varios: lista, recipientes: lista.length, minutos: min,
                       cm_medio: Math.round(media * 100) / 100,
                       uniformidad: mayor > 0 ? Math.round((menor / mayor) * 100) / 100 : null });
  }

  // Lo tecleó él directamente en mm/h. Pantalla avanzada: no se pregunta así en
  // el onboarding. Confianza media — no sabemos cómo lo obtuvo.
  function capacidadDeclarada(mmh) {
    return capacidad(num(mmh), "declarado", "media", { mm_h: num(mmh) });
  }

  // ÚLTIMO RECURSO, y va marcado como tal. Es el mismo valor que el motor usaba
  // en silencio: la diferencia es que ahora queda escrito que es una suposición
  // nuestra y no un dato suyo. El bancal real medía 5,4 y esta tabla dice 10.
  const POR_DEFECTO_MMH = { goteo: 4, aspersion: 10, manguera: 20 };
  function capacidadEstimada(metodo) {
    const v = POR_DEFECTO_MMH[metodo];
    if (v == null) return fallo("metodo_sin_estimacion");
    return { ok: true, valor: v, unidad: "mm/h", fuente: "estimado_metodo",
             confianza: "baja", datos: { metodo } };
  }

  // Puerta única: el onboarding llama AQUÍ y no a las de arriba, para que añadir
  // un método nuevo no obligue a tocar cada call site.
  function derivar(metodo, entrada = {}) {
    if (entrada.mm_h != null)                   return capacidadDeclarada(entrada.mm_h);
    // Varios recipientes gana a uno solo esté el método que esté: es la medida
    // mejor, y se comprueba ANTES para que el onboarding nuevo no caiga por
    // descuido en la rama de un vaso.
    if (Array.isArray(entrada.cm_varios))       return capacidadVasos(entrada);
    if (metodo === "aspersion" && entrada.disposicion) return capacidadAspersion(entrada);
    if (metodo === "goteo")                     return capacidadGoteo(entrada);
    if (metodo === "aspersion" || metodo === "manguera") return capacidadVaso(entrada);
    return fallo("metodo_sin_capacidad", { metodo });
  }

  // ─── Qué capacidad rige para una siembra ─────────────────────────────────
  //
  // ⚠️ LA REGLA QUE MANDA AQUÍ: UNA ESTIMACIÓN NUNCA ES EL CAUDAL OPERATIVO.
  //
  // El motor no sabe de dónde viene el número que le pasan. `presentarRiego`,
  // ante un caudal ausente, sustituye CAUDAL_DEFAULT_MMH y devuelve unos minutos
  // con la misma cara de seguridad que si estuvieran medidos — y el bancal real
  // medía 5,4 mm/h donde esa tabla dice 10. Así que el filtro tiene que estar
  // ANTES del motor, no después: lo que no está medido o derivado sale como
  // `operativo: null` y no llega a cruzar la puerta.
  //
  // `estimacion_mmh` se conserva aparte para poder ORIENTAR al agricultor
  // ("tu goteo rondará los 4 L/m²·h"), pero vive en otro campo a propósito:
  // un valor que no puede confundirse con el operativo por descuido.
  //
  // COMPATIBILIDAD LEGACY. Una siembra antigua no tiene `riego`, y para ella
  // todo sigue EXACTAMENTE igual: su caudal, si no, el de la finca. Lo que
  // cambia es solo para las altas nuevas, que siempre escriben `riego` — ese
  // campo ES la marca de "esta siembra declaró su riego explícitamente", y una
  // siembra que lo declaró no hereda el caudal del cultivo de al lado.
  function capacidadVigente(s = {}, finca = {}) {
    const metodo = s.metodoRiego || finca.metodoRiego || null;
    const est = capacidadEstimada(metodo);
    const estimacion = est.ok ? est.valor : null;

    // Qué `riego` rige. Una siembra del alta nueva SIEMPRE lleva el suyo y no
    // hereda; una antigua se sintetiza como provisional, que es lo que era.
    // ⚠️ MARCA EXPLÍCITA DE "LO INDICARÉ DESPUÉS". Va antes que todo lo demás y
    // no depende de que `riego` se haya escrito: un valor falsy nunca puede
    // decidir por sí solo que toca heredar.
    if (s.riegoPendiente === true) {
      return { unidad: "mm/h", estimacion_mmh: estimacion, motor: null, operativo: null,
               valor: null, clase: "no_ejecutable", motivo: "riego_pendiente",
               fuente: "pendiente", confianza: "baja", datos: null,
               nivel: "ninguno", declarada: true, admisible: false };
    }

    let riego, nivel, declarada;
    if (s.riego)                                      { riego = s.riego; nivel = "siembra"; declarada = true; }
    else if (capacidadOperativa(s.caudal) !== null)   { riego = { capacidad_mmh: s.caudal, fuente: "declarado", confianza: "media" }; nivel = "siembra"; declarada = false; }
    else if (capacidadOperativa(finca.caudal) !== null) { riego = { capacidad_mmh: finca.caudal, fuente: "heredado_finca", confianza: "baja" }; nivel = "finca"; declarada = false; }
    else                                              { riego = { capacidad_mmh: null, fuente: "sin_datos" }; nivel = "ninguno"; declarada = false; }

    const ev = evaluarCapacidadRiego(riego, metodo);
    return { unidad: "mm/h", estimacion_mmh: estimacion,
             // El número que cruza al motor (null si nada puede cruzar).
             motor: ev.capacidad_mmh,
             // Habilita declarar los minutos FIABLES.
             operativo: ev.puede_ejecutar ? ev.capacidad_mmh : null,
             valor: ev.capacidad_mmh,
             clase: ev.clase, motivo: ev.motivo,
             fuente: ev.fuente, confianza: ev.confianza,
             datos: riego.datos || null, nivel, declarada,
             admisible: ev.puede_ejecutar };
  }

  // El número que se le puede pasar al MOTOR.
  function caudalMotor(s = {}, finca = {}) {
    return capacidadVigente(s, finca).motor;
  }
  const caudalOperativo = caudalMotor;

  // ─── Cambiar de método invalida la capacidad ─────────────────────────────
  //
  // Un caudal de 6,7 mm/h derivado de la geometría de una cinta de goteo no dice
  // NADA sobre un aspersor. Conservarlo al cambiar de método es peor que no
  // tener dato: es un número con procedencia creíble aplicado a una instalación
  // que no es la suya.
  //
  // El alta ya invalidaba al cambiar de chip, pero el PANEL normal no: cambiabas
  // de goteo a aspersión, guardabas, y te quedabas con 6,7 y `derivado_goteo`.
  // Esta función es la puerta única para que no dependa de que cada pantalla se
  // acuerde.
  //
  // MVP: invalidación SEGURA, sin intentar adivinar si el número podría
  // reutilizarse. goteo→aspersión, aspersión→goteo, goteo→manguera: todas
  // dejan la configuración sin capacidad hasta volver a medir o derivar.
  function riegoTrasCambioDeMetodo(previo = {}, metodoNuevo) {
    const metodoPrevio = previo.metodoRiego || null;
    const metodoDestino = metodoNuevo || null;
    const sinCambio = { caudal: previo.caudal ?? null, riego: previo.riego || null,
                        invalidado: false, metodo_anterior: metodoPrevio };
    // ⚠️ `null` NO significa "no ha habido cambio". Significa que ya no hay
    // sistema de riego configurado, y una capacidad sin sistema al que
    // pertenecer no es una capacidad. Deseleccionar el método en el panel dejaba
    // el 6,7 de goteo vivo y fiable, colgando de la nada.
    if (metodoDestino === metodoPrevio) return sinCambio;

    // Lo anterior se guarda como HISTÓRICO, anidado. `capacidadVigente` lee
    // `riego.capacidad_mmh`, `.fuente`, `.confianza` y `.datos` del primer
    // nivel: nada de lo que hay bajo `anterior` puede volver a activarse solo.
    const historico = previo.riego && previo.riego.capacidad_mmh != null
      ? { metodo: metodoPrevio, capacidad_mmh: previo.riego.capacidad_mmh,
          fuente: previo.riego.fuente || null, medido: previo.riego.medido || null }
      : (previo.caudal != null ? { metodo: metodoPrevio, capacidad_mmh: previo.caudal,
                                   fuente: "declarado", medido: null } : null);

    return {
      caudal: null,
      riego: { capacidad_mmh: null, unidad: "mm/h",
               fuente: "invalidada_por_cambio_de_metodo", confianza: "baja", datos: null,
               metodo_anterior: metodoPrevio,
               estimacion_mmh: POR_DEFECTO_MMH[metodoDestino] ?? null,
               anterior: historico },
      invalidado: true,
      metodo_anterior: metodoPrevio,
    };
  }

  // ¿Se le pueden dar MINUTOS a este cultivo?
  //
  // A regadera y surco no se les dan minutos nunca (viajes y L/m²), así que la
  // pregunta no aplica y la respuesta es que sí: su orden no depende del caudal.
  // A goteo, aspersión y manguera solo si hay un caudal operativo de verdad.
  function puedeDarMinutos(metodo, valor) {
    // Sin método válido no hay orden que dar: ni minutos, ni viajes, ni nada que
    // dependa de cómo se riega.
    if (!metodo || !UNIDAD_ORDEN[metodo]) return false;
    if (UNIDAD_ORDEN[metodo] !== "min") return true;
    // MISMA puerta que todo lo demás. Antes esto aceptaba >= 0,1 mientras
    // `capacidadVigente` aceptaba cualquier número: con capacidad 0 el estado
    // decía "completa, lista para ejecutar" y esta función decía que no se
    // podían dar minutos. Las dos cosas a la vez, sobre la misma siembra.
    return capacidadOperativa(valor) !== null;
  }

  // LA ÚNICA PUERTA AL MOTOR para presentar un riego. Se le pasa la
  // `presentarRiego` del motor (así este fichero no depende de él y se puede
  // cargar suelto), y si no hay caudal operativo devuelve la lámina en L/m² en
  // vez de dejar que el motor la convierta con su tabla por defecto.
  //
  // El agricultor no pierde información: L/m² es exactamente lo que el motor ha
  // decidido. Lo que pierde es una precisión que no teníamos.
  function presentarRiegoSeguro(presentarRiego, mmBruto, opts = {}) {
    const metodo = opts.metodoRiego;
    // `clase` la pone quien llama, desde capacidadVigente. Sin ella se asume
    // provisional: es la lectura conservadora.
    let clase = opts.clase || (opts.caudalMmh != null ? "provisional" : "no_ejecutable");

    // ── DEFENSA EN PROFUNDIDAD ──────────────────────────────────────────────
    // No basta con que quien llama diga "fiable": esta función vuelve a exigir
    // las condiciones duras. Un estado incoherente —legacy, una config a medias,
    // un `clase` heredado de otra pantalla— no puede producir unos minutos con
    // cara de medidos solo porque exista un número.
    //
    // Es literalmente el caso que se escapó: método deseleccionado, capacidad
    // 6,7 marcada fiable, y la presentación decía "72 min".
    if (!metodo || !UNIDAD_ORDEN[metodo]) {
      return lamina(mmBruto, "Falta definir cómo riegas para convertirlo a tiempo");
    }
    if (capacidadOperativa(opts.caudalMmh) === null && clase === "fiable") clase = "no_ejecutable";

    if (puedeDarMinutos(metodo, opts.caudalMmh)) {
      const p = presentarRiego(mmBruto, opts);
      if (p.unidad !== "min" || clase === "fiable") return { ...p, clase: p.unidad === "min" ? clase : "fiable" };
      // PROVISIONAL: los mismos minutos, pero sin venderlos como exactos. Una
      // alta nueva con caudal tecleado no puede verse igual que una derivada.
      return { ...p, clase: "provisional",
               texto: `Aproximadamente ${p.texto}`,
               aviso: "Capacidad de riego pendiente de validar" };
    }
    return lamina(mmBruto, "Falta validar la capacidad de tu sistema para convertirlo a tiempo");
  }

  // La lámina tal cual la decidió el motor. No se pierde información: L/m² es
  // exactamente lo que hay que aplicar. Lo que no se da es una precisión que no
  // tenemos.
  function lamina(mmBruto, aviso) {
    const mm = Number(mmBruto);
    const v = Number.isFinite(mm) ? Math.max(0, mm) : 0;
    return { unidad: "l_m2", valor: Math.round(v), mm: Math.round(v * 10) / 10,
             sinCapacidad: true, clase: "no_ejecutable",
             texto: `Aplica ${Math.round(v)} L/m²`, aviso };
  }

  // ─── Completitud ─────────────────────────────────────────────────────────
  // DOS NIVELES, y no uno. Kylia puede saber perfectamente que a un cultivo le
  // faltan 6 mm sin tener ni idea de cuántos minutos son esos 6 mm. Colapsar las
  // dos cosas en un único booleano obliga a elegir entre mentir ("riega 45 min"
  // con un caudal inventado) o callarse ("configuración incompleta") cuando
  // había una respuesta útil que dar.
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  function fechaUsable(f, hoy) {
    if (!ISO.test(String(f || ""))) return "formato";
    const d = new Date(`${f}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return "formato";
    if (hoy && ISO.test(hoy) && f > hoy) return "futura";
    return null;
  }

  function estadoSiembra(s = {}, finca = {}, opts = {}) {
    const soportados = opts.cultivosSoportados || null;
    const hoy = opts.hoy || null;
    const faltan = [], incertidumbres = [];

    if (!s.cultivo) faltan.push("cultivo");
    else if (soportados && !soportados.includes(s.cultivo)) faltan.push("cultivo_no_soportado");

    const malaFecha = fechaUsable(s.fechaPlantacion, hoy);
    if (!s.fechaPlantacion) faltan.push("fecha_plantacion");
    else if (malaFecha === "futura") faltan.push("fecha_plantacion_futura");
    else if (malaFecha) faltan.push("fecha_plantacion_invalida");

    const lat = num(s.lat != null ? s.lat : finca.lat);
    const lon = num(s.lon != null ? s.lon : finca.lon);
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) faltan.push("ubicacion");

    const area = num(s.area_m2);
    if (!(area > 0)) faltan.push("area");

    const metodo = s.metodoRiego || finca.metodoRiego || null;
    if (!metodo || !UNIDAD_ORDEN[metodo]) faltan.push("metodo_riego");

    // El agua se puede calcular con esto y nada más. El clima NO entra aquí:
    // es disponibilidad de una API, no configuración del agricultor, y una caída
    // de Open-Meteo no puede devolverlo al onboarding.
    const lista_para_calcular_agua = faltan.length === 0;

    const unidad_orden = metodo ? UNIDAD_ORDEN[metodo] : null;
    const cap = metodo ? capacidadVigente(s, finca) : null;
    let lista_para_ejecutar_riego = false;

    if (unidad_orden === "l_m2") {
      // Surco: la orden se da en L/m² y no necesita caudal. No falta nada.
      lista_para_ejecutar_riego = lista_para_calcular_agua;
      incertidumbres.push({ dato: "capacidad_riego", motivo: "surco_sin_modelo_de_caudal",
                            efecto: "la orden se da en L/m², no en minutos", confianza: "media" });
    } else if (unidad_orden === "regaderas") {
      const capL = num(s.capacidadRegaderaL != null ? s.capacidadRegaderaL : finca.capacidadRegadera);
      if (!(capL >= REGADERA_MIN_L && capL <= REGADERA_MAX_L)) faltan.push("capacidad_regadera");
      else lista_para_ejecutar_riego = lista_para_calcular_agua;
    } else if (unidad_orden === "min") {
      // Aquí está el nudo del piloto. Con una capacidad medida o derivada los
      // minutos son suyos; sin ella no hay minutos que dar — ni exactos ni
      // aproximados, porque el número saldría de una tabla nuestra.
      //
      // Un caudal HEREDADO de la finca sí es operativo (es lo que hacían las
      // siembras antiguas y hay que respetarlo), pero no habilita los minutos
      // como fiables: sale del cultivo de al lado, no de este.
      // `cap.operativo` YA lleva dentro las tres condiciones —número finito y
      // positivo, dentro de rango, y fuente en la whitelist—, así que aquí no se
      // vuelve a decidir nada. Antes esta línea repetía el criterio con nombres
      // de fuente ("!== estimado_metodo"), y por ahí se colaba una capacidad 0.
      //
      // INVARIANTE 1: capacidad operativa null ⇒ lista_para_ejecutar_riego false.
      const fiable = !!cap && cap.admisible === true;
      // INVARIANTE 2: si se declara ejecutable, la presentación TIENE que poder
      // dar minutos. Se comprueba con la misma función que usa la presentación,
      // no con una copia del criterio.
      if (fiable && puedeDarMinutos(metodo, cap.operativo)) {
        lista_para_ejecutar_riego = lista_para_calcular_agua;
      } else if (cap && cap.fuente === "heredado_finca") {
        incertidumbres.push({ dato: "capacidad_riego", motivo: "heredada_de_la_finca",
                              efecto: "los minutos salen del caudal de otro cultivo", confianza: "baja" });
      } else if (cap && cap.valor !== null && !cap.admisible) {
        // Hay un número, pero no sabemos de dónde salió (tecleado a mano, o una
        // estimación nuestra). Sirve para orientar; no para prometer minutos.
        incertidumbres.push({ dato: "capacidad_riego", motivo: `fuente_no_operativa:${cap.fuente}`,
                              efecto: "los minutos no se pueden declarar fiables", confianza: "baja" });
      } else {
        incertidumbres.push({ dato: "capacidad_riego", motivo: "sin_capacidad_declarada",
                              efecto: "no se pueden dar minutos: solo L/m²", confianza: "baja" });
      }
    }

    // El suelo nunca bloquea: `franco` es el término medio de la tabla FAO-56 y
    // decidir con él es correcto. Pero mueve la lámina un ±10% y eso se declara.
    if (!(s.suelo || finca.suelo)) {
      incertidumbres.push({ dato: "suelo", motivo: "sin_determinar",
                            efecto: "la lámina puede variar un ±10%", confianza: "baja" });
    } else if ((finca.sueloFuente || s.sueloFuente) === "soilgrids") {
      incertidumbres.push({ dato: "suelo", motivo: "prior_soilgrids_250m",
                            efecto: "la lámina puede variar un ±10%", confianza: "media" });
    }

    const estado_configuracion = !lista_para_calcular_agua ? "incompleta"
                               : lista_para_ejecutar_riego ? "completa"
                               : "pendiente_validacion";

    return { estado_configuracion, lista_para_calcular_agua, lista_para_ejecutar_riego,
             unidad_orden, capacidad: cap, faltan, incertidumbres };
  }

  // ─── Decisión ≠ configuración ────────────────────────────────────────────
  // Separadas a propósito (y con tres nombres distintos) porque mezclarlas es
  // cómo una caída de Open-Meteo acaba pidiéndole al agricultor que rehaga el
  // alta. Su configuración no ha cambiado; lo que falla es nuestro proveedor.
  function estadoDecision(estadoCfg, externos = {}) {
    const cob = num(externos.coberturaClima);
    const estado_datos_externos = cob == null ? "clima_desconocido"
                                : cob >= 0.95 ? "completo"
                                : "clima_temporalmente_incompleto";
    const estado_decision =
      !estadoCfg.lista_para_calcular_agua ? "esperando_configuracion"
      : estado_datos_externos !== "completo" ? "esperando_datos"
      : estadoCfg.lista_para_ejecutar_riego ? "puede_decidir"
      : "puede_calcular_agua";
    return { estado_datos_externos, estado_decision };
  }

  return {
    MMH_MIN, MMH_MAX, UNIDAD_ORDEN, POR_DEFECTO_MMH,
    REGADERA_MIN_L, REGADERA_MAX_L,
    capacidadGoteo, capacidadVaso, capacidadDeclarada, capacidadEstimada, derivar,
    capacidadAspersion, capacidadVasos, MIN_RECIPIENTES,
    FUENTES_OPERATIVAS, FUENTES_AL_MOTOR, FUENTES_FIABLES, FUENTES_PROVISIONALES,
    capacidadOperativa, evaluarCapacidadRiego,
    capacidadVigente, caudalOperativo, caudalMotor, puedeDarMinutos, presentarRiegoSeguro,
    riegoTrasCambioDeMetodo,
    estadoSiembra, estadoDecision,
  };
});
