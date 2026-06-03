# Motor de decisión de Kylia

> Documento de referencia del motor agronómico: qué datos entran, qué cálculos
> se hacen, en función de qué se emite cada recomendación y cuál es el estado de
> validación de cada modelo.
>
> Sirve de tres cosas a la vez: (1) **especificación** para la reescritura del
> riego a FAO-56; (2) **documento de transparencia** para la UPC y evaluadores;
> (3) **base honesta del reveal** del piloto silencioso — solo ponemos números
> económicos donde el modelo está validado.
>
> Última actualización: 2026-06-03.

---

## 0. Filosofía del motor

Kylia toma **cuatro tipos de decisión** cada día para una parcela:

1. **Riego** — ¿hay que regar?, ¿cuánto?, ¿cuándo?
2. **Tratamiento** — ¿hay riesgo de plaga/enfermedad que justifique intervenir?
3. **Nutrición** — ¿el cultivo necesita abonado?
4. **Selección de producto** — de un catálogo oficial, ¿cuál conviene?

Principio rector: **cada decisión debe poder explicarse al agricultor en lenguaje
llano y trazarse hasta un dato concreto.** Nada de cajas negras. La IA reescribe
y prioriza, pero nunca inventa cantidades, productos ni umbrales: esos salen
siempre de reglas auditables documentadas aquí.

### Distinción clave: entradas exógenas vs endógenas

- **Exógenas** (no dependen de las decisiones del agricultor): clima (ET₀,
  lluvia, temperatura, humedad, viento), previsión, calendario/fenología,
  cultivo, tipo de suelo, y lo que el agricultor declara.
- **Endógenas** (consecuencia de sus decisiones): el estado del satélite
  (NDVI, NDMI, humedad de suelo), porque reflejan el campo *después* de actuar.

Esto importa para el piloto: las cifras del reveal solo son limpias en las
dimensiones que corren sobre datos **exógenos** (agua, dinero, tratamientos
evitables). Lo que depende del satélite (nutrición vía NDVI) va fuera del número
económico. Ver §8.

---

## 0.1 Conceptos clave: ET₀, Kc y ETc (en llano)

Tres conceptos sostienen todo el motor de riego.

### ET₀ — cuánta agua "pide" el aire ese día
La **evapotranspiración de referencia** es el agua que se evaporaría en un día
desde un campo de césped de referencia bien regado, por efecto del sol, la
temperatura, el viento y la humedad. Es el "hambre de agua" de la atmósfera, y
**no depende del cultivo**.
- Unidad: **mm/día** (1 mm = 1 litro/m²).
- Día nublado de invierno ≈ 1 mm; día de pleno verano ≈ 5–7 mm.
- Fuente: Open-Meteo (`et0_fao_evapotranspiration`), fórmula FAO-56
  Penman-Monteith. Dato **exógeno** (clima, no decisiones del agricultor).

### Kc — cuánta de esa agua bebe TU cultivo
La ET₀ es para el césped de referencia, no para tu tomate. El **coeficiente de
cultivo Kc** es un multiplicador (sin unidades) que ajusta la ET₀ a lo que de
verdad consume tu cultivo, y **cambia con la fase fenológica**:
- Plántula (poca hoja) → Kc bajo (~0.5–0.7), bebe poco.
- Plena producción (mucha hoja/fruto) → Kc alto (~1.0–1.15), bebe más que el césped.
- Final de ciclo → Kc baja otra vez.

### ETc — la demanda real, que es lo que usa Kylia
```
ETc = Kc × ET₀          (mm/día)
```
Ejemplo, día de verano con **ET₀ = 5 mm**:

| Cultivo y fase | Kc | ETc = Kc × 5 |
|---|---|---|
| Lechuga recién plantada | 0.70 | 3.5 mm |
| Tomate en plena producción | 1.15 | 5.75 mm |

Mismo clima, misma ET₀ — pero el tomate necesita casi el doble. Esa diferencia es
todo lo que aporta el Kc. El motor antiguo usaba ET₀ a secas (Kc = 1 implícito):
se quedaba ~15% corto con el tomate en producción y se pasaba ~30% con la lechuga
joven. El motor FAO-56 aplica el Kc correcto según cultivo y días desde plantación
(de ahí el campo "fecha de plantación" del onboarding).

---

## 1. Fuentes de datos

| Fuente | Qué aporta | Frecuencia | Endpoint |
|---|---|---|---|
| **Sentinel-2 L2A** (Copernicus) | NDVI (vigor), NDMI (agua en hoja) | ~cada 5 días, si no hay nubes | `api/sentinel.js` |
| **Open-Meteo** | ET₀ FAO, lluvia, Tª máx, humedad, viento; previsión 3 días | diaria | frontend + `cargarET0()` |
| **Humedad de suelo** (Open-Meteo / modelo) | humedad volumétrica capa superficial | diaria | frontend |
| **Registro del agricultor** | riegos (fecha + L/m²), aplicaciones (producto, dosis, fecha) | manual | `localStorage` + `api/log.js` |
| **Onboarding** | cultivo(s), manejo (eco/conv), [NUEVO: fecha plantación, tipo de suelo] | una vez | `api/log.js` |

---

## 2. Índices de satélite (Sentinel-2)

Calculados en `api/sentinel.js` con la Statistical API de Copernicus, promediando
los píxeles válidos dentro de la geometría de la parcela (excluye nubes/sombra
vía SCL; `maxCloudCoverage: 60`; se queda con la observación válida más reciente
de los últimos 30 días).

### NDVI — vigor / biomasa
```
NDVI = (B08 − B04) / (B08 + B04)
```
Clasificación (`api/sentinel.js`):

| NDVI | Estado |
|---|---|
| > 0.6 | buena |
| 0.35 – 0.6 | moderada |
| < 0.35 | estrés |

### NDMI — contenido de agua en la hoja
```
NDMI = (B08 − B11) / (B08 + B11)
```
Clasificación (`clasificarNDMI`, frontend):

| NDMI | Estado |
|---|---|
| ≥ 0.2 | hidratada |
| 0.0 – 0.2 | vigilar |
| < 0.0 | estrés hídrico |

### Humedad de suelo (capa superficial)
Clasificación (`clasificarHumedadSuelo`):

| valor (m³/m³) | Estado |
|---|---|
| < 0.15 | seco |
| 0.15 – 0.35 | adecuado |
| > 0.35 | húmedo/saturado |

> ⚠️ **Endógeno:** NDVI, NDMI y humedad reflejan el efecto de los riegos del
> agricultor. Se usan como *contexto y confirmación*, no como base de las cifras
> económicas del reveal.

---

## 3. Decisión: RIEGO

Es el modelo estrella del piloto (alimenta el número de ahorro de agua). Aquí se
documenta **cómo decide hoy** y **cómo decidirá tras la reescritura FAO-56**.

### 3.1 Motor anterior (heurística ET₀ cruda) — SUSTITUIDO el 2026-06-03

`calcularBalanceHidrico()` suma la **ET₀ de referencia** (Open-Meteo
`et0_fao_evapotranspiration`) desde el último riego registrado, ajusta por un
déficit/excedente residual del riego anterior, y dispara por umbral fijo:

| Balance (mm ≈ L/m²) | Acción (`card-hoy`) |
|---|---|
| ≥ 30 | "Regar hoy" (urgente, rojo) |
| 15 – 30 | "Revisar el riego" (naranja) |
| < 15 | "Todo en orden" (verde) |

Cantidad recomendada = `Math.ceil(balanceTotal)` L/m², ajustada por lluvia prevista:
- lluvia prevista ≥ 70% del déficit → "no riegues, la lluvia lo cubre";
- lluvia parcial → riego reducido = déficit − lluvia prevista;
- sin lluvia → riego completo; horario "mañana temprano" si Tªmáx > 33 °C, si no "tarde-noche".

**Por qué no es válido (FAO-56):** usa **ET₀ de referencia como si fuera la
demanda del cultivo**. La demanda real es ETc = Kc × ET₀. Con Kc de tomate/
pimiento en plena producción ≈ 1.15, el modelo **subestima ~15%**; con lechuga
recién plantada (Kc ≈ 0.7) **sobreestima ~30%**. Además el umbral 30/15 mm es
fijo: ignora que un suelo arenoso retiene mucha menos agua disponible que uno
arcilloso y debería disparar antes.

### 3.2 Motor actual (FAO-56) — implementado y en producción (2026-06-03)

Implementación del **balance hídrico de suelo FAO-56** (Allen et al., 1998),
método del coeficiente único de cultivo (single Kc). Referencia de cálculo:
`pyfao56`. **Desplegado en `main` (commit `e5a75ce`)** — sustituye a la heurística
de §3.1.

#### a) Demanda real del cultivo
```
ETc,i = Kc(fase) × ET0,i
```
`Kc` varía según la fase fenológica, que se deriva de **días desde plantación**
(campo nuevo de onboarding) y de las longitudes de fase del cultivo.

Curva Kc por fases (FAO-56 Tabla 12, estándar internacional — calibrar localmente
con datos del piloto e IRTA/Ruralcat):

| Cultivo | Kc_ini | Kc_med | Kc_fin | L_ini / L_des / L_med / L_fin (días, orientativo) |
|---|---|---|---|---|
| Lechuga | 0.70 | 1.00 | 0.95 | 20 / 30 / 15 / 10 |
| Espinaca | 0.70 | 1.00 | 0.95 | 20 / 20 / 15 / 5 |
| Col/coliflor (brassica) | 0.70 | 1.05 | 0.95 | 30 / 35 / 50 / 15 |
| Tomate | 0.60 | 1.15 | 0.80 | 30 / 40 / 45 / 30 |
| Pimiento | 0.60 | 1.05 | 0.90 | 30 / 35 / 40 / 20 |
| Berenjena | 0.60 | 1.05 | 0.90 | 30 / 40 / 40 / 20 |
| Calabacín | 0.50 | 0.95 | 0.75 | 25 / 35 / 25 / 15 |

Interpolación lineal de Kc durante la fase de desarrollo (Kc_ini → Kc_med) y la
fase final (Kc_med → Kc_fin), según FAO-56.

> **Verificación (2026-06-03):** los 7 valores de Kc del código coinciden
> **exactamente** con el Cuadro 12 del Manual FAO-56 (traducción ICIA). No
> requieren cambios. Tres matices de calibración local pendientes:
> 1. **Kc_ini es aproximado**: con riego de alta frecuencia (goteo diario) puede
>    subir hasta 1.0–1.2 (más evaporación de suelo mojado).
> 2. **Tomate/pimiento entutorados (1.5–2 m) o en invernadero**: Kc_med sube a
>    1.20 (tomate) / 1.15 (pimiento). Depende del sistema de cultivo del piloto.
> 3. **Longitudes de fase (L)**: es lo único realmente "blando"; dependen del
>    clima y la fecha de siembra. Calibrar con IRTA/Ruralcat (Lleida) o con los
>    datos del propio piloto. Los valores del Cuadro 12 son para clima sub-húmedo
>    (HRmin ≈ 45%, viento ≈ 2 m/s); el interior de Cataluña es más seco.

#### b) Agua disponible en el suelo
```
TAW = 1000 × (θ_FC − θ_WP) × Zr        (agua total disponible, mm)
RAW = p × TAW                           (agua fácilmente disponible, mm)
```
- `θ_FC − θ_WP` (agua disponible por textura, FAO-56 Tabla 19):

  | Suelo (selector onboarding) | θ_FC − θ_WP (m³/m³) |
  |---|---|
  | Arenoso | 0.08 |
  | Franco | 0.15 |
  | Arcilloso | 0.16 |

  > En el **campo de validación** se sustituye por θ_FC y θ_WP del análisis de
  > suelo real (más preciso que la tabla por textura).
- `Zr` profundidad radicular efectiva ≈ 0.3 m (hortícola superficial), crece con la fase.
- `p` fracción de agotamiento sin estrés ≈ 0.45 para hortícolas (FAO-56 Tabla 22),
  ajustable por ETc (p_aj = p + 0.04·(5 − ETc)).

#### c) Balance hídrico diario (agotamiento de la zona radicular)
```
Dr,i = Dr,i-1 − (P − RO)i − Ii + ETc,i        (acotado a [0, TAW])
```
- `P` lluvia diaria; `RO` escorrentía; `(P − RO)` = **lluvia efectiva** (P>0:
  método simple, descarta el exceso sobre TAW − Dr).
- `Ii` riego neto aplicado el día i = L/m² registrados × eficiencia del sistema
  (goteo ≈ 0.90, aspersión ≈ 0.75).
- `Dr` es el déficit acumulado en mm.

#### d) Regla de decisión
```
si Dr ≥ RAW  → REGAR
   cantidad neta = Dr  (rellenar a capacidad de campo)
   cantidad bruta = Dr / eficiencia_sistema
```
Estados de la `card-hoy` (sustituyen al 30/15 fijo):

| Condición | Acción |
|---|---|
| Dr ≥ RAW | "Regar hoy" (urgente) |
| 0.75·RAW ≤ Dr < RAW | "Revisar el riego" (atención) |
| Dr < 0.75·RAW | "Todo en orden" |

Ajuste por lluvia prevista (se conserva la lógica actual, ahora sobre Dr/RAW):
si la lluvia prevista cubre el déficit hasta RAW → posponer; si lo cubre en
parte → riego reducido; horario tarde-noche / mañana según Tªmáx.

#### e) Datos nuevos que requiere (onboarding)
1. **Fecha de plantación/transplante** por cultivo → fase fenológica → Kc.
2. **Tipo de suelo** (selector arenoso/franco/arcilloso) → TAW/RAW.
   (Campo de validación: θ_FC, θ_WP del análisis de suelo.)

#### f) Validación del motor (Nivel 2 del plan)
Comparar Dr y ETc diarios de Kylia contra `pyfao56` con las mismas entradas →
reportar RMSE en mm. Opcional: contrastar contra sensor de humedad de suelo en
el campo de validación. **Protocolo detallado en §3.4** *(pendiente de ejecutar).*

### 3.3 Evidencia de mejora: motor anterior vs FAO-56

Comparación de **ambos motores decidiendo sobre el mismo clima real** (Open-Meteo,
Barcelona, 14 días, ET₀ media 5,3 mm/día, sin lluvia en el periodo). Mismo riego
de partida en cada caso. "Mejor" = más cerca de la demanda real del cultivo según
el estándar FAO-56.

| Escenario | Motor anterior (ET₀ cruda) | Motor FAO-56 | Consecuencia del anterior |
|---|---|---|---|
| Tomate en producción (80 d), franco, regó hace 6 d | Regar **32 L/m²** | Regar **41 L/m²** (Kc 1,15) | Se queda **9 L/m² corto** → estrés hídrico |
| Lechuga joven (12 d), franco, regó hace 6 d | Regar **32 L/m²** | Regar **25 L/m²** (Kc 0,70) | Aplica **7 L/m² de más** → agua/dinero desperdiciados |
| Tomate (80 d), mismo caso, suelo **arenoso** | Regar 32 L/m² (ciego al suelo) | déficit/umbral **24/10,8 mm** | Ignora que el arenoso retiene la mitad → riega tarde |
| Tomate en producción (80 d), franco, regó hace **4 d** | "**Revisar**" (no urgente) | "**Regar (urgente)**" | **No detecta** que ya toca regar → estrés |

Lecturas clave:
- El motor anterior asumía Kc = 1 (todos los cultivos como el césped de
  referencia): **subestima** en cultivos de Kc alto (tomate en producción) y
  **sobreestima** en Kc bajo (plántula).
- Era **ciego al suelo** (umbral fijo 30/15 mm): un arenoso debería disparar
  mucho antes que un arcilloso.
- **No restaba la lluvia** (no se ve en esta tabla por ausencia de lluvia, pero en
  semana lluviosa recomendaría regar cuando la lluvia ya cubrió el déficit).
- Caso más grave: el 4º, donde el anterior **no dispara** el riego que el cultivo
  ya necesita.

**Verificación end-to-end (2026-06-03, navegador headless):** onboarding persiste
suelo + fecha de plantación; tras recargar, el motor aplica el Kc real (tomate a
80 d → Kc 0,88 en fase de desarrollo, no el fallback 1,0); la `card-hoy` renderiza
por RAW; sin excepciones JS. Probes confirmados: el suelo cambia RAW
(arenoso 10,8 / franco 20,3 / arcilloso 21,6 mm) y la edad cambia Kc
(0,70 a 8 d / 0,95 a 80 d / 1,0 sin fecha = degradación elegante).

### 3.4 Protocolo de validación contra `pyfao56` (Nivel 2) — *pendiente de ejecutar*

La comparación de §3.3 demuestra que el motor nuevo se comporta **distinto y mejor
fundado** que el viejo, pero lo hace contra el propio motor viejo de Kylia. Para
cerrar el Nivel 2 del plan de validación hace falta contrastar el motor FAO-56 de
Kylia contra una **implementación de referencia independiente del estándar**:
[`pyfao56`](https://github.com/kthorp/pyfao56) (Thorp, USDA-ARS), que implementa el
balance hídrico de suelo de Allen et al. (1998). Si Kylia y `pyfao56` divergen poco
con las mismas entradas, el motor de Kylia *es* FAO-56, no solo "se inspira" en él.

> **Estado:** no ejecutado todavía. Esta sección es la especificación del ensayo,
> no su resultado. Hasta correrlo, §8 mantiene el riego como "validable", no
> "validado contra estándar externo".

#### a) Entradas idénticas a ambos motores
Para un cultivo y periodo dados, alimentar Kylia y `pyfao56` con **exactamente** los
mismos datos exógenos día a día:
- **ET₀** diaria (Open-Meteo `et0_fao_evapotranspiration`).
- **Lluvia** diaria (`precipitation_sum`).
- **Cultivo** + **fecha de plantación** → misma curva Kc y mismas longitudes de fase
  (`FAO_KC`); cargar en `pyfao56` el mismo `.par` (Kc_ini/med/fin, L_ini/des/med/fin).
- **Suelo**: mismos `θ_FC − θ_WP` (o `θ_FC`, `θ_WP` del análisis real) y `Zr`.
- **Riegos** netos aplicados (L/m² × eficiencia del sistema) en las mismas fechas.
- `p` (fracción de agotamiento) idéntico.

#### b) Salidas a comparar (serie diaria)
- **ETc,i** (mm/día) — demanda del cultivo.
- **Dr,i** (mm) — agotamiento de la zona radicular (la variable que dispara el riego).
- **Eventos de riego** que cada motor habría disparado (día y cantidad neta).

#### c) Métrica
Sobre la serie diaria emparejada:
```
RMSE(X) = √( (1/n) · Σ (X_kylia,i − X_pyfao56,i)² )      X ∈ {ETc, Dr}
```
Reportar también **MBE** (sesgo medio, para detectar si Kylia corre seco o húmedo
de forma sistemática) y la **concordancia de eventos de riego** (% de días en que
ambos motores coinciden en "regar / no regar", y diferencia media en mm cuando ambos
riegan).

#### d) Criterio de aceptación (propuesto)
| Métrica | Umbral objetivo | Lectura si se supera |
|---|---|---|
| RMSE(ETc) | ≤ 0,3 mm/día | Discrepancia en la curva Kc o en la interpolación de fase |
| RMSE(Dr) | ≤ 5 mm (< ¼ de un RAW típico) | Discrepancia en lluvia efectiva, TAW/RAW o redondeos del balance |
| MBE(Dr) | \|·\| ≤ 2 mm | Sesgo sistemático → revisar `p`, `Zr` o eficiencia de riego |
| Concordancia eventos | ≥ 90% de días | Revisar el umbral de disparo (Dr ≥ RAW) |

Cualquier desvío por encima del umbral se **diagnostica hasta el día y la variable**
que lo causa (no se "ajusta a ojo"): el objetivo del ensayo es localizar dónde
Kylia se aparta del estándar, no maquillar el RMSE.

#### e) Montaje
Harness en Python: `pip install pyfao56`; un script que (1) lea el mismo clima y
parámetros que usa el frontend, (2) reconstruya el `Model` de `pyfao56` con esos
`.par`/`.wth`/`.irr`, (3) exporte la serie diaria de Kylia (replicando
`calcularBalanceHidrico()` en Python o volcando el `Dr` calculado por el frontend),
(4) empareje por fecha y calcule las métricas de (c). Resultado → tabla nueva en esta
§3.4 con los RMSE reales y el veredicto. Opcional (Nivel 2 reforzado): contrastar `Dr`
contra el **sensor de humedad de suelo** del campo de validación.

---

## 4. Decisión: TRATAMIENTO (riesgo de plaga/enfermedad)

5 modelos de riesgo, cada uno mapeado a cultivos (`CULTIVOS`) y a productos
(`PRODUCTOS_PLAGA`). Cada modelo recibe el meteo del día y devuelve
ALTO / MEDIO / BAJO + motivo.

| Plaga | Cultivos | Variables | Disparador ALTO (resumen) |
|---|---|---|---|
| **Pulgón** (Myzus/Nasonovia) | lechuga, espinaca, brassica | Tªmáx, hum, viento, lluvia | 18–22 °C + hum > 65% + viento ≤ 25 |
| **Mildiu** (Bremia lactucae) | lechuga, espinaca | Tªmáx, hum, lluvia | 10–22 °C + (hum > 85% o lluvia) ; inhibe si Tª > 27 |
| **Oruga de la col** (Pieris/Plutella) | brassica | Tªmáx, lluvia | 16–28 °C + tiempo seco |
| **Mosca blanca** (Bemisia/Trialeurodes) | tomate, pimiento, berenjena, calabacín | Tªmáx, hum, lluvia | 25–32 °C + hum < 65% |
| **Araña roja** (Tetranychus urticae) | tomate, pimiento, berenjena | Tªmáx, hum, lluvia | Tª ≥ 28 °C + hum < 45% |

(Umbrales exactos por nivel en `app/index.html`, §"Modelos de riesgo".)

### Árbol de decisión del tratamiento (`renderRecomendaciones`, bloque 2)

Para cada plaga activa según el/los cultivo(s):

1. Si hay **protección activa** de una aplicación reciente (`aplicacionReciente`)
   → no insistir; solo aviso suave "protección activa, quedan N días".
2. **Hoy ALTO y ≥ 2 días ALTO** (hoy + previsión) → recomendar tratar
   (ventana real, preventivo eficaz).
3. **Hoy ALTO pero solo 1 día** → "vigila, riesgo puntual": revisar, tratar solo
   si hay daño visible (no malgastar producto por una ventana de 1 día).
4. **Próximos días ALTO sostenido** (≥ 2) → aviso preventivo "prepárate a partir del día X".

Ventanas de protección: `calcularEfectoAplicacion` usa `duracionProteccion` del
catálogo de productos para silenciar recomendaciones mientras dura el efecto.

---

## 5. Decisión: NUTRICIÓN

`renderRecomendaciones`, bloque 3. Disparador y catálogo por grupo de cultivo.

### Disparador
```
si NDVI < 0.5  y  en temporada (mar–oct)  y  suelo no saturado (≤ 0.38)
   → recomendar abonado
```
Grupos (`grupoFertilizante`):
- **fruto** (tomate, pimiento, berenjena, calabacín) → abono rico en K.
- **hojas** (lechuga, espinaca) → abono nitrogenado.
- **brassica** (col/coliflor) → cobertera nitrogenada.

### Ajuste por lluvia prevista
- **lluvia intensa** (> 15 mm algún día) → "espera, se lixiviarían los nutrientes".
- **lluvia inminente** (≥ 4 mm en 1–2 días) → "abona hoy en cobertera, la lluvia lo disuelve".
- **sin lluvia** → recomendación estándar.

### Silenciado por abonado reciente
Si hubo un fertilizante aplicado dentro de la ventana de respuesta
(`ESPERA_RESPUESTA_NDVI_DIAS = 14` d) → no insistir (la planta tarda 7–14 d en
mostrar respuesta en NDVI; insistir antes sobrefertiliza).

> ⚠️ **Endógeno y no calibrado:** el disparador `NDVI < 0.5` es absoluto, no
> calibrado por cultivo ni fase (un NDVI de 0.5 significa cosas distintas en
> lechuga joven vs tomate maduro), y usa la señal contaminada por las decisiones
> del agricultor. **Fuera de las cifras económicas del reveal** (§8).

---

## 6. Decisión: SELECCIÓN DE PRODUCTO

Único modelo plenamente **validado**: catálogo curado (`data/productos.json`)
verificado contra el **registro MAPA** (sustancia activa, dosis, plazo de
seguridad, eficacia, coste €/ha, cultivos+plagas autorizados).

Flujo (`api/sugerencia-producto.js`):
1. El frontend filtra del catálogo los productos válidos para el contexto
   (cultivo, plaga/tipo fertilizante, presupuesto, plazo).
2. Gemini Flash **elige UNO de la lista recibida** y razona en 1–2 frases.
3. **Validación dura:** el `idElegido` debe existir en los candidatos; si no,
   fallback al primero. La IA **nunca introduce productos nuevos** (riesgo de
   alucinación inaceptable en fitosanitarios).

Regla sagrada: **IA selectora, nunca generadora, en fitosanitarios.**

---

## 7. Capa de IA narrativa

Dos usos, ambos con `gemini-2.5-flash`, `thinkingBudget: 0`, fallback silencioso
(si falla, queda la regla):

- **`api/recomendacion.js`** — un párrafo de lectura agronómica de la parcela
  (2–3 frases, castellano llano, sin siglas). No decide nada: interpreta.
- **`api/recomendaciones-texto.js`** — reescribe título+detalle de las
  recomendaciones **conservando cantidades y productos exactos** de las reglas.

La IA **nunca** genera cantidades de riego, dosis, productos ni umbrales. Solo
redacta y prioriza sobre lo que las reglas ya calcularon.

---

## 8. Estado de validación de cada modelo (honesto)

| Modelo | Estado | Referencia que lo valida | En cifras € del reveal |
|---|---|---|---|
| **Selección de producto** | ✅ Validado | Registro MAPA | n/a (no es € de ahorro) |
| **Riego (tras FAO-56)** | 🔧 En reescritura → validable | FAO-56 / `pyfao56` / sensor suelo | ✅ **Sí** (número estrella) |
| **Plagas** | ⚠️ Heurística no validada | Modelos grados-día / humectación foliar (pendiente, con UPC) | ❌ No (solo cualitativo) |
| **Nutrición** | ⚠️ Heurística, señal endógena | Balance de N (RD 1051/2022, guías de abonado) | ❌ No (solo cualitativo) |

**Frontera honesta del reveal:** € solo en **agua** (modelo validado contra
estándar). Plagas y nutrición se reportan de forma cualitativa
("Kylia detectó presión de X el día Y"), nunca como ahorro monetario, hasta que
tengan validación propia.

---

## 9. Referencias

- Allen, R.G. et al. (1998). *Crop evapotranspiration — Guidelines for computing
  crop water requirements*. FAO Irrigation and Drainage Paper 56.
- `pyfao56` — implementación de referencia FAO-56 (github.com/kthorp/pyfao56).
- Cuadro 12 FAO-56 (valores Kc), traducción ICIA: https://www.icia.es/icia/riegos/Cuadro12ManualFAO.pdf
- Ruralcat / IRTA — "Gestió eficient de l'aigua de reg" y eines de reg (Cataluña).
- Open-Meteo — `et0_fao_evapotranspiration` (FAO-56 Penman-Monteith).
- Registro de productos fitosanitarios, MAPA (España).
- RD 1051/2022 — nutrición sostenible en suelos agrarios (España).
- Precedente de validación análogo: CropManage (UC Davis), hortícolas de hoja,
  FAO-56 + nutrientes.
```

`Pendiente de calibración local: refinar curvas Kc y longitudes de fase para las
condiciones de Cataluña (datos del propio piloto + IRTA/Ruralcat), y anclar los
modelos de plaga a literatura epidemiológica.`
