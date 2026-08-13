# Revisión crítica del precio — 13-ago-2026

> Anexo a `precio-por-valor.md` (11-ago). No lo sustituye: **la recomendación de
> precio aguanta**. Lo que cambia es el ARGUMENTO que la sostiene, y hay dos
> hechos del mercado que el documento original no tenía y que le quitan el suelo
> a su pieza central.
>
> Misma regla: dato oficial citado, dato de motor reproducible, estimación
> etiquetada.

---

## 1. El ancla de 200 € ya no existe

El documento construye su tesis sobre esto: *"el ancla mental de ese agricultor
está en ~200 €/año, no en 800"*, apoyado en Agroptima a **198 €+IVA — dato de
2016**, con la advertencia de que podía estar desactualizado.

Comprobado el 13-ago-2026 en su propia página de precios: **Agroptima ya no
publica precios**. Dice literalmente que *"el precio se calcula según hectáreas y
usuarios"* y remite a contacto comercial. Ofrece 15 días de prueba sin tarjeta.

Dos conclusiones, y la segunda importa más que la primera:

- **El ancla de 198 € no es verificable hoy.** Un dato de hace diez años sin
  confirmación no puede sostener la comparación principal de un documento de
  precio. Hay que tratarlo como lo que es: histórico.
- **El comparable cobra por hectáreas y usuarios**, que es exactamente el modelo
  que este documento propuso para Kylia. Eso es una validación fuerte y gratuita:
  el mercado ya ha educado al cliente en que el software agrícola escala con la
  superficie. El "defecto de los 99 € planos" que el documento identificó no solo
  era real, es que corregirlo alinea a Kylia con el estándar del sector.

## 2. El cuaderno tiene un sustituto gratis, y eso desinfla la capa A

La capa A —el valor determinista, lo único sobre lo que el documento acepta
construir precio— vale **500-1.500 €/año**, y su partida mayor es *"cuaderno
digital RD 1051/2022: 198-800 €"*.

Ese número está inflado. Las comunidades autónomas ofrecen cuaderno digital
**gratuito** (Castilla y León con CUECYL, Andalucía, Castilla-La Mancha, y CXT de
Plataforma Tierra con el primer año gratis). Tienen limitaciones reales —sin app
móvil con modo sin cobertura, soporte escaso, interfaz peor— pero **cumplen el
mínimo legal y cuestan cero euros**.

Si existe un sustituto gratuito que cumple, el valor de mercado del cuaderno *como
cuaderno* no son 198-800 €: es la diferencia de comodidad. Y sobre comodidad no
se cobra 99 € a un horticultor.

**Esto no hunde el precio; obliga a mover el argumento.** Lo que ningún cuaderno
gratuito hace —ni de pago, según la comparativa del documento original— es
**decidir**: los gratuitos REGISTRAN lo que ya hiciste. Kylia calcula los gramos
antes de que los eches y descuenta lo ya aplicado. La capa A hay que recomponerla
así:

| Concepto | Valor defendible | Comentario |
|---|---|---|
| Cuaderno como registro | **≈0 €** | Hay alternativa gratuita que cumple |
| Cuaderno **integrado** con la decisión (no reteclear) | Comodidad, no cuantificable | No se factura solo |
| **Plan de abonado al gramo** | **La partida principal** | Obligatorio, y ningún gratuito lo calcula |
| Descuento del abonado ya aplicado | 34% de más en el caso real del Labinor | Dato de motor |

## 3. El plan de abonado ya es obligatorio — y el documento lo infravalora

Esto juega a favor y el documento lo trata de pasada, como *"coste de sustituir
Agroptima"*. Es bastante más que eso: el plan de abonado del **RD 1051/2022** es
**exigible desde el 1-sep-2025** *(tras el aplazamiento de la fecha inicial)*. O
sea: no es un ahorro hipotético, es una obligación **vigente hoy** que Kylia
resuelve sola y al gramo.

Ese es el argumento de venta más fuerte que tiene el producto, y estaba escondido
en una fila de una tabla.

## 4. ⚠️ El riesgo que no estaba en el documento: SIEX

**`SIEX` no aparece en NINGÚN fichero del repositorio.** `RD 1051/2022` aparece en
cinco o más. Son cosas distintas y conviene no mezclarlas:

- **RD 1051/2022** → nutrición sostenible, plan de abonado. Es lo que Kylia hace.
- **RD 1054/2022** → crea **SIEX** (Sistema de Información de Explotaciones), el
  REA y el **CUE (Cuaderno Digital de Explotación)**. El CUE digital es
  **obligatorio desde el 1-ene-2027 para registrar tratamientos fitosanitarios**,
  para todas las explotaciones.

El CSV que exporta Kylia lleva cabeceras propias (`sustancia_activa`,
`plazo_seguridad_dias`, `fuera_catalogo`…) y no hay ni rastro de compatibilidad
con SIEX.

**El riesgo comercial es concreto**: si en 2027 se vende Kylia como "tu cuaderno
digital", el agricultor esperará cumplir con ello y **no cumplirá**. Hay que
decidir una de dos, y decidirlo antes de vender:

1. Integrar el volcado a SIEX, y entonces el cuaderno sí es un argumento de peso
   justo cuando pasa a ser obligatorio para todos; o
2. Dejar de posicionar a Kylia como el cuaderno, y venderla por la decisión
   (riego + abonado), con el cuaderno como registro interno que se exporta.

La opción 2 es coherente con el punto 2 de este anexo y no requiere trabajo. La 1
convierte una amenaza (cuadernos gratis) en un motivo de compra con fecha límite
puesta por el BOE.

## 5. Un error aritmético en el documento

Dice: *"el plan de lechuga son **116 kg N/ha** (extracción 2,5 kg N/t × 35 t/ha +
colchón MAPA 45 − crédito de residuos 13,2)"*.

Ejecutado contra `api/_motor-nutricion.js` el 13-ago:

```
necesidadNutrientes("lechuga", 35, null, { area_m2: 10000 })
  → extracción 87,5 + colchón 45 = 132,5 kg N/ha   (sin crédito)
creditoResiduosN("lechuga", true) → 13,2
  → 132,5 − 13,2 = 119,3 kg N/ha                   (con restos incorporados)
```

**119,3, no 116.** La propia fórmula que el documento escribe da 119,3. Es un 2,8%
y no mueve la conclusión —los 44 €/ha salen de otra cuenta— pero en un documento
cuya autoridad se apoya en que sus cifras son reproducibles, un número que no
reproduce su propia fórmula cuesta más que el 2,8%.

Detalle relevante: el crédito de 13,2 **solo se aplica si los restos del cultivo
anterior se incorporaron**. Sin esa marca el motor devuelve 0, y el plan pide
132,5 kg N/ha.

---

## 6. Qué cambia y qué no

**No cambia:** la tarifa (99 € hasta 5 ha, +12 €/ha, tope 400), el cobro anual y
por adelantado, no cobrar por el agua mientras la concordancia honesta sea del
62%, y no bajar el precio de la cooperativa para cerrar la primera.

**Cambia el argumento de venta.** Deja de ser *"te ahorras el cuaderno"* (hay uno
gratis) y pasa a ser *"cumples el plan de abonado obligatorio y además te dice
cuántos gramos echar, descontando lo que ya echaste"*. Es más estrecho, más
verdadero y más difícil de rebatir.

**Y aparecen dos deberes nuevos:**

1. Decidir la postura ante SIEX/CUE **antes** de vender el cuaderno como
   argumento (§4).
2. Fijar la política de IVA en `/precios`. Muchos horticultores están en el
   **régimen especial agrario** y no recuperan el IVA soportado: para ellos 99 €
   son 119,79 € reales. Si la landing dice 99 y el cargo es 119,79, la primera
   impresión del cobro es una decepción del 21%. Agroptima publicaba
   "198 €**+IVA**". Hay que elegir y escribirlo con la misma claridad.

---

## 7. Fuentes de esta revisión

- [Agroptima — página de precios](https://www.agroptima.com/es/precios) (consultada 13-ago-2026: sin precios públicos, "según hectáreas y usuarios", prueba de 15 días).
- [FEGA — El Cuaderno Digital de Explotación Agrícola (CUE)](https://www.fega.gob.es/sites/default/files/files/document/10.2023.03.15-12.45h_blq-04_inmaculada-bravo_cue.el-cue-y-el-riego.pdf).
- [Junta de Castilla y León — CUECYL, cuaderno digital de explotación](https://agriculturaganaderia.jcyl.es/web/es/cuaderno-digital-explotacion-agricola.html) (gratuito).
- [Junta de Andalucía — Cuaderno de explotación](https://www.juntadeandalucia.es/organismos/agriculturapescaaguaydesarrollorural/areas/agricultura/cuaderno-explotacion.html).
- [Interempresas — El CUE en España: mucho más que un 'excel' obligatorio](https://www.interempresas.net/Grandes-cultivos/610490-Cuaderno-Digital-de-Explotacion-en-Espana-(CUE)-mucho-mas-que-un-'excel'-obligatorio.html).
- [Locatec — Cuánto cuesta el cuaderno de campo digital](https://locatec.es/cuanto-cuesta-el-cuaderno-de-campo-digital-precios-descuentos-y-ayudas/) (confirma versiones gratuitas de las administraciones; no publica importes).
- Motor: `api/_motor-nutricion.js`, ejecutado el 13-ago-2026.
