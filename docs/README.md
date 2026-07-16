# Documentación Kylia

Este directorio agrupa toda la documentación interna del proyecto, organizada por área. La parte pública (legal, código, landing) vive fuera de aquí.

## Estructura

### `estrategia/` — Visión y diferenciación
- **`vision-y-roadmap.html`** — documento estratégico vivo: tesis, diferenciación frente a IAs generalistas y competencia sectorial, hoja de ruta a 5 años.
- **`Kylia-vision-y-roadmap.pdf`** — snapshot imprimible, generado con `scripts/build_estrategia_pdf.mjs`.
- **`anexo-2026-diferenciacion-y-escalado.md`** — anexo operativo: cliente arquetípico (Marc), reencuadre del eje competitivo (3 capas), agente IA como motor del producto, escenarios futuros y opcionalidad estratégica, path realista a enterprise.

### `tecnico/` — Cómo está construido Kylia

**Referencia técnica completa y actual (2026-07, escrita desde el código real) — empieza aquí:**
- **`00-panorama-tecnico.md`** — documento maestro: qué es Kylia, stack, topología, fuentes de datos, variables de entorno, la frontera honesta por subsistema, despliegue. Índice de los demás.
- **`01-modelo-de-datos.md`** — las 7 tablas Postgres reales (base + ALTERs), el trigger append-only, convenciones de `acciones`, y qué hace cada fichero SQL.
- **`02-motores-agronomicos.md`** — los cinco motores puros: riego FAO-56, nutrición (balance de masa), cuaderno €/PAC, oferta de suelo por satélite (SoilGrids), y el reveal, con fórmulas.
- **`03-referencia-api.md`** — cada endpoint serverless: routers (`log`, `campo`, `ia`), crons (`diario-b`, `recordatorio-wizard`), satélite (`sentinel`), SIGPAC, informe.
- **`04-piloto-silencioso-y-reveal.md`** — el circuito de extremo a extremo: alta → registro → congelado nocturno → reveal, y cómo verificarlo en vivo.
- **`dossier.md`** — documento de una sentada: qué es, en base a qué se toma cada recomendación (FAO-56, balance de masa, SoilGrids, NDRE), la frontera honesta, el método de prueba (reveal) y la defensibilidad. Destila la serie `0x-` sin el detalle de implementación.

**Profundizaciones** (deep-dives que la serie `0x-` enlaza; siguen vigentes):
- **`fase-2-integracion-mapa.md`** — diseño de la integración con el dump oficial MAPA (Fase 2, pendiente de implementación).
- **`motor-de-decision.md`** — referencia del motor agronómico: datos, cálculos FAO-56 del riego, estado de validación honesto por modelo.
- **`shadow-log-recomendaciones.md`** — cómo una recomendación pasa a ser texto en Supabase (registro silencioso) + el cron Diario B.
- **`generador-reveal.md`** — el informe final del piloto: cruza lo que Kylia decidió vs lo que el agricultor hizo (4 dimensiones de /piloto), € solo en agua.
- **`runbook-piloto-silencioso.md`** — pasos operativos para activar los pilotos silenciosos y montar el campo del padre, dejándolo todo registrado.
- **`dossier-tecnico.pdf`** — versión imprimible para enseñar a un CTO o a un partner técnico.
- **`validacion-nutricion.md`** — validación del motor de fertilizantes contra la Guía de fertilización de MAPA: coeficientes de extracción (9/9 en rango), estructura del balance (= método oficial), y el modelo de N del suelo (sobreestima ×2,4 → recalibrar a la Tabla 4.2).
- **`historico/`** — snapshots superados por la serie `0x-` (`arquitectura.md`, `estado-y-roadmap.md`), conservados por su detalle de costes/DR/roadmap.

### `negocio/` — Estrategia y captación de capital
- **`dossier-mercado.md`** — documento de una sentada: mapa de mercado (cliente arquetípico, geografía), tamaño (anclajes oficiales INE/MAPA + embudo TAM/SAM/SOM etiquetado), diferenciación (las 3 capas + mapa competitivo) y tracción real (pilotos, primer resultado, estado honesto). Pareja de `tecnico/dossier.md`.
- **`go-to-market.md`** — plan de lanzamiento, segmentos prioritarios, canales y métricas de éxito.
- **`Presentacion_Kylia.pdf`** — presentación corta de Kylia.
- **`dossier-inversores.pdf`** — pitch deck en PDF para enviar a fondos / business angels.

### `marketing/` — Captación directa y outreach
- **`emails/`** — plantillas de bienvenida y de outreach a perfiles piloto (asesor ATRIA, centro de investigación, cooperativa).
- **`guion-llamada-piloto.md`** — guion para llamadas de captación de piloto.
- **`lista-pilotos-targets.md`** — lista de contactos objetivo para el piloto.

### `legal-fuente/` — Fuentes de los textos legales
Los `.md` aquí se compilan a HTML con `scripts/build_legal.py` y se publican en `/legal/*` en la landing.

## Convenciones

- Los `.md` son el documento vivo; los `.pdf` son snapshots imprimibles.
- Los marcadores `[REVISAR]` en cualquier doc indican secciones que requieren validación humana antes de publicar.
