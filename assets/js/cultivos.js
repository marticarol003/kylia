// ─────────────────────────────────────────────────────────────────
// Catálogo de cultivos — qué se puede REGISTRAR y qué se puede CALCULAR
// ─────────────────────────────────────────────────────────────────
// Son dos cosas distintas y hasta hoy eran la misma: la app solo dejaba elegir
// los ocho cultivos que el motor sabe calcular, así que un agricultor con
// alcachofas no podía ni apuntarlas. Su explotación no cabía en Kylia.
//
// Aquí el registro es ancho y el cálculo es estrecho, y la diferencia se DICE:
//   · soportado → el motor tiene su curva de Kc y puede recomendar riego
//   · no soportado → se registra, y se avisa de que aún no hay recomendación
//
// ⚠️ NUNCA se asigna un Kc genérico ni el de un cultivo parecido. Una lechuga y
// una alcachofa no gastan lo mismo, y un número inventado con cara de cálculo es
// peor que decir "todavía no". El motor tiene ocho curvas medidas; el resto
// espera a tenerla.
//
// `kcId` es el identificador CANÓNICO con el que el motor lo conoce. Si es null,
// no hay motor para ese cultivo y no se le busca sustituto.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KyliaCultivos = factory();
})(typeof self !== "undefined" ? self : this, function () {

  // Los ocho con curva FAO-56 medida. `kcId` es la clave de FAO_KC.
  const SOPORTADOS = [
    { id: "lechuga",   nombre: "Lechuga",         kcId: "lechuga",   alias: ["lechuga romana", "romana", "iceberg", "hoja de roble", "enciam"] },
    { id: "espinaca",  nombre: "Espinaca",        kcId: "espinaca",  alias: ["espinacas", "espinac"] },
    { id: "brassica",  nombre: "Col o coliflor",  kcId: "brassica",  alias: ["col", "coliflor", "brócoli", "brocoli", "repollo", "berza", "kale", "romanesco", "col rizada", "bròquil"] },
    { id: "tomate",    nombre: "Tomate",          kcId: "tomate",    alias: ["tomatera", "cherry", "tomàquet", "tomaquet"] },
    { id: "pimiento",  nombre: "Pimiento",        kcId: "pimiento",  alias: ["pimientos", "padrón", "padron", "pebrot"] },
    { id: "berenjena",  nombre: "Berenjena",      kcId: "berenjena", alias: ["albergínia", "alberginia"] },
    { id: "calabacin", nombre: "Calabacín",       kcId: "calabacin", alias: ["calabacines", "carabassó", "carabasso", "zucchini"] },
    { id: "cebolla",   nombre: "Cebolla tierna",  kcId: "cebolla",   alias: ["cebolleta", "cebollino", "calçot", "calcot", "ceba"] },
  ];

  // Lo que un agricultor de huerta mediterránea planta de verdad y el motor
  // todavía no sabe calcular. Se registran para que su explotación esté
  // completa — el cuaderno, las superficies, las fechas — y se dice que el
  // riego aún no. La lista no pretende ser exhaustiva: el buscador acepta
  // cualquier texto (ver `buscar`).
  const SIN_MOTOR = [
    "Acelga", "Ajo", "Alcachofa", "Apio", "Boniato", "Brócoli morado",
    "Calabaza", "Cardo", "Cebolla de guarda", "Chirivía", "Escarola",
    "Espárrago", "Fresa", "Guisante", "Haba", "Hinojo", "Judía verde",
    "Melón", "Nabo", "Pak choi", "Patata", "Pepino", "Perejil", "Puerro", "Rabanito",
    "Remolacha", "Rúcula", "Sandía", "Zanahoria",
    "Almendro", "Avellano", "Cerezo", "Ciruelo", "Higuera", "Manzano",
    "Melocotonero", "Naranjo", "Nogal", "Olivo", "Peral", "Viña",
    "Alfalfa", "Avena", "Cebada", "Maíz", "Trigo", "Veza",
  ].map(nombre => ({
    id: "otro:" + nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-"),
    nombre, kcId: null, alias: [],
  }));

  const CATALOGO = [...SOPORTADOS, ...SIN_MOTOR];

  const normaliza = (t) => String(t || "").toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ]/g, "").trim();

  // Un cultivo es SOPORTADO si el motor lo conoce por su `kcId`. Nada más: ni
  // por parecerse a uno, ni por estar en la lista de arriba.
  const soportado = (c) => !!(c && c.kcId);

  function porId(id) {
    if (!id) return null;
    const enCatalogo = CATALOGO.find(c => c.id === id || c.kcId === id);
    if (enCatalogo) return enCatalogo;
    // Un cultivo que escribió él y no está en la lista. Se reconstruye para que
    // la app pueda enseñarlo aunque nadie lo haya catalogado.
    if (String(id).startsWith("otro:")) {
      const n = String(id).slice(5).replace(/-/g, " ");
      return { id, nombre: n.charAt(0).toUpperCase() + n.slice(1), kcId: null, alias: [] };
    }
    return null;
  }

  const nombreDe = (id) => porId(id)?.nombre || (id || "");

  // Lo que escribe el agricultor, convertido en un cultivo registrable. Si no
  // está en el catálogo se acepta igual: su explotación no puede depender de
  // que nosotros hayamos previsto su cultivo.
  function desdeTexto(texto) {
    const t = String(texto || "").trim();
    if (!t) return null;
    const n = normaliza(t);
    const exacto = CATALOGO.find(c => normaliza(c.nombre) === n || c.alias.some(a => normaliza(a) === n));
    if (exacto) return exacto;
    return { id: "otro:" + n.replace(/[^a-z0-9]+/g, "-"),
             nombre: t.charAt(0).toUpperCase() + t.slice(1), kcId: null, alias: [] };
  }

  // Autocompletado. Ordena: primero lo que EMPIEZA por lo escrito, luego lo que
  // lo contiene; y a igualdad, antes lo que el motor sabe calcular — porque es
  // lo que de verdad le sirve hoy.
  function buscar(q, limite = 8) {
    const n = normaliza(q);
    if (!n) return SOPORTADOS.slice(0, limite);
    const puntua = (c) => {
      const textos = [c.nombre, ...c.alias].map(normaliza);
      if (textos.some(t => t === n)) return 0;
      if (textos.some(t => t.startsWith(n))) return 1;
      if (textos.some(t => t.includes(n))) return 2;
      return 99;
    };
    return CATALOGO
      .map(c => ({ c, p: puntua(c) }))
      .filter(x => x.p < 99)
      .sort((a, b) => (a.p - b.p) || (soportado(b.c) - soportado(a.c)) || a.c.nombre.localeCompare(b.c.nombre, "es"))
      .slice(0, limite)
      .map(x => x.c);
  }

  return { CATALOGO, SOPORTADOS, soportado, porId, nombreDe, desdeTexto, buscar, normaliza };
});
