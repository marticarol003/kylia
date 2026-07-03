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

const HANDLERS = {
  "recomendacion":         require("./_ia-recomendacion.js"),
  "recomendaciones-texto": require("./_ia-recomendaciones-texto.js"),
  "sugerencia-producto":   require("./_ia-sugerencia-producto.js"),
};

module.exports = async (req, res) => {
  let tipo = (req.query?.tipo || "").toString().trim();
  if (!tipo && req.body) {
    // fallback: tipo en el body (por si algún llamador no puede usar query)
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
    tipo = ((body || {}).tipo || "").toString().trim();
  }

  const handler = HANDLERS[tipo];
  if (!handler) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") return res.status(204).end();
    return res.status(400).json({
      error: `tipo inválido: '${tipo || "(vacío)"}'. Usa ?tipo=${Object.keys(HANDLERS).join(" | ")}`,
    });
  }
  return handler(req, res);
};
