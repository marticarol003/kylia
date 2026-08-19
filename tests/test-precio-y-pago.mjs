// El precio de una explotación y el esqueleto de cobro.
//   node tests/test-precio-y-pago.mjs
//
// Tarifa decidida el 11-ago-2026 (docs/negocio/precio-por-valor.md):
// 99 €/año hasta 5 ha, +12 €/ha adicional, tope 400 €/año.
//
// Aquí se prueba el dinero, así que se prueba EJECUTANDO: importes exactos en
// céntimos, los bordes de la tarifa, y que la firma del webhook no se pueda
// falsear. Un error en este fichero es un cargo mal hecho a un agricultor.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import crypto from "crypto";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const P = require(join(RAIZ, "api", "_precio.js"));
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };
const zonas = (...m2) => m2.map(a => ({ area_m2: a }));

console.log("── la tarifa, en los números que importan ──");
ok(P.precioAnual(zonas(10000)).total_cent === 9900, "1 ha → 99 €");
ok(P.precioAnual(zonas(50000)).total_cent === 9900, "5 ha justas → 99 € (el umbral entra en la base)");
// El caso del documento: Marc, 8 ha → 135 €/año.
const marc = P.precioAnual(zonas(80000));
ok(marc.total_cent === 13500, `8 ha → 135 € (el arquetipo del documento; salen ${P.euros(marc.total_cent)})`);
ok(P.precioAnual(zonas(150000)).total_cent === 21900, "15 ha → 219 € (99 + 10 ha × 12)");
ok(P.precioAnual(zonas(60000)).total_cent === 11100, "6 ha → 111 € (99 + 12)");

console.log("── el tope ──");
const grande = P.precioAnual(zonas(1000000));   // 100 ha
ok(grande.total_cent === 40000 && grande.topado === true, "100 ha → 400 €, y queda marcado como topado");
ok(P.precioAnual(zonas(301000)).total_cent === 40000, "a partir de ~30,1 ha ya toca techo");
ok(P.precioAnual(zonas(300000)).total_cent === 39900, "y justo debajo, 30 ha → 399 €: el tope no se activa antes de tiempo");

console.log("── varias parcelas suman, que es como se factura ──");
const tres = P.precioAnual(zonas(20000, 30000, 30000));   // 2+3+3 = 8 ha
ok(tres.total_cent === marc.total_cent, "tres parcelas de 2+3+3 ha pagan lo mismo que una de 8");
ok(P.precioAnual(zonas(10000, null, 0, undefined)).total_cent === 9900,
   "una zona a medio configurar (sin superficie) no factura ni rompe la suma");

console.log("── quien no debe pagar ──");
const piloto = P.precioAnual(zonas(80000), { gratuitoDePorVida: true });
ok(piloto.cobrable === false && piloto.total_cent === 0,
   "un piloto de 2026 no paga: la gratuidad es palabra dada, no un caso límite");
ok(piloto.motivo === "gratuito_de_por_vida", "y se dice por qué, para que el importe 0 no parezca un fallo");
const vacio = P.precioAnual([]);
ok(vacio.cobrable === false && vacio.motivo === "sin_superficie",
   "sin parcelas dadas de alta no se cobra la base 'por si acaso': no hay nada que gestionar");

console.log("── el IVA se calcula, no se olvida ──");
ok(marc.total_con_iva_cent === 16335, "135 € + 21% = 163,35 € (lo que de verdad se le carga)");
ok(marc.iva_pct === 21, "y el tipo va explícito en la respuesta");

console.log("── céntimos enteros siempre ──");
for (const m2 of [12345, 67890, 123456, 999999, 51234]) {
  const t = P.precioAnual(zonas(m2));
  if (!Number.isInteger(t.total_cent) || !Number.isInteger(t.total_con_iva_cent)) {
    ok(false, `importe no entero con ${m2} m²`); break;
  }
}
ok(true, "ningún importe sale con decimales de coma flotante");
ok(P.hectareasFacturables(34287) === 3.4, "las hectáreas se cobran a la décima: 3,4287 ha → 3,4");

console.log("── el recibo se explica en una frase ──");
ok(/8 ha/.test(P.explicacion(marc)) && /135,00/.test(P.explicacion(marc)),
   `la explicación dice las hectáreas y el importe: "${P.explicacion(marc)}"`);
ok(/piloto/i.test(P.explicacion(piloto)), "y la del piloto dice por qué es 0");

console.log("── prorrateo del primer año ──");
const pr = P.prorrateoHastaFinDeAnio(13500, new Date(Date.UTC(2026, 8, 7)));  // 7-sep, Lanzadera
ok(pr.importe_cent < 13500 && pr.importe_cent > 0, `entrar el 7-sep no paga el año entero (${P.euros(pr.importe_cent)} €)`);
ok(P.prorrateoHastaFinDeAnio(13500, new Date(Date.UTC(2026, 0, 1))).importe_cent === 13500,
   "y quien entra el 1 de enero paga el año completo");

console.log("── la firma del webhook no se puede falsear ──");
process.env.STRIPE_WEBHOOK_SECRET = "whsec_pruebas";
const S = require(join(RAIZ, "api", "_stripe.js"));
const cuerpo = JSON.stringify({ type: "checkout.session.completed", data: { object: { client_reference_id: "x" } } });
const t = Math.floor(Date.now() / 1000);
const firmaBuena = crypto.createHmac("sha256", "whsec_pruebas").update(`${t}.${cuerpo}`).digest("hex");

ok(S.verificarFirma(cuerpo, `t=${t},v1=${firmaBuena}`).ok === true, "una firma correcta pasa");
ok(S.verificarFirma(cuerpo, `t=${t},v1=${"0".repeat(64)}`).ok === false, "una firma inventada, no");
ok(S.verificarFirma(cuerpo + " ", `t=${t},v1=${firmaBuena}`).ok === false,
   "un cuerpo alterado en UN byte tumba la firma — por eso hace falta el cuerpo crudo");
const viejo = t - 3600;
const firmaVieja = crypto.createHmac("sha256", "whsec_pruebas").update(`${viejo}.${cuerpo}`).digest("hex");
ok(S.verificarFirma(cuerpo, `t=${viejo},v1=${firmaVieja}`).ok === false,
   "un webhook legítimo pero de hace una hora no vale: es defensa contra reenvíos");
ok(S.verificarFirma(cuerpo, "").ok === false && S.verificarFirma("", `t=${t},v1=x`).ok === false,
   "sin firma o sin cuerpo, no pasa");

console.log("── el endpoint, montado como debe ──");
const pago = leer("api", "pago.js");
ok(/bodyParser: false/.test(pago),
   "el body parser está apagado: si algo parsea y reserializa el cuerpo, la firma deja de cuadrar");
ok(/leerCuerpoCrudo/.test(pago), "y se lee el cuerpo crudo del stream");
ok(/if \(!r\.precio\.cobrable\)/.test(pago),
   "a un piloto con gratuidad NO se le abre la pasarela");
ok(/ES_UUID\.test\(propietarioId\)/.test(pago),
   "el webhook no escribe con un propietario_id que no tenga forma de UUID");
ok(/return res\.status\(500\)/.test(pago),
   "si no se puede guardar el cobro se devuelve 500, para que Stripe reintente");
// Comprobado en producción el 13-ago: con la lista de columnas explícita, /api/pago
// daba 500 mientras la migración no estuviera ejecutada. Es la misma trampa que
// campo.js ya tenía documentada.
ok(!/select=id,propietario_id,email,gratuito_de_por_vida/.test(pago) &&
   (pago.match(/&select=\*/g) || []).length === 2,
   "las consultas usan select=*: sin la migración ejecutada, pedir las columnas nuevas revienta");
const sql = leer("db", "suscripciones-2026-08-13.sql");
ok(/gratuito_de_por_vida/.test(sql) && /palabra dada/.test(sql),
   "la migración marca la gratuidad de los pilotos y deja escrito por qué");
ok(/add column if not exists/.test(sql), "y es idempotente");

console.log("── nada de esto cobra todavía ──");
delete process.env.STRIPE_SECRET_KEY;
ok(S.configurado() === false, "sin STRIPE_SECRET_KEY, Stripe está apagado");
ok(/stripe_no_configurado/.test(pago), "y el endpoint lo dice en vez de fallar raro");

if (fallos) { console.error(`\n${fallos} test(s) FALLARON`); process.exit(1); }
console.log("\n✅ TODOS LOS TESTS VERDES");
