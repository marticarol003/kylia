# Generador del reveal: el informe final del piloto

> Cómo se construye el **reveal** que /piloto promete: el análisis día a día que
> cruza lo que **Kylia decidió** (`recomendaciones_log`, congelado por el Diario B)
> contra lo que el **agricultor hizo** (`acciones` / `jornadas`).
>
> Relacionado: [`shadow-log-recomendaciones.md`](shadow-log-recomendaciones.md) (de dónde
> sale el registro), [`../estrategia/validacion-laboratorio-vs-sombra.md`](../estrategia/validacion-laboratorio-vs-sombra.md)
> §4 (por qué el € solo va en agua). Última actualización: 2026-06-05.

---

## 1. Las piezas

| Qué | Dónde |
|---|---|
| Núcleo PURO (cálculo, sin red, testeable) | `api/_reveal.js` |
| Endpoint (lee Supabase → núcleo → JSON) | `api/reveal.js` |
| Test determinista | `scripts/test-reveal.mjs` (`node scripts/test-reveal.mjs`) |

El núcleo recibe las filas ya leídas y devuelve el informe; el endpoint solo lee de
Supabase y ensambla. Mismo patrón que `_motor-riego.js` ↔ `diario-b.js`.

**Uso:** `GET /api/reveal?usuario_id=<uuid>` → `{ ok, informe }`. Añade `&dump=1` para
ver las filas crudas. Si existe `REVEAL_TOKEN` en entorno, se exige (`?token=` o header).

---

## 2. Las 4 dimensiones (las de /piloto) y su soporte de datos

| # | Dimensión | Fuente | Estado |
|---|---|---|---|
| 1 | Horas en decidir | `jornadas.fuente_decision` | ⚠️ **Proxy**: hay fuentes, no minutos |
| 2 | Agua aplicada vs recomendada | `acciones`(riego) vs `recomendaciones_log`(riego) | ✅ **Completo, con €** |
| 3 | Tratamientos evitables | `acciones`(trat) vs `recomendaciones_log`(trat) | ⚠️ **Sin contrafactual** hoy |
| 4 | Coste de la divergencia | dim. 2 × área × tarifa | ✅ **Agua sí**; trat. no (a propósito) |

### Frontera honesta (la regla que no se cruza)
Solo se traduce a € el **agua**, porque es el único modelo **validado** (FAO-56 vs
pyfao56, ETc RMSE 0.000). Plagas/nutrición son heurísticas no validadas → se reportan
**cualitativamente**, sin euros. Esto es de diseño, no una limitación temporal.

### Honestidad operativa
El informe **declara lo que aún no puede medir** en vez de inventarlo: cada dimensión
trae `disponible` + `motivo`, y `informe.avisos[]` lista lo que no se afirma todavía.

---

## 3. Detalle de cálculo

- **Agua (dim. 2):** compara solo en el **periodo con decisiones congeladas** (desde la
  primera fila de riego del Diario B). Riegos reales anteriores se reportan aparte
  (`riegos_antes_del_registro`), no se comparan — evita el sesgo de medir agua real de
  60 días contra decisiones de 30. `recomendada` = suma de las decisiones `nivel:"alta"`
  (lámina bruta de "regar hoy"). Comparativa por semana ISO. `cobertura_pct` delata
  huecos del cron.
- **Coste (dim. 4):** `€ = exceso(L/m²) × área(m²) / 1000 × tarifa(€/m³)`. Sin área o
  tarifa → devuelve el exceso en L/m² y el motivo, sin inventar €.
- **Tratamientos (dim. 3):** por cada aplicación real, ¿había una recomendación de
  tratamiento congelada ±3 días? No → "preventivo / potencialmente evitable". Cualitativo.

---

## 4. Deuda de captura (para cumplir las 4 dimensiones al 100%)

El reveal de agua está **listo y validado**. Para las otras dos faltan dos piezas de
captura — el generador ya las consume en cuanto existan:

1. **Tiempo de decisión (dim. 1):** el cierre del diario (`jornadas`) captura *en qué te
   basaste*, no *cuántos minutos*. Sin ese campo no se estiman horas. → Añadir un campo de
   minutos al wizard de cierre + columna en `jornadas`.
2. **Congelar plagas/nutrición (dim. 3):** `api/diario-b.js` hoy solo congela la decisión
   de **riego**. Sin decisión de tratamiento congelada no hay contrafactual. → Extender el
   Diario B para congelar también la recomendación de plagas/nutrición del día.

Hasta entonces el reveal entrega la dim. 2 + 4(agua) con rigor, y las dim. 1 + 3 como
señal parcial **declarada como tal**.
