# Kylia — Comparativa competitiva y precio por valor aportado

> Documento de decisión de precio (2026-08-11). Misma regla de honestidad que el
> resto de `docs/negocio/`: **dato oficial citado**, **dato de motor** (sale del
> código de Kylia y se puede reproducir), **estimación** etiquetada como tal.
> Ninguna cifra inventada. Donde no hay dato, se dice que no lo hay.

---

## 0. El aviso que va primero

Hoy Kylia **no puede cobrar**, y eso no es un detalle de implementación:

- No hay cuentas: la identidad es un UUID en `localStorage`. Sin login no hay
  cliente, no hay aislamiento de datos y no se atiende un derecho de supresión.
- No hay pasarela de cobro en todo el repo.
- Vercel Hobby y CallMeBot **prohíben expresamente el uso comercial**.
- `/precios` promete públicamente *"gratis durante el piloto"* y *"app completa
  gratis de por vida al cerrar"*. Los pilotos actuales tienen esa gratuidad
  **ganada**: es un compromiso adquirido, no un bug a corregir.

Ver [[project_bloqueos_mercado]] / `MEMORY.md`. Este documento decide **cuánto
debe costar**, no cuándo se enciende el cobro.

---

## 1. Comparativa competitiva

### 1.1 Qué hace cada uno

| | Cliente real | Qué entrega | Baja al producto y la dosis | Cuaderno RD 1051/2022 | Precio |
|---|---|---|---|---|---|
| **xarvio** (BASF) | Agricultor medio-grande y técnico | Dashboard + modelos de enfermedad | Sí, pero **es de BASF** | Parcial | No publicado; ≈800 €/año es la cifra que maneja el anexo interno *(estimación)* |
| **Auravant** | Técnico / asesor B2B | Capas satelitales, prescripciones | No al detalle | No (España) | Freemium + módulos de pago, no publicado |
| **VisualNACert** | Cooperativa | Trazabilidad, gestión | No | Sí | A medida, no publicado |
| **EOSDA** | Global, analítica | Índices satelitales | No | No | Por ha, escalado internacional |
| **GeoCampo Pro** | Suite SIGPAC | Mapas y expedientes | No | Parcial | No publicado |
| **Agroptima** | Agricultor español | Cuaderno de campo + costes | No decide nada | **Sí, es su producto** | **198 €+IVA/año** *(dato de 2016, puede estar desactualizado)* |
| **Dataris** | Grande con maquinaria | Ortofotos de dron, telemetría | No | No | Proyecto a medida |
| **Gestoría agraria** | Cualquiera | Papeleo PAC | No | Sí, en papel y reactivo | 800-2.000 €/año *(estimación interna del anexo)* |
| **Kylia** | Hortelano 3-15 ha, **sin asesor** | **La decisión**: cuánto regar hoy, cuántos gramos de N y de qué saco | **Sí, y es neutral** | Sí, sale solo del sistema | **A decidir — esta es la pregunta** |

### 1.2 La lectura

Dos observaciones que mandan sobre el precio:

**(a) El comparable de precio real no es xarvio, es Agroptima.** xarvio y
Auravant venden a alguien que ya tiene técnico. El agricultor que Kylia persigue
—3-15 ha, sin asesor— no está eligiendo entre Kylia y xarvio: está eligiendo
entre Kylia, una app de cuaderno, y la libreta. El ancla mental de ese agricultor
está en **~200 €/año**, no en 800.

**(b) Nadie de la lista decide por él.** Todos entregan datos, mapas o casillas
para rellenar. Kylia entrega el gesto: *"riega 12 L/m² esta tarde"*, *"te quedan
38 g de N, cómprate este saco"*. Esa diferencia justifica estar **por encima** de
Agroptima, no por debajo. Pero solo justifica un múltiplo si el valor se
demuestra, y ahí es donde hay que ser estricto.

---

## 2. El valor aportado, desglosado por certeza

La clave de todo el documento: **no todo lo que Kylia aporta está igual de
probado**. Mezclarlo en un solo número es lo que produce precios que luego no se
sostienen en una llamada de ventas. Tres capas.

### Capa A — Valor DETERMINISTA (no depende de ningún modelo)

Es aritmética o es una obligación legal. No hay nada que validar.

| Concepto | Valor anual | Base |
|---|---|---|
| Cuaderno digital RD 1051/2022 | **198-800 €/explotación** | Coste de sustituir Agroptima *(198 €, dato 2016)* o la parte de cuaderno de una gestoría *(estimación)* |
| Abonado al gramo en parcela pequeña | El redondeo a dosis de etiqueta metía **+72%** sobre lo necesario | Dato de motor (corregido el 6-ago) |
| Descuento del abonado ya echado | El plan pedía **58 g de N** habiendo ya **20 g** en el suelo: **34% de más** | Dato de motor, caso real del Labinor (`7d71ba5`) |

Traducido a euros de fertilizante: el plan de lechuga son **116 kg N/ha**
(extracción 2,5 kg N/t × 35 t/ha + colchón MAPA 45 − crédito de residuos 13,2;
todo en `_motor-nutricion.js`). Los 40 kg N/ha que no se descontaban, a ~1,09
€/kg N (urea 46% a ~500 €/t) son **≈44 €/ha y ciclo**.

### Capa B — Valor PROBABLE (medido una vez, en una parcela)

> **Rehecho el 13-sep-2026** desde el servidor, con el clima completo y el motor
> posterior a la auditoría. Los tres números que había aquí eran de antes y
> ninguno se sostenía. Detalle en `docs/pilotos/revision-2026-09-13.md`.

| Concepto | Valor | Estado de la evidencia |
|---|---|---|
| Ahorro de agua (lechuga, 440 m²) | **15%** · 62,4 L/m² ≈ 27 m³ | **Una** cosecha, y la parcela estaba invadida de verdolaga. Antes decía 20-30% |
| Ahorro de agua (cebolla, La Selva) | **15%** · 52,7 L/m² | **Una** campaña |
| Ahorro de agua (tomate, Breda) | **ninguno: regó un 23% de MENOS** | El "~64%" de aquí era el `area_m2` mal metido (30 m² para 88) sobre el clima roto |

Por hectárea y ciclo de lechuga, con los números del reveal de hoy (el padre
aplicó 410 L/m² = 4.100 m³/ha; Kylia habría dicho 347,6 = 3.476 m³/ha):

- Ahorro: **624 m³/ha y ciclo**, y con la banda de suelo (ver abajo) **525-841**.
- Si el agua se factura por volumen a tarifas de Levante (**0,355 €/m³** Albatera
  jun-2025; **0,41-0,434 €/m³** Campo de Cartagena jun-2025): **185-365 €/ha y
  ciclo**.
- Si es canon fijo por hectárea y solo se ahorra bombeo (0,06 → >0,20 €/m³ según
  las propias comunidades de regantes): **30-170 €/ha y ciclo**.

⚠️ **Este es el número grande y es el menos sólido**, y en septiembre se ha
encogido dos veces. La validación honesta de 2026-08-05 dice: la demanda ETc es
exacta (RMSE 0,000 en 60 ventanas) pero la concordancia de la *decisión* es
**62%, no 95%**. Encima el ahorro sale de una parcela con mala hierba, y la
lámina que se le atribuye a Kylia se mueve un **±10% solo con cambiar la clase de
suelo**, que en ninguna de las tres parcelas está medida: es un prior de
SoilGrids a 250 m. Un precio construido sobre esto se cae en la primera objeción.

**Lo que sí aguanta como argumento es el REPARTO, no el total:** Ferran hizo 73
riegos donde hacían falta 13. Eso está medido, no estimado, y no depende del
suelo supuesto.

### Capa C — Valor PROMETIDO (no existe todavía)

Predicción del precio de venta y asistente PAC/ecoesquemas completo. Están en
roadmap. **Valor hoy: 0 €.** No se cobra por promesas.

---

## 3. La cuenta para el cliente arquetípico

Marc, 8 ha de hortícola al aire libre, 2 ciclos al año, sin asesor.

| Capa | Concepto | €/año |
|---|---|---|
| A | Cuaderno digital | 198-800 |
| A | Fertilizante no aplicado de más (44 €/ha × 8 ha × 2 ciclos) | ~700 *(supone que hoy sobrefertiliza)* |
| A | Evitar **una** aplicación innecesaria (80-200 € cada una) | 80-200 |
| **Subtotal A — lo que se puede defender hoy** | | **~500-1.500** |
| B | Agua, si se factura por volumen (270-520 €/ha × 8 × 2) | 4.300-8.300 |
| B | Agua, si solo es bombeo | 700-3.800 |
| **Total con agua** | | **1.200-9.800** |

La horquilla del total es tan ancha que **no sirve para fijar precio**. La de la
capa A sí.

---

## 4. El precio

### La regla

Un SaaS vertical se queda con **10-20% del valor que crea**, y en el extremo bajo
cuando el cliente aún no se fía. Aplicado **solo a la capa A** (500-1.500 €/año):

> **50-300 €/año.** Los **99 €/año ya fijados caen dentro, en la mitad baja.**

Es decir: **el precio de 99 € no hay que justificarlo con el ahorro de agua.** Se
paga solo con el cuaderno y el abonado, que son deterministas. Eso es una
posición de ventas mucho más fuerte que un porcentaje de ahorro que un agricultor
escéptico puede discutir — y si el ahorro de agua resulta ser la mitad, el precio
sigue en pie.

### El defecto de los 99 € planos

El valor **escala con las hectáreas** (fertilizante y agua son lineales) y el
precio no. A 1 ha, 99 € es caro. A 15 ha, es regalar el producto.

### Recomendación

| Plan | Quién | Precio | Por qué ese número |
|---|---|---|---|
| **Free** | Cualquiera | 0 € | Una parcela, estado y aviso del día. Es el canal de captación del go-to-market, no un plan. |
| **Productor** | 3-15 ha | **99 €/año hasta 5 ha, +12 €/ha adicional, tope 400 €/año** | La base la paga la capa A sola. Los 12 €/ha extra son ~14% del valor de fertilizante por hectárea *sin* contar agua: defendible aunque la tesis del agua no se confirme. Marc (8 ha) = **135 €/año**. |
| **Cooperativa** | Coop / ADV | **2.900 €/año** (Esencial) | Se mantiene. Con 60 socios son 48 €/socio, muy por debajo de lo que pagaría cada uno suelto: la coop es el motor de margen y el argumento se defiende solo. |

**Cobro anual y por adelantado, en enero-febrero**, antes de campaña, cuando el
agricultor está planificando gasto. Mensual a 8 €/mes suena bien en la landing
pero rompe la retención en un producto estacional: en enero no riega y se da de
baja.

**No bajar el precio de la cooperativa para cerrar la primera.** Ya está escrito
en `go-to-market.md` y sigue siendo cierto.

### Qué desbloquea subir de ahí

El componente por hectárea puede ir a **25-30 €/ha** —y entonces Marc paga
~300 €/año— **cuando el ahorro de agua esté validado de verdad**: varias parcelas,
varios ciclos, y la tanda de septiembre pesada en bancal y zona B con el mismo
criterio. Hoy no. Con una sola cosecha y una parcela con verdolaga, cobrar por el
agua es cobrar por una hipótesis.

Y la capa económica (predicción de precio de venta) es lo que justificaría un
salto de categoría de precio. Cuando exista.

---

## 5. Secuencia

1. Que un agricultor real use `/app` completa un mes. **Sigue sin haber pasado.**
2. Cuentas y aislamiento de datos.
3. Cosecha de septiembre pesada → evidencia de rendimiento, no solo de agua.
4. Encender el cobro: Stripe + reescribir `/precios` + planes comerciales de
   infra + subencargados en la política de privacidad.
5. Respetar la gratuidad de por vida de los pilotos actuales. Es palabra dada.

---

## 6. Fuentes

- Comunidad de Regantes de Albatera — [nota informativa, precio del agua de riego, 30-05-2025](https://cralbatera.coresat.es/up/noticias/257/NOTA_INFORMATIVA_SOBRE_EL_PRECIO_DEL_AGUA_DE_RIEGO_COMUNIDAD_DE_REGANTES_DE_ALBATERA_30-05-2025.pdf) (0,355 €/m³).
- Comunidad de Regantes del Campo de Cartagena — [precio del agua](https://www.crcc.es/category/precio-del-agua/) (0,41 y 0,434 €/m³, jun-2025).
- Fuji Electric España — [el reto energético en las comunidades de regantes](https://fujielectricspain.com/el-gran-reto-energetico-en-las-comunidades-de-regantes/) (bombeo de 0,06 a >0,20 €/m³).
- Revista Campo — [el precio del fertilizante sube el 50% en dos años](https://www.revistacampo.es/fertilizacion-2/el-precio-del-fertilizante-sube-el-50-en-dos-anos-es-rentable-abonar/) (348 → 506 €/t).
- ProfesionalAgro — [Agroptima Costes](https://profesionalagro.com/noticias/agroptima-costes-la-solucion-para-controlar-los-gastos-de-su-explotacion.html) (198 €+IVA/año, **2016**).
- Interno: `docs/negocio/dossier-mercado.md`, `docs/negocio/go-to-market.md`,
  `docs/estrategia/anexo-2026-diferenciacion-y-escalado.md`.
- Motor: `api/_motor-nutricion.js` (extracciones MAPA, colchón, residuos),
  `api/_rendimiento.js` (rinde de referencia 35 t/ha lechuga),
  `docs/tecnico/validacion-nutricion.md`.
