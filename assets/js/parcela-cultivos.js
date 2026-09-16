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
  // Lo que el agricultor ve en la pantalla de reparto. `sin_asignar` puede ser
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
      sin_asignar: Math.max(0, Math.round(total - asignado)),
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
    const r = reparto(parcela, ocupados);
    const area = m2(candidato?.area_m2);
    if (area > 0 && area > r.sin_asignar + tolerancia) {
      return { ok: false, motivo: "no_cabe", sin_asignar: r.sin_asignar, pedido: Math.round(area) };
    }
    return { ok: true, motivo: null };
  }

  const MOTIVOS = {
    sin_geometria:          "Marca en el mapa qué parte ocupa este cultivo.",
    se_cruza_consigo_mismo: "Ese contorno se cruza consigo mismo. Prueba a mover el punto por otro sitio.",
    fuera_de_la_parcela:    "Se sale de tu parcela. Muévelo hacia dentro.",
    se_solapa:              "Se pisa con otro cultivo que ya has añadido.",
    no_cabe:                "No queda tanta superficie sin asignar en esta parcela.",
  };
  const explicar = (motivo) => MOTIVOS[motivo] || null;

  // ─── El estado del flujo ─────────────────────────────────────────────────
  // Una parcela, los cultivos que lleve, y en qué paso va el que se está
  // añadiendo. Es un objeto plano a propósito: se serializa, se inspecciona en
  // un test y no esconde nada.
  function nuevoFlujo(parcela = null) {
    return { parcela, cultivos: [], borrador: null, paso: parcela ? "cuantos" : "parcela",
             cuantos: null };
  }

  function elegirParcela(flujo, parcela) {
    return { ...flujo, parcela, paso: "cuantos", cultivos: [], borrador: null, cuantos: null };
  }

  // "1 cultivo" / "varios" / "ninguno". Lo único que hace falta saber: no se le
  // pregunta "¿tienes 2, 3, 4?" — se añaden tantos como haga falta.
  function responderCuantos(flujo, respuesta) {
    if (respuesta === "ninguno") return { ...flujo, cuantos: "ninguno", paso: "resumen" };
    const uno = respuesta === "uno";
    return { ...flujo, cuantos: uno ? "uno" : "varios", paso: "cultivo",
             // Con un solo cultivo se propone que ocupe la parcela entera, que
             // es el caso corriente; sigue pudiendo ajustarlo.
             borrador: nuevoBorrador(flujo.parcela, uno) };
  }

  function nuevoBorrador(parcela, ocuparTodo = false) {
    return { cultivo: null, cultivoId: null, soportado: null,
             area_m2: ocuparTodo ? m2(parcela?.superficie_m2 ?? parcela?.area_m2) : null,
             geometria: ocuparTodo ? (parcela?.geometria || null) : null,
             ocupaTodo: !!ocuparTodo,
             fechaPlantacion: null, metodoRiego: null, riego: null, caudal: null,
             paso: "cultivo" };
  }

  const PASO_SIGUIENTE = { cultivo: "superficie", superficie: "fecha", fecha: "riego", riego: "hecho" };

  // Avanza SOLO si el paso actual está contestado. El flujo no puede saltarse
  // una pregunta y dejar el cultivo a medias: un cultivo sin fecha no tiene
  // reloj fenológico, y uno sin superficie no tiene ni plan de abonado.
  function completo(borrador, paso) {
    if (!borrador) return false;
    if (paso === "cultivo")    return !!borrador.cultivoId;
    if (paso === "superficie") return m2(borrador.area_m2) > 0;
    if (paso === "fecha")      return !!borrador.fechaPlantacion;
    if (paso === "riego")      return !!borrador.metodoRiego;
    return false;
  }

  function avanzar(flujo) {
    const b = flujo.borrador;
    if (!completo(b, b?.paso)) return flujo;
    const siguiente = PASO_SIGUIENTE[b.paso];
    if (siguiente !== "hecho") {
      return { ...flujo, borrador: { ...b, paso: siguiente } };
    }
    return guardarCultivo(flujo);
  }

  // Cierra el cultivo en curso. Cada uno se queda con LO SUYO: su fecha, su
  // riego, su caudal y su procedencia. Compartirlos entre cultivos fue el
  // defecto que se cerró el 16-sep y no puede volver por esta puerta.
  function guardarCultivo(flujo) {
    const b = flujo.borrador;
    if (!b || !completo(b, "riego")) return flujo;
    const cultivo = {
      id: b.id || null,
      cultivo: b.cultivoId, soportado: !!b.soportado,
      area_m2: Math.round(m2(b.area_m2)), geometria: b.geometria || null,
      fechaPlantacion: b.fechaPlantacion,
      metodoRiego: b.metodoRiego, caudal: b.caudal ?? null, riego: b.riego || null,
    };
    const cultivos = b.id
      ? flujo.cultivos.map(c => (c.id === b.id ? { ...c, ...cultivo } : c))
      : [...flujo.cultivos, cultivo];
    return { ...flujo, cultivos, borrador: null, paso: "resumen" };
  }

  function anadirOtro(flujo) {
    return { ...flujo, paso: "cultivo", borrador: nuevoBorrador(flujo.parcela, false) };
  }

  // Cuánto queda libre AHORA, contando lo ya guardado y sin contar el borrador.
  const libres = (flujo) => reparto(flujo.parcela, flujo.cultivos).sin_asignar;

  // "Usar toda la superficie disponible": el atajo que evita dibujar cuando el
  // cultivo ocupa lo que queda. Con la parcela vacía es la parcela entera.
  function usarTodoLoLibre(flujo) {
    const b = flujo.borrador;
    if (!b) return flujo;
    const soloEl = flujo.cultivos.length === 0;
    return { ...flujo, borrador: { ...b, ocupaTodo: true,
      area_m2: libres(flujo),
      // Solo se puede heredar el contorno de la parcela si no hay nadie más:
      // con vecinos, el trozo libre no es un polígono que sepamos dibujar solos.
      geometria: soloEl ? (flujo.parcela?.geometria || null) : b.geometria } };
  }

  return { PASOS_CULTIVO, reparto, cabe, explicar, MOTIVOS,
           nuevoFlujo, elegirParcela, responderCuantos, nuevoBorrador,
           completo, avanzar, guardarCultivo, anadirOtro, libres, usarTodoLoLibre };
});
