// ─────────────────────────────────────────────────────────────────
// El precio de una explotación, calculado desde lo que ya sabemos de ella
// ─────────────────────────────────────────────────────────────────
// Tarifa decidida el 11-ago-2026 (docs/negocio/precio-por-valor.md):
//
//   Productor: 99 €/año hasta 5 ha · +12 €/ha adicional · tope 400 €/año
//
// LA SUPERFICIE NO SE LE PREGUNTA AL AGRICULTOR: sale de las zonas que ya tiene
// dadas de alta, cuyo `area_m2` viene de la superficie oficial de SIGPAC. Eso
// hace el precio verificable por las dos partes.
//
// Y se cobra por lo que GESTIONA EN KYLIA, no por lo que posee. Alguien con
// 12 ha que solo lleva 3 en la app paga por 3. Cobrar por el catastro sería
// convertir el primer recibo en una discusión, y además penalizar justo el gesto
// que queremos: dar de alta más parcelas.
//
// Todo en CÉNTIMOS enteros. Un precio en euros con decimales flotantes acaba
// facturando 134,99999 € — y aquí el número va a un cargo real.

const BASE_CENT       = 9900;    // 99 € hasta el umbral
const UMBRAL_HA       = 5;
const POR_HA_CENT     = 1200;    // 12 €/ha adicional
const TOPE_CENT       = 40000;   // 400 €/año
const IVA_PCT         = 21;      // España, servicios digitales

// Redondeo comercial: las hectáreas se cobran a la décima. Cobrar por 3,4287 ha
// no es más justo, es menos explicable — y un recibo que no se puede explicar en
// una frase se discute.
function hectareasFacturables(m2) {
  const ha = Number(m2) / 10000;
  if (!Number.isFinite(ha) || ha <= 0) return 0;
  return Math.round(ha * 10) / 10;
}

// `zonas`: filas de `usuarios` del propietario (cada una es una parcela).
// Solo cuentan las que tienen superficie: una zona a medio configurar no factura.
function superficieDeZonas(zonas) {
  if (!Array.isArray(zonas)) return 0;
  return zonas.reduce((s, z) => {
    const a = Number(z?.area_m2);
    return s + (Number.isFinite(a) && a > 0 ? a : 0);
  }, 0);
}

// opts.gratuitoDePorVida: los pilotos de 2026 tienen la gratuidad GANADA — se
// les prometió en /precios y es palabra dada, no un caso límite. Va como bandera
// explícita en la fila, no deducida de una fecha, para que nadie la pierda por
// un cambio de criterio posterior.
function precioAnual(zonas, opts = {}) {
  const m2 = superficieDeZonas(zonas);
  const ha = hectareasFacturables(m2);

  if (opts.gratuitoDePorVida) {
    return {
      cobrable: false, motivo: "gratuito_de_por_vida",
      hectareas: ha, base_cent: 0, extra_cent: 0, total_cent: 0,
      total_con_iva_cent: 0, iva_pct: IVA_PCT, topado: false,
    };
  }
  // Sin superficie no hay precio que calcular. No se cobra la base "por si
  // acaso": todavía no hay nada que gestionar.
  if (ha <= 0) {
    return {
      cobrable: false, motivo: "sin_superficie",
      hectareas: 0, base_cent: 0, extra_cent: 0, total_cent: 0,
      total_con_iva_cent: 0, iva_pct: IVA_PCT, topado: false,
    };
  }

  const extraHa    = Math.max(0, ha - UMBRAL_HA);
  const extra_cent = Math.round(extraHa * POR_HA_CENT);
  const bruto      = BASE_CENT + extra_cent;
  const total_cent = Math.min(bruto, TOPE_CENT);

  return {
    cobrable: true, motivo: null,
    hectareas: ha,
    base_cent: BASE_CENT,
    extra_cent: total_cent === TOPE_CENT ? TOPE_CENT - BASE_CENT : extra_cent,
    total_cent,
    total_con_iva_cent: Math.round(total_cent * (1 + IVA_PCT / 100)),
    iva_pct: IVA_PCT,
    topado: bruto > TOPE_CENT,
  };
}

const euros = (cent) => (cent / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Una frase que el agricultor pueda comprobar sin fiarse de nadie. Si no se
// puede explicar el recibo en una línea, el precio está mal contado.
function explicacion(p) {
  if (p.motivo === "gratuito_de_por_vida") return "Gratis de por vida: eres uno de los pilotos de 2026.";
  if (p.motivo === "sin_superficie")       return "Todavía no has dado de alta ninguna parcela.";
  if (p.topado) return `${p.hectareas} ha · tarifa máxima: ${euros(p.total_cent)} €/año + IVA.`;
  if (p.extra_cent === 0) return `${p.hectareas} ha (hasta ${UMBRAL_HA}): ${euros(p.total_cent)} €/año + IVA.`;
  return `${p.hectareas} ha: ${euros(BASE_CENT)} € hasta ${UMBRAL_HA} ha + ` +
         `${euros(p.extra_cent)} € por las ${Math.round((p.hectareas - UMBRAL_HA) * 10) / 10} restantes ` +
         `= ${euros(p.total_cent)} €/año + IVA.`;
}

// ── Prorrateo del primer año ───────────────────────────────────────
// El cobro es anual y por adelantado, y la renovación de todos cae en enero:
// es cuando el agricultor planifica gasto, y en un producto estacional cobrar
// en temporada baja es pedir la baja. Quien entra a mitad de año paga solo lo
// que queda hasta el 31 de diciembre, para no arrastrar doce fechas distintas.
function prorrateoHastaFinDeAnio(total_cent, hoy = new Date()) {
  const anio    = hoy.getUTCFullYear();
  const finAnio = Date.UTC(anio, 11, 31);
  const diasAnio = (Date.UTC(anio, 11, 31) - Date.UTC(anio, 0, 1)) / 86400000 + 1;
  const restantes = Math.max(1, Math.round((finAnio - Date.UTC(anio, hoy.getUTCMonth(), hoy.getUTCDate())) / 86400000) + 1);
  return { dias_restantes: restantes, dias_anio: diasAnio,
           importe_cent: Math.round(total_cent * restantes / diasAnio) };
}

module.exports = {
  BASE_CENT, UMBRAL_HA, POR_HA_CENT, TOPE_CENT, IVA_PCT,
  hectareasFacturables, superficieDeZonas, precioAnual, explicacion,
  prorrateoHastaFinDeAnio, euros,
};
