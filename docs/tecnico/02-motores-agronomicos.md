# Kylia — Motores agronómicos

> Última actualización: **2026-07-12**. Los cinco motores viven en `api/_motor-*.js`
> y `api/_suelo-oferta.js` / `api/_reveal.js`. Son **núcleos puros**: sin red ni
> estado (salvo la única llamada HTTP de `_suelo-oferta`), para poder testearse
> determinista y correr idénticos en cliente y servidor. Tests en `tests/*.mjs`
> (`npm test` para los deterministas).

Índice: [Riego FAO-56](#1-riego--fao-56) · [Nutrición](#2-nutrición--balance-de-masa) ·
[Cuaderno €](#3-cuaderno-de-fertilización--) · [Suelo satelital](#4-oferta-del-suelo--soilgrids) ·
[Reveal](#5-reveal--el-contrafactual).

---

## 1. Riego — FAO-56

**Fichero:** `api/_motor-riego.js`. Método del coeficiente único de cultivo
(Allen et al., 1998). Todo en mm (= L/m²). Validado contra `pyfao56` (ETc RMSE ≈ 0).

### Parámetros calibrados
- `FAO_KC` — por cultivo: `{ ini, med, fin, L:[inicial,desarrollo,media,final], zr:[mín,máx], p }`.
  Cultivos: lechuga, espinaca, brassica, tomate, pimiento, berenjena, calabacín, cebolla
  (tierna). `zr` = profundidad radicular (Tabla 22, cota inferior = conservador para
  huerta somera); `p` = fracción de agotamiento sin estrés.
- `SUELO_AWC` = { arenoso 0.08, franco 0.15, arcilloso 0.16 } (θFC−θWP, Tabla 19).
- `EFIC_RIEGO` = { goteo 0.90, aspersión 0.75, manguera 0.70, surco 0.60, regadera 0.85 }.
- `CAUDAL_DEFAULT_MMH` = { goteo 4, aspersión 10, manguera 20 } — fallback si el
  agricultor no declara su caudal.

### Funciones
- **`kcDelDia(cultivo, dias)`** — Kc interpolado linealmente entre fases inicial →
  desarrollo → media → final. Sin cultivo/fecha → Kc=1 (ETc = ET₀).
- **`faseDelDia`** — nombre de la fase (para explicar en pantalla el porqué del Kc).
- **`zrDelDia(cultivo, dias)`** — profundidad radicular efectiva: crece linealmente
  de `zr[0]` al trasplante hasta `zr[1]` al inicio de la fase media (FAO-56 §8.3).
- **`aguaSuelo(suelo, cultivo, dias)`** → `{ taw, raw, awc }`. `TAW = 1000·AWC·Zr`;
  `RAW = p·TAW`. La raíz crece día a día → el depósito crece.
- **`balanceHidrico(serie, riegos, opts)`** → `{ Dr, taw, raw, efic, kcActual, etcAcum, et0Acum, lluviaAcum, sinFenologia }`.
  Bucle diario: recarga por riego neto (`litros × eficiencia`), `ETc = Kc·ET₀`, resta
  **lluvia efectiva** (`Pe = lluvia si ≥ 2 mm, si no 0`), acota el déficit `Dr` a `[0, TAW]`.
  - `serie`: `[{date, et0, lluvia}]`; `riegos`: `[{date, litros|null}]` (`null` = recarga completa).
- **`decisionRiego(bal)`** → nivel + cantidad:
  - `Dr ≥ RAW` → **regar** (alta), lámina bruta = `Dr / eficiencia`.
  - `0.75·RAW ≤ Dr < RAW` → **vigilar** (media).
  - `Dr < 0.75·RAW` → **todo en orden** (baja).
- **`presentarRiego(mmBruto, opts)`** — traduce la lámina a la unidad del agricultor:
  regadera → nº de regaderas; goteo/aspersión/manguera → minutos (`mm/caudal×60`);
  surco/sin datos → L/m². Siempre devuelve `mm` para trazabilidad.
- **`simularKylia(serie, opts)`** — **contrafactual**: simula "qué habría hecho Kylia"
  día a día (riega la lámina bruta cuando `Dr ≥ RAW`, repone, si no espera). Devuelve la
  serie acumulada + `deficitFinal` (agua "en cola" no regada al corte — honestidad al
  comparar acumulados a igual fecha). Es la rama que alimenta el reveal y `/campo`.

---

## 2. Nutrición — balance de masa

**Fichero:** `api/_motor-nutricion.js`. Gemelo del de riego, para el abonado.

```
Necesidad(nutriente) = Extracción(nutriente) × Rendimiento_esperado − Oferta_del_suelo
```

- **`EXTRACCION`** — kg de N / P₂O₅ / K₂O por **tonelada** cosechada, por cultivo
  (tomate, cebolla, lechuga). Son el "Kc de la nutrición": coeficientes = **centro**
  de los rangos de extracción de guías españolas (agroes.es). Se usa extracción (lo
  que retira el cultivo), no dosis (lo que se aplica, mayor).
- **`necesidadNutrientes(cultivo, rendimientoT, ofertaSuelo)`** →
  por nutriente `{ extraccion_kg, aporte_suelo_kg, necesidad_kg }` (nunca negativa).
  - Sin `ofertaSuelo` → `oferta_conocida:false` y necesidad = extracción **bruta**
    (sobreestima; se declara, no se estima el suelo por satélite).
  - Con `ofertaSuelo = {N, P2O5, K2O}` → resta el aporte conocido.

**Frontera:** los coeficientes varían por variedad/zona/manejo; lo robusto es la
estructura del balance y la relación N:P:K, no el segundo decimal.

---

## 3. Cuaderno de fertilización — € y PAC

**Fichero:** `api/_motor-cuaderno-fert.js`. Traduce la necesidad de nutrientes a
coste y a las líneas del cuaderno de abonado (gancho regulatorio RD 1051/2022).

- **`PRECIO_REF_EUR_KG`** = { N 1.2, P2O5 1.4, K2O 0.9 } — €/kg de nutriente,
  referencia editable (volátil; el agricultor puede pasar los suyos).
- **`cuadernoFertilizacion(necesidad, opts)`** → líneas `{nutriente, necesidad_kg,
  precio_eur_kg, coste_eur}` + `coste_total_eur`.
  - El plan es a nivel de **nutriente**, no de producto comercial (el catálogo
    eco/conv que mapeaba a marcas se quitó por lioso — premisa de simplicidad).
  - Sin analítica → plan sobre extracción bruta (sobreestima), declarado en la nota.

---

## 4. Oferta del suelo — SoilGrids

**Fichero:** `api/_suelo-oferta.js` (añadido 2026-07-12). Rellena el `ofertaSuelo`
del motor de nutrición **sin analítica de laboratorio ni hardware**: una consulta por
coordenada a **SoilGrids** (ISRIC, 250 m, CC-BY). Encaja con la premisa satélite+modelos.

### Qué hace
- **`consultaPunto(lat, lon)`** — pide a SoilGrids `nitrogen, soc, phh2o, clay, sand,
  bdod` ponderados en profundidad 0–30 cm. Devuelve `null` por propiedad si el píxel
  está enmascarado (urbano/agua).
- **`consultaConFallback`** — si el punto exacto da `null` (p. ej. campo del padre en
  Sant Boi urbano), muestrea un anillo de 8 puntos a ~400 m y promedia los válidos.
- **`ofertaSuelo(lat, lon, areaM2, opts)`** → `{ N, P2O5, K2O, observado, modelo_n, fuente, nota }`.

### El modelo de nitrógeno (lo importante)
El N **total** del suelo es casi todo orgánico inmovilizado; lo que la planta usa en
una campaña es la fracción que **mineraliza**. Modelo de primer orden:

```
masa_suelo(t/ha) = bdod(t/m³) × 0.30 m × 10 000
N_total(kg/ha)   = N_conc(g/kg) × masa_suelo
N_mineralizable  = N_total × k        (k = 1,2 %/ciclo, conservador y afinable)
N_parcela(kg)    = N_mineralizable(kg/ha) × area_m2 / 10 000
```

### Fronteras honestas (declaradas en el código)
- **P₂O₅ y K₂O → `null`.** SoilGrids no da sus formas asimilables; no se leen desde el
  espacio. Su fuente sería ESDAC/LUCAS (descartado: licencia "no ceder a terceros" +
  sin API + interpolación 500 m poco fiable para P/K) o una analítica del agricultor.
- Es un **prior regional** (250 m), no la parcela. No sustituye a una analítica.
- Píxel sin dato → `disponible:false` → el motor cae a extracción bruta.

### Cacheado (persist-once)
El suelo no cambia: `ofertaSuelo` se calcula **una vez** y se guarda en
`usuarios.suelo_oferta`. `api/campo.js` (`obtenerOfertaSuelo`) lee la caché y solo
llama a SoilGrids si está vacía. Nunca revienta la vista: ante fallo, extracción bruta.

**Efecto real medido** (cebolla, La Selva): el suelo del delta mineraliza ~100 kg N/ha,
así que la dosis honesta de N baja de 4,4 a 0,6 kg (coste 14,35 → 9,79 €). P y K sin cambio.

---

## 5. Reveal — el contrafactual

**Fichero:** `api/_reveal.js` (`construirReveal`). Cruza las dos series del piloto —lo
que **Kylia decidió** (`recomendaciones_log`, congelado por diario-b) vs. lo que el
**agricultor hizo** (`acciones`)— y produce las dimensiones del informe final.

- El **ahorro de agua** se calcula con `simularKylia` (contrafactual FAO-56 desde
  `piloto_inicio`), no leyendo el log crudo, para no arrastrar días de baseline sucio.
  Ejemplo verificado (Breda): 23 vs 64 L/m² = ~64 % de ahorro.
- Dimensiones honestas: no añade métricas de precisión/adopción/satisfacción (romperían
  el modelo honesto — decisión de producto).

Detalle en `docs/tecnico/generador-reveal.md` y
[`04-piloto-silencioso-y-reveal.md`](04-piloto-silencioso-y-reveal.md).
