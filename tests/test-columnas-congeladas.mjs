// El código que lee las columnas congeladas se desplegó ANTES de la migración.
//   node tests/test-columnas-congeladas.mjs
//
// POR QUÉ EXISTE ESTE FICHERO. El paso 5 de db/congelar-lamina-riego-2026-09-14.sql
// dice "el código nuevo LEE columnas que ya existen (paso 3), así que no falla".
// Esa frase describe el orden previsto, no el que ocurrió: el código salió a
// producción al pushear a main y la migración sigue sin ejecutar. Resultado
// medido contra la API real el 15-sep-2026:
//
//   GET /api/campo?vista=hoy&usuario_id=9aaa1b25-…   → {"ok":false,
//     "error":"Supabase select acciones 400 … 42703 column acciones.lamina_mm
//     does not exist"}
//
// La pantalla de hoy de la única parcela viva, el perfil y el reveal de los tres
// pilotos: los cuatro caídos. Ningún test lo vio porque todos le dan a Supabase
// de mentira, y el de mentira tiene todas las columnas.
//
// Aquí se ejecuta el helper real contra un PostgREST simulado SIN esas columnas,
// que es el estado de producción ahora mismo.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

process.env.SUPABASE_URL = "https://falso.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "clave-de-mentira";

const CONGELADAS = ["lamina_mm", "lamina_origen", "caudal_mmh"];

// PostgREST de mentira. `columnas` dice qué existe de verdad en la tabla; lo que
// se pida y no esté se rechaza igual que el de verdad: 42703 en el SELECT y
// PGRST204 en el INSERT, y la consulta ENTERA cae.
function montar({ columnas, filas = [] }) {
  const peticiones = [];
  const http = require(join(RAIZ, "api", "_http.js"));
  http.fetchConTimeout = async (url, opts = {}) => {
    const u = new URL(url);
    const metodo = opts.method || "GET";
    peticiones.push({ metodo, query: u.search.replace(/^\?/, ""), body: opts.body });

    if (metodo === "GET") {
      const pedidas = (u.searchParams.get("select") || "*").split(",").map(c => c.trim());
      const falta = pedidas.find(c => c !== "*" && !columnas.includes(c));
      if (falta) return respuesta(400, JSON.stringify(
        { code: "42703", details: null, hint: null, message: `column acciones.${falta} does not exist` }));
      return respuesta(200, JSON.stringify(filas.map(f => proyectar(f, pedidas, columnas))));
    }
    const cuerpo = JSON.parse(opts.body);
    const falta = cuerpo.flatMap(f => Object.keys(f)).find(c => !columnas.includes(c));
    if (falta) return respuesta(400, JSON.stringify(
      { code: "PGRST204", message: `Could not find the '${falta}' column of 'acciones' in the schema cache` }));
    return respuesta(201, JSON.stringify(cuerpo));
  };
  // Se recarga _supabase para que coja el fetch parcheado y resetee su memoria
  // de "faltan columnas" (es estado de módulo, con TTL).
  delete require.cache[require.resolve(join(RAIZ, "api", "_supabase.js"))];
  return { sb: require(join(RAIZ, "api", "_supabase.js")), peticiones };
}
const respuesta = (status, texto) => ({
  ok: status < 400, status,
  text: async () => texto, json: async () => JSON.parse(texto),
});
const proyectar = (fila, pedidas, columnas) => {
  if (pedidas.includes("*")) return { ...fila };
  const o = {};
  for (const c of pedidas) if (columnas.includes(c)) o[c] = fila[c] ?? null;
  return o;
};

// La consulta EXACTA que tumbó producción (api/campo.js:313, vista=perfil).
const QUERY_PERFIL = "usuario_id=eq.9aaa1b25-6fad-4213-9eda-e135af71b2c3&tipo=eq.riego"
  + "&select=id,fecha_local,cantidad_l_m2,duracion_min,lamina_mm,lamina_origen,caudal_mmh"
  + "&order=fecha_local.desc&limit=8";

const RIEGO = { id: 7, fecha_local: "2026-07-20", cantidad_l_m2: null, duracion_min: 120 };
const SIN_MIGRAR = ["id", "fecha_local", "cantidad_l_m2", "duracion_min", "tipo", "usuario_id"];
const MIGRADA    = [...SIN_MIGRAR, ...CONGELADAS];

console.log("\n── 1. antes de migrar: la columna que falta no puede tumbar la consulta ──");
{
  const { sb, peticiones } = montar({ columnas: SIN_MIGRAR, filas: [RIEGO] });
  let filas = null, error = null;
  try { filas = await sb.supabaseSelect("acciones", QUERY_PERFIL); }
  catch (e) { error = e; }
  ok(error === null, `no lanza (antes: ${error ? String(error.message).slice(0, 60) : "—"})`);
  ok(Array.isArray(filas) && filas.length === 1, `devuelve el riego (${filas ? filas.length : "nada"})`);
  ok(peticiones.length === 2, `un reintento, no más (${peticiones.length} peticiones)`);
  const segunda = peticiones[1]?.query || "";
  ok(CONGELADAS.every(c => !segunda.includes(c)), "el reintento va sin las tres congeladas");
  ok(segunda.includes("limit=8") && segunda.includes("order=fecha_local.desc")
     && segunda.includes("tipo=eq.riego"), "y conserva filtro, orden y límite");
}

console.log("\n── 2. y lo que sale no se inventa: se declara reconstruido ──");
{
  const { sb } = montar({ columnas: SIN_MIGRAR, filas: [RIEGO] });
  const [fila] = await sb.supabaseSelect("acciones", QUERY_PERFIL);
  const { laminaDeAccion } = require(join(RAIZ, "assets", "js", "motor-riego.js"));
  const l = laminaDeAccion(fila, 11);
  ok(l.mm === 22, `la lámina se recalcula con el caudal actual (${l.mm} mm = 120 min × 11 mm/h)`);
  ok(l.origen === "recalculada_caudal_actual", `y lo dice: origen "${l.origen}"`);
  ok(l.reconstruida === true, "marcada como reconstrucción, no como dato de época");
}

console.log("\n── 3. un riego no se pierde por una columna que aún no existe ──");
{
  const { sb, peticiones } = montar({ columnas: SIN_MIGRAR });
  const fila = { usuario_id: "u1", tipo: "riego", fecha_local: "2026-09-15",
                 duracion_min: 60, cantidad_l_m2: null,
                 caudal_mmh: 11, lamina_mm: 11, lamina_origen: "duracion_x_caudal" };
  let guardado = null, error = null;
  try { guardado = await sb.supabaseInsert("acciones", fila); }
  catch (e) { error = e; }
  ok(error === null, `el insert no lanza (antes: ${error ? String(error.message).slice(0, 60) : "—"})`);
  ok(Array.isArray(guardado) && guardado.length === 1, "el riego queda guardado");
  ok(guardado && guardado[0].duracion_min === 60, "con su duración, que es de lo que se recalcula");
  ok(guardado && CONGELADAS.every(c => !(c in guardado[0])), "sin los campos congelados, que no caben todavía");
}

console.log("\n── 4. el fallback NO se traga cualquier error de columna ──");
{
  const { sb, peticiones } = montar({ columnas: SIN_MIGRAR, filas: [RIEGO] });
  let error = null;
  try { await sb.supabaseSelect("acciones", "select=id,columna_inventada"); }
  catch (e) { error = e; }
  ok(error !== null, "una columna que no es de la migración sigue siendo un error");
  ok(String(error?.message || "").includes("columna_inventada"), "y el mensaje dice cuál");
  ok(peticiones.length === 1, "sin reintentar: no hay nada que recortar");
}

console.log("\n── 5. después de migrar, manda la lámina congelada y no sobra ni una petición ──");
{
  const congelado = { ...RIEGO, lamina_mm: 15, lamina_origen: "duracion_x_caudal", caudal_mmh: 7.5 };
  const { sb, peticiones } = montar({ columnas: MIGRADA, filas: [congelado] });
  const [fila] = await sb.supabaseSelect("acciones", QUERY_PERFIL);
  ok(peticiones.length === 1, `una sola petición (${peticiones.length})`);
  ok(peticiones[0].query.includes("lamina_mm"), "que sí pide las congeladas");
  const { laminaDeAccion } = require(join(RAIZ, "assets", "js", "motor-riego.js"));
  const l = laminaDeAccion(fila, 11);
  ok(l.mm === 15, `manda la congelada (${l.mm} mm), no el caudal de hoy (habría dado 22)`);
  ok(l.reconstruida === false, "y es dato de época, no reconstrucción");
}

console.log("\n── 6. sabido que faltan, no se gasta un round-trip por consulta ──");
{
  const { sb, peticiones } = montar({ columnas: SIN_MIGRAR, filas: [RIEGO] });
  await sb.supabaseSelect("acciones", QUERY_PERFIL);     // 2 peticiones: falla y reintenta
  await sb.supabaseSelect("acciones", QUERY_PERFIL);     // 1: ya va recortada
  await sb.supabaseSelect("acciones", QUERY_PERFIL);     // 1
  ok(peticiones.length === 4, `2 + 1 + 1 = 4 peticiones (${peticiones.length})`);
  ok(CONGELADAS.every(c => !(peticiones[2].query.includes(c))), "la segunda consulta ya va recortada de salida");
}

console.log(fallos === 0 ? "\n✅ TODOS LOS TESTS VERDES\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos === 0 ? 0 : 1);
