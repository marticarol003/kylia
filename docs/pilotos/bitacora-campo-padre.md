# Bitácora del piloto — Campo del padre (Sant Boi)

> **Documento vivo.** Diario del primer piloto real de Kylia: el campo del padre del
> fundador, en Sant Boi de Llobregat. Es un **laboratorio abierto** (Kylia *habla*: se
> sigue la recomendación, se mide y se calibra), a diferencia de los pilotos silenciosos
> donde Kylia *calla*. Ver la diferencia conceptual en
> [`../estrategia/validacion-laboratorio-vs-sombra.md`](../estrategia/validacion-laboratorio-vs-sombra.md).
>
> Cada entrada se añade al final, con fecha. No se reescribe el pasado; si algo cambia,
> se anota como corrección fechada.

---

## Ficha del piloto

| | |
|---|---|
| **Inicio** | 2026-06-05 (Día 1) |
| **Ubicación** | Sant Boi de Llobregat — 41.32339 N, 2.05936 E |
| **Cultivo** | Lechuga Maravilla (Batavia) |
| **Tipo** | Laboratorio abierto (Kylia habla) — Nivel 1 de validación |
| **Modelo en juego** | Riego FAO-56 (clima/ET₀). El satélite NO aplica a esta escala. |
| `usuario_id` | `9aaa1b25-6fad-4213-9eda-e135af71b2c3` |
| **Visualizador** | `kylia.app/campo` |

### Dos parcelas que se compararán (por m²)
El piloto tiene dos brazos de **escalas muy distintas**, así que la única comparación
justa es **por metro cuadrado** (L/m², no litros absolutos):

1. **Parcela Kylia** — 10 lechugas Maravilla en un bancal de **0,70 m²**, regadas con
   **cubo de 20 L** (método `regadera`). Se sigue la recomendación FAO-56 de Kylia.
   *"Lo que hago es lo que Kylia recomienda"* → esta parcela ≈ la recomendación del modelo.
2. **Parcela del padre** — **~1 ha de lechuga** regada por **aspersión**, manejo tradicional.
   Es el control. *(Alta pendiente de 3 datos: superficie real, suelo, mm/h del aspersor.)*

El dashboard de `/campo` (en construcción) enseñará **2 líneas en L/m²**:
🟢 Kylia (= parcela de 10 lechugas) · 🟤 Padre (1 ha, aspersión). La referencia de Kylia
se calcula en vivo del clima — no depende del Diario B.

---

## Diario

### Día 1 · 2026-06-05 — Plantación y arranque

**Qué pasó en el campo:**
- Se plantaron **10 lechugas Maravilla** en el bancal de 0,70 m² (2 m × 0,35 m).
- **Riego de asentamiento del trasplante:** 36 L (1,8 cubos de 20 L) = **51,4 L/m²**.
  Encharcó a propósito (riego de trasplante). El suelo venía ya saturado por ~21 mm de
  lluvia el día anterior, así que el déficit hídrico quedó a 0.
- Suelo clasificado como **franco** (delta aluvial del Llobregat; AWC ≈ 0,15).

**Qué dijo Kylia (FAO-56, clima de Sant Boi en vivo vía Open-Meteo):**
- Decisión de hoy: **no regar** — déficit 0 mm < umbral ~20 mm. ET₀ 2,9 mm, lluvia 5,8 mm.
- Próximo riego previsto: el suelo tiene reserva; no toca regar en ~5-6 días. Apunta a
  un riego de mantenimiento de **~0,8 cubos (~16 L)** hacia el **12-14 jun**.

**Apunte agronómico honesto:**
- Los 36 L fueron un riego de asentamiento **muy generoso** (habría bastado ~1 cubo
  localizado). Es, en vivo, un ejemplo del "regar de más" que el reveal está pensado para
  medir. En mantenimiento ~1 cubo/riego basta, sin encharcar.

**Estado técnico (verificado en producción este día):**
- El alta del campo (`db/alta-campo-padre.sql`) **ya está ejecutada** en Supabase: el
  endpoint `kylia.app/api/campo?vista=hoy` devuelve los datos reales y el motor FAO-56
  razona correctamente.
- El cuaderno de registro de `/campo` (riego en cubos / tratamiento / observación) está
  operativo y escribe en `acciones` / `observaciones`.

**Pendiente para el Día 2 y siguientes:**
- Dar de alta la **parcela del padre (1 ha)** → faltan: superficie real, tipo de suelo,
  y mm/h del aspersor (o registrar mm estimados por riego).
- Construir el **dashboard comparativo** de 2 líneas en `/campo`.
- Empezar a registrar los riegos reales del padre (captura mixta: él + el fundador).

---

<!-- Plantilla para nuevas entradas:

### Día N · YYYY-MM-DD — Titular

**Qué pasó en el campo:**
-

**Qué dijo Kylia:**
-

**Divergencia / comparación (cuando haya parcela del padre):**
-

**Notas:**
-
-->
