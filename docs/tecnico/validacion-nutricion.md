# Validación del motor de nutrición (fertilizantes)

> Análoga a la validación del riego contra `pyfao56`. Aquí la referencia es la
> **"Guía práctica de la fertilización racional de los cultivos en España"** (MAPA),
> la guía oficial española (≈20 autores universitarios). Fecha: 2026-07-16.
> Motores validados: `api/_motor-nutricion.js`, `api/_motor-cuaderno-fert.js`,
> `api/_suelo-oferta.js`. Doc interno (excluido del deploy por `.vercelignore`).

## Método

No existe un simulador único de referencia para el abonado (como pyfao56 para el
agua). La validación tiene tres partes: (1) los **coeficientes de extracción**
contra la tabla oficial de MAPA; (2) la **estructura del balance** contra el método
oficial; (3) el **modelo de N del suelo** (SoilGrids) contra la tabla de
mineralización de MAPA.

---

## 1. Coeficientes de extracción — ✅ VALIDADOS

Comparación de `EXTRACCION` (kg de nutriente por tonelada cosechada) contra las
Tablas 23.3.1 / 23.3.2 / 23.3.3 de la Guía MAPA (Parte II, hortícolas):

| Cultivo | Nutriente | Motor | Rango oficial MAPA | Veredicto |
|---|---|---|---|---|
| Tomate | N | 3,0 | 2,5–3,5 | ✅ centro |
| Tomate | P₂O₅ | 1,3 | 1,1–1,5 | ✅ centro |
| Tomate | K₂O | 5,2 | 5,0–5,5 | ✅ |
| Cebolla | N | 2,3 | 2,1–2,5 | ✅ centro |
| Cebolla | P₂O₅ | 1,2 | 0,9–1,5 | ✅ centro |
| Cebolla | K₂O | 3,4 | 3,0–3,8 | ✅ centro |
| Lechuga | N | 2,5 | 2,2–2,7 | ✅ |
| Lechuga | P₂O₅ | 1,1 | 0,8–1,4 | ✅ centro |
| Lechuga | K₂O | 5,3 | 4,6–6,0 | ✅ centro |

**Los 9 coeficientes caen dentro del rango oficial, casi todos en el centro.** Los
rangos que `tests/test-nutricion.mjs` ya verificaba coinciden exactamente con los de
MAPA, así que el motor estaba test-validado contra la fuente primaria sin saberlo.

### 1b. Rindes de referencia — ✅ VALIDADOS (2026-07-23)

`RINDE_REF_T_HA` (`_rendimiento.js`) es la cosecha esperada por defecto (t/ha) que,
sin dato del agricultor, arranca la estimación de rendimiento y por tanto la
extracción del plan de abonado. Se han alineado con la **producción comercial de
referencia de MAPA** (misma Tabla 23.3.1), lo que hace el balance internamente
consistente: extracción de N/ha = coef. × rinde cae en el centro del rango oficial.

| Cultivo | Rinde anterior | Rinde MAPA (nuevo) | N/ha resultante | Rango MAPA N/ha |
|---|---|---|---|---|
| Tomate | 70 | **60** | 180 | 150–210 ✅ centro |
| Cebolla | 45 | **65** | 149 | 140–160 ✅ centro |
| Lechuga | 35 | **35** | 87 | 80–100 ✅ centro |

El tomate a 70 daba 210 kg N/ha (tope del rango) y la cebolla a 45 daba 103 kg N/ha
(**por debajo** del rango → infraabonaba). Ambos corregidos.

---

## 2. Estructura del balance — ✅ VALIDADA

La Guía MAPA (pág. 184) define la dosis así:

> *"La dosis de nutrientes a aplicar depende de las **extracciones del cultivo**, del
> **contenido de nutrientes en el suelo** y de su **eficiencia de utilización**."*

Y para el nitrógeno, el balance completo (pág. 185):

> *Dosis N = (Extracción + Lixiviación + Inmovilización + Pérdidas gaseosas + N mineral
> mínimo final) − (Residuos de cosecha + N mineral inicial + Mineralización de la MO)*

El motor implementa el núcleo de ese balance: `Necesidad = Extracción × Rendimiento −
Oferta del suelo`. **La estructura es la oficial.** Los términos que el motor aún no
incluye se enumeran en §4.

---

## 3. Modelo de N del suelo (SoilGrids) — ⚠️ APROBADO EN ENFOQUE, PERO DESCALIBRADO

MAPA **avala el enfoque** de `_suelo-oferta.js`: estima el aporte de N del suelo por
"mineralización de la materia orgánica… según su contenido de MO y su textura"
(Tabla 4.2). Es exactamente lo que hace el módulo con SoilGrids (carbono orgánico +
textura por coordenada).

**Tabla 4.2 de MAPA — aporte anual de N por mineralización de la MO (kg N/ha·año):**

| MO suelo % | Arcillosos (fríos) | Francos (templados) | Arenosos (cálidos) |
|---|---|---|---|
| 1 | 15 | 22 | 30 |
| 2 | 30 | 45 | 60 |
| 3 | 45 | 65 | 90 |

Contraste sobre el suelo real de La Selva (SoilGrids: C org. 24,97 g/kg → **MO 4,3 %**,
franco, N total 2,09 g/kg, densidad 1,43):

| | Mi modelo (`k=1,2 %/ciclo`) | MAPA Tabla 4.2 |
|---|---|---|
| N total del suelo | 8.966 kg/ha | — |
| N mineralizable | **108 kg/ha por ciclo** | ~91 kg/ha·año → **~46 kg/ha por ciclo de verano** |

**Hallazgo (antes de recalibrar): el modelo sobreestimaba el N del suelo ×2,4**, sobre-
acreditando el suelo y recomendando menos nitrógeno del que MAPA aplicaría. Causa: el
coeficiente `k=1,2 %/ciclo` sobre el N total era demasiado alto.

### ✅ Recalibración APLICADA (2026-07-16)
`_suelo-oferta.js` ya no usa el `k` mecanicista: implementa la **Tabla 4.2 de MAPA**,
que es exactamente lineal → `N_anual (kg/ha) = FACTOR[textura] × MO%`, con
`FACTOR = {arcilloso 15, franco 22, arenoso 30}` y `MO% = C org.% × 1,724`, por la
fracción de ciclo de verano (~½ del anual). La textura se clasifica desde clay/sand de
SoilGrids. Resultado sobre La Selva: **~47–56 kg N/ha·ciclo** (antes 108) → alineado con
la tabla oficial. La salida ahora **reproduce el método oficial de MAPA**.

---

## 4. Fronteras honestas (confirmadas por el balance de MAPA)

El motor da un "necesidad neta" defendible, pero el balance completo de MAPA tiene
términos que el motor aún no modela:

- **Términos que SUBEN la dosis** (eficiencia): lixiviación, inmovilización, pérdidas
  gaseosas del N, y el colchón de "N mineral mínimo al final del cultivo" (30–60 kg
  N/ha en general; 60–90 en cebolla/espinaca/puerro/brócoli/coliflor).
- **Términos que BAJAN la dosis** (créditos del suelo): N mineral inicial del suelo
  (necesita análisis) y N de los residuos de la cosecha anterior. **El crédito de
  residuos ya está implementado** (2026-07-23): el onboarding captura el cultivo
  anterior y si se incorporaron los restos; el motor (`creditoResiduosN`) traduce el
  cultivo a los kg N/ha de la **Tabla 23.3.1 de MAPA** (centro del rango) × **60 %**
  (centro del 40–80 % que se mineraliza en 2–3 meses si se incorporan, MAPA Parte II
  pág. 186). Sin incorporación o sin cultivo anterior → crédito 0.
- **P₂O₅ y K₂O**: siguen sin oferta de suelo derivable de satélite (declarados).
- **Fraccionamiento temporal**: **ya implementado** (2026-07-23) en `_motor-cuaderno-fert.js`
  según MAPA Parte II (pág. 189-190). Riego tradicional (surco/aspersión/manguera/
  regadera): N fondo 30% + cobertera 70%, P₂O₅ y K₂O 100% en fondo. Fertirrigación
  (goteo): cada nutriente en tercios del ciclo (≈25/55/20). El reparto viaja en cada
  línea del plan (`reparto`) + un bloque `fraccionamiento` con el modelo. **Nota**: hoy
  el plan solo vive en la respuesta de la API (`/api/campo?vista=cuaderno`); ningún
  front lo pinta aún (la página del cuaderno solo muestra los abonados registrados).

Estos términos se compensan en parte (unos suben, otros bajan), por eso el número del
motor es un estimador central razonable — pero no es la dosis rigurosa de MAPA.

---

## Veredicto global

| Componente | Estado |
|---|---|
| Coeficientes de extracción | ✅ Validados contra MAPA (9/9 en rango) |
| Estructura del balance | ✅ Es el método oficial de MAPA |
| Enfoque de N del suelo (SoilGrids) | ✅ Avalado por MAPA (Tabla 4.2) |
| Coeficiente de mineralización | ✅ Recalibrado a la Tabla 4.2 (2026-07-16) |
| Colchón de N final (MAPA) | ✅ Implementado (30–60 / 60–90 kg/ha por cultivo) |
| Crédito de residuos del cultivo anterior | ✅ Implementado (Tabla 23.3.1 × 60 %, 2026-07-23) |
| Fraccionamiento fondo/cobertera | ✅ Implementado (MAPA pág. 189-190, 2026-07-23) |
| Eficiencia / pérdidas gaseosas / lixiviación | ❌ No modelado (gap conocido) |
| Oferta de suelo P/K | ❌ No derivable de satélite (declarado) |

El motor es **sólido y defendible en su núcleo** (coeficientes + estructura = método
oficial español). La acción concreta que sale de esta validación es **recalibrar el
modelo de mineralización a la Tabla 4.2 de MAPA**.

## Fuentes

- MAPA — *Guía práctica de la fertilización racional de los cultivos en España*
  ([Parte I](https://www.mapa.gob.es/dam/mapa/contenido/agricultura/publicaciones/01_fertilizacion-baja-.pdf),
  [Parte II](https://www.mapa.gob.es/dam/mapa/contenido/agricultura/publicaciones/02_fertilizacion-baja-.pdf)).
  Extracciones: Parte II, Tablas 23.3.1/2/3. Balance de N y mineralización: Parte I,
  Tabla 4.2 (pág. 36) y Parte II, pág. 185.
