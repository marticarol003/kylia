# Legal · documentos fuente

Estos `.md` son la **fuente de verdad** de los documentos legales que se publican en `kylia.app/legal/*`.

## Cómo se publican

Los `.md` de esta carpeta se convierten a HTML estilado (con la cabecera/footer del sitio, índice automático, enlaces relacionados, metadatos OG) mediante el script `scripts/build_legal.py`.

Los HTML resultantes viven en `/legal/{slug}/index.html` y son los que sirve Vercel.

## Flujo de actualización

1. Editar el `.md` correspondiente en `docs/legal-fuente/`.
2. Ejecutar el build (cuando exista el script):
   ```bash
   python3 scripts/build_legal.py
   ```
3. Verificar el HTML generado en `legal/{slug}/index.html`.
4. Si hay cambios en el flujo de tratamiento de datos o en los términos contractuales, **antes de hacer commit** pasarlo por el abogado (marcadores `[REVISAR]`).
5. Commit y push — Vercel despliega automáticamente.

## Documentos

| Slug              | Tipo                | URL pública                          |
| ----------------- | ------------------- | ------------------------------------ |
| `terminos`        | Contrato            | `/legal/terminos`                    |
| `privacidad`      | RGPD art. 13/14     | `/legal/privacidad`                  |
| `cookies`         | LSSI-CE art. 22.2   | `/legal/cookies`                     |
| `dpa-enterprise`  | RGPD art. 28        | `/legal/dpa-enterprise`              |

## Marcadores

- `[REVISAR]` — sección que requiere validación de un abogado antes de publicar.
- Las cifras de planes (precios, tramos de hectáreas) deben coincidir con `index.html`, `precios/index.html` y `cooperativas/index.html`.
