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
    const base = { unidad: "mm/h", estimacion_mmh: estimacion };

    // ── Alta nueva: declaró su riego. No hereda nada.
    if (s.riego) {
      const v = num(s.riego.capacidad_mmh);
      if (v != null) {
        return { ...base, operativo: v, fuente: s.riego.fuente || "declarado",
                 confianza: s.riego.confianza || "media",
                 datos: s.riego.datos || null, nivel: "siembra", declarada: true };
      }
      // Dijo "no lo sé". Se queda sin caudal operativo, a propósito.
      return { ...base, operativo: null, fuente: s.riego.fuente || "no_lo_se",
               confianza: "baja", datos: null, nivel: "ninguno", declarada: true };
    }

    // ── Legacy: exactamente lo de siempre.
    if (num(s.caudal) != null) {
      return { ...base, operativo: num(s.caudal), fuente: "declarado",
               confianza: "media", datos: null, nivel: "siembra", declarada: false };
    }
    if (num(finca.caudal) != null) {
      return { ...base, operativo: num(finca.caudal), fuente: "heredado_finca",
               confianza: "baja", datos: null, nivel: "finca", declarada: false };
    }
    // Ni suyo ni de la finca: tampoco se inventa. El motor lo rellenaría solo,
    // y eso es justo lo que no puede pasar.
    return { ...base, operativo: null, fuente: "sin_datos", confianza: "baja",
             datos: null, nivel: "ninguno", declarada: false };
  }

  // El número que puede cruzar la puerta del motor, y nada más. Es LA función
  // que deben usar `configEfectiva` y `payloadSiembra`: si cada uno resuelve la
  // precedencia por su cuenta, se separan en cuanto alguien toque una.
  function caudalOperativo(s = {}, finca = {}) {
    return capacidadVigente(s, finca).operativo;
  }

  // ¿Se le pueden dar MINUTOS a este cultivo?
  //
  // A regadera y surco no se les dan minutos nunca (viajes y L/m²), así que la
  // pregunta no aplica y la respuesta es que sí: su orden no depende del caudal.
  // A goteo, aspersión y manguera solo si hay un caudal operativo de verdad.
  function puedeDarMinutos(metodo, operativo) {
    if (UNIDAD_ORDEN[metodo] !== "min") return true;
    const v = num(operativo);
    return v != null && v >= 0.1;
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
    if (puedeDarMinutos(metodo, opts.caudalMmh)) return presentarRiego(mmBruto, opts);
    const mm = Number(mmBruto);
    const v = Number.isFinite(mm) ? Math.max(0, mm) : 0;
    return { unidad: "l_m2", valor: Math.round(v), mm: Math.round(v * 10) / 10,
             sinCapacidad: true, texto: `${Math.round(v)} L/m²` };
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
      const fiable = cap && cap.operativo != null
                     && cap.fuente !== "estimado_metodo" && cap.fuente !== "heredado_finca";
      if (fiable) lista_para_ejecutar_riego = lista_para_calcular_agua;
      else if (cap && cap.fuente === "heredado_finca") {
        incertidumbres.push({ dato: "capacidad_riego", motivo: "heredada_de_la_finca",
                              efecto: "los minutos salen del caudal de otro cultivo", confianza: "baja" });
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
    capacidadVigente, caudalOperativo, puedeDarMinutos, presentarRiegoSeguro,
    estadoSiembra, estadoDecision,
  };
});
