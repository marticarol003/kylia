const NOMBRES_CULTIVO = {
  lechuga: "lechuga", espinaca: "espinaca", brassica: "col/coliflor",
  tomate: "tomate", pimiento: "pimiento", berenjena: "berenjena", calabacin: "calabacín",
};

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY no configurada" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  const {
    cultivos = [],
    ndviEstado, ndviFecha,
    ndmiEstado,
    sueloEstado,
    et0Acumulado, diasSinRiego,
    tempMax,
    lluviaPrevista, diaLluvia,
  } = body;

  const cultivoTexto = cultivos.map(id => NOMBRES_CULTIVO[id] || id).join(", ") || "cultivo no especificado";

  const ndviMap = { buena: "muy bueno", moderada: "normal", estres: "bajo (posible estrés)", recuperacion: "en recuperación tras el último riego" };
  const sueloMap = { seco: "suelo muy seco", adecuado: "humedad del suelo adecuada", saturado: "suelo muy húmedo o encharcado" };
  const ndmiMap  = { hidratada: "bien hidratada", vigilar: "con agua justa", estres: "con estrés hídrico" };

  const lineas = [
    `Cultivos: ${cultivoTexto}`,
    ndviEstado ? `Vigor del cultivo: ${ndviMap[ndviEstado] || ndviEstado}${ndviFecha ? ` (imagen del ${ndviFecha})` : ""}` : null,
    ndmiEstado ? `Agua en la planta: ${ndmiMap[ndmiEstado] || ndmiEstado}` : null,
    sueloEstado ? `Suelo: ${sueloMap[sueloEstado] || sueloEstado}` : null,
    diasSinRiego != null && et0Acumulado != null
      ? `Riego: lleva ${diasSinRiego} día${diasSinRiego !== 1 ? "s" : ""} sin regar; han evaporado unos ${Math.round(et0Acumulado)} L/m²`
      : null,
    tempMax != null ? `Temperatura máxima hoy: ${tempMax}°C` : null,
    lluviaPrevista > 2
      ? `Lluvia prevista: ${Math.round(lluviaPrevista)} mm los próximos días${diaLluvia ? ` (el ${diaLluvia})` : ""}`
      : "Lluvia prevista: no se espera lluvia próximamente",
  ].filter(Boolean).join("\n");

  const prompt = `Eres un agrónomo experto que aconseja a agricultores de forma directa y en lenguaje muy llano.
Analiza estos datos de una parcela y escribe UN párrafo corto (2-3 frases) con lo más importante que el agricultor debe saber hoy.
Tutéalo. No uses siglas técnicas como NDVI, NDMI o ET₀. No repitas los datos en bruto — interprétalos. Sé concreto y útil.

${lineas}

Responde SOLO con el párrafo, sin introducción ni despedida.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 200 },
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Gemini ${resp.status}: ${err.slice(0, 120)}`);
    }

    const data = await resp.json();
    const texto = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!texto) throw new Error("Respuesta vacía de Gemini");

    res.json({ texto });
  } catch (err) {
    console.error("[recomendacion]", err.message);
    res.status(500).json({ error: err.message });
  }
};
