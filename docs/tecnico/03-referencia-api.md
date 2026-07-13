# Kylia — Referencia de API

> Última actualización: **2026-07-12**. Funciones serverless en `api/`. El plan
> Hobby de Vercel limita a 12 funciones; por eso hay **routers** que consolidan
> varios "recursos"/"vistas"/"tipos" en un solo endpoint (`log.js`, `campo.js`, `ia.js`).
> Los `_motor-*.js`, `_ia-*.js`, `_reveal.js`, `_supabase.js` son **módulos**
> (prefijo `_`), no endpoints: se importan, no se rutean.

Convención común: CORS abierto, `OPTIONS` → 204, cuerpo JSON. Helper `preludio()`
y `parseBody()` en `_supabase.js`. Si Supabase no está configurado, los endpoints
degradan con `persisted:false` en vez de romper.

---

## Endpoints de escritura del piloto — `POST /api/log`

Router por campo `recurso`. Consolida toda la traza del piloto silencioso
(`window.kyliaSync` en el front hace POST aquí).

| `recurso` | Handler | Escribe en | Notas |
|---|---|---|---|
| `registro-usuario` | `handleRegistroUsuario` | `usuarios` (upsert por UUID) | **Guard anti-colisión:** si la fila existente es `piloto_sombra` y el email no coincide → 409 (protege pilotos de ser pisados por un UUID reciclado de localStorage) |
| `acciones` | `handleAcciones` | `acciones` | riego o aplicación; valida `tipo`, `franja_horaria` |
| `borrar-accion` | `handleBorrarAccion` | `acciones` (DELETE) | el botón "borrar riego" |
| `observaciones` | `handleObservaciones` | `observaciones` | plaga/enfermedad/estrés |
| `jornadas` | `handleJornadas` | `jornadas` | cierre del diario del día |
| `mediciones` | `handleMediciones` | `mediciones` | NDVI/NDMI/NDRE/suelo |
| `recomendaciones-log` | `handleRecomendacionesLog` | `recomendaciones_log` | inserta (append-only) |
| `eventos` | `handleEventos` | `eventos` | tracking |
| `pauta-goteo` | `handlePautaGoteo` | `usuarios` (`riego_auto_*`) | fija la pauta del goteo automático sin SQL |

Validaciones: UUID de usuario, catálogos cerrados (`METODOS_RIEGO`, `FRANJAS`,
`MANEJOS`, `SUELOS`), `clean()`/`numOrNull()`/`dateOrNull()` en cada campo.

---

## Endpoints de lectura del campo — `GET /api/campo`

Router por query `vista`. Solo lectura. Requiere `usuario_id` (UUID). Reutiliza
los motores puros para ensamblar la respuesta.

| `vista` | Función | Devuelve |
|---|---|---|
| `hoy` (default) | `vistaHoy` | Riego de hoy: clima Open-Meteo en vivo + balance FAO-56 + decisión, en la unidad del agricultor (cubos/minutos/L·m²) |
| `reveal` | `vistaReveal` | Informe final del piloto (4 dimensiones; ver `_reveal.js`) |
| `comparativa` | `vistaComparativa` | Campo del padre: contrafactual Kylia vs. riego real, ahorro de agua (con banda de caudal) |
| `perfil` | `vistaPerfil` | Ficha de la parcela |
| `cuaderno` | `vistaCuaderno` | Cuaderno de fertilización PAC: abonados registrados + plan €/nutriente. **Descuenta la oferta de suelo** (`obtenerOfertaSuelo` → SoilGrids, cacheado) |
| `pilotos` | `vistaPilotos` | Listado de pilotos silenciosos (para el panel) |

`module.exports.revealDeUsuario` se reexporta para que `informe-cientifico.js`
reconstruya el reveal en servidor sin fiarse de números del cliente.

---

## Cron — `GET /api/diario-b`

Congela cada madrugada (`0 6 * * *`) la decisión de riego de cada piloto silencioso.

- Recorre `usuarios` con `piloto_sombra=true` y coordenadas.
- Por cada uno: baja clima (`climaSerie`, Open-Meteo, ET₀+lluvia), lee riegos reales,
  **sintetiza el goteo automático** que falte (`materializarGoteoAuto`, idempotente),
  corre `balanceHidrico` + `decisionRiego`, e inserta la fila en `recomendaciones_log`
  con `fecha` = fecha de la **decisión** y `contexto` con la trazabilidad.
- **Seguridad:** por defecto **DRY-RUN** (calcula y loguea, no escribe). Solo persiste
  si `DIARIO_B_LIVE === "1"` y la request no trae `?dry=1`. Auth opcional por `DIARIO_B_TOKEN`.
- Guard `yaCongelado` evita doble congelado el mismo día.
- Test manual: `GET /api/diario-b?dry=1`.

---

## Cron — `GET /api/recordatorio-wizard`

Recordatorio vespertino del diario por email (`0 17 * * *`). `emailHtml` vía Resend
(`RESEND_API_KEY`, `RECORDATORIO_FROM_EMAIL`). `yaRespondioHoy` evita duplicar.
Test: `?dry=1`.

---

## Datos satelitales — `GET /api/sentinel`

OAuth Copernicus Data Space (`CDSE_CLIENT_ID/SECRET`) + Statistics API.

- Params: `lat`, `lon` (obligatorios), `geometry` opcional (recorta a la parcela).
- Evalscript pide bandas `B04, B05, B08, B11, SCL, dataMask` y calcula:
  - **NDVI** `(B08−B04)/(B08+B04)` — vigor/biomasa.
  - **NDMI** `(B08−B11)/(B08+B11)` — agua en la hoja.
  - **NDRE** `(B08−B05)/(B08+B05)` — proxy de **nitrógeno** (red-edge B05 = clorofila).
- `pickLatestValid` toma la última pasada con suficientes píxeles válidos.
- Devuelve medias + stdev + `estado` (buena/moderada/estrés por umbral NDVI).
- **Límite físico:** B05 es nativo a 20 m; en parcelas de decenas de m² el NDRE es
  ruidoso → sirve como tendencia, no valor absoluto de un día.

---

## Geometría de parcela — `GET /api/sigpac`

Lookup SIGPAC oficial por `lat`/`lon`. Calcula el tile XYZ, baja el vector tile
GeoJSON de `sigpac.mapa.es`, encuentra el recinto que contiene el punto
(`containsPoint` sobre geometría en Mercator) y devuelve su geometría en WGS84 +
la superficie oficial. Matemática de proyección propia (`wgs84ToMercator`, etc.).

---

## IA de texto — `POST /api/ia?tipo=...`

Router por `tipo`. Backend de texto (Gemini free tier; `GEMINI_API_KEY`).

| `tipo` | Módulo | Qué genera |
|---|---|---|
| `recomendacion` | `_ia-recomendacion.js` | Recomendación agronómica estructurada |
| `recomendaciones-texto` | `_ia-recomendaciones-texto.js` | Texto humano de las recomendaciones |
| `sugerencia-producto` | `_ia-sugerencia-producto.js` | Elige el mejor producto **entre candidatos curados** (no inventa) |

---

## Informe científico — `GET|POST /api/informe-cientifico`

Genera el texto del informe del piloto. Body `{ usuario_id }`. Reconstruye el reveal
en servidor (`revealDeUsuario`) y redacta con **cascada a coste cero**:
`llamarClaude` (`ANTHROPIC_API_KEY`, opcional) → Gemini (free) → `informePlantilla`
(plantilla determinista). La respuesta marca la `fuente` usada.

---

## Otros endpoints

| Endpoint | Método | Qué hace |
|---|---|---|
| `/api/feedback` | POST | Feedback in-app → email (Resend) / webhook |
| `/api/waitlist` | POST | Captura de leads pre-launch → email / webhook |

---

## Panel de pilotos — `/pilotos`

Página admin (frontend) protegida por `PILOTOS_KEY`. Permite el registro admin
retroactivo de riegos y fijar la pauta del goteo sin SQL (consume `/api/log` y
`/api/campo?vista=pilotos`). Config vía `PILOTOS_JSON`.
