// ─────────────────────────────────────────────────────────────────
// Geometría de parcela — partir un recinto por una línea recta
// ─────────────────────────────────────────────────────────────────
// Núcleo PURO compartido navegador ↔ Node (mismo patrón que motor-riego.js):
// el navegador lo carga con <script src> y los tests hacen require().
//
// POR QUÉ EXISTE. Un recinto de SIGPAC es homogéneo en USO declarado, no en
// cultivo: dentro puede haber lechuga en una mitad y cebolla en la otra.
// En parcelas pequeñas eso se resuelve repartiendo METROS y ya está — la
// geometría solo la necesita el satélite, y una subzona de un recinto pequeño
// nunca llega a las 0,5 ha que hacen falta.
//
// Pero en una finca GRANDE no: 5 ha partidas en 3 + 2 dejan las dos partes muy
// por encima del umbral, y entonces cada una puede tener SU PROPIA medida de
// satélite. Renunciar al contorno ahí es renunciar al satélite justo en las
// parcelas donde funciona bien. De ahí este fichero.
//
// El corte es una LÍNEA RECTA porque así es como se trabaja de verdad un campo
// grande (y porque son dos toques en el móvil, no dibujar un polígono a dedo).

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KyliaGeo = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const R_TIERRA = 6378137;                 // radio WGS-84 (m)
  const rad = (d) => (d * Math.PI) / 180;

  // Un grado de longitud mide menos que uno de latitud según subes en latitud
  // (a 41°N, ~0,75×). Sin corregirlo, una línea "recta" en grados sale torcida
  // sobre el terreno y las áreas de las dos partes salen mal repartidas. Se
  // trabaja en un plano local en metros y se vuelve a grados al final.
  function proyector(latRef) {
    const kx = Math.cos(rad(latRef)) * R_TIERRA * Math.PI / 180;
    const ky = R_TIERRA * Math.PI / 180;
    return {
      aPlano:  ([lon, lat]) => [lon * kx, lat * ky],
      aGrados: ([x, y])     => [x / kx, y / ky],
    };
  }

  // Área de un anillo en m² por la fórmula del exceso esférico. Es la misma que
  // ya usaba la app para "usar toda la parcela"; aquí sirve para repartir la
  // superficie entre las dos partes del corte.
  function areaM2(ring) {
    if (!ring || ring.length < 3) return 0;
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
      const [lo1, la1] = ring[i];
      const [lo2, la2] = ring[(i + 1) % ring.length];
      a += rad(lo2 - lo1) * (2 + Math.sin(rad(la1)) + Math.sin(rad(la2)));
    }
    return Math.abs((a * R_TIERRA * R_TIERRA) / 2);
  }

  // Anillo exterior de un Polygon o MultiPolygon, sin el vértice de cierre.
  function anilloExterior(geometry) {
    if (!geometry) return null;
    const ring = geometry.type === "Polygon"      ? geometry.coordinates[0]
               : geometry.type === "MultiPolygon" ? geometry.coordinates[0][0]
               : null;
    if (!ring || ring.length < 4) return null;
    const cerrado = ring[0][0] === ring[ring.length - 1][0]
                 && ring[0][1] === ring[ring.length - 1][1];
    return cerrado ? ring.slice(0, -1) : ring.slice();
  }

  function cerrar(ring) {
    return ring.concat([ring[0]]);
  }

  // Parte un recinto en DOS por la recta que pasa por p1 y p2 (la recta se
  // prolonga: basta con marcar la dirección, no hace falta acertar en el borde).
  //
  //   geometry : GeoJSON Polygon / MultiPolygon
  //   p1, p2   : [lon, lat] — los dos puntos que marca el agricultor
  //   opts.superficieOficialM2 : el dn_surface de SIGPAC, si se conoce
  //
  // LO DE LA SUPERFICIE OFICIAL NO ES UN ADORNO. Un recinto puede traer HUECOS
  // (una caseta, una balsa, un rodal de arbolado): son anillos interiores del
  // polígono, y aquí solo se usa el exterior. Medido sobre SIGPAC real, un
  // recinto de Palafolls con 4 huecos daba 79.568 m² por geometría contra los
  // 73.566 oficiales — un 8% de más. Como los kg del plan de abonado escalan con
  // la superficie, ese 8% se convertiría en 8% de abono de más en ese cultivo.
  // Así que la geometría decide el REPARTO (qué proporción va a cada lado) y la
  // cifra oficial de SIGPAC pone el TOTAL, que es la que está certificada y la
  // que ya usa el resto de la app.
  //
  // Devuelve { ok:true, partes:[{geometria, area_m2}, ...] } o { ok:false, motivo }.
  // Solo acepta el corte LIMPIO (la recta entra y sale una vez). Con una parcela
  // muy irregular la recta puede cruzarla 4 o 6 veces y entonces el resultado
  // serían trozos sueltos que no se corresponden con lo que el agricultor tenía
  // en la cabeza: mejor decírselo que devolver algo raro.
  function partirPorLinea(geometry, p1, p2, opts = {}) {
    const ring = anilloExterior(geometry);
    if (!ring) return { ok: false, motivo: "sin_geometria" };

    const latRef = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const { aPlano, aGrados } = proyector(latRef);

    const A = aPlano(p1), B = aPlano(p2);
    const dx = B[0] - A[0], dy = B[1] - A[1];
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return { ok: false, motivo: "puntos_iguales" };

    const plano = ring.map(aPlano);
    // A qué lado de la recta cae cada vértice (producto vectorial).
    const lado = plano.map(([x, y]) => dx * (y - A[1]) - dy * (x - A[0]));

    // Recorre el anillo buscando los cruces. Un vértice EXACTAMENTE sobre la
    // recta se cuenta hacia un solo lado (>= 0) para no generar cruces dobles.
    const cortes = [];   // { indice: tras qué vértice entra, punto: [x,y] }
    const n = plano.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const li = lado[i], lj = lado[j];
      if ((li >= 0) === (lj >= 0)) continue;          // no cruza
      const t = li / (li - lj);                        // interpolación al cruce
      cortes.push({
        indice: i,
        punto: [plano[i][0] + t * (plano[j][0] - plano[i][0]),
                plano[i][1] + t * (plano[j][1] - plano[i][1])],
      });
    }

    if (cortes.length === 0) return { ok: false, motivo: "no_cruza" };
    if (cortes.length !== 2)  return { ok: false, motivo: "corte_multiple", cruces: cortes.length };

    const [c1, c2] = cortes;
    // Parte 1: del primer cruce al segundo siguiendo el anillo.
    const parte1 = [c1.punto];
    for (let k = c1.indice + 1; k <= c2.indice; k++) parte1.push(plano[k % n]);
    parte1.push(c2.punto);
    // Parte 2: el resto del anillo.
    const parte2 = [c2.punto];
    for (let k = c2.indice + 1; k <= c1.indice + n; k++) parte2.push(plano[k % n]);
    parte2.push(c1.punto);

    const crudas = [parte1, parte2].map((p) => {
      const enGrados = cerrar(p.map(aGrados).map(([lo, la]) =>
        [Math.round(lo * 1e6) / 1e6, Math.round(la * 1e6) / 1e6]));
      return {
        geometria: { type: "Polygon", coordinates: [enGrados] },
        areaGeom: areaM2(enGrados.slice(0, -1)),
      };
    });

    const sumaGeom = crudas.reduce((s, p) => s + p.areaGeom, 0);
    if (!(sumaGeom > 0)) return { ok: false, motivo: "parte_vacia" };

    // La geometría reparte; la superficie oficial pone el total (ver arriba).
    const oficial = Number(opts.superficieOficialM2);
    const escala  = Number.isFinite(oficial) && oficial > 0 ? oficial / sumaGeom : 1;

    const partes = crudas
      .map((p) => ({
        geometria: p.geometria,
        area_m2: Math.round(p.areaGeom * escala),
        fraccion: Math.round((p.areaGeom / sumaGeom) * 1000) / 1000,
      }))
      // La mayor primero: es la que el agricultor asocia con su cultivo
      // principal, y así el reparto sale en el orden que espera.
      .sort((a, b) => b.area_m2 - a.area_m2);

    if (partes.some((p) => p.area_m2 <= 0)) return { ok: false, motivo: "parte_vacia" };
    return { ok: true, partes, superficie_oficial_usada: escala !== 1 };
  }

  // ── Editar el contorno vértice a vértice ────────────────────────────────
  // SIGPAC da el recinto oficial, pero un cultivo casi nunca ocupa el recinto
  // entero ni tiene su forma: en una misma finca hay varios cultivos y varios
  // riegos. Esto permite ajustar el contorno de cada uno arrastrando sus
  // esquinas.
  //
  // La superficie que sale de aquí no es decorativa: escala los kg del plan de
  // abonado y los litros totales. Por eso el que manda es `esSimple`.

  function polDe(ring) {
    return { type: "Polygon", coordinates: [cerrar(ring)] };
  }

  // ¿Se cruzan dos segmentos? Orientaciones opuestas a cada lado = cruce.
  function orientacion(a, b, c) {
    const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    return v > 1e-14 ? 1 : v < -1e-14 ? -1 : 0;
  }
  function seCruzan(p1, p2, p3, p4) {
    const d1 = orientacion(p3, p4, p1), d2 = orientacion(p3, p4, p2);
    const d3 = orientacion(p1, p2, p3), d4 = orientacion(p1, p2, p4);
    return d1 !== d2 && d3 !== d4;   // el caso colineal no se persigue: no cambia el área
  }

  // Un polígono con un lazo (una "pajarita") tiene un área que NO es la del
  // terreno: la fórmula suma un trozo en negativo. Como esa cifra acaba en los
  // kg de abono y en los litros, arrastrar un vértice hasta cruzar un lado tiene
  // que RECHAZARSE, no corregirse por detrás. Sin esto el error es invisible:
  // el mapa se ve raro un segundo y el número queda mal para siempre.
  function esSimple(ring) {
    if (!ring || ring.length < 3) return false;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        // Lados contiguos comparten vértice: se saltan, igual que el par
        // primero-último, que también es contiguo por el cierre.
        if (j === i || j === i + 1 || (i === 0 && j === n - 1)) continue;
        if (seCruzan(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return false;
      }
    }
    return true;
  }

  // Mueve un vértice. Devuelve {ok:false} si el resultado se cruza consigo mismo
  // — el que llama debe dejar el vértice donde estaba.
  function moverVertice(geometry, indice, destino) {
    const ring = anilloExterior(geometry);
    if (!ring || indice < 0 || indice >= ring.length) return { ok: false, motivo: "indice" };
    const nuevo = ring.slice();
    nuevo[indice] = [Number(destino[0]), Number(destino[1])];
    if (!esSimple(nuevo)) return { ok: false, motivo: "se_cruza" };
    return { ok: true, geometria: polDe(nuevo), area_m2: Math.round(areaM2(nuevo)) };
  }

  // Añade un vértice partiendo el lado `indiceLado` por su punto medio. Es lo
  // que convierte "cuatro esquinas" en un contorno que puede seguir la forma
  // real de un bancal.
  function insertarVertice(geometry, indiceLado) {
    const ring = anilloExterior(geometry);
    if (!ring || indiceLado < 0 || indiceLado >= ring.length) return { ok: false, motivo: "indice" };
    const a = ring[indiceLado], b = ring[(indiceLado + 1) % ring.length];
    const nuevo = ring.slice();
    nuevo.splice(indiceLado + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    return { ok: true, geometria: polDe(nuevo), area_m2: Math.round(areaM2(nuevo)), indice: indiceLado + 1 };
  }

  // Quita un vértice. Por debajo de 3 no hay polígono que valga.
  function quitarVertice(geometry, indice) {
    const ring = anilloExterior(geometry);
    if (!ring || indice < 0 || indice >= ring.length) return { ok: false, motivo: "indice" };
    if (ring.length <= 3) return { ok: false, motivo: "minimo_3" };
    const nuevo = ring.slice();
    nuevo.splice(indice, 1);
    if (!esSimple(nuevo)) return { ok: false, motivo: "se_cruza" };
    return { ok: true, geometria: polDe(nuevo), area_m2: Math.round(areaM2(nuevo)) };
  }

  // Punto de partida para un cultivo que aún no tiene contorno: un rectángulo
  // de la superficie que se le ha asignado, centrado en el recinto. El
  // agricultor arrastra las esquinas desde ahí en vez de dibujar de cero.
  function rectanguloCentrado(geometryRecinto, areaObjetivoM2) {
    const ring = anilloExterior(geometryRecinto);
    if (!ring || !(areaObjetivoM2 > 0)) return null;

    const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const { aPlano, aGrados } = proyector(lat);

    // Proporción del recinto, para que el rectángulo nazca con su forma en vez
    // de cuadrado: encaja mejor en un bancal alargado y hay menos que arrastrar.
    const plano = ring.map(aPlano);
    const ancho = Math.max(...plano.map(p => p[0])) - Math.min(...plano.map(p => p[0]));
    const alto  = Math.max(...plano.map(p => p[1])) - Math.min(...plano.map(p => p[1]));
    const razon = ancho > 0 && alto > 0 ? ancho / alto : 1;

    const ladoY = Math.sqrt(areaObjetivoM2 / razon);
    const ladoX = areaObjetivoM2 / ladoY;
    const c = aPlano([lon, lat]);
    const esquinas = [
      [c[0] - ladoX / 2, c[1] - ladoY / 2],
      [c[0] + ladoX / 2, c[1] - ladoY / 2],
      [c[0] + ladoX / 2, c[1] + ladoY / 2],
      [c[0] - ladoX / 2, c[1] + ladoY / 2],
    ].map(aGrados);

    return { geometria: polDe(esquinas), area_m2: Math.round(areaM2(esquinas)) };
  }

  // ¿Cae este punto dentro del contorno? Ray casting clásico sobre el anillo
  // exterior. Los huecos interiores no se miran a propósito: la pregunta que
  // resuelve esto es "¿el agricultor está en su parcela?", y estar de pie junto
  // a la caseta o la balsa que forman el hueco sigue siendo estar en ella.
  //
  // Lo que decide: si el GPS cae dentro, el contorno que ya tenía guardado sigue
  // siendo el suyo y NO se toca. Antes, actualizar la ubicación borraba la
  // parcela sin avisar, y con ella la referencia del satélite y la superficie.
  function contieneAlPunto(geometry, punto) {
    const ring = anilloExterior(geometry);
    if (!ring || ring.length < 3 || !Array.isArray(punto)) return false;
    const [x, y] = [Number(punto[0]), Number(punto[1])];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

    let dentro = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      // El lado cruza la horizontal del punto, y el corte cae a su derecha.
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        dentro = !dentro;
      }
    }
    return dentro;
  }

  // ─── Un cultivo dentro de su parcela, sin pisar a los vecinos ────────────
  //
  // ⚠️ AQUÍ NO SE ENCOGE NADA. La primera versión muestreaba los polígonos
  // tirando los puntos un 0,5% hacia su centro para que "compartir borde" no
  // contase como "compartir área". Funcionaba para el caso de la linde y fallaba
  // para todo lo demás: en una parcela de 100×100 m dejaba pasar un solape de
  // 10 m² y una salida de 20 m², porque ambos caben dentro de ese 0,5%. Un
  // margen relativo aplicado a una pregunta topológica da respuestas falsas
  // proporcionales al tamaño del campo.
  //
  // LO QUE SE HACE AHORA. No hace falta recortar polígonos ni medir áreas de
  // intersección: para polígonos SIMPLES, "¿el área compartida es cero o
  // positiva?" se decide de forma EXACTA con dos predicados.
  //
  //   · cruce PROPIO de bordes → los bordes se atraviesan de verdad, en un punto
  //     interior a los dos segmentos. Tocarse en un vértice o compartir un tramo
  //     de linde NO es un cruce propio, y por eso compartir borde sigue valiendo.
  //   · punto ESTRICTAMENTE interior de uno dentro del otro → uno contiene al
  //     otro, aunque sus bordes no se crucen.
  //
  // Dos polígonos simples comparten área si y solo si se da una de las dos. Sin
  // tolerancia relativa, sin muestreo y sin depender de lo grande que sea el
  // campo. La única tolerancia que queda es el epsilon numérico de los propios
  // cálculos en coma flotante.

  const EPS = 1e-12;          // epsilon numérico, no una tolerancia agronómica
  const AREA_MIN_M2 = 0.5;    // por debajo de esto no es un recinto, es un error

  const cruz = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const signo = (v) => (v > EPS ? 1 : v < -EPS ? -1 : 0);
  const enCaja = (p, q, r) =>
    Math.min(p[0], q[0]) - EPS <= r[0] && r[0] <= Math.max(p[0], q[0]) + EPS &&
    Math.min(p[1], q[1]) - EPS <= r[1] && r[1] <= Math.max(p[1], q[1]) + EPS;

  // CRUCE PROPIO: los dos segmentos se atraviesan en un punto interior a ambos.
  // Si alguno de los cuatro giros sale 0, hay contacto (vértice compartido o
  // tramo colineal) y eso NO es atravesar.
  function crucePropio(a, b, c, d) {
    const d1 = signo(cruz(a, b, c)), d2 = signo(cruz(a, b, d));
    const d3 = signo(cruz(c, d, a)), d4 = signo(cruz(c, d, b));
    return d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0 && d1 !== d2 && d3 !== d4;
  }

  const enSegmento = (p, q, r) => signo(cruz(p, q, r)) === 0 && enCaja(p, q, r);

  // Dónde cae un punto respecto de un anillo: dentro, en el borde, o fuera. El
  // borde se distingue a propósito — es lo que permite que dos cultivos
  // compartan linde sin que eso cuente como pisarse.
  function situarPunto(anillo, p) {
    const n = anillo.length;
    for (let i = 0; i < n; i++) {
      if (enSegmento(anillo[i], anillo[(i + 1) % n], p)) return "borde";
    }
    let dentro = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
      if ((yi > p[1]) !== (yj > p[1]) &&
          p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro ? "dentro" : "fuera";
  }

  const medio = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const ladosDe = (anillo) => anillo.map((p, i) => [p, anillo[(i + 1) % anillo.length]]);

  function hayCrucePropio(ra, rb) {
    for (const [a, b] of ladosDe(ra)) {
      for (const [c, d] of ladosDe(rb)) if (crucePropio(a, b, c, d)) return true;
    }
    return false;
  }

  // ─── Validación canónica de un Polygon GeoJSON ───────────────────────────
  // UNA sola puerta. Antes cada función comprobaba lo que le parecía: una
  // pajarita pasaba como válida, un polígono de área cero también, y uno vacío
  // reventaba con una excepción en vez de decir qué le pasaba. Aquí nada lanza:
  // lo que no vale, sale con su motivo.
  //
  // ⚠️ RECIBE GeoJSON, no un anillo. El contrato está en el nombre a propósito:
  // `esSimple` espera un ANILLO y se le estaba pasando el GeoJSON entero, así
  // que devolvía true para cualquier cosa y las pajaritas se colaban.
  function validarPolygonGeoJSON(geom) {
    if (!geom || typeof geom !== "object") return { ok: false, motivo: "sin_geometria" };
    const tipo = geom.type;
    if (tipo !== "Polygon" && tipo !== "MultiPolygon") return { ok: false, motivo: "tipo_no_soportado" };
    let anillo;
    try { anillo = anilloExterior(geom); } catch (_) { return { ok: false, motivo: "sin_coordenadas" }; }
    if (!Array.isArray(anillo) || anillo.length < 3) return { ok: false, motivo: "pocos_vertices" };
    for (const p of anillo) {
      if (!Array.isArray(p) || p.length < 2) return { ok: false, motivo: "sin_coordenadas" };
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return { ok: false, motivo: "coordenada_no_finita" };
    }
    // Vértices repetidos seguidos: no aportan lado y estropean los predicados.
    const limpio = anillo.filter((p, i) => {
      const q = anillo[(i + 1) % anillo.length];
      return Math.abs(p[0] - q[0]) > EPS || Math.abs(p[1] - q[1]) > EPS;
    });
    if (limpio.length < 3) return { ok: false, motivo: "pocos_vertices" };
    // ⚠️ LA SIMPLICIDAD SE MIRA ANTES QUE EL ÁREA. El área de Gauss de una
    // pajarita simétrica se cancela y sale ~0, así que comprobando primero el
    // área se la acusaba de "área nula" — cierto de la fórmula, y equivocado
    // sobre lo que le pasa. El motivo que se enseña tiene que ser el de verdad.
    if (!esSimple(limpio)) return { ok: false, motivo: "se_cruza_consigo_mismo" };
    const area = areaM2(limpio);
    if (!Number.isFinite(area) || area < AREA_MIN_M2) return { ok: false, motivo: "area_nula" };
    return { ok: true, motivo: null, anillo: limpio, area_m2: Math.round(area) };
  }

  // ¿Está `interior` ENTERO dentro de `exterior`? Ocupar la parcela entera vale;
  // sobresalir una franja, por estrecha que sea, no. Exacto, sin tolerancia.
  function contenidoEn(interior, exterior) {
    const vi = validarPolygonGeoJSON(interior), ve = validarPolygonGeoJSON(exterior);
    if (!vi.ok || !ve.ok) return false;
    const ri = vi.anillo, re = ve.anillo;
    // Un solo vértice fuera ya lo descarta.
    for (const p of ri) if (situarPunto(re, p) === "fuera") return false;
    // Atravesar el borde: es lo que pasa cuando sobresale un trozo, y también
    // cuando un cultivo cruza el hueco de una parcela en forma de L.
    if (hayCrucePropio(ri, re)) return false;
    // Y el punto medio de cada lado: cubre el caso de salir y volver a entrar
    // justo por dos vértices del exterior, donde no hay cruce propio.
    for (const [a, b] of ladosDe(ri)) if (situarPunto(re, medio(a, b)) === "fuera") return false;
    return true;
  }

  // ¿Comparten ÁREA dos cultivos? Compartir un punto o un tramo de linde NO
  // cuenta: el área de intersección de eso es cero, y dos bancales pegados es lo
  // normal en un campo.
  function seSolapan(a, b) {
    const va = validarPolygonGeoJSON(a), vb = validarPolygonGeoJSON(b);
    if (!va.ok || !vb.ok) return false;
    const ra = va.anillo, rb = vb.anillo;
    if (hayCrucePropio(ra, rb)) return true;
    // ⚠️ UNO DENTRO DEL OTRO, INCLUIDO SER EL MISMO. Con dos polígonos idénticos
    // no hay cruces propios (los lados son colineales) y NINGÚN vértice cae
    // "dentro" del otro: todos caen en el borde. Sin esta línea, arrastrar un
    // cultivo exactamente encima de otro se daba por bueno. Lo cazó el test de
    // navegador; el unitario usaba rectángulos anidados y no lo veía.
    if (contenidoEn(a, b) || contenidoEn(b, a)) return true;
    // Y el caso general: un punto estrictamente interior de uno dentro del otro.
    const algunoDentro = (r1, r2) =>
      r1.some(p => situarPunto(r2, p) === "dentro") ||
      ladosDe(r1).some(([x, y]) => situarPunto(r2, medio(x, y)) === "dentro");
    return algunoDentro(ra, rb) || algunoDentro(rb, ra);
  }

  // La comprobación que usa el editor, con el motivo dicho para poder enseñarlo.
  // El área SIEMPRE sale del polígono: nunca se declara por separado.
  function validarCultivo(geom, parcela, ocupados = []) {
    const v = validarPolygonGeoJSON(geom);
    if (!v.ok) return { ok: false, motivo: v.motivo };
    const vp = validarPolygonGeoJSON(parcela);
    if (!vp.ok) return { ok: false, motivo: "parcela_invalida" };
    if (!contenidoEn(geom, parcela)) return { ok: false, motivo: "fuera_de_la_parcela" };
    for (let i = 0; i < ocupados.length; i++) {
      if (!ocupados[i]) continue;
      if (seSolapan(geom, ocupados[i])) return { ok: false, motivo: "se_solapa", con: i };
    }
    return { ok: true, motivo: null, area_m2: v.area_m2 };
  }

  // Área (m²) de un Polygon GeoJSON, sin que quien llama tenga que acordarse de
  // sacar el anillo. Devuelve null si la geometría no vale — nunca lanza.
  function areaDePolygon(geom) {
    const v = validarPolygonGeoJSON(geom);
    return v.ok ? v.area_m2 : null;
  }

  return { areaM2, anilloExterior, partirPorLinea, R_TIERRA, contieneAlPunto,
           esSimple, moverVertice, insertarVertice, quitarVertice, rectanguloCentrado,
           crucePropio, situarPunto, validarPolygonGeoJSON, areaDePolygon,
           contenidoEn, seSolapan, validarCultivo };
});
