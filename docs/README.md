# Documentación Kylia

Este directorio agrupa toda la documentación interna del proyecto, organizada por área. La parte pública (legal, código, landing) vive fuera de aquí.

## Estructura

### `tecnico/` — Cómo está construido Kylia
- **`arquitectura.md`** — diagrama Mermaid del sistema, decisiones de stack (Vercel + Supabase + Copernicus), costes mensuales estimados, plan de disaster recovery.
- **`dossier-tecnico.pdf`** — versión imprimible para enseñar a un CTO o a un partner técnico.

### `negocio/` — Estrategia y captación de capital
- **`go-to-market.md`** — plan de lanzamiento, segmentos prioritarios, canales y métricas de éxito.
- **`dossier-inversores.pdf`** — pitch deck en PDF para enviar a fondos / business angels.

### `marketing/` — Comunicación y captación de leads
- **`social-media.md`** — estrategia de redes sin cara del fundador, tono y formatos.
- **`telegram-leads.md`** — guion del canal de Telegram, tipos de mensaje y flujo de captación.
- **`emails/`** — plantillas transaccionales y de newsletter (variables tipo `{{nombre}}`, `{{ndmi}}`).
- **`contenido/`** — calendario editorial semana a semana, con sub-carpetas `imagenes/` que contienen los SVG fuente y los PNG ya rasterizados listos para publicar.

## Convenciones

- Los `.md` son el documento vivo; los `.pdf` son snapshots imprimibles.
- Las imágenes de redes se generan en SVG (1080×1080 cuadrado, 1080×1350 vertical, 1200×400 banner) y se rasterizan a PNG con `cairosvg`.
- Los marcadores `[REVISAR]` en cualquier doc indican secciones que requieren validación humana antes de publicar.
