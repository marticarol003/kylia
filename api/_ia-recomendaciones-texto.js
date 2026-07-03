// Reescribe los textos (título + detalle) de las recomendaciones generadas
// por reglas, conservando las cantidades, productos y prioridades calculadas
// por el cliente. La IA NUNCA decide cantidades — solo redacta.
//
// Request body: {
//   cultivos: ["tomate", ...],
//   contexto: { ndviEstado, ndmiEstado, sueloEstado, tempMax, diasSinRiego, ... },
//   candidatos: [{ id, categoria, titulo, detalle, cantidad? }, ...]
// }
// Response: { textos: [{ id, titulo, detalle }, ...] }

const NOMBRES_CULTIVO = {
  lechuga: "lechuga", espinaca: "espinaca", brassica: "col/coliflor",
  tomate: "tomate", pimiento: "pimiento", berenjena: "berenjena", calabacin: "calabacín",
};

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY no configurada" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  const candidatos = Array.isArray(body.candidatos) ? body.candidatos : [];
  if (!candidatos.length) return res.json({ textos: [] });

  const cultivos  = (body.cultivos || []).map(id => NOMBRES_CULTIVO[id] || id).join(", ") || "cultivo no especificado";
  const ctx       = body.contexto || {};

  // Datos de contexto que la IA puede mencionar
  const lineasCtx = [
    `Cultivos: ${cultivos}`,
    ctx.ndviEstado ? `Vigor: ${ctx.ndviEstado}` : null,
    ctx.ndmiEstado ? `Agua en planta: ${ctx.ndmiEstado}` : null,
    ctx.sueloEstado ? `Suelo: ${ctx.sueloEstado}` : null,
    ctx.tempMax != null ? `Tmax hoy: ${ctx.tempMax}°C` : null,
    ctx.diasSinRiego != null ? `Días sin riego: ${ctx.diasSinRiego}` : null,
    ctx.et0Acumulado != null ? `ET₀ acumulada: ${Math.round(ctx.et0Acumulado)} mm` : null,
    ctx.lluviaPrevista ? `Lluvia prevista: ${Math.round(ctx.lluviaPrevista)} mm` : null,
  ].filter(Boolean).join("; ");

  // Compacto JSON sin valores prescindibles para reducir tokens
  const candidatosCompactos = candidatos.map(c => ({
    id: c.id,
    categoria: c.categoria,
    titulo: c.titulo,
    detalle: c.detalle,
  }));

  const prompt = `Eres un agrónomo profesional. Vas a reescribir unas recomendaciones generadas por reglas para que el texto sea más natural y directo, sin perder precisión.

Tono:
- Profesional y sobrio. Tuteo neutro, como técnico que habla con un agricultor adulto.
- Directo, sin rodeos. Sin exclamaciones, sin interjecciones, sin paternalismo.
- Sin frases motivacionales tipo "muy bien", "buen trabajo", "perfecto".
- Castellano peninsular. Sin siglas técnicas (NDVI, NDMI, ET₀). Sin emojis.

Reglas estrictas:
- CONSERVA exactamente todas las cantidades numéricas (litros, mm, días, °C, fechas, horas). No las cambies ni las redondees.
- CONSERVA los nombres de productos, plagas y fertilizantes si aparecen.
- NO inventes cantidades, productos, fechas ni datos que no aparezcan en el original.
- Título: instrucción clara, máx 9 palabras. Sin signos de exclamación.
- Detalle: 1-2 frases. Explica el porqué de la acción usando el contexto.

Contexto de la parcela: ${lineasCtx}.

Devuelve EXCLUSIVAMENTE un JSON válido con la forma:
{"textos":[{"id":"<mismo id que recibes>","titulo":"<nuevo título>","detalle":"<nuevo detalle>"}, ...]}

Recomendaciones a reescribir (JSON):
${JSON.stringify(candidatosCompactos)}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 800,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: "application/json",
        },
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Gemini ${resp.status}: ${err.slice(0, 200)}`);
    }

    const data = await resp.json();
    const texto = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!texto) throw new Error("Respuesta vacía de Gemini");

    let parsed;
    try { parsed = JSON.parse(texto); }
    catch (_) { throw new Error("JSON inválido en respuesta"); }

    const textos = Array.isArray(parsed?.textos) ? parsed.textos : [];
    // Validación mínima: solo devolvemos ids que existían en los candidatos
    const idsValidos = new Set(candidatos.map(c => c.id));
    const filtrados = textos
      .filter(t => t && idsValidos.has(t.id) && typeof t.titulo === "string" && typeof t.detalle === "string")
      .map(t => ({ id: t.id, titulo: t.titulo.trim(), detalle: t.detalle.trim() }));

    res.json({ textos: filtrados });
  } catch (err) {
    console.error("[recomendaciones-texto]", err.message);
    res.status(500).json({ error: err.message });
  }
};
