// Optimización coste ↔ calidad: la combinación de insumos más barata que
// garantiza una calidad mínima de laboratorio (p. ej. °Brix). El motor
// (api/_optimizador-calidad.js) calcula las cantidades; la IA solo las
// explica en llano, sin inventar números (principio Kylia: IA narradora,
// nunca generadora). Upgradea la decisión de NUTRICIÓN (motor §5).
//
// Request body: {
//   contexto: { cultivo, calidadMinima, metrica? },
//   modelo?, precios?, limites?        // opcionales: si no, se usan los del cultivo
// }
// Response: {
//   optimo: { exito, mensaje, insumos:{...}, costeTotal, calidad },
//   curva:  [{ calidad, coste }, ...],
//   explicacion: "<2-3 frases>"
// }

const motor = require("./_optimizador-calidad");

const NOMBRES_INSUMO = {
  nitrogeno: "nitrógeno", fosforo: "fósforo", potasio: "potasio", riego: "riego",
};

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  const ctx = body.contexto || {};
  const cultivo = ctx.cultivo || "tomate";

  // Modelo de calidad + precios + límites: del request o, si no, los del cultivo.
  const modelo = body.modelo || motor.modeloPara(cultivo);
  const precios = body.precios || motor.PRECIOS_DEFAULT;
  const limites = body.limites || motor.LIMITES_DEFAULT;
  const metrica = ctx.metrica || modelo.metrica || "calidad";

  const calidadMinima = Number(ctx.calidadMinima);
  if (!Number.isFinite(calidadMinima)) {
    return res.status(400).json({ error: "Falta contexto.calidadMinima (número)." });
  }

  // ── Núcleo determinista (reglas auditables) ──
  const optimo = motor.optimizarCoste(modelo, precios, limites, calidadMinima);

  // Curva de compromiso alrededor del objetivo (para fijar precio de venta).
  const base = Math.round(calidadMinima);
  const niveles = [base - 2, base - 1, base, base + 1, base + 2, base + 3].filter((q) => q > 0);
  const curva = motor.curvaCosteCalidad(modelo, precios, limites, niveles);

  // ── Capa de IA narrativa (opcional, fallback silencioso) ──
  const explicacion = await explicar({ optimo, metrica, cultivo, calidadMinima });

  res.json({ optimo, curva, explicacion });
};

// Genera 2-3 frases que explican el resultado SIN cambiar ningún número.
// Si no hay GEMINI_API_KEY o falla, devuelve una explicación por plantilla.
async function explicar({ optimo, metrica, cultivo, calidadMinima }) {
  const plantilla = explicacionPlantilla({ optimo, metrica, cultivo, calidadMinima });
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey || !optimo.exito) return plantilla;

  const insumosTxt = Object.entries(optimo.insumos)
    .map(([n, v]) => `${NOMBRES_INSUMO[n] || n}: ${v}`)
    .join("; ");

  const prompt = `Eres un agrónomo profesional. Explica al agricultor, en 2-3 frases, el resultado de una optimización que ya está calculada. NO cambies ningún número ni inventes datos.

Datos (fijos, no los alteres):
- Cultivo: ${cultivo}
- Calidad mínima garantizada: ${calidadMinima} ${metrica}
- Plan de insumos más barato que la logra: ${insumosTxt}
- Coste total de ese plan: ${optimo.costeTotal} €

Tono: profesional y sobrio, sin paternalismo, tuteo neutro, castellano peninsular, sin exclamaciones ni emojis. Menciona qué insumo concentra más coste si es evidente. Termina con la idea de que ese coste es la base para fijar el precio de venta con margen.

Devuelve EXCLUSIVAMENTE un JSON: {"explicacion":"<2-3 frases>"}`;

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
    if (!resp.ok) throw new Error(`Gemini ${resp.status}`);
    const data = await resp.json();
    const texto = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const parsed = JSON.parse(texto);
    return typeof parsed?.explicacion === "string" && parsed.explicacion.trim()
      ? parsed.explicacion.trim()
      : plantilla;
  } catch (err) {
    console.error("[optimizacion-calidad]", err.message);
    return plantilla; // fallback silencioso: siempre queda la plantilla por reglas
  }
}

function explicacionPlantilla({ optimo, metrica, cultivo, calidadMinima }) {
  if (!optimo.exito) return optimo.mensaje;
  const caro = Object.entries(optimo.insumos).sort((a, b) => b[1] - a[1])[0];
  const insumoCaro = caro ? (NOMBRES_INSUMO[caro[0]] || caro[0]) : "los insumos";
  return (
    `Para garantizar ${calidadMinima} ${metrica} en ${cultivo}, el plan de insumos ` +
    `más barato cuesta ${optimo.costeTotal} €, con ${insumoCaro} como partida principal. ` +
    `Ese coste es la base sobre la que fijar el precio de venta con tu margen.`
  );
}
