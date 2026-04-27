# Kylia

Monitorización agronómica por satélite para parcelas SIGPAC.
Vigor del cultivo (NDVI), humedad (NDMI) y recomendación de riego — sin sensores, sin formación, sin €/ha lineal.

**Stack**: HTML + JS vanilla en frontend · Vercel serverless functions en backend · Sentinel-2 (Copernicus) + DWD ICON + SIGPAC como fuentes de datos.

## Estructura del repositorio

```
kylia-1/
├── index.html              Landing comercial
├── app.html                Producto (vista parcela)
├── 404.html                Error page
├── robots.txt              SEO
├── sitemap.xml             SEO
├── og-image.png            Open Graph (en root para previsualizaciones)
├── vercel.json             Configuración deploy + headers
├── api/                    Vercel Serverless Functions
│   ├── waitlist.js         POST captura de leads
│   ├── sigpac.js           Proxy SIGPAC
│   └── sentinel.js         Proxy Sentinel Hub Processing API
├── assets/
│   └── img/                Mockups del producto
└── docs/
    ├── inversores.pdf      One-pager para inversores
    ├── tecnico.pdf         Resumen técnico
    ├── go-to-market.md     Plan 90 días
    ├── social-media.md     Estrategia de contenido (sin cara del fundador)
    └── telegram-leads.md   Captación en Telegram + canales verificados
```

## Modelo de negocio

| Tier | Precio | Para |
|---|---|---|
| Free | 0 € · hasta 20 ha | Captación |
| Pro | 19 €/mes (≤100 ha) · 49 €/mes (≤500 ha) | Agricultor profesional |
| Cooperativa | 6.000 / 12.000 / 24.000 €/año | ADV, ATRIA, cooperativas |
| Enterprise | desde 25.000 €/año | Aseguradoras, banca rural, administración |

Tarifas planas por tramo, nunca €/ha lineal.

## Desarrollo local

```bash
npx serve .          # sirve la landing estática en :3000
vercel dev           # arranca también las funciones de /api
```

Variables de entorno necesarias en `.env.local`:

```
SENTINEL_HUB_CLIENT_ID=
SENTINEL_HUB_CLIENT_SECRET=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

## Deploy

`git push` a `main` despliega automáticamente en Vercel. La configuración vive en `vercel.json`.

## Contacto

Martí Carol · marticarol003@gmail.com
