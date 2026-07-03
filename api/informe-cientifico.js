// ─────────────────────────────────────────────────────────────────
// Informe científico del piloto silencioso — capa de razonamiento (Claude)
// ─────────────────────────────────────────────────────────────────
// Toma el objeto `reveal` que ya produce api/_reveal.js (4 dimensiones +
// frontera honesta + avisos) y pide a Claude que lo interprete como un
// informe científico de cierre de los 2 meses: qué muestran los datos, con
// qué confianza, qué NO se puede afirmar todavía, e hipótesis para la Fase 2.
//
// La IA NUNCA inventa números ni afirma más de lo que el reveal permite:
// - Respeta `dimension.disponible === false` (no narra lo que no se midió).
// - Solo el agua se traduce a € (único modelo validado vs FAO-56 / pyfao56).
// - Plagas/nutrición son heurísticas: se reportan cualitativas, sin acierto.
// - Las limitaciones salen de `reveal.avisos`, no de la imaginación del modelo.
//
// Si no hay ANTHROPIC_API_KEY o la llamada falla, cae a un informe por
// plantilla determinista construido con los mismos números (igual que
// api/optimizacion-calidad.js hace con Gemini).
//
// SEGURIDAD: el reveal se reconstruye SIEMPRE en servidor a partir del
// usuario_id (mismo modelo de auth-por-UUID que el resto de la API). No se
// acepta un reveal del cliente: nadie puede inyectar números al informe ni
// quemar tokens sin un UUID válido de piloto.
//
// Request body:  { usuario_id: "<uuid>" }   (o GET ?usuario_id=)
// Response:      { titulo, informe_md, fuente: "claude" | "plantilla" }

const { isConfigured, supabaseSelect } = require("./_supabase.js");
const { revealDeUsuario } = require("./campo.js");

const MODEL = "claude-opus-4-8";
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Caché en memoria por (usuario, día): el informe de cierre no cambia dentro
// del mismo día y cada generación cuesta tokens. Sobrevive mientras viva la
// instancia serverless; con ?force=1 se regenera.
const cacheInformes = new Map();
const NOMBRES_CULTIVO = {
  lechuga: "lechuga", espinaca: "espinaca", brassica: "col/coliflor",
  tomate: "tomate", pimiento: "pimiento", berenjena: "berenjena",
  calabacin: "calabacín", cebolla: "cebolla tierna",
};

function r1(x) { return Math.round((Number(x) || 0) * 10) / 10; }

// ── Fallback por plantilla (sin IA): informe honesto con los mismos datos ──
function informePlantilla(reveal) {
  const u = reveal.usuario || {};
  const d = reveal.dimensiones || {};
  const agua = d.agua || {};
  const cultivo = NOMBRES_CULTIVO[u.cultivo] || u.cultivo || "el cultivo";
  const lineas = [];

  lineas.push(`# Informe de cierre del piloto — ${cultivo}`);
  if (reveal.periodo) {
    lineas.push(
      `Periodo medido: ${reveal.periodo.desde} → ${reveal.periodo.hasta} ` +
      `(${reveal.periodo.dias} días, cobertura del registro ${reveal.periodo.cobertura_pct ?? "?"}%).`
    );
  }

  lineas.push("\n## Agua aplicada frente a la lámina FAO-56");
  if (agua.disponible) {
    lineas.push(
      `Aplicaste **${r1(agua.aplicada_l_m2)} L/m²**; la lámina FAO-56 que Kylia ` +
      `habría aplicado es **${r1(agua.recomendada_l_m2)} L/m²** ` +
      `(diferencia ${r1(agua.exceso_l_m2)} L/m²` +
      (agua.ahorro_pct != null ? `, ahorro potencial ${agua.ahorro_pct}%` : "") + `). ${agua.veredicto || ""}`
    );
    if (d.coste && d.coste.agua_eur != null) {
      lineas.push(`Coste del exceso de agua: **${d.coste.agua_eur} €** en el periodo medido.`);
    }
  } else {
    lineas.push(`No disponible: ${agua.motivo || "faltan datos."}`);
  }

  lineas.push("\n## Tratamientos");
  const trat = d.tratamientos || {};
  if (trat.disponible) {
    lineas.push(
      `${trat.aplicados} aplicación(es) registradas; ${trat.alineados_con_kylia} coincidían ` +
      `con presión que Kylia también veía y ${trat.sin_senal_kylia} sin señal (potencialmente ` +
      `evitables). Lectura cualitativa: el modelo de plagas/nutrición es heurístico y no está validado.`
    );
  } else {
    lineas.push(`Sin datos suficientes para contrastar tratamientos.`);
  }

  if (Array.isArray(reveal.avisos) && reveal.avisos.length) {
    lineas.push("\n## Qué NO puede afirmar este informe todavía");
    for (const a of reveal.avisos) lineas.push(`- ${a}`);
  }

  return {
    titulo: `Informe de cierre — ${cultivo}`,
    informe_md: lineas.join("\n"),
    fuente: "plantilla",
  };
}

// ── Prompt: interpretación científica con guardarraíles ────────────
function construirPrompt(reveal) {
  return `Eres un agrónomo-investigador. Redacta el INFORME CIENTÍFICO DE CIERRE de un piloto de riego de 2 meses a partir del objeto de datos que te doy. El piloto compara, sobre la MISMA parcela, la lámina de riego que un modelo FAO-56 validado (Kylia) habría aplicado frente a lo que el agricultor regó de verdad.

REGLAS INNEGOCIABLES (rigor científico y honestidad):
- Usa EXCLUSIVAMENTE los números del objeto. No inventes cifras, no extrapoles, no redondees a la baja para "vender".
- Si una dimensión trae "disponible": false, NO la narres como resultado: menciónala solo como dato aún no capturado, citando su "motivo".
- Solo el AGUA se traduce a euros (único modelo validado vs FAO-56 / pyfao56). Plagas y nutrición son heurísticas NO validadas: repórtalas de forma cualitativa, sin afirmar acierto ni monetizarlas.
- La sección de limitaciones debe construirse a partir de "avisos" del objeto (transcríbelos y explícalos), más la cobertura del registro si es < 90%.
- No confundas correlación con causalidad. Con un único piloto (n=1) habla de "indicio" u "observación", nunca de "demostrado".

ESTRUCTURA (markdown, castellano peninsular, tono sobrio, sin emojis, sin siglas sin explicar la primera vez):
1. Título (una línea).
2. Resumen ejecutivo (2-3 frases con las cifras clave de agua).
3. Resultado de agua: interpreta la diferencia L/m², el % de ahorro y el coste en €, situándolo en el periodo y la cobertura reales.
4. Tratamientos: lectura cualitativa honesta.
5. Limitaciones y validez: a partir de "avisos" y la cobertura.
6. Hipótesis y siguientes pasos para la Fase 2 (2-4 hipótesis TESTABLES, p.ej. diseño split-plot, captura de minutos, congelar plagas en el Diario B).

Responde SOLO con el JSON final, sin razonamiento visible, con la forma exacta:
{"titulo":"<título>","informe_md":"<informe completo en markdown>"}

Objeto de datos del piloto (JSON):
${JSON.stringify(reveal)}`;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  const usuarioId = ((req.query?.usuario_id || body.usuario_id || "") + "").trim();
  if (!ES_UUID.test(usuarioId)) {
    return res.status(400).json({ error: "usuario_id inválido (UUID)" });
  }
  if (!isConfigured()) return res.status(200).json({ ok: false, reason: "supabase_not_configured" });

  // Caché del día (evita regenerar con tokens en clics repetidos).
  const claveCache = `${usuarioId}:${new Date().toISOString().slice(0, 10)}`;
  const force = String(req.query?.force || body.force || "") === "1";
  if (!force && cacheInformes.has(claveCache)) {
    return res.json({ ...cacheInformes.get(claveCache), cacheado: true });
  }

  // Reveal reconstruido en servidor: la única fuente de números del informe.
  let reveal;
  try {
    const usuarios = await supabaseSelect("usuarios", `id=eq.${usuarioId}&select=*`);
    const u = (usuarios || [])[0];
    if (!u) return res.status(404).json({ ok: false, error: "usuario no encontrado" });
    reveal = (await revealDeUsuario(u)).informe;
  } catch (err) {
    console.error("[informe-cientifico] reveal:", err.message);
    return res.status(500).json({ ok: false, error: "no se pudo reconstruir el reveal" });
  }
  if (!reveal || !reveal.dimensiones) {
    return res.status(500).json({ ok: false, error: "reveal incompleto" });
  }

  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  // Sin clave: informe por plantilla (honesto, con los mismos números).
  if (!apiKey) {
    const plantilla = informePlantilla(reveal);
    cacheInformes.set(claveCache, plantilla);
    return res.json(plantilla);
  }

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2500,
        messages: [{ role: "user", content: construirPrompt(reveal) }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Anthropic ${resp.status}: ${err.slice(0, 200)}`);
    }

    const data = await resp.json();
    // La respuesta trae bloques; nos quedamos con el texto (saltando thinking).
    const texto = (data?.content || [])
      .filter(b => b && b.type === "text")
      .map(b => b.text)
      .join("")
      .trim();
    if (!texto) throw new Error("Respuesta vacía de Claude");

    // Tolera fences ```json ... ``` alrededor del JSON.
    const limpio = texto.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let parsed;
    try { parsed = JSON.parse(limpio); }
    catch (_) { throw new Error("JSON inválido en respuesta"); }

    const titulo = typeof parsed?.titulo === "string" ? parsed.titulo.trim() : null;
    const informe_md = typeof parsed?.informe_md === "string" ? parsed.informe_md.trim() : null;
    if (!informe_md) throw new Error("Falta informe_md en la respuesta");

    const resultado = { titulo, informe_md, fuente: "claude" };
    cacheInformes.set(claveCache, resultado);
    res.json(resultado);
  } catch (err) {
    console.error("[informe-cientifico]", err.message);
    // Ante cualquier fallo, no rompemos: devolvemos el informe por plantilla.
    res.json(informePlantilla(reveal));
  }
};
