# Kylia — Panorama técnico del proyecto

> Documento maestro. Última actualización: **2026-07-12**.
> Escrito a partir del código real del repo (no de intenciones). Si algo aquí
> contradice a un doc más antiguo de `docs/tecnico/`, manda este.

Este es el mapa de todo lo que **es** Kylia hoy y **cómo** funciona por dentro.
Los detalles finos de cada pieza están en los documentos hermanos:

- [`01-modelo-de-datos.md`](01-modelo-de-datos.md) — las tablas Postgres reales (base + ALTERs).
- [`02-motores-agronomicos.md`](02-motores-agronomicos.md) — riego FAO-56, nutrición, suelo satelital, reveal.
- [`03-referencia-api.md`](03-referencia-api.md) — cada endpoint serverless, sus métodos y parámetros.
- [`04-piloto-silencioso-y-reveal.md`](04-piloto-silencioso-y-reveal.md) — el circuito de extremo a extremo del piloto.

Documentos previos que siguen siendo válidos como profundización: `motor-de-decision.md`,
`shadow-log-recomendaciones.md`, `generador-reveal.md`, `runbook-piloto-silencioso.md`.
(`arquitectura.md` y `estado-y-roadmap.md` están parcialmente desfasados: Supabase ya
es central, no "próximamente".)

---

## 1. Qué es Kylia

Monitorización y recomendación agronómica para parcelas pequeñas de horticultura,
**sin instalar nada en el campo**. Todo se deriva de:

- **Datos satelitales** (Sentinel-2 vía Copernicus Data Space): vigor (NDVI),
  humedad foliar (NDMI) y estado de nitrógeno (NDRE).
- **Modelos matemáticos** alimentados por meteorología (Open-Meteo): balance
  hídrico FAO-56 para el riego, balance de masa para la nutrición.
- **Bases de datos geoespaciales públicas**: geometría de parcela (SIGPAC),
  propiedades del suelo (SoilGrids/ISRIC), catálogo de productos (registro MAPA).

**Premisa de diseño (dura):** cero hardware, cero sensores, cero formación del
agricultor. Lo que no se puede leer honestamente desde satélite o modelo, no se
inventa: se declara como desconocido. Esta honestidad es una decisión de producto,
no un accidente — recorre todo el código (ver §6).

**Premisa de producto:** simplicidad máxima. Lo que no se usa, se elimina.

---

## 2. El modelo de negocio que condiciona la arquitectura: el "piloto silencioso"

Kylia se valida con **pilotos silenciosos**. La mecánica técnica:

1. Se da de alta un campo real (`usuarios`, con `piloto_sombra = true`).
2. Kylia **calla**: el agricultor riega/abona como siempre y solo **registra**
   lo que hace (tabla `acciones`).
3. Cada madrugada, un cron (`diario-b`) calcula **qué habría recomendado Kylia**
   ese día y lo **congela** en `recomendaciones_log` (tabla sellada, append-only).
4. Al final de la campaña (~2 meses), el **reveal** cruza las dos series —lo que
   Kylia decidió vs. lo que el agricultor hizo— y demuestra cuánta agua/insumo se
   habría ahorrado. Es la prueba científica y el momento de conversión.

Todo lo demás (esquema de datos, crons, el motor puro compartido) existe para que
ese reveal sea **indiscutible**: mismo motor en cliente y servidor, decisiones
fechadas sin retrovisor, registro inalterable. Detalle en
[`04-piloto-silencioso-y-reveal.md`](04-piloto-silencioso-y-reveal.md).

Pilotos activos (2026-07): tomate (Breda), cebolla tierna (El Tros de l'Uri, La Selva),
y el "campo del padre" (Sant Boi) como laboratorio abierto de comparación.

---

## 3. Stack y topología

```
┌─────────────────────── NAVEGADOR (agricultor / técnico) ────────────────────────┐
│  HTML + JS vanilla (sin framework). Leaflet para mapas. UUID de piloto en        │
│  localStorage. Páginas: / (landing), /app (producto), /campo (comparativa),      │
│  /piloto/* (alta, diario, cuaderno, informe), /pilotos (panel admin).            │
└───────────────┬──────────────────────────────────────────────────────────────────┘
                │  fetch()
┌───────────────▼──────────────────────── VERCEL (serverless Node) ─────────────────┐
│  api/*.js — 10 funciones (límite Hobby = 12; por eso hay routers que consolidan   │
│  varios "recursos" en un endpoint: log.js, ia.js, campo.js).                      │
│  Motores PUROS y testeables: _motor-riego, _motor-nutricion, _motor-cuaderno-fert,│
│  _suelo-oferta, _reveal. Helper Supabase: _supabase.js.                            │
│  2 crons: recordatorio-wizard (17:00), diario-b (06:00 UTC).                       │
└───┬───────────┬───────────┬───────────┬───────────┬───────────┬───────────┬───────┘
    │           │           │           │           │           │           │
    ▼           ▼           ▼           ▼           ▼           ▼           ▼
 Supabase   Copernicus   Open-Meteo   SIGPAC     SoilGrids    Gemini/     Resend
 Postgres   Data Space   (ET₀+lluvia) (mapa.es)  (ISRIC)      Claude      (email)
 (datos)    (Sentinel-2)                                      (texto IA)
```

**Frontend:** HTML estático + JS vanilla servido por Vercel. Sin build. `app/index.html`
es el producto (~5.700 líneas: selección de parcela por SIGPAC+Leaflet, tarjetas de
NDVI/NDMI, riego FAO-56, nutrición, plagas, diario). Modo demo con `?demo=1`.

**Backend:** funciones serverless Node en `api/`. No hay dependencias de producción
(`package.json` sin `dependencies`; solo `puppeteer` como devDependency para mockups).
Todo con `fetch` nativo de Node.

**Base de datos:** Supabase Postgres, accedida vía PostgREST con la service key
(`SUPABASE_SERVICE_KEY`). Ver [`01-modelo-de-datos.md`](01-modelo-de-datos.md).

---

## 4. Fuentes de datos externas (hosts reales invocados por el código)

| Fuente | Host | Para qué | Auth |
|---|---|---|---|
| **Copernicus Data Space** | `identity.dataspace.copernicus.eu` + `sh.dataspace.copernicus.eu` | Sentinel-2: NDVI, NDMI, NDRE (Statistics API) | OAuth client credentials (`CDSE_CLIENT_ID/SECRET`) |
| **Open-Meteo** | `api.open-meteo.com` | ET₀ FAO + precipitación diaria | ninguna (free) |
| **SIGPAC** | `sigpac.mapa.es` | Geometría oficial de la parcela por lat/lon | ninguna (vector tiles) |
| **SoilGrids (ISRIC)** | `rest.isric.org` | Propiedades del suelo por coordenada (N, C org., pH, textura, densidad) | ninguna (CC-BY) |
| **Gemini** | `generativelanguage.googleapis.com` | Texto de recomendaciones + informe (free tier) | `GEMINI_API_KEY` |
| **Claude** | `api.anthropic.com` | Informe científico (opcional, capa premium) | `ANTHROPIC_API_KEY` |
| **Resend** | `api.resend.com` | Email transaccional (feedback, recordatorio) | `RESEND_API_KEY` |

Coste de datos: **0 €** en el núcleo (Copernicus, Open-Meteo, SIGPAC, SoilGrids son
gratuitos; Gemini free tier). El informe cae en cascada Claude → Gemini → plantilla
para no depender de un pago.

---

## 5. Variables de entorno (Vercel)

| Variable | Uso |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Acceso a Postgres vía PostgREST |
| `CDSE_CLIENT_ID`, `CDSE_CLIENT_SECRET` | OAuth Copernicus (Sentinel-2) |
| `DIARIO_B_LIVE` | `"1"` habilita la escritura del cron diario-b (si no, dry-run) |
| `DIARIO_B_TOKEN` | Token opcional para autenticar la llamada al cron |
| `PILOTOS_KEY`, `PILOTOS_JSON` | Panel `/pilotos` (clave de acceso + config) |
| `GEMINI_API_KEY` | IA de texto (recomendaciones, informe) |
| `ANTHROPIC_API_KEY` | Informe científico premium (opcional) |
| `RESEND_API_KEY`, `RECORDATORIO_FROM_EMAIL`, `RECORDATORIO_TOKEN` | Email + cron recordatorio |
| `FEEDBACK_FORWARD_EMAIL`, `FEEDBACK_WEBHOOK_URL` | Enrutado del feedback in-app |
| `WAITLIST_FORWARD_EMAIL`, `WAITLIST_WEBHOOK_URL` | Enrutado de leads de waitlist |

> Nota operativa: en local, `.env.local` solo tiene `DATABASE_URL` (vacío). Los
> secretos viven en Vercel; **no se puede escribir en la BD de producción desde
> local** sin cargarlos. Los cambios de datos de piloto se aplican por el SQL
> Editor de Supabase o por el panel `/pilotos`.

---

## 6. La frontera honesta, por subsistema

El principio "no inventes lo que no puedes medir" está codificado. Cada motor
declara hasta dónde llega:

| Subsistema | Qué es sólido | Qué se declara como estimación/desconocido |
|---|---|---|
| **Riego (FAO-56)** | Modelo validado contra `pyfao56` (ETc RMSE ≈ 0). Agua medida > modelo. | El caudal del aspersor/goteo si no se midió (banda, "truco del vaso"). |
| **Nutrición (extracción)** | Coeficientes = centro de rangos de guías españolas; relación N:P:K por cultivo. | Sin analítica de suelo → extracción **bruta** (sobreestima), marcado `oferta_conocida:false`. |
| **Suelo satelital (SoilGrids)** | Nitrógeno vía mineralización del N orgánico (prior regional). | **P₂O₅ y K₂O no se derivan de satélite → `null`**. Píxel urbano → sin dato → extracción bruta. |
| **Plagas / productos** | Solo el catálogo MAPA (`data/productos.json`) está validado. | La elección concreta la sugiere la IA entre candidatos curados; no inventa productos. |

Esta tabla es el corazón del producto: el reveal vale porque los números que
enseña son defendibles, no porque sean impresionantes.

---

## 7. Despliegue y operación

- **Deploy:** push a `main` → Vercel construye y publica en `kylia.app`. Sin CI/build step (estático + serverless).
- **Crons (`vercel.json`):**
  - `recordatorio-wizard` — `0 17 * * *` (recordatorio vespertino del diario por email).
  - `diario-b` — `0 6 * * *` (congela la decisión de riego de cada piloto silencioso).
- **Migraciones de BD:** ficheros en `db/`, idempotentes, ejecutados a mano en el
  SQL Editor de Supabase. `schema.sql` es la base (reset destructivo de 7 tablas);
  el esquema **real** es esa base + los ALTERs de los ficheros posteriores
  (ver [`01-modelo-de-datos.md`](01-modelo-de-datos.md)).
- **Verificación en vivo:** los endpoints GET (`/api/campo?vista=...`) permiten
  comprobar el estado real de un piloto sin abrir Supabase.
