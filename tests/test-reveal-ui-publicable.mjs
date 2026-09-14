// Una métrica con publicable=false no puede pintarse como ahorro.
//   node tests/test-reveal-ui-publicable.mjs
//
// HALLAZGO DE CODEX (14-sep-2026), confirmado. El servidor calcula `publicable`
// desde el 13-sep y pone las cifras a null cuando el contrafactual no se
// sostiene. Pero piloto/informe/index.html solo miraba `agua.disponible`: con
// publicable=false pintaba el hero de "0 L/m² · A la par" como si fuera un
// resultado. La guardia estaba puesta en el servidor y abierta en la pantalla.
//
// Este test ejecuta la función de pintado del informe sobre un payload real del
// servidor, en un DOM de mentira. No busca palabras en el fuente.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const RV = require(join(RAIZ, "api", "_reveal.js"));

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

// ── Se extraen las funciones del informe y se ejecutan de verdad ──
const html = readFileSync(join(RAIZ, "piloto", "informe", "index.html"), "utf8");
const cuerpo = html.split("<script>").pop().split("</script>")[0];
let root;
const ctx = {
  document: { getElementById: () => root, addEventListener: () => {} },
  window: { location: { search: "" } },
  fetch: async () => ({ json: async () => ({}) }),
  console,
};
const fn = new Function("document", "window", "fetch", "console", "location", "URLSearchParams",
  cuerpo + "\n;return { pintar: typeof pintar === 'function' ? pintar : null };");
const invocar = (datos) => fn(ctx.document, ctx.window, ctx.fetch, console,
                             { search: "" }, URLSearchParams).pintar(datos);

const dia = i => new Date(new Date("2026-06-01T12:00:00Z").getTime() + i * 86400000).toISOString().slice(0, 10);
const riegos = Array.from({ length: 20 }, (_, i) => ({ dia: dia(i), l_m2: 20 }));
const cfBien = { puntos: [{ date: dia(0), acum_l_m2: 0 }, { date: dia(19), acum_l_m2: 300 }],
                 total: 300, deficitFinal: 0, coberturaClima: 1, diasSinClima: 0, diasSinLluviaConocida: 0 };
const cfRoto = { ...cfBien, coberturaClima: 0.6, diasSinClima: 8 };

const informe = (cf) => ({
  ok: true,
  informe: {
    usuario: { ciudad: "Breda", cultivo: "tomate", metodo_riego: "goteo" },
    periodo: { desde: dia(0), hasta: dia(19) },
    dimensiones: {
      agua: RV.dimAguaDesdeContrafactual(riegos, cf),
      horas: { disponible: false, motivo: "sin captura" },
      tratamientos: { disponible: false, motivo: "sin datos" },
      coste: { agua_eur: null, tratamientos_eur: null, nota: "" },
    },
    avisos: [],
  },
});

console.log("── con un contrafactual que NO se sostiene ──");
const roto = informe(cfRoto);
ok(roto.informe.dimensiones.agua.publicable === false, "el servidor lo marca no publicable");
ok(roto.informe.dimensiones.agua.disponible === true,
   "pero `disponible` sigue siendo true: por eso mirar solo eso no bastaba");
root = { innerHTML: "" };
invocar(roto);
const pintadoRoto = root.innerHTML;
ok(!/A la par/.test(pintadoRoto), "la pantalla NO pinta 'A la par'");
ok(!/habrías/.test(pintadoRoto), "ni habla de lo que habrías hecho");
ok(/No se puede comparar/.test(pintadoRoto), "dice que no se puede comparar");
ok(/60% del clima/.test(pintadoRoto), `y por qué: "${(pintadoRoto.match(/No se puede comparar[^<]*/) || [""])[0].slice(0, 110)}"`);
ok(!/\d+ L\/m²<\/div>/.test(pintadoRoto.split("hero")[1] || ""), "y no enseña ninguna cifra grande de agua");

console.log("\n── con uno que sí se sostiene ──");
const bien = informe(cfBien);
ok(bien.informe.dimensiones.agua.publicable === true, "el servidor lo marca publicable");
root = { innerHTML: "" };
invocar(bien);
const pintadoBien = root.innerHTML;
ok(/L\/m²/.test(pintadoBien), "ahora sí se pinta la cifra");
ok(/simulación/.test(pintadoBien), "y se dice que es una SIMULACIÓN");
ok(!/habrías <b>ahorrado<\/b>/.test(pintadoBien),
   "sin convertirla en un ahorro demostrado ('habrías ahorrado')");

console.log("\n── y el payload lo declara para quien lo lea por API ──");
const a = bien.informe.dimensiones.agua;
ok(a.ahorro_demostrado === false, "ahorro_demostrado = false");
ok(a.clase_metrica === "contrafactual_simulado", `clase_metrica = ${a.clase_metrica}`);

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
