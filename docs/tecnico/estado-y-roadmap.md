# Estado actual y roadmap

Documento vivo. Última actualización: **2026-05-19**.

Propósito: dejar constancia de dónde estamos, qué tecnologías usamos y por qué, y planificar la evolución — especialmente del uso de IA, que crecerá en próximas iteraciones.

---

## 1. Estado actual de la app

Kylia es un SPA monolítico (`/app/index.html`) desplegado en Vercel y servido sobre `kylia.vercel.app`. La landing pública es `/index.html`. El piloto es privado: el acceso a `/app` exige un email registrado mediante un gate.

### 1.1 Funcionalidades implementadas

| Bloque | Estado | Resumen |
|---|---|---|
| Acción del día | Producción | Card prioritaria que dice "Regar hoy / Revisar el riego / Todo en orden" según balance hídrico. Botón "He regado hoy". Panel "¿Por qué?" |
| Tarjeta "Tu parcela" | Producción | Tres indicadores: vigor del cultivo (NDVI), agua en la planta (NDMI), humedad del suelo (Open-Meteo DWD ICON). Cada uno con panel explicativo |
| Histórico NDVI | Producción | Sparkline 56 días con bandas de color |
| Seguimiento de riego | Producción | Modal para registrar fecha + cantidad (L/m²). Card con últimos 7 riegos. Balance hídrico detecta déficit residual cuando un riego se queda corto |
| Recomendaciones | Producción | RIEGO, TRATAMIENTO, NUTRICIÓN. Calculadas por reglas duras con cantidades. Reescritas por IA para tono natural |
| Comparativa productos | Producción | Tabla con filtros y orden sobre catálogo curado, sugerencia IA contextual, botón "Voy a usar este" |
| Registro de aplicaciones | Producción | Modal de registro, historial con plazo de seguridad activo, exportación CSV, aviso proactivo en card del día |
| Análisis IA | Producción | Párrafo 2-3 frases sobre el estado global de la parcela. Bloque "✨ Análisis" |
| Alertas plagas | Producción | Cálculo por reglas según meteo + cultivos seleccionados |
| Mapa de parcela | Producción | Selección SIGPAC en mapa Leaflet, contorno oficial guardado en localStorage |
| Configuración | Producción | Cultivos, ubicación GPS, nombre |

### 1.2 Lo que aún NO existe

- Auth real (hoy: gate por email simple, sin verificación)
- Persistencia servidor (todo en localStorage del navegador)
- Pasarela de pago (Stripe)
- Cron de alertas push (Telegram / email)
- Multi-parcela por usuario
- Histórico riegos exportable
- Comparativa de productos en recomendaciones (siguiente sprint)

---

## 2. Stack y dependencias externas

### 2.1 Frontend

- HTML + JS vanilla. Cero framework. Cero build step.
- Leaflet 1.9.4 (cargado lazy al abrir el panel de configuración).
- CSS inline en cada `*.html`. Variables CSS para tema.
- Almacenamiento: `localStorage`.

### 2.2 Backend serverless (Vercel Node functions)

| Endpoint | Función |
|---|---|
| `/api/sigpac` | Resuelve parcela SIGPAC oficial por lat/lon |
| `/api/sentinel` | OAuth2 CDSE + Statistics API para NDVI / NDMI |
| `/api/parcela` | Orquestador SIGPAC + Sentinel |
| `/api/waitlist` | Captura emails (landing y gate) |
| `/api/recomendacion` | Análisis IA (Gemini) — párrafo de contexto |
| `/api/recomendaciones-texto` | Reescritura IA de las recomendaciones — tono natural preservando cantidades |

### 2.3 Datos externos consumidos

| Fuente | Uso | Cuota |
|---|---|---|
| Copernicus Data Space | Sentinel-2 NDVI/NDMI | ~30k req/mes free |
| SIGPAC (MAPA) | Geometría oficial parcelas | Pública, sin clave |
| Open-Meteo | Meteo actual + previsión + ET₀ + humedad suelo | Pública, sin clave, sin cuota dura |
| Open-Meteo Geocoding | Búsqueda de ciudad → lat/lon | Pública |
| BigDataCloud Reverse Geocoding | GPS → nombre lugar | Free tier suficiente |
| Google Generative Language API | Gemini 2.5 Flash | Free tier mientras volumen sea bajo |

### 2.4 Despliegue

- Vercel conectado a GitHub `main` → auto-deploy en push.
- Variables de entorno: `GEMINI_API_KEY`, `CDSE_CLIENT_ID`, `CDSE_CLIENT_SECRET`, `RESEND_API_KEY`, `WAITLIST_FORWARD_EMAIL`.

---

## 3. IA en uso (hoy)

### 3.1 Modelo único

**`gemini-2.5-flash`** (Google) en ambos endpoints. Sin thinking tokens (`thinkingBudget: 0`) porque las tareas no requieren razonamiento profundo y queremos latencia baja.

### 3.2 Puntos de aplicación

| Endpoint | Input | Output | Latencia típica | Coste estimado |
|---|---|---|---|---|
| `/api/recomendacion` | Datos parcela (NDVI, NDMI, suelo, ET₀, días sin riego, meteo) | Párrafo libre 2-3 frases | 1-3 s | ~$0.0001 / llamada |
| `/api/recomendaciones-texto` | Lista de recomendaciones generadas por reglas + contexto | JSON: array `{id, titulo, detalle}` reescrito | 1-3 s | ~$0.0001-0.0002 / llamada |

### 3.3 Frecuencia de llamadas

- Por sesión de usuario: ~2-4 llamadas (al cargar y al refrescar). Coste total despreciable hoy.
- Frontend hace hash de candidatos para no llamar a `/api/recomendaciones-texto` si el conjunto no cambia.

### 3.4 Tono y reglas de los prompts

- Profesional, sobrio, tuteo neutro.
- Castellano peninsular.
- Sin siglas técnicas (NDVI/NDMI/ET₀), sin paternalismo, sin exclamaciones.
- Preservación estricta de cantidades numéricas y nombres de productos cuando se reescribe.
- Fallback silencioso si la API falla — siempre quedan los textos generados por reglas.

---

## 4. Decisiones técnicas relevantes (recientes)

- **Catálogo curado vs IA buscando productos** (2026-05-19): elegido **catálogo curado + IA selectora** sobre el catálogo. La IA puede inventar dosis, plazos o autorizaciones; el riesgo legal/agronómico es inaceptable en producción. La IA aporta donde aporta sin riesgo: razonamiento contextual sobre datos verificados.
- **Tono profesional en prompts** (2026-05-19): retirados los exclamativos y paternalismos. El usuario objetivo es un agricultor adulto profesional.
- **Lazy load de Leaflet** (2026-05-19): el mapa solo se carga al abrir el panel de configuración. Reduce LCP del primer paint.
- **Storage `kylia_riegos` migrado** (2026-05-19): de un único string `kylia_ultimo_riego` a un array `[{date, litros}]` con balance hídrico que detecta déficit residual.
- **`thinkingBudget: 0` en Gemini 2.5** (2026-05-19): sin thinking tokens. Las tareas son simples (redactar, decidir entre opciones cerradas). Ahorro de coste y latencia.

---

## 5. Próximos pasos inmediatos

### 5.1 Sprint actual — Comparativa de productos en recomendaciones

**Por qué.** Hoy cada recomendación de tratamiento o nutrición muestra una sola opción eco + una conv. El agricultor no puede decidir según presupuesto, plazo de seguridad, eficacia o tipo. Una comparativa real cambia mucho el valor agronómico.

**Plan acordado (Fase 1):**

1. `data/productos.json` — catálogo curado de **10-15 productos** verificados manualmente contra registro MAPA. Por producto: nombre, sustancia activa, tipo (eco/conv), dosis, plazo seguridad, eficacia (alta/media/baja), coste €/ha (rango), cultivos autorizados, plagas autorizadas.

2. Sustituir las cards eco/conv del panel expandido por **tabla comparativa**:
   - Filtros: tipo (eco/conv/todos), presupuesto máx, plazo máx.
   - Ordenable: barato / eco / plazo / eficacia.
   - Botón "Voy a usar este" → preferencia en `localStorage["kylia_preferencias_producto"]`.

3. Nuevo endpoint `/api/sugerencia-producto`:
   - Input: productos filtrados + contexto (cultivo, días estimados a cosecha, meteo).
   - Output: `{ idElegido, razonamiento }`.
   - Gemini elige el mejor producto **de la tabla dada** y razona en 1-2 frases. **No introduce productos nuevos.**

4. Disclaimer permanente: *"Lee siempre la etiqueta del producto antes de aplicar. Precios orientativos."*

**Tiempo estimado:** 2-3 horas.

### 5.2 Siguiente, después de validar la comparativa

- ✅ **Registro de aplicaciones** (2026-05-20): modal "He aplicado este" desde la tabla comparativa o entrada manual con campos libres. Storage `kylia_aplicaciones` con array de eventos.
- ✅ **Card "Tus últimas aplicaciones"**: lista las últimas 7 con producto, sustancia, dosis, cultivo, fecha. Badges automáticos de plazo de seguridad (rojo si activo, verde si ya libre).
- ✅ **Aviso proactivo en la card de "Acción del día"**: si hay aplicaciones con plazo vigente, aparece bloque rojo "No recolectar hasta DD/MM".
- ✅ **Exportación CSV**: botón en la card del historial — útil para cuaderno de explotación obligatorio.

---

## 6. Roadmap IA — aumentar uso

Aumentar la presencia de IA siempre **donde aporta sin introducir riesgo**. Tres ejes:

### 6.1 Eje *RAZONAMIENTO CONTEXTUAL* (bajo riesgo, alto valor)

Casos donde la IA recibe datos ya verificados y solo elige/explica. Ya en curso:

- ✅ Reescritura de recomendaciones (`/api/recomendaciones-texto`)
- ✅ Análisis global de la parcela (`/api/recomendacion`)
- 🔜 Selección de producto sobre catálogo curado (`/api/sugerencia-producto`)
- 🔜 Diagnóstico cuando NDVI baja sin causa clara: IA propone 2-3 hipótesis ordenadas por probabilidad (estrés hídrico vs plaga vs enfermedad fúngica vs nutricional)
- 🔜 Plan semanal: "Esta semana lo importante es X, Y, Z" — un resumen de 4-5 frases con todas las acciones recomendadas

### 6.2 Eje *INTERACCIÓN CONVERSACIONAL*

- 🔜 Chat con el agricultor: "Pregunta cualquier cosa sobre tu parcela". La IA tiene acceso a un *system prompt* con todos los datos actuales + histórico. Útil para preguntas tipo "¿es normal que el NDVI suba con el tomate en esta época?"
- 🔜 Reconocimiento visual: el agricultor sube foto de una hoja con síntoma. Gemini Vision identifica posible causa y sugiere mirar primero el catálogo curado. **Sin diagnóstico definitivo** — siempre con disclaimer.

### 6.3 Eje *AUTOMATIZACIÓN PROACTIVA* (mayor riesgo, requiere validación)

- 🔜 Resumen mensual generado por IA y enviado por email/Telegram.
- 🔜 Detección de anomalías: la IA compara la evolución NDVI vs años anteriores en parcelas similares de la zona y avisa si hay desviación.
- 🔜 Mediación con cooperativa: borrador automático de mensaje al técnico con los datos relevantes cuando la app detecta un problema agronómico.

---

## 7. Roadmap de modelos

### 7.1 Hoy

- Único: `gemini-2.5-flash` para todo.
- Razón: barato, rápido, suficiente para reescritura y razonamiento sobre datos dados.

### 7.2 Cuándo evaluar mejoras

- **Si la calidad de los textos se queda corta** (lenguaje plano, repeticiones, falta de matiz): probar `gemini-2.5-pro` solo en `/api/recomendacion`. Coste ~10× pero latencia y output significativamente mejores.
- **Si el chat conversacional entra en producción**: usar `gemini-2.5-pro` con `thinkingBudget` moderado para preguntas complejas; mantener `flash` para acciones simples.
- **Si se introduce visión** (foto de hoja): `gemini-2.5-flash` con input multimodal ya lo soporta. Si la precisión no es suficiente, evaluar `gemini-2.5-pro` o modelos especializados (PlantNet, fine-tunes propios).
- **Si llegamos a límites de cuota Google**: A/B probar Claude Haiku 4.5 (más barato, similar calidad para reescritura) y mantener Gemini para visión.

### 7.3 Indicadores para tomar decisiones

- Latencia P95 por endpoint (objetivo <3 s para reescritura, <2 s para selección).
- Tasa de fallback (>5 % = problema con prompts o modelo).
- Coste mensual total (objetivo <€5/mes mientras estemos por debajo de 500 usuarios activos).
- Feedback cualitativo en piloto: ¿el agricultor confía en lo que dice?

---

## 8. Deuda técnica y limitaciones conocidas

- **localStorage frágil.** Todo el histórico del agricultor (parcela, riegos, preferencias) está en su navegador. Si cambia de móvil pierde todo. **Resolver con Supabase Auth + Postgres.**
- **Sin tests automatizados.** Frontend y backend funcionan por inspección manual. Riesgo creciente conforme aumenta complejidad. Mínimo necesario: tests de balance hídrico, generación de recomendaciones y validación JSON de respuestas Gemini.
- **Eficacia de productos = valor cualitativo.** No hay número oficial. Curado por nosotros. Documentar criterio en el JSON del catálogo.
- **Sin observabilidad.** No registramos qué recomendaciones se generan, cuáles se aceptan, cuántas veces falla la IA. Añadir telemetría mínima (Vercel Analytics + log estructurado) antes del piloto público.
- **Sin caché de respuestas Gemini.** Cada apertura de la app reanaliza desde cero. Cachear por hash de inputs (cliente: localStorage; servidor: KV) reducirá costes cuando crezca el volumen.
- **Único usuario por navegador.** No hay concepto de "varias parcelas del mismo agricultor con distintos cultivos". Pendiente para multi-parcela.

---

## 9. Referencias internas

- Estado funcional vivo: memoria del proyecto en `~/.claude/projects/.../memory/project_estado_app.md`
- Arquitectura completa (devs/consultores): `docs/tecnico/arquitectura.md`
- Términos legales: `docs/legal-fuente/`
- Estrategia de mercado: `docs/negocio/go-to-market.md`
