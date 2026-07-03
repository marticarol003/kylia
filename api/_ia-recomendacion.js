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

  const prompt = `Eres un agrónomo profesional. Hablas con un agricultor adulto que conoce su cultivo.
Escribe UN párrafo (2-3 frases) con la lectura agronómica de la parcela hoy.

Tono:
- Profesional y sobrio. Tuteo neutro, sin coloquialismos.
- Directo, sin rodeos. Sin exclamaciones ni interjecciones.
- Sin paternalismo, sin "muy bien", "buen trabajo" ni frases motivacionales.
- Castellano peninsular. Sin siglas técnicas (NDVI, NDMI, ET₀).
- Interpreta los datos, no los repitas en bruto. Si todo está correcto, dilo en una frase y no rellenes.

Datos de la parcela:
${lineas}

Responde solo con el párrafo. Sin introducción, sin despedida, sin emojis.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 400,
          thinkingConfig: { thinkingBudget: 0 },
        },
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
