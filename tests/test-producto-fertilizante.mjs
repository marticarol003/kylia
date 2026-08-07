// "Qué fertilizante comprar": la búsqueda en vivo del mercado.
//   node tests/test-producto-fertilizante.mjs
//
// No se llama a la API aquí (cuesta dinero y depende de la red). Lo que se ata
// es lo que puede romperse en silencio: la clave de caché, el parseo de la
// respuesta, la recogida de citas, y que el prompt siga llevando el criterio
// agronómico que hace útil a esto — sin él es un comparador de precios, y el
// comparador de precios se equivoca (ver la cabecera del módulo: el líquido de
// aminoácidos sale primero al buscar y es la peor opción de las tres).
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const M = require("../api/_ia-producto-fertilizante.js");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

const BANCAL = {
  nutriente: "N", gramos: 41, momento: "cobertera", cultivo: "lechuga",
  manejo: "ecologico", area_m2: 5, metodo_riego: "aspersion",
  capacidad_regadera: null, ciudad: "Sant Boi de Llobregat", dias_a_cosecha: 42,
};

console.log("── la clave de caché cambia cuando cambia la decisión ──");
const base = M.claveDe(BANCAL);
ok(M.claveDe({ ...BANCAL }) === base, "misma necesidad → misma clave (no rebusca ni cobra otra vez)");
ok(M.claveDe({ ...BANCAL, gramos: 82 }) !== base, "el doble de nutriente → clave nueva");
ok(M.claveDe({ ...BANCAL, manejo: "convencional" }) !== base, "ecológico↔convencional → clave nueva (otro catálogo entero)");
ok(M.claveDe({ ...BANCAL, momento: "fondo" }) !== base, "fondo↔cobertera → clave nueva (cambia la velocidad que hace falta)");
ok(M.claveDe({ ...BANCAL, cultivo: "cebolla" }) !== base, "otro cultivo → clave nueva");
ok(M.claveDe({ ...BANCAL, gramos: 41.4 }) === base, "41,4 g y 41 g son la misma compra (se redondea, no se rebusca por decimales)");
ok(M.claveDe({ ...BANCAL, ciudad: "Girona" }) === base, "cambiar de ciudad NO tira la caché (el catálogo español es el mismo)");

console.log("── el prompt lleva el criterio, no solo la pregunta ──");
const S = M.SISTEMA;
ok(/dosis de etiqueta|DOSIS DEL PLAN TIENE QUE CABER/i.test(S),
   "regla 1: descarta el producto si hay que pasarse de la etiqueta para llegar a la dosis");
ok(/mineraliza/i.test(S), "regla 2: en ecológico, el N tiene que mineralizar a tiempo");
ok(/€\/kg DE NUTRIENTE SE CALCULA/i.test(S), "regla 3: el €/kg de nutriente se calcula, no se estima");
ok(/No inventes NUNCA/i.test(S) && /precio/i.test(S), "prohibición explícita de inventar producto, precio o certificación");
ok(/certificado_eco: null|no lo supongas/i.test(S), "no supone la certificación ecológica por el nombre del producto");

console.log("── el prompt del usuario lleva las variables que deciden ──");
const p = M.promptUsuario(BANCAL);
ok(/41 g/.test(p), "los gramos exactos que calculó el motor");
ok(/ECOLÓGICO/.test(p), "el manejo, en mayúsculas y sin ambigüedad");
ok(/8\.2 g de nutriente por m²/.test(p), `la dosis por m² ya calculada (${p.match(/[\d.]+ g de nutriente por m²/)?.[0]})`);
ok(/cobertera/.test(p), "el momento de aplicación");
ok(/~6\b/.test(p), "las semanas que quedan hasta cosechar (decide si el N orgánico llega a tiempo)");
ok(/España/.test(p), "el mercado donde tiene que poder comprarlo");

console.log("── parseo defensivo de la respuesta ──");
const conRuido = [{ type: "text", text: 'Claro, aquí tienes:\n```json\n{"recomendado":{"producto":"Harina de sangre"}}\n```' }];
ok(M.extraerJSON(conRuido)?.recomendado?.producto === "Harina de sangre", "saca el JSON aunque venga envuelto en markdown y preámbulo");
ok(M.extraerJSON([{ type: "text", text: "no encontré nada" }]) === null, "sin JSON → null (no revienta)");
ok(M.extraerJSON([{ type: "text", text: "{roto" }]) === null, "JSON roto → null (no revienta)");
ok(M.extraerJSON([]) === null && M.extraerJSON(null) === null, "contenido vacío o nulo → null");

console.log("── las citas salen de lo que Claude leyó de verdad ──");
const contenido = [
  { type: "text", text: "…", citations: [
    { url: "https://tienda.example/harina", title: "Harina de sangre 1 kg" },
    { url: "https://tienda.example/harina", title: "duplicado" },
  ] },
  { type: "text", text: "…", citations: [{ url: "https://otra.example/ficha", title: "Ficha técnica" }] },
];
const c = M.citas(contenido);
ok(c.length === 2, `dos fuentes distintas, sin duplicar la misma URL (${c.length})`);
ok(c[0].url === "https://tienda.example/harina", "conserva la URL para que el agricultor la abra");
ok(M.citas([{ type: "text", text: "sin citas" }]).length === 0, "sin citas → lista vacía, no undefined");

console.log("── guardas de coste y de encaje en la infraestructura ──");
const src = readFileSync(join(RAIZ, "api", "_ia-producto-fertilizante.js"), "utf8");
ok(/max_uses:\s*MAX_USES/.test(src) && /MAX_USES\s*=\s*\d+/.test(src),
   "las búsquedas van con tope duro (web search se factura por búsqueda)");
ok(/response_inclusion:\s*"excluded"/.test(src),
   "el contenido crudo de las búsquedas no vuelve al cliente (recorta tokens de salida)");
ok(/cacheado: true/.test(src) && /CACHE_DIAS/.test(src),
   "hay caché: la misma necesidad no se paga dos veces");
ok(/stop_reason === "refusal"/.test(src),
   "un rechazo del modelo llega como 200 y se detecta (si no, parecería un fallo de formato)");
ok(/obsoleto: true/.test(src),
   "si la búsqueda falla se devuelve la caché vieja MARCADA como vieja, no una pantalla en blanco");

const ia = readFileSync(join(RAIZ, "api", "ia.js"), "utf8");
ok(/"producto-fertilizante":\s*require/.test(ia),
   "cuelga de /api/ia (Vercel Hobby admite 12 funciones y ya hay 11)");

const vercel = JSON.parse(readFileSync(join(RAIZ, "vercel.json"), "utf8"));
ok(vercel.functions?.["api/ia.js"]?.maxDuration >= 60,
   "api/ia.js tiene 60 s (una búsqueda + razonamiento no cabe en los 10 s por defecto)");

const schemaSql = readFileSync(join(RAIZ, "db", "anadir-producto-fert-2026-08-07.sql"), "utf8");
ok(/producto_fert jsonb/.test(schemaSql), "la migración crea la columna de caché");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
