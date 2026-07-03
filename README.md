# Kylia

Monitorización agronómica por satélite para parcelas SIGPAC.
Vigor del cultivo (NDVI), humedad (NDMI) y recomendación de riego — sin sensores, sin formación, sin €/ha lineal.

**Stack**: HTML + JS vanilla en frontend · Vercel serverless functions en backend · Sentinel-2 (Copernicus DataSpace) + SIGPAC + DWD ICON / Open-Meteo como fuentes de datos. Postgres (Supabase) cuando entre la auth.

---

## Estructura del repositorio

```
kylia-1/
│
│ ── Web pública (servida por Vercel) ──
├── index.html              Landing comercial (URL: /)
├── precios/
│   └── index.html          Pricing (URL: /precios)
├── cooperativas/
│   └── index.html          Landing B2B coops (URL: /cooperativas)
├── blog/
│   └── index.html          Blog SEO (URL: /blog) — artículos próximamente
├── 404.html                Página de error
├── robots.txt              SEO — bots
├── sitemap.xml             SEO — URLs indexables
│
│ ── Producto ──
├── app/
│   └── index.html          Producto (URL: /app)
│
│ ── Backend ──
├── api/                    Serverless Functions (Vercel/Node)
│   ├── waitlist.js         POST captura de leads pre-launch
│   ├── sigpac.js           Lookup SIGPAC por lat/lon
│   ├── sentinel.js         OAuth Copernicus + Statistics API
│   └── parcela.js          Orquestador (sigpac + sentinel + interpretación)
├── db/
│   └── schema.sql          Esquema Postgres (Supabase) con RLS
│
│ ── Estáticos ──
├── assets/
│   └── img/                og-image, mockups y screenshots del producto
│
│ ── Páginas legales ──
├── legal/                  HTML compilado (RGPD-compliant)
│   ├── index.html
│   ├── terminos/index.html
│   ├── privacidad/index.html
│   ├── cookies/index.html
│   └── dpa-enterprise/index.html
│
│ ── Documentación interna ──
├── docs/                   Ver docs/README.md
│   ├── tecnico/            Arquitectura y dossier técnico
│   ├── negocio/            Go-to-market, dossier inversores y presentación
│   ├── legal-fuente/       Fuentes .md de las páginas legales (compiladas por scripts/build_legal.py)
│   └── marketing/          Redes, Telegram, emails y calendario editorial
│       └── contenido/
│           ├── semana-1/
│           │   ├── plan.md       Textos + instrucciones de publicación
│           │   └── imagenes/     PNGs y SVGs listos para publicar
│           └── semana-2/
│               ├── plan.md
│               └── imagenes/
│
│ ── Scripts ──
├── scripts/
│   └── build_legal.py      Compila docs/legal-fuente/*.md → legal/*/index.html
│
│ ── Configuración del repo ──
├── vercel.json             Deploy config + headers + rewrites + redirects
├── README.md               Este archivo
├── LICENSE                 Software propietario
└── .gitignore
```

## Modelo de negocio

| Tier | Precio | Para |
|---|---|---|
| Free | 0 € · hasta 30 ha · 2 parcelas | Captación, huertos familiares |
| Productor | desde 99 €/año (€/ha decreciente) | Agricultor profesional |
| Cooperativa | 2.900 / 5.900 / 11.900 €/año (paquete) | ADV, ATRIA, cooperativas |
| Enterprise | desde 30.000 €/año | Aseguradoras, banca rural, administración |

Productor: mínimo 99 €/año hasta 100 ha, +0,40 €/ha hasta 500 ha, +0,20 €/ha hasta 2.000 ha. Cooperativa: paquete cerrado por tamaño (Esencial 200 socios, Profesional 600 socios, Avanzado 2.000 socios). Garantía de devolución 60 días.
Detalle en [/precios](https://kylia.app/precios) y [/cooperativas](https://kylia.app/cooperativas).

## Desarrollo local

Requisitos: Node ≥ 18.

```bash
# Servir landing estática
npx serve .                          # http://localhost:3000

# Servir landing + funciones serverless
npx vercel dev                       # http://localhost:3000 con /api/*
```

Variables de entorno (`.env.local`):

```
# Copernicus DataSpace (gratis tras registro en dataspace.copernicus.eu)
SH_CLIENT_ID=
SH_CLIENT_SECRET=

# Supabase (cuando entre la auth)
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Stripe (cuando entren los planes Pro)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Resend (email transaccional)
RESEND_API_KEY=
```

## Endpoints públicos

| Endpoint | Método | Params | Devuelve |
|----------|--------|--------|----------|
| `/api/waitlist` | POST | `{ email, origen }` | `{ ok: true }` |
| `/api/sigpac` | GET | `lat`, `lon` | geometría parcela WGS84 |
| `/api/sentinel` | GET | `geometry`, `days` | NDVI, NDMI, fecha |

## Deploy

`git push origin main` despliega automáticamente en Vercel. El dominio de producción es `kylia.app` (cuando esté registrado y configurado).

PR previews automáticas en cada Pull Request.

## Tareas abiertas (orden de prioridad)

1. Registrar dominio `kylia.app` y conectar a Vercel.
2. Crear cuentas: LinkedIn empresa, Telegram canal, Beehiiv newsletter, Cloudflare DNS.
3. Implementar auth con Supabase + persistir parcelas en BD.
4. Cron semanal de alertas (Vercel Cron + Resend).
5. Stripe Billing en planes Pro 100 / Pro 500.
6. Bot Telegram `@kylia_alertas_bot` para alertas push.

Detalle en [`docs/tecnico/arquitectura.md`](docs/tecnico/arquitectura.md). Índice completo de documentación en [`docs/README.md`](docs/README.md).

## Licencia

Software propietario. Ver [`LICENSE`](LICENSE).

## Contacto

Martí Carol · marticarol003@gmail.com
