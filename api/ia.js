// ─────────────────────────────────────────────────────────────────
// /api/ia — punto único de los endpoints de texto con IA (Gemini)
// ─────────────────────────────────────────────────────────────────
// Consolidación de 3 funciones serverless en 1 (Vercel Hobby limita a 12
// por deploy; esto libera 2 slots para /api/agent y lo que venga). Cada
// handler vive en su módulo _ia-*.js con su lógica intacta; aquí solo se
// enruta por ?tipo= (o body.tipo). Los cuerpos de petición y las respuestas
// no cambian respecto a los endpoints antiguos.
//
//   POST /api/ia?tipo=recomendacion          ← antes /api/recomendacion
//   POST /api/ia?tipo=recomendaciones-texto  ← antes /api/recomendaciones-texto
//   POST /api/ia?tipo=sugerencia-producto    ← antes /api/sugerencia-producto
//   POST /api/ia?tipo=producto-fertilizante  ← nuevo (no gasta slot de función)
//
// OJO con el reparto de modelos: los tres primeros van a Gemini y eligen dentro
// de un catálogo curado. `producto-fertilizante` es distinto — sale a buscar al
// mercado en vivo con Claude + web search, así que cuesta dinero por consulta y
// tarda; por eso cachea. Ver la cabecera de _ia-producto-fertilizante.js.

const { cabecerasCors, ipDe } = require("./_origen.js");
const { guardia } = require("./_limite.js");

const HANDLERS = {
  "recomendacion":         require("./_ia-recomendacion.js"),
  "recomendaciones-texto": require("./_ia-recomendaciones-texto.js"),
  "sugerencia-producto":   require("./_ia-sugerencia-producto.js"),
  "producto-fertilizante": require("./_ia-producto-fertilizante.js"),
};

module.exports = async (req, res) => {
  let tipo = (req.query?.tipo || "").toString().trim();
  if (!tipo && req.body) {
    // fallback: tipo en el body (por si algún llamador no puede usar query)
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
    tipo = ((body || {}).tipo || "").toString().trim();
  }

  // CORS acotado (antes era "*": cualquier web podía gastar nuestra cuota de
  // Gemini con el navegador de sus visitantes) + límite de uso persistente.
  // El CORS solo frena a un navegador ajeno; el límite frena también a un script.
  cabecerasCors(req, res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const handler = HANDLERS[tipo];
  if (!handler) {
    return res.status(400).json({
      error: `tipo inválido: '${tipo || "(vacío)"}'. Usa ?tipo=${Object.keys(HANDLERS).join(" | ")}`,
    });
  }

  // El límite se aplica AQUÍ y no dentro de cada _ia-*.js: es el único sitio por
  // el que pasan los cuatro, y así el contador no se puede olvidar al añadir uno
  // nuevo. `producto-fertilizante` tiene su propio cupo, mucho más corto, porque
  // sale a buscar al mercado con Claude y cada consulta cuesta dinero.
  if (!(await guardia(req, res, `ia:${tipo}`, ipDe(req)))) return;

  return handler(req, res);
};
