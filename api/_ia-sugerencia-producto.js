// Recibe una lista filtrada de productos del catálogo curado y el contexto
// agronómico del agricultor. Pide a Gemini que elija el más adecuado y dé
// un razonamiento breve. La IA no introduce productos nuevos: solo elige
// uno de los que recibe.
//
// Request body: {
//   contexto: { cultivo, plaga|tipoFertilizante, ndviEstado, tempMax,
//               diasSinRiego, lluviaPrevista, et0Acumulado, ... },
//   candidatos: [{ id, nombre, tipo, dosis, plazoSeguridad, eficacia,
//                  costeMin, costeMax, notas }, ...]
// }
// Response: { idElegido, razonamiento }

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
  if (!candidatos.length) return res.json({ idElegido: null, razonamiento: "" });

  const ctx = body.contexto || {};
  const cultivo = NOMBRES_CULTIVO[ctx.cultivo] || ctx.cultivo || "el cultivo";

  // Contexto que la IA puede usar para decidir
  const lineasCtx = [
    `Cultivo: ${cultivo}`,
    ctx.plaga ? `Plaga a tratar: ${ctx.plaga}` : null,
    ctx.tipoFertilizante ? `Necesidad nutricional: ${ctx.tipoFertilizante}` : null,
    ctx.ndviEstado ? `Vigor del cultivo: ${ctx.ndviEstado}` : null,
    ctx.tempMax != null ? `Temperatura máxima hoy: ${ctx.tempMax}°C` : null,
    ctx.diasSinRiego != null ? `Días sin riego: ${ctx.diasSinRiego}` : null,
    ctx.et0Acumulado != null ? `ET₀ acumulada: ${Math.round(ctx.et0Acumulado)} mm` : null,
    ctx.lluviaPrevista ? `Lluvia prevista: ${Math.round(ctx.lluviaPrevista)} mm en próximos días` : null,
  ].filter(Boolean).join("; ");

  // Compactamos los candidatos para reducir tokens
  const candidatosCompactos = candidatos.map(c => ({
    id: c.id,
    nombre: c.nombre,
    tipo: c.tipo,
    eficacia: c.eficacia,
    plazoSeguridad: c.plazoSeguridad,
    costeMin: c.costeMin,
    costeMax: c.costeMax,
    notas: c.notas,
  }));

  const prompt = `Eres un agrónomo profesional. Tienes que elegir UN producto de la lista que se te da, basándote en el contexto agronómico actual del agricultor.

Reglas estrictas:
- DEBES elegir un producto cuyo "id" esté EXACTAMENTE en la lista recibida. No inventes productos ni nombres.
- Si varios encajan, prioriza: (a) menor plazo de seguridad si el cultivo está cerca de cosecha; (b) menor coste si todo lo demás es similar; (c) opción eco si el rendimiento agronómico es comparable.
- En el razonamiento, menciona EL DATO concreto del contexto que justifica la elección (ej. "tu cultivo lleva 8 días sin regar y estamos a 30 °C").

Tono:
- Profesional y sobrio, sin paternalismo. Tuteo neutro. Castellano peninsular.
- Sin exclamaciones, sin emojis, sin "muy bien" ni "perfecto".
- Razonamiento: 1-2 frases. Concreto. Termina con la acción recomendada.

Contexto: ${lineasCtx}.

Productos disponibles (elige uno):
${JSON.stringify(candidatosCompactos)}

Devuelve EXCLUSIVAMENTE un JSON con esta forma:
{"idElegido":"<id exacto del producto elegido>","razonamiento":"<1-2 frases>"}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 300,
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

    // Validación: el id debe existir en los candidatos. Si no, fallback al primero.
    const idsValidos = new Set(candidatos.map(c => c.id));
    const idElegido = idsValidos.has(parsed?.idElegido)
      ? parsed.idElegido
      : candidatos[0].id;
    const razonamiento = typeof parsed?.razonamiento === "string"
      ? parsed.razonamiento.trim()
      : "";

    res.json({ idElegido, razonamiento });
  } catch (err) {
    console.error("[sugerencia-producto]", err.message);
    res.status(500).json({ error: err.message });
  }
};
