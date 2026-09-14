// El panel /pilotos no puede publicar un ahorro que el informe no sostiene.
//   node tests/test-pilotos-publicable.mjs
//
// HALLAZGO DE CODEX en la reauditoría de 56fd87b: el payload de
// /api/campo?vista=pilotos no propagaba `publicable`, así que la página no tenía
// forma de saber que el informe no se sostiene. Con publicable=false las cifras
// llegan a null, `exceso > 0.5` da falso, y caía al ÚLTIMO caso del if:
//
//     "Su riego coincidió con la lámina FAO-56."
//
// que es una conclusión sobre datos que no la sostienen. Y cuando sí hay cifras,
// decía "Siguiendo a Kylia ahorrarías X", que convierte una simulación en un
// ahorro medido (ahorro_demostrado es false, siempre).
//
// Este test ejecuta la función `claim()` real de la página.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

// Se extrae claim() de la página y se ejecuta de verdad.
const html = readFileSync(join(RAIZ, "pilotos", "index.html"), "utf8");
const cuerpo = html.split("<script>").pop().split("</script>")[0];
const claim = new Function("location", "document", "fetch", "URLSearchParams",
  cuerpo + "\n;return claim;")(
  { search: "" },
  { getElementById: () => ({ innerHTML: "" }), addEventListener: () => {} },
  async () => ({ json: async () => ({}) }),
  URLSearchParams);

console.log("── el caso exacto que reproduce Codex ──");
const roto = { disponible: true, publicable: false,
               motivo_no_publicable: "el contrafactual se calculó con el 61% del clima del periodo",
               exceso_l_m2: 20, ahorro_pct: 25, ahorro_potencial_pct: 25, ahorro_demostrado: false };
const pintadoRoto = claim(roto);
ok(!/ahorrar/i.test(pintadoRoto), "no aparece la palabra ahorrar");
ok(!/20 L\/m²/.test(pintadoRoto), "ni la cifra de 20 L/m²");
ok(!/25%/.test(pintadoRoto), "ni el 25%");
ok(/No se puede comparar/.test(pintadoRoto), `dice que no se puede comparar`);
ok(/61% del clima/.test(pintadoRoto), "y por qué");

console.log("\n── y el caso real de hoy: publicable=false deja las cifras a null ──");
// Así es como llega hoy desde el servidor. Antes caía al último `return` y
// pintaba "su riego coincidió", que es peor: afirma en vez de callarse.
const nulo = { disponible: true, publicable: false, motivo_no_publicable: "faltan riegos cuantificados",
               exceso_l_m2: null, ahorro_pct: null };
ok(!/coincidió/.test(claim(nulo)), "NO dice 'su riego coincidió'");
ok(/No se puede comparar/.test(claim(nulo)), "dice que no se puede comparar");

console.log("\n── cuando sí se sostiene, lenguaje contrafactual ──");
const bien = { disponible: true, publicable: true, exceso_l_m2: 20, ahorro_pct: 25,
               ahorro_potencial_pct: 25, ahorro_demostrado: false };
const pintadoBien = claim(bien);
ok(/20 L\/m²/.test(pintadoBien) && /25%/.test(pintadoBien), "ahora sí salen las cifras");
ok(/simulación/.test(pintadoBien), "y se dice que es una simulación");
ok(!/ahorrarías/.test(pintadoBien), "sin 'ahorrarías': no hay ahorro demostrado que afirmar");

console.log("\n── déficit y empate también pasan por la guardia ──");
ok(/déficit/.test(claim({ ...bien, exceso_l_m2: -20 })), "el caso de riego corto sigue avisando");
ok(/simulad/.test(claim({ ...bien, exceso_l_m2: 0 })), "y el empate dice que la lámina es simulada");

console.log("\n── el servidor propaga los tres campos ──");
const campo = readFileSync(join(RAIZ, "api", "campo.js"), "utf8");
const payload = campo.split("agua: a.disponible")[1].split("avisos:")[0];
for (const c of ["publicable", "clase_metrica", "ahorro_demostrado", "motivo_no_publicable"])
  ok(new RegExp(`${c}:`).test(payload), `vista=pilotos manda ${c}`);
ok(/ahorro_demostrado: a\.ahorro_demostrado === true/.test(payload),
   "y ahorro_demostrado solo es true si el informe lo dice (por defecto, false)");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
