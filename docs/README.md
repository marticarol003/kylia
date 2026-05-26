# Documentación Kylia

Este directorio agrupa toda la documentación interna del proyecto, organizada por área. La parte pública (legal, código, landing) vive fuera de aquí.

## Estructura

### `estrategia/` — Visión y diferenciación
- **`vision-y-roadmap.html`** — documento estratégico vivo: tesis, diferenciación frente a IAs generalistas y competencia sectorial, hoja de ruta a 5 años.
- **`Kylia-vision-y-roadmap.pdf`** — snapshot imprimible, generado con `scripts/build_estrategia_pdf.mjs`.
- **`anexo-2026-diferenciacion-y-escalado.md`** — anexo operativo: cliente arquetípico (Marc), reencuadre del eje competitivo (3 capas), agente IA como motor del producto, escenarios futuros y opcionalidad estratégica, path realista a enterprise.

### `tecnico/` — Cómo está construido Kylia
- **`arquitectura.md`** — diagrama Mermaid del sistema, decisiones de stack (Vercel + Supabase + Copernicus), costes mensuales estimados, plan de disaster recovery.
- **`estado-y-roadmap.md`** — estado funcional actual y siguientes pasos técnicos.
- **`fase-2-integracion-mapa.md`** — diseño de la integración con el dump oficial MAPA (Fase 2, pendiente de implementación).
- **`dossier-tecnico.pdf`** — versión imprimible para enseñar a un CTO o a un partner técnico.

### `negocio/` — Estrategia y captación de capital
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
