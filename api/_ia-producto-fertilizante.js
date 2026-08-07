// ─────────────────────────────────────────────────────────────────
// Qué fertilizante COMPRAR — búsqueda en vivo del mercado español
// ─────────────────────────────────────────────────────────────────
// El motor de nutrición dice cuántos GRAMOS de N/P/K hace falta y en qué
// momento. Lo que no dice —y es lo que el agricultor necesita para actuar— es
// qué producto real comprar, a qué precio y cuánto pesar de él.
//
// Ese salto no se puede dar con una tabla cableada: los precios se mueven, los
// envases cambian y en ecológico el catálogo es otro. Aquí se resuelve BUSCANDO
// EN GOOGLE en el momento y eligiendo con el contexto agronómico de la parcela
// delante.
//
// Por qué esto no es un buscador de precios: la decisión no es "el más barato".
// Se comprobó a mano el 2026-08-07 con la cobertera del bancal de lechugas, y el
// producto más obvio era el peor. Los abonos líquidos de aminoácidos que salen
// primero al buscar "fertilizante nitrogenado ecológico" son BIOESTIMULANTES:
// ~4,6% N y dosis de etiqueta de 10 ml/L. Para aportar los 9,5 g de N que pedía
// el plan había que ir a 4× la etiqueta, con riesgo de quemar, a ~390 €/kg de N.
// La harina de sangre (15% N, 93 €/kg de N) hace el trabajo a dosis normal. De
// ahí las tres reglas del prompt: la dosis del plan tiene que caber DENTRO de la
// etiqueta, el N orgánico tiene que mineralizar a tiempo, y el €/kg de nutriente
// se calcula, no se estima.
//
// MOTOR: Gemini con grounding de Google Search — es literalmente "una búsqueda
// de Google en tiempo real", y es GRATIS al volumen de Kylia: 5.000 consultas
// con grounding al mes sin coste, sobre la GEMINI_API_KEY que ya está en
// producción. La primera versión de esto (commit 09647cd) usaba Claude + web
// search, que cuesta $10/1.000 búsquedas; se cambió el 7-ago por el equivalente
// gratuito. Lo que NO cambió es el criterio: el prompt de abajo es el mismo, y
// es donde está el valor (ver las tres reglas).
//
// ⚠️ LATENCIA (por lo que esto va cacheado, no se llama en cada pintado): buscar
// y razonar tarda más que los 10 s por defecto de Vercel; de ahí maxDuration 60
// en vercel.json. Si aun así no llega, se devuelve la caché anterior marcada.
// La caché vive en usuarios.producto_fert (jsonb) y la clave incluye la
// necesidad: mientras el plan no cambie, no se vuelve a buscar. "Tiempo real" es
// que el dato sale de una búsqueda viva, no que se repita la búsqueda por gusto.

const { isConfigured, supabaseSelect, supabaseUpdate, parseBody, preludio } = require("./_supabase.js");

const API_BASE  = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL     = "gemini-2.5-flash";   // mismo modelo que el resto de /api/ia
const CACHE_DIAS = 30;    // por debajo de esto no se vuelve a buscar aunque coincida la clave

const NUTRIENTE_NOMBRE = { N: "nitrógeno (N)", P2O5: "fósforo (P₂O₅)", K2O: "potasio (K₂O)" };

// Instrucciones del sistema. Las tres reglas de abajo son el criterio agronómico
// que separa esto de un comparador de precios; ver la cabecera del fichero.
const SISTEMA = `Eres el asesor de compras de Kylia, una herramienta de riego y abonado para agricultores españoles de horticultura.

Te llega la necesidad de nutriente YA CALCULADA por el motor FAO-56/MAPA de Kylia y los datos de la parcela. Tu trabajo es buscar en la web qué producto REAL puede comprar hoy en España y cuánto tiene que pesar de él.

CÓMO DECIDIR (por orden, no es el más barato el que gana):

1. LA DOSIS DEL PLAN TIENE QUE CABER EN LA ETIQUETA. Muchos productos que aparecen al buscar son bioestimulantes o complementos: su %N es bajo y su dosis de etiqueta aporta una fracción de lo que el cultivo necesita. Si para llegar a los gramos pedidos hay que superar la dosis recomendada del envase, ese producto NO vale como fuente principal: decláralo y descártalo. Prefiere siempre productos cuyo uso normal sea aportar ese nutriente.

2. EN ECOLÓGICO, EL NUTRIENTE TIENE QUE LLEGAR A TIEMPO. El N orgánico debe mineralizarse antes de que la planta lo use. Si el momento de aplicación es una cobertera con pocas semanas por delante, descarta compost y estiércol (demasiado lentos e imposibles de dosificar con precisión) y ve a fuentes rápidas. Di siempre qué fracción de N se aprovecha dentro del ciclo es INCIERTA si no la conoces; no la inventes.

3. EL €/kg DE NUTRIENTE SE CALCULA, NO SE ESTIMA: precio del envase ÷ (kg del envase × %nutriente/100). Hazlo con los números que hayas encontrado.

REGLAS DURAS:
- No inventes NUNCA un producto, un precio, un %N ni una certificación. Todo lo que afirmes tiene que salir de una página que hayas visitado. Si no encuentras el precio, pon null y dilo.
- Los precios se mueven: son orientativos y con fecha de consulta.
- Certificación ecológica: fíate solo de lo que diga la ficha del producto ("apto para agricultura ecológica", CAAE, Ecocert...). Si no lo dice, marca certificado_eco: null; no lo supongas por el nombre.
- Avisa si el envase mínimo es mucho mayor que lo que necesita (en huerto pequeño es lo normal y conviene decirlo).
- Habla en español de agricultor, sin marketing.

Responde SOLO con un objeto JSON, sin markdown ni texto alrededor, con esta forma:
{"recomendado":{"producto":"","fabricante":"","forma":"solido|liquido|polvo_soluble","pct_nutriente":0,"envase":"","precio_eur":0,"eur_kg_nutriente":0,"producto_necesario_g":0,"certificado_eco":true,"url":"","por_que":""},
 "alternativas":[{"producto":"","pct_nutriente":0,"envase":"","precio_eur":0,"eur_kg_nutriente":0,"url":"","por_que":""}],
 "descartados":[{"producto":"","motivo":""}],
 "como_aplicarlo":"",
 "avisos":[""],
 "fuentes":[{"titulo":"","url":""}]}`;

function promptUsuario(ctx) {
  const n = NUTRIENTE_NOMBRE[ctx.nutriente] || ctx.nutriente;
  return [
    `NECESIDAD A CUBRIR: ${ctx.gramos} g de ${n}.`,
    `MOMENTO: ${ctx.momento}.`,
    `CULTIVO: ${ctx.cultivo}.`,
    `MANEJO: ${ctx.manejo === "ecologico" ? "ECOLÓGICO (solo insumos permitidos en agricultura ecológica)" : "convencional"}.`,
    `SUPERFICIE A TRATAR: ${ctx.area_m2} m² → ${(ctx.gramos / ctx.area_m2).toFixed(1)} g de nutriente por m².`,
    ctx.dias_a_cosecha != null ? `SEMANAS HASTA LA COSECHA: ~${Math.round(ctx.dias_a_cosecha / 7)}.` : null,
    `FORMA DE APLICAR: riego por ${ctx.metodo_riego || "sin dato"}${ctx.capacidad_regadera ? ` (regadera de ${ctx.capacidad_regadera} L)` : ""}.`,
    ctx.ciudad ? `ZONA: ${ctx.ciudad}, España.` : "ZONA: España.",
    "",
    "Busca productos a la venta en España hoy y responde con el JSON.",
  ].filter(Boolean).join("\n");
}

// Saca el JSON de las partes de texto de la respuesta. No se pide salida
// estructurada a la API porque con el grounding de Google activo no se puede
// (responseMimeType json y google_search son excluyentes): se pide en el prompt
// y se extrae aquí, tolerando preámbulo y vallas de markdown.
function extraerJSON(partes) {
  const texto = (partes || []).map(p => p?.text).filter(t => typeof t === "string").join("\n");
  const i = texto.indexOf("{"), j = texto.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(texto.slice(i, j + 1)); } catch (_) { return null; }
}

// Las páginas que la búsqueda visitó DE VERDAD (groundingChunks del grounding de
// Google). Se devuelven aparte de las que el modelo liste en `fuentes`, para que
// el front pueda enseñar la procedencia sin fiarse de lo que diga el JSON.
function citas(groundingMetadata) {
  const vistas = new Map();
  for (const chunk of groundingMetadata?.groundingChunks || []) {
    const w = chunk?.web;
    if (w?.uri && !vistas.has(w.uri)) vistas.set(w.uri, { titulo: w.title || w.uri, url: w.uri });
  }
  return [...vistas.values()].slice(0, 12);
}

// Clave de caché: si esto no cambia, la respuesta de hace 3 semanas sigue valiendo.
function claveDe(ctx) {
  return [ctx.nutriente, Math.round(ctx.gramos), ctx.momento, ctx.cultivo,
          ctx.manejo || "-", ctx.metodo_riego || "-"].join("|");
}

async function buscarProducto(ctx, apiKey) {
  const url = `${API_BASE}/${MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SISTEMA }] },
      contents: [{ role: "user", parts: [{ text: promptUsuario(ctx) }] }],
      // La búsqueda de Google, que es la pieza nueva. Va sola: con grounding
      // activo NO se puede pedir responseMimeType json (la API lo rechaza), por
      // eso el JSON se pide en el prompt y se extrae a mano más abajo.
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 4000 },
    }),
  });

  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(`gemini ${res.status}: ${detalle.slice(0, 300)}`);
  }
  const data = await res.json();

  const cand = data?.candidates?.[0];
  // Un bloqueo por filtros llega como 200 sin partes de texto: sin esta guarda
  // parecería un fallo de formato y no se vería el motivo real.
  if (!cand || cand.finishReason === "SAFETY" || cand.finishReason === "PROHIBITED_CONTENT") {
    throw new Error(`la consulta fue bloqueada (${cand?.finishReason || "sin candidato"})`);
  }

  const plan = extraerJSON(cand.content?.parts);
  if (!plan) throw new Error("respuesta sin JSON parseable");

  const meta = cand.groundingMetadata;
  return {
    ...plan,
    citas: citas(meta),
    busquedas: (meta?.webSearchQueries || []).length || null,
    consultas: meta?.webSearchQueries || [],
    modelo: MODEL,
  };
}

module.exports = async (req, res) => {
  if (!preludio(req, res, "POST")) return;
  const body = parseBody(req);

  const usuario_id = (body.usuario_id || "").toString().trim();
  const nutriente  = ["N", "P2O5", "K2O"].includes(body.nutriente) ? body.nutriente : "N";
  const gramos     = Number(body.gramos);
  const momento    = (body.momento || "cobertera").toString().slice(0, 60);

  if (!/^[0-9a-f-]{36}$/i.test(usuario_id)) return res.status(400).json({ error: "usuario_id inválido" });
  if (!(gramos > 0)) return res.status(400).json({ error: "gramos debe ser > 0 (lo da el plan de abonado)" });

  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return res.status(200).json({ ok: false, reason: "gemini_no_configurada" });
  if (!isConfigured()) return res.status(200).json({ ok: false, reason: "supabase_not_configured" });

  let u;
  try {
    u = (await supabaseSelect("usuarios", `id=eq.${usuario_id}&select=*`))[0];
  } catch (err) {
    return res.status(500).json({ ok: false, error: `no se pudo leer la parcela: ${err.message}` });
  }
  if (!u) return res.status(404).json({ ok: false, error: "parcela no encontrada" });

  const ctx = {
    nutriente, gramos, momento,
    cultivo: (u.cultivos || [])[0] || "hortícola",
    manejo: u.manejo || null,
    area_m2: Number(u.area_m2) > 0 ? Number(u.area_m2) : 1,
    metodo_riego: u.metodo_riego || null,
    capacidad_regadera: u.capacidad_regadera || null,
    ciudad: u.ciudad || null,
    dias_a_cosecha: null,
  };

  // ── Caché: misma necesidad y menos de CACHE_DIAS → no se vuelve a buscar ──
  const clave  = claveDe(ctx);
  const previo = u.producto_fert && typeof u.producto_fert === "object" ? u.producto_fert : null;
  const edad   = previo?.consultado
    ? Math.floor((Date.now() - new Date(`${previo.consultado}T12:00:00Z`)) / 86400000)
    : null;
  const forzar = body.forzar === true;

  if (!forzar && previo && previo.clave === clave && edad != null && edad < CACHE_DIAS) {
    return res.status(200).json({ ok: true, cacheado: true, dias: edad, ...previo });
  }

  let plan;
  try {
    plan = await buscarProducto(ctx, apiKey);
  } catch (err) {
    console.error("[producto-fertilizante]", err.message);
    // Un dato de hace 40 días sigue siendo mejor que una pantalla vacía, siempre
    // que se diga que está viejo y por qué no se ha refrescado.
    if (previo) {
      return res.status(200).json({ ok: true, cacheado: true, obsoleto: true, dias: edad,
                                    error_refresco: err.message, ...previo });
    }
    return res.status(502).json({ ok: false, error: `no se pudo consultar el mercado: ${err.message}` });
  }

  const guardado = { ...plan, clave, consultado: new Date().toISOString().slice(0, 10), necesidad: ctx };
  try {
    await supabaseUpdate("usuarios", `id=eq.${usuario_id}`, { producto_fert: guardado });
  } catch (err) {
    console.warn("[producto-fertilizante] no se pudo cachear:", err.message);
  }

  console.log("[producto-fertilizante]", JSON.stringify({
    usuario_id, nutriente, gramos, busquedas: plan.busquedas,
    producto: plan.recomendado?.producto || null,
  }));

  return res.status(200).json({ ok: true, cacheado: false, ...guardado });
};

module.exports.claveDe    = claveDe;
module.exports.extraerJSON = extraerJSON;
module.exports.citas      = citas;
module.exports.SISTEMA    = SISTEMA;
module.exports.promptUsuario = promptUsuario;
