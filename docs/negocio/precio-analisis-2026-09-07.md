# Análisis del precio — 7-sep-2026

> Tercer documento de la serie, después de `precio-por-valor.md` (11-ago) y
> `precio-revision-2026-08-13.md` (13-ago). Misma regla: **dato oficial citado**,
> **dato de motor** (reproducible ejecutando el código), **estimación** etiquetada.
>
> Este no confirma la tarifa. **La tarifa de 99 €/12 €/400 € se justificó contra
> una pila de valor que tres correcciones posteriores han vaciado, y nadie volvió
> a hacer la cuenta.** Aquí se hace.

---

## 0. Resumen para quien no lea el resto

1. **La capa A se ha quedado en una sola línea.** De las tres partidas que
   sostenían los 99 €, dos ya no existen (el cuaderno tiene sustituto gratis
   desde el 13-ago; los fitosanitarios se retiraron del producto el 13-ago) y la
   tercera —el plan de abonado— **también es gratis**: la propia Administración
   lo calcula. Lo único defendible en euros es el fertilizante que no se compra.
2. **Con esa única línea, la tarifa es coherente por encima de ~7 ha e
   indefendible por debajo de 5.** A 2 ha el precio es 3-6× la banda de captura
   que el propio documento de agosto se impuso.
3. **El cambio a IVA incluido no es neutro en ingreso**, al contrario de lo
   apuntado: +1,0% a 8 ha, +2,4% a 25 ha, −0,8% en el tope. Es pequeño y está
   bien, pero es una subida de la pendiente, no un cambio de presentación.
4. **El precio se congela el día del checkout y no vuelve a mirarse nunca.** Toda
   la promesa —"el precio sale de tu superficie de SIGPAC"— sólo es cierta el
   primer día. Es el hueco de ingeniería más caro de los que quedan.
5. **Hay una palanca legal que no está en ningún documento**: desde 2027-2028 el
   asesoramiento en fertilización es obligatorio, y un **programa informático
   reconocido por la autoridad competente** exime de tener asesor. Ese
   reconocimiento es, hoy, la única vía por la que Kylia puede cobrar por
   cumplimiento en vez de por comodidad.

---

## 1. Lo que ha cambiado en los hechos desde el 13-ago

### 1.1 La fecha del plan de abonado está mal en el repositorio

`precio-revision-2026-08-13.md:67` dice que el plan de abonado es *"exigible
desde el 1-sep-2025"*. **No lo era.** El calendario real, tras el RD 934/2025:

| Explotación | Plan de abonado obligatorio desde |
|---|---|
| Regadío con siembra/plantación entre el 1-mar y el 30-jun de 2026 | **1-ene-2026** |
| Secano y el resto de regadíos | **1-sep-2026** |

El cliente de Kylia —hortícola de regadío, plantación de primavera— cae en la
**primera** fila. O sea que la obligación lleva encima desde enero, y para el
resto del campo empezó hace seis días. La conclusión de agosto ("es una
obligación vigente hoy") acaba siendo cierta por accidente: cuando se escribió,
faltaba medio mes.

Esto importa para el go-to-market más que para el precio: **la ventana comercial
del argumento se abrió la semana pasada.**

### 1.2 Y hay exenciones que se comen justo el tramo base

Del **registro de fertilización** quedan exentas las fincas de **≤5 ha** de
cultivo con **≤1 ha de regadío**. Del **plan de abonado**, los pastos no
fertilizados y el secano ≤10 ha de autoconsumo.

Dicho de otra forma: **una parte del tramo que paga la base plana de 120 € no
tiene ninguna obligación legal que Kylia le resuelva.** El argumento de
cumplimiento no aplica ahí, y es exactamente donde está el precio más caro por
hectárea.

### 1.3 El plan de abonado también es gratis

El 13-ago se aceptó que el cuaderno vale ≈0 € porque las CCAA lo dan gratis, y se
movió la tesis a *"lo que ningún gratuito hace es calcular el plan de abonado"*.
**Esa frase, que es la viga que sostiene el precio actual, es falsa:**

- El cuaderno digital gratuito de la Administración **SGA-CEX** *"permite realizar
  este plan y tiene integrada la herramienta de sostenibilidad agraria para
  nutrientes"* — un módulo de Plan de Abonado dentro del propio cuaderno.
- El MAPA pone a disposición **SATIVUM** (ITACyL), aplicación de recomendación de
  fertilización, para elaborar los planes obligatorios.
- **Atfarm (Yara)** ofrece *"planes ilimitados GRATIS"* de nutrición.

Y esto último no es una casualidad, es la estructura del mercado: **quien vende
el saco regala la recomendación, porque la recomendación vende el saco.** Igual
que xarvio es de BASF. Kylia compite, en la partida "calcular la dosis", contra
el Estado y contra los fabricantes de fertilizante, y los dos la dan a coste
cero. Ninguna estrategia de precio sobrevive a ignorar eso.

Lo que ni el Estado ni Yara pueden dar —y es lo único que queda en pie— es un
sistema **neutral que te diga que eches MENOS**, y que lo diga **en campaña, cada
día, por zona, descontando lo ya aplicado**, y no una vez al año en un portal.

### 1.4 La partida de fitosanitarios ya no la entrega el producto

`precio-por-valor.md` §3 sigue contando *"evitar una aplicación innecesaria:
80-200 €"* dentro de la capa A. El 13-ago (`7a4401d`) se retiraron los
fitosanitarios de la app por decisión propia y bien tomada. **Esa línea vale 0 €
desde entonces** y sigue sumando en la tabla que justifica el precio.

---

## 2. La capa A, recalculada

| Partida | Valor en el doc de agosto | Valor hoy | Motivo |
|---|---|---|---|
| Cuaderno digital RD 1051/2022 | 198-800 € | **0 €** | Sustituto gratuito de las CCAA (asumido ya el 13-ago) |
| Plan de abonado obligatorio | "la partida principal" | **0 €** | SGA-CEX, SATIVUM y Atfarm lo calculan gratis (§1.3) |
| Evitar una aplicación innecesaria | 80-200 € | **0 €** | El producto ya no recomienda tratar (§1.4) |
| **Fertilizante no aplicado de más** | ~44 €/ha y ciclo | **~44 €/ha y ciclo** | Dato de motor; **condicionado** a que hoy sobrefertilice |

**Capa A defendible = 44 €/ha y ciclo × 2 ciclos ≈ 88 €/ha y año.** Y con una
condición encima que conviene no esconder: si el agricultor ya ajusta bien el
nitrógeno, el valor determinista de Kylia para él es **0 €**.

### La banda de captura, aplicada de verdad

La regla que el propio documento fijó: quedarse con el **10-20%** del valor
creado. Sobre 88 €/ha y año, eso son **8,8-17,6 €/ha y año**. Contra la tarifa
nueva (neto, sin IVA):

| Superficie | Valor capa A | Banda 10-20% | Precio neto hoy | Captura real |
|---|---|---|---|---|
| 1 ha | 88 € | 9-18 € | 99,17 € | **113%** ❌ |
| 2 ha | 176 € | 18-35 € | 99,17 € | **56%** ❌ |
| 5 ha | 440 € | 44-88 € | 99,17 € | 23% ⚠️ |
| 8 ha | 704 € | 70-141 € | 136,36 € | 19% ✅ |
| 15 ha | 1.320 € | 132-264 € | 223,14 € | 17% ✅ |
| 29 ha | 2.552 € | 255-510 € | 396,69 € | 16% ✅ |

**La tarifa es correcta a partir de ~7 ha y sólo a partir de ahí.** Debajo de 5
ha se cobra por encima de todo el valor determinista anual, y a 1 ha se cobra más
que el valor entero. El documento de agosto decía que los 99 € caían "en la mitad
baja" de la banda; con la capa A de verdad caen en el **borde superior** para el
arquetipo y **fuera** para el cliente pequeño.

Y el dato incómodo: **la pendiente que sale de la banda es 8,8-17,6 €/ha**, o
sea que los **15 €/ha ya decididos son el precio correcto** — el problema no es
la pendiente, es la base plana.

---

## 3. El cambio a IVA incluido, comprobado con el motor

Decidido el 28-ago: **120 € hasta 5 ha · +15 €/ha · tope 480 €, IVA incluido**.
Ejecutado contra `api/_precio.js` y comparado con lo que se cobra hoy:

| ha | Hoy: neto | Hoy: lo que paga | Nuevo: lo que paga | Nuevo: neto | Δ ingreso |
|---|---|---|---|---|---|
| ≤5 | 99,00 | 119,79 | **120,00** | 99,17 | +0,2% |
| 6 | 111,00 | 134,31 | **135,00** | 111,57 | +0,5% |
| 8 | 135,00 | 163,35 | **165,00** | 136,36 | +1,0% |
| 15 | 219,00 | 264,99 | **270,00** | 223,14 | +1,9% |
| 25 | 339,00 | 410,19 | **420,00** | 347,11 | +2,4% |
| ≥29 | 400,00 | 484,00 | **480,00** | 396,69 | −0,8% |

**Tres cosas que la decisión no dijo:**

1. **No es neutro.** "El ingreso no se mueve" es cierto en la base y falso en el
   resto: la pendiente sube un 3,3% neto (15/1,21 = 12,40 > 12,00) y el tope baja
   un 0,8% (480 < 400×1,21 = 484). Está bien así, pero es **una subida de precio
   deliberada en el tramo medio**, no un cambio de presentación. Si se quisiera
   neutralidad estricta habría que poner 14,52 €/ha y 484 € de tope, que son
   números que no se pueden decir en voz alta.
2. **El tope pasa a morder antes**: en 29 ha en vez de en 30,1 ha.
3. **Y a cambio se gana lo que justifica todo**: cada peldaño es múltiplo de 15 y
   todo importe que ve el agricultor es redondo — 120, 135, 150, 165, 180 €. Con
   `exclusive` veía 119,79 y 163,35. **Ese es el argumento bueno del cambio**, más
   incluso que el del régimen especial agrario.

Veredicto: **hacerlo, y escribir en el commit que la pendiente sube un 2%.**

---

## 4. Cinco defectos del cobro que no son de precio pero cuestan dinero

### 4.1 🔴 El precio se congela en el checkout y no se vuelve a mirar

`api/_stripe.js:80-92` crea la suscripción con un `unit_amount` calculado en ese
instante. **No hay una sola línea en todo el repo que actualice el importe cuando
cambia la superficie**: ni `billing_cycle_anchor`, ni actualización de
`subscription_items`, ni recálculo en la renovación (comprobado con grep sobre
`api/`).

Consecuencia: quien se dé de alta con 1 ha y llegue a 12 pagará 120 € para
siempre; y quien se dé de baja de parcelas seguirá pagando de más. La frase que
vende el modelo —*"la superficie no se te pregunta, sale de SIGPAC"*— **sólo es
verdad el primer día**. Es el defecto más caro que queda abierto.

### 4.2 🔴 El prorrateo se anuncia y no se cobra — y el arreglo obvio es una trampa

`GET /api/pago` devuelve `prorrateo_primer_anio`, y `handleCheckout` cobra
`precio.total_cent`, el año entero. Ya estaba apuntado. Lo que no estaba: **meter
el importe prorrateado en `unit_amount` es peor que no hacer nada**, porque ese
importe pasa a ser el precio recurrente de todos los años siguientes.

La forma correcta es `subscription_data.billing_cycle_anchor` al 1 de enero con
`proration_behavior`, que es además lo que ancla todas las renovaciones en enero,
que es lo que el documento de agosto quería. Un único cambio resuelve las dos
cosas.

### 4.3 🟠 No hay prueba gratuita, y el comparable da 15 días sin tarjeta

No existe `trial_period_days` en el checkout. Se le pide a un agricultor que no
ha usado nunca el producto **120 € por adelantado**. Agroptima da 15 días sin
tarjeta. Y el paso 0 del propio documento de agosto —*"que un agricultor real use
`/app` completa un mes"*— **sigue sin cumplirse**: un `trial_period_days: 30` es
literalmente ese paso 0, convertido en función de producto.

### 4.4 🟠 El plan Free existe en el documento y no en el motor

La tabla de planes tiene un plan **Free** ("una parcela, estado y aviso del
día"). `precioAnual()` no lo conoce: cualquier parcela con superficie es
`cobrable: true`. El bancal de 5 m² factura 120 € — hay un test que lo fija como
comportamiento correcto (`tests/test-precio-y-pago.mjs`, "la parcela pequeña de
verdad SÍ es una parcela").

Esa decisión era buena contra el bug que arreglaba (el mensaje mentía), pero
**responde a la pregunta equivocada**: que una parcela de 5 m² sea una parcela de
verdad no implica que pague la misma tarifa que 5 ha. Entre "gratis" y "120 €" no
hay nada, y todos los usuarios reales de hoy están en ese hueco.

### 4.5 🟡 El tope y el plan de cooperativa se contradicen

Tope 480 €/año para cualquier superficie; plan Cooperativa 2.900 €/año
(`go-to-market.md:73`). Una cooperativa que dé de alta las parcelas de sus socios
bajo un mismo propietario paga **480 €** — un 83% menos — y nada en el código lo
impide. Antes de vender la primera coop hay que decidir si el tope es por
explotación o si el plan coop se define por número de titulares.

---

## 5. Qué hacer con el precio

### 5.1 Lo que no cambia

- **15 €/ha es el número correcto**: cae dentro de la banda 8,8-17,6 €/ha que sale
  de la única partida de valor que sigue en pie.
- **IVA incluido**: por los importes redondos y por el régimen especial agrario.
- **Anual y por adelantado**: el razonamiento de estacionalidad aguanta.
- **No bajar el precio de la cooperativa** para cerrar la primera.

### 5.2 Lo que hay que cambiar

**a) Romper la base plana.** Es el único cambio de tarifa que pide el análisis.
Tres formas, de menos a más agresiva:

| Opción | Tarifa | 2 ha | 8 ha | Comentario |
|---|---|---|---|---|
| A — bajar el umbral | 120 € hasta **2 ha** · +15 €/ha · tope 480 | 120 € | 210 € | Sube al mediano; no arregla al pequeño |
| B — base menor, mismo suelo | **75 €** hasta 2 ha · +15 €/ha · tope 480 | 75 € | 165 € | Deja el arquetipo igual y hace posible el pequeño |
| C — sólo por hectárea | **15 €/ha**, mínimo 90 €, tope 480 | 90 € | 120 € | La más honesta y la que menos factura |

**Recomendación: B.** Marc (8 ha) sigue pagando 165 €, que es lo ya decidido; el
hortelano de 2 ha paga 75 € en vez de 120 €, que sigue estando por encima de su
banda pero deja de ser el triple; y el escalón desaparece.

**b) Un plan gratis de verdad por debajo de 1 ha**, y no por generosidad: es el
tramo donde no hay obligación legal (§1.2), donde no hay valor determinista, y
donde están todos los usuarios actuales. Es captación, no un plan.

**c) Mover el argumento de venta por tercera vez, y esta es la definitiva.**
No es "te hacemos el cuaderno" (gratis), no es "te calculamos el plan de abonado"
(gratis, y lo regala quien te vende el saco). Es:

> **Kylia es el único que no gana nada si echas más.** El plan que te da la
> Administración se hace una vez al año en una pantalla; el de Yara lo paga quien
> vende el nitrógeno. Kylia te dice cada día, por zona y al gramo, cuánto NO
> tienes que echar, descontando lo que ya echaste y lo que ya hay en el suelo.

Es más estrecho que lo anterior y es lo único que no puede copiar ni el Estado ni
un fabricante.

### 5.3 La palanca que nadie ha mirado: el reconocimiento oficial

El RD 1051/2022, modificado por el RD 840/2024, permite que las obligaciones de
**asesoramiento** se cumplan si el titular usa *"un programa informático de
recomendaciones de abonado reconocido por la autoridad competente"* (requisitos
mínimos en la parte III del anexo III), siempre que lleve cuaderno digital. Y ese
asesoramiento pasa a ser **obligatorio en 2027 en zonas vulnerables a nitratos y
en 2028 en el resto**; los asesores humanos deben estar inscritos en **REGFER**
desde julio de 2026.

Traducido: a partir de 2027, un hortelano en zona vulnerable tiene que pagar un
asesor **o** usar un programa reconocido. Si Kylia consigue el reconocimiento de
la autoridad competente (en Cataluña, el DARP):

- Deja de competir con herramientas gratuitas por comodidad y pasa a **sustituir
  un coste obligatorio con nombre y factura**, que es la única base sólida para
  subir de los 15 €/ha.
- Y tiene **fecha de caducidad puesta por el BOE**, que es el mejor argumento
  comercial que existe.

Si no lo consigue, hay que decirlo en la landing: Kylia **no** exime del asesor.
Vender lo contrario en 2027 es el mismo error que §4 del documento de agosto
señalaba con SIEX.

**Esto es lo más rentable que hay ahora mismo en la lista de pendientes, y no
está en ninguna lista.** Antes de escribir una línea más de código de cobro,
merece una llamada al DARP para preguntar qué hace falta.

---

## 6. Lo que no se ha podido calcular y hace falta

**El coste marginal por parcela y año.** Todo este documento razona sobre el
valor para el cliente; no hay en ningún sitio el coste de servir una parcela
(llamadas a Gemini/Anthropic del cron diario, Sentinel, Vercel comercial,
Supabase). Sin ese número no se sabe si el plan gratis por debajo de 1 ha es
captación o una sangría, ni si el tope de 480 € a 100 ha deja margen. Es una
tarde de trabajo y falta.

---

## 7. Fuentes

- [AEFA — Plan de Abonado 2026: fechas clave y exenciones del RD 934/2025](https://aefa-agronutrientes.org/plan-de-abonado-2026-fechas-clave-y-exenciones-del-rd-934-2025) (fechas 1-ene-2026 / 1-sep-2026; exenciones; asesoramiento 2027-2028; REGFER desde julio 2026).
- [Castilla-La Mancha — Obligatoriedad plan de abonado](https://apliagri.castillalamancha.es/obligatoriedad-plan-de-abonado) (*"El cuaderno de campo digital de la Administración SGA-CEX permite realizar este plan y tiene integrada la herramienta de sostenibilidad agraria para nutrientes"*).
- [Castilla-La Mancha — Disponible la herramienta de sostenibilidad para nutrientes en SGA_CEX](https://apliagri.castillalamancha.es/disponible-la-herramienta-de-sostenibilidad-para-nutrientes-en-sgacex).
- [BOE — RD 840/2024, que modifica el RD 1051/2022](https://www.boe.es/buscar/doc.php?id=BOE-A-2024-17371) (el asesoramiento se puede cumplir con un programa informático de recomendaciones de abonado reconocido por la autoridad competente).
- [BOE — RD 1051/2022](https://www.boe.es/buscar/doc.php?id=BOE-A-2022-23052) (anexo III parte III, requisitos mínimos del programa).
- [Atfarm (Yara) — Planificador de nutrición gratuito](https://es.at.farm/plan-de-nutricion/) (*"¡Crea planes ilimitados GRATIS!"*).
- [VisualNACert — Plan de abonado y registro de fertilización: fechas clave](https://visualnacert.com/plan-abonado-registro-fertilizacion-2026/).
- [El Español — Los agricultores españoles tendrán que contar con un plan de abonado](https://www.elespanol.com/ciencia/20260904/oficial-agricultores-espanoles-contar-plan-abonado-cultivos-nc/1003744372277_0.html) (4-sep-2026).
- Motor: `api/_precio.js`, `api/_stripe.js`, `api/pago.js`, ejecutados el 7-sep-2026.
- Interno: `docs/negocio/precio-por-valor.md`, `docs/negocio/precio-revision-2026-08-13.md`, `docs/negocio/go-to-market.md`.
