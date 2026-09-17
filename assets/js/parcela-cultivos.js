// ─────────────────────────────────────────────────────────────────
// Parcela → cultivos: el reparto, en un sitio y sin DOM
// ─────────────────────────────────────────────────────────────────
// QUÉ ES. La lógica del alta de una parcela con varios cultivos: cuánto queda
// sin asignar, si un cultivo cabe, en qué paso del flujo estamos y qué se
// guarda. Sin `document`, para que los tests la EJECUTEN en vez de leerla.
//
// POR QUÉ EXISTE. El alta anterior preguntaba "¿cultivas todo el recinto o solo
// una parte?", y esa pregunta ya decide por el agricultor: induce a pensar en un
// único cultivo. Un recinto con lechuga, col y un pasillo sin plantar no cabía
// en ella. Aquí la parcela es el sitio y los cultivos se añaden de uno en uno.
//
// ⚠️ NO se exige que la suma de los cultivos llene la parcela. Un campo real
// tiene pasillos, bordes, barbecho y sitios donde no se planta. Lo que sí se
// impide es lo imposible: salirse de la parcela o pisar a otro cultivo.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KyliaParcela = factory();
})(typeof self !== "undefined" ? self : this, function () {

  // Los pasos del mini-flujo de UN cultivo. El orden es el del encargo y no es
  // casual: qué → cuánto → cuándo → cómo se riega, de lo que mejor sabe a lo
  // que peor.
  const PASOS_CULTIVO = ["cultivo", "superficie", "fecha", "riego"];

  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const m2 = (v) => { const n = num(v); return n !== null && n > 0 ? n : 0; };

  // ─── Contabilidad de superficie ──────────────────────────────────────────
  // Lo que el agricultor ve en la pantalla de reparto. `sin_configurar` puede ser
  // > 0 y eso NO es un error: es el pasillo, el borde, lo que no ha plantado.
  function reparto(parcela = {}, cultivos = []) {
    const total = m2(parcela.superficie_m2 ?? parcela.area_m2);
    const filas = (cultivos || []).map(c => ({
      id: c.id, cultivo: c.cultivo || null, area_m2: m2(c.area_m2),
    }));
    const asignado = filas.reduce((s, f) => s + f.area_m2, 0);
    return {
      total,
      asignado: Math.round(asignado),
      // Nunca negativo en pantalla: si por datos viejos la suma se pasa, se
      // enseña 0 y `excedido` lo dice aparte, en vez de un "-340 m²" que no
      // significa nada para quien lo lee.
      sin_configurar: Math.max(0, Math.round(total - asignado)),
      excedido: asignado > total ? Math.round(asignado - total) : 0,
      filas,
    };
  }

  // ─── ¿Cabe este cultivo? ─────────────────────────────────────────────────
  // Dos capas: la superficie (rápida, y la que se enseña mientras arrastra) y
  // la geometría (la que manda). Si hay geometría, ella decide.
  function cabe(geo, candidato, parcela, ocupados = [], opts = {}) {
    const tolerancia = num(opts.toleranciaM2) ?? 1;   // redondeos del dibujo
    if (candidato?.geometria && parcela?.geometria && geo?.validarCultivo) {
      const v = geo.validarCultivo(candidato.geometria, parcela.geometria,
                                   (ocupados || []).map(o => o.geometria).filter(Boolean));
      if (!v.ok) return { ok: false, motivo: v.motivo, con: v.con ?? null };
    }
    // Sin geometría no hay cultivo que validar: no se asignan metros a ciegas.
    if (!candidato?.geometria) return { ok: false, motivo: "sin_geometria" };
    // Y ya está: si el contorno cabe dentro de la parcela y no pisa a nadie, la
    // superficie CUADRA por construcción. Comparar un `area_m2` declarado contra
    // los metros libres era una segunda verdad que podía contradecir a la
    // primera; ahora la única verdad es el dibujo.
    void reparto; void tolerancia;
    return { ok: true, motivo: null };
  }

  const MOTIVOS = {
    sin_geometria:          "Marca en el mapa qué zona ocupa este cultivo.",
    parcela_invalida:       "El contorno de la parcela no es válido.",
    se_cruza_consigo_mismo: "Ese contorno se cruza consigo mismo. Mueve el punto por otro sitio.",
    area_nula:              "Ese contorno no encierra superficie.",
    pocos_vertices:         "Ese contorno no tiene forma. Vuelve a marcarlo.",
    coordenada_no_finita:   "Ese contorno no es válido. Vuelve a marcarlo.",
    se_cruza_consigo_mismo: "Ese contorno se cruza consigo mismo. Prueba a mover el punto por otro sitio.",
    fuera_de_la_parcela:    "Se sale de tu parcela. Muévelo hacia dentro.",
    se_solapa:              "Se pisa con otro cultivo que ya has añadido.",
    no_cabe:                "No queda tanta superficie sin asignar en esta parcela.",
  };
  const explicar = (motivo) => MOTIVOS[motivo] || null;

  // ─── El estado del flujo ─────────────────────────────────────────────────
  //
  // ⚠️ YA NO SE PREGUNTA "¿CUÁNTOS CULTIVOS TIENES?". Esa pregunta obliga al
  // agricultor a contarse el campo antes de haber entendido qué le vamos a
  // pedir, y tampoco es lo que queremos saber: Kylia no gestiona su terreno
  // entero, gestiona los cultivos que él elija llevar aquí. Se añade uno, y
  // luego otro si quiere.
  //
  //   terreno → cultivo → superficie → fecha → riego → guardado
  //
  // Es un objeto plano a propósito: se serializa, se guarda como borrador y se
  // inspecciona en un test sin tener que instanciar nada.
  const PASOS = ["terreno", "cultivo", "superficie", "fecha", "riego", "guardado"];

  function nuevoFlujo(parcela = null) {
    return { parcela, cultivos: [], borrador: parcela ? nuevoBorrador(parcela) : null,
             paso: parcela ? "cultivo" : "terreno" };
  }

  function elegirParcela(flujo, parcela) {
    return { ...flujo, parcela, paso: "cultivo", cultivos: [], borrador: nuevoBorrador(parcela) };
  }

  // Un cultivo en curso. Nace SIN nada declarado: ni superficie, ni fecha, ni
  // riego. Lo que no haya dicho él, no está.
  function nuevoBorrador(parcela) {
    return {
      cultivo: null, cultivoId: null, soportado: null,
      // La superficie sale del polígono, siempre. Aquí no se declara.
      area_m2: null, geometria: null, ocupaTodo: false,
      // `fechaPrecision` distingue tres cosas que no son lo mismo:
      //   "exacta"     → eligió un día en el calendario
      //   "aproximada" → dijo "hace unas dos semanas", y eso NO es un día
      //   null         → "no me acuerdo": no hay fecha, y no se inventa
      fechaPlantacion: null, fechaPrecision: null,
      metodoRiego: null, riego: null, caudal: null, capacidadRegaderaL: null,
      paso: "cultivo",
    };
  }

  const SIGUIENTE = { cultivo: "superficie", superficie: "fecha", fecha: "riego", riego: "hecho" };

  // Qué hace falta para poder pasar de pantalla. Lo que se puede dejar para
  // después se deja: la fecha y el riego pueden quedar pendientes a propósito,
  // porque obligar a contestarlos es cómo se fabrica un dato falso.
  function completo(borrador, paso) {
    if (!borrador) return false;
    if (paso === "cultivo")    return !!borrador.cultivoId;
    if (paso === "superficie") return !!borrador.geometria;
    // "No me acuerdo" es una respuesta válida: `fechaPendiente` lo marca.
    if (paso === "fecha")      return !!borrador.fechaPlantacion || borrador.fechaPendiente === true;
    // "Lo indicaré después" también.
    if (paso === "riego")      return !!borrador.metodoRiego || borrador.riegoPendiente === true;
    return false;
  }

  function avanzar(flujo, geo = null) {
    const b = flujo.borrador;
    if (!completo(b, b?.paso)) return flujo;
    const siguiente = SIGUIENTE[b.paso];
    if (siguiente !== "hecho") return { ...flujo, borrador: { ...b, paso: siguiente } };
    return guardarCultivo(flujo, geo);
  }

  function atras(flujo) {
    const b = flujo.borrador;
    if (!b) return { ...flujo, paso: "cultivo", borrador: nuevoBorrador(flujo.parcela) };
    const i = PASOS.indexOf(b.paso);
    // ⚠️ VOLVER ATRÁS NO BORRA NADA. El borrador entero se conserva: retroceder
    // para mirar algo y perder lo contestado es la forma más rápida de que
    // alguien abandone el alta.
    if (i <= 1) return { ...flujo, paso: "terreno" };
    return { ...flujo, borrador: { ...b, paso: PASOS[i - 1] } };
  }

  // Cierra el cultivo en curso. Cada uno se queda con LO SUYO: su fecha, su
  // riego, su caudal y su procedencia. Compartirlos entre cultivos fue el
  // defecto que se cerró el 16-sep y no puede volver por esta puerta.
  function guardarCultivo(flujo, geo = null) {
    const b = flujo.borrador;
    if (!b || !completo(b, "riego") || !b.cultivoId || !b.geometria) return flujo;
    // ⚠️ EL ÁREA SALE DEL POLÍGONO. Si se pasa el módulo de geometría, manda él:
    // así el invariante "area_m2 == area(GeoJSON)" no depende de que la pantalla
    // se haya acordado de recalcularla.
    const area = geo?.areaDePolygon ? geo.areaDePolygon(b.geometria) : m2(b.area_m2) || null;
    const cultivo = {
      id: b.id || null,
      cultivo: b.cultivoId, soportado: !!b.soportado,
      area_m2: area, geometria: b.geometria,
      fechaPlantacion: b.fechaPlantacion || null,
      fechaPrecision: b.fechaPlantacion ? (b.fechaPrecision || "exacta") : null,
      metodoRiego: b.metodoRiego || null,
      // ⚠️ MARCA EXPLÍCITA, no un valor falsy. Una alta nueva que dice "lo
      // indicaré después" y una siembra histórica que nunca declaró su riego
      // tienen los mismos campos a null, y por eso la nueva se interpretaba como
      // legacy y heredaba el método y el caudal de la finca. Esto las distingue.
      riegoPendiente: !!b.riegoPendiente,
      caudal: b.caudal ?? null, riego: b.riego || null,
      capacidadRegaderaL: b.capacidadRegaderaL ?? null,
    };
    // ⚠️ POR ID, NO POR POSICIÓN. Pulsar dos veces "guardar" o volver atrás y
    // repetir no puede dejar el cultivo duplicado.
    const yaEsta = b.id && flujo.cultivos.some(c => c.id === b.id);
    const cultivos = yaEsta ? flujo.cultivos.map(c => (c.id === b.id ? { ...c, ...cultivo } : c))
                            : [...flujo.cultivos, cultivo];
    return { ...flujo, cultivos, borrador: null, paso: "guardado", ultimo: cultivo };
  }

  function anadirOtro(flujo) {
    return { ...flujo, paso: "cultivo", ultimo: null, borrador: nuevoBorrador(flujo.parcela) };
  }

  const libres = (flujo) => reparto(flujo.parcela, flujo.cultivos).sin_configurar;

  // ─── "Usar todo el terreno" ──────────────────────────────────────────────
  // SOLO cuando podemos construir el polígono EXACTO, o sea con el terreno aún
  // sin cultivos: entonces "todo" es literalmente su contorno —agujeros
  // incluidos— y se copia tal cual. Con cultivos dentro, lo que queda libre es
  // una diferencia geométrica que no sabemos dibujar, y asignar los metros sin
  // polígono es inventarse un dato.
  const puedeUsarTodo = (flujo) => (flujo?.cultivos?.length || 0) === 0
                                   && !!flujo?.parcela?.geometria;

  function usarTodoElTerreno(flujo) {
    const b = flujo.borrador;
    if (!b || !puedeUsarTodo(flujo)) return flujo;
    // El GeoJSON COMPLETO: si el terreno tiene una caseta dentro, el cultivo
    // tampoco la ocupa.
    return { ...flujo, borrador: { ...b, ocupaTodo: true,
             geometria: JSON.parse(JSON.stringify(flujo.parcela.geometria)), area_m2: null } };
  }

  // ─── Los TRES estados, que no son el mismo ───────────────────────────────
  //   registrado            → el cultivo existe y lo declarado está guardado
  //   lista_para_calcular_agua → se puede saber cuánta agua necesita
  //   lista_para_ejecutar_riego → además, cuántos minutos regar
  //
  // Y los pendientes se expresan como ACCIÓN, no como campo que falta: "falta
  // medir la instalación" y no "capacidad_mmh: null".
  function pendientesDe(cultivo = {}, riegoAPI = null) {
    const p = [];
    if (!cultivo.fechaPlantacion) p.push({ clave: "fecha", texto: "Falta decirnos cuándo lo plantaste" });
    if (!cultivo.metodoRiego)     p.push({ clave: "metodo", texto: "Falta decirnos cómo lo riegas" });
    else if (riegoAPI) {
      const ev = riegoAPI.evaluarCapacidadRiego(cultivo.riego, cultivo.metodoRiego);
      const unidad = riegoAPI.UNIDAD_ORDEN?.[cultivo.metodoRiego];
      if (unidad === "min" && !ev.puede_ejecutar) {
        p.push({ clave: "capacidad", texto: "Falta medir la instalación" });
      }
      if (unidad === "regaderas" && !(Number(cultivo.capacidadRegaderaL) > 0)) {
        p.push({ clave: "regadera", texto: "Falta decirnos cuántos litros caben en tu regadera" });
      }
    }
    if (!cultivo.soportado) {
      p.push({ clave: "sin_motor", texto: "Todavía no calculamos el riego de este cultivo" });
    }
    return p;
  }

  // ─── Borrador: se guarda y se retoma ─────────────────────────────────────
  // Cerrar la app a mitad del alta —una llamada, el móvil que se bloquea— no
  // puede costarle empezar de cero. Se guarda el flujo entero, que es un objeto
  // plano, y se recupera tal cual.
  //
  // ⚠️ UN BORRADOR NO ES UNA SIEMBRA. Vive en su propia clave y solo se
  // convierte en cultivo cuando él lo guarda; recuperarlo no crea nada.
  const CLAVE_BORRADOR = "kylia_alta_borrador";

  function guardarBorrador(almacen, flujo) {
    try {
      if (!flujo || (!flujo.parcela && !flujo.cultivos?.length)) return false;
      almacen.setItem(CLAVE_BORRADOR, JSON.stringify({ v: 1, guardado: Date.now(), flujo }));
      return true;
    } catch (_) { return false; }
  }
  function leerBorrador(almacen) {
    try {
      const d = JSON.parse(almacen.getItem(CLAVE_BORRADOR) || "null");
      if (!d || d.v !== 1 || !d.flujo) return null;
      // Un borrador de hace semanas ya no es lo que estaba haciendo.
      if (Date.now() - (d.guardado || 0) > 1000 * 60 * 60 * 24 * 14) return null;
      return d.flujo;
    } catch (_) { return null; }
  }
  const borrarBorrador = (almacen) => { try { almacen.removeItem(CLAVE_BORRADOR); return true; } catch (_) { return false; } };

  return { PASOS, reparto, cabe, explicar, MOTIVOS,
           nuevoFlujo, elegirParcela, nuevoBorrador, completo, avanzar, atras,
           guardarCultivo, anadirOtro, libres, usarTodoElTerreno, puedeUsarTodo,
           pendientesDe, CLAVE_BORRADOR, guardarBorrador, leerBorrador, borrarBorrador };
});
