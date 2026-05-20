# Fase 2 — Integración con el registro MAPA

Documento de diseño. **No implementado todavía.** Se aborda cuando la Fase 1 (catálogo curado + tabla comparativa + sugerencia IA) esté validada con piloto real.

---

## 1. Motivación

Fase 1 entrega valor con un catálogo curado a mano (`data/productos.json`, ~15 productos para hortícolas españolas). Es la opción correcta para empezar: cero riesgo de alucinación, datos verificables, sin latencia ni coste API por navegación.

El límite es la cobertura. Cuando el piloto se extienda a más cultivos (cereales, olivar, viña, frutales) hará falta:

- **Cientos de productos**, no decenas
- **Actualización continua** (productos que pierden autorización, nuevas formulaciones)
- **Verificación oficial** del nº de registro MAPA en cada producto

La Fase 2 cubre estas necesidades sin entrar en el escenario "IA inventa productos" que descartamos.

---

## 2. Lo que aporta el registro MAPA (y lo que no)

### Datos que sí están en el registro oficial

- Número de registro y validez actual
- Sustancia activa y formulación
- Cultivos autorizados (lista cerrada)
- Plagas/enfermedades autorizadas para ese cultivo
- Plazo de seguridad oficial
- Dosis autorizadas (mínima y máxima)
- Categoría toxicológica
- Condicionantes (polinizadores, fauna acuática, etc.)
- Fecha de caducidad de la autorización

### Datos que NO están en el registro oficial

- **Precios** (no lo regula el MAPA — vienen de distribuidores/cooperativas)
- **Eficacia numérica** (no hay valor oficial — solo "autorizado para")
- **Marcas comerciales agregadas** (cada formulación tiene su propio nº de registro, hay miles)
- **Reseñas de uso** (foros y experiencia profesional, fuera del MAPA)

### Implicación de diseño

Tras la integración MAPA, el catálogo seguirá teniendo **dos capas**:

1. **Capa oficial (MAPA)** — autorizaciones, dosis, plazo, validez. Refrescada periódicamente.
2. **Capa curada (nuestra)** — precios estimados (rango), eficacia cualitativa (A/M/B con criterio documentado), notas agronómicas. Curada manualmente y revisable por panel agronómico.

La sugerencia IA seguirá funcionando como hoy: razona sobre la tabla que recibe, no inventa. Solo crece la tabla.

---

## 3. Opciones técnicas para obtener los datos MAPA

El MAPA **no expone API JSON pública** del registro de fitosanitarios. Las opciones realistas, ordenadas por preferencia:

### Opción A — Dump CSV/Excel oficial *(preferida)*

El MAPA publica periódicamente listados completos en formato Excel:
- https://www.mapa.gob.es/agricultura/pags/fitos/registros/productos/consulta.asp

**Pros**: dato oficial, formato estructurado, bajo riesgo de bloqueo.
**Contras**: requiere descarga manual o automatizada del Excel; no hay endpoint estable que apunte siempre al "último listado".

**Cómo abordarlo**: cron semanal que (a) descarga el Excel, (b) lo convierte a JSON con `xlsx` o `exceljs`, (c) normaliza nombres y campos, (d) guarda en `data/productos-mapa.json` versionado en el repo.

### Opción B — Scraping del buscador HTML

El buscador web del registro (https://www.mapa.gob.es/.../consulta.asp) acepta filtros por cultivo, sustancia, plaga, etc., y devuelve resultados paginados en HTML.

**Pros**: granular (puedes pedir "todos los autorizados para tomate × pulgón").
**Contras**: parsing HTML frágil; si cambian la maquetación se rompe; cuotas implícitas (pueden bloquear IPs que hagan muchas requests).

### Opción C — datasets en datos.gob.es

Hay datasets agrupados en https://datos.gob.es/es/catalogo?q=fitosanitarios. Calidad variable y desactualización frecuente. Útil como complemento, no como fuente principal.

### Opción D — APIs de terceros (pago)

Servicios como Agroptima, Hispatec, etc. tienen APIs comerciales que agregan el registro MAPA. Coste recurrente significativo. Solo tendría sentido si el equipo no quiere mantener la pipeline de la Opción A.

---

## 4. Arquitectura propuesta

```
                 ┌──────────────────────────────────┐
                 │ Cron semanal (Vercel Cron)       │
                 │ scripts/sync-mapa-fitos.js       │
                 │                                  │
                 │ 1. Descarga el Excel del MAPA    │
                 │ 2. Convierte a JSON normalizado  │
                 │ 3. Compara contra versión anterior│
                 │ 4. Commit + push al repo         │
                 └──────────┬───────────────────────┘
                            │
                            ▼
                 ┌──────────────────────────────────┐
                 │ data/productos-mapa.json         │
                 │ (versionado en el repo)          │
                 └──────────┬───────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│ /api/productos-comparar  (extensión del actual)         │
│                                                          │
│ Para cada plaga/cultivo:                                 │
│  1. Consulta data/productos-mapa.json                    │
│  2. Cruza con data/productos.json (capa curada)          │
│     → precios, eficacia, notas                           │
│  3. Devuelve unión: productos oficiales enriquecidos     │
│     con datos comerciales                                │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
                 ┌──────────────────────────────────┐
                 │ Frontend (tabla comparativa)     │
                 │ Badge "✓ MAPA · nº registro"    │
                 │ Link a la ficha oficial          │
                 └──────────────────────────────────┘
```

---

## 5. Plan de implementación (cuando se aborde)

### Hito 1 — Pipeline de ingesta

- `scripts/sync-mapa-fitos.js` que descarga el Excel (URL parametrizada en `MAPA_LISTADO_URL`).
- Parser con `xlsx` o `exceljs`.
- Normalización de campos: minúsculas, sin acentos en claves, sustancia activa estandarizada, mapeo cultivo→IDs internos, mapeo plaga→IDs internos.
- Output: `data/productos-mapa.json`.
- Cron: GitHub Action semanal (no Vercel Cron, porque queremos commit al repo). Alternativa: Vercel Cron + KV.

### Hito 2 — Capa de enriquecimiento

- Por cada producto MAPA, buscar match en `data/productos.json` por sustancia activa.
- Si hay match: añadir `costeMin`, `costeMax`, `eficacia`, `notas` del catálogo curado.
- Si no hay match: el producto sale en la tabla pero con `eficacia: "no evaluado"` y precio como rango orientativo por sustancia activa.

### Hito 3 — Endpoint extendido

- `GET /api/productos-comparar?cultivo=X&plaga=Y&tipo=eco` devuelve la tabla unida.
- Caché en memoria del worker, TTL 24 h.

### Hito 4 — Frontend

- Tabla comparativa: nuevo badge **"✓ MAPA · nº 12345/01"** clicable, abre la ficha oficial.
- Filtro adicional "Solo verificados MAPA" (por defecto activo).
- Disclaimer actualizado: *"Datos sincronizados del registro oficial MAPA (versión XX/XX/2026). Precios orientativos curados por Kylia."*

---

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El MAPA cambia formato del Excel | Test de schema en cada sync; alerta a mantenedor si falla |
| Cambio de URL del Excel | Variable de entorno + script de descubrimiento si falla |
| Producto retirado entre syncs | Marca "validez hasta DD/MM" en cada entrada; tabla descarta los caducados |
| Sobrecarga de la base curada | La capa curada solo cubre productos top usados; el resto se muestra sin enriquecimiento (transparente al usuario) |
| Coste de almacenamiento | El JSON completo del registro español pesa ~5-10 MB. Servido como estático desde el repo, cero coste extra |

---

## 7. Cuándo abordar la Fase 2

Indicadores que justifican empezar:

- Más de 3 cultivos en uso real (más allá de hortícolas)
- Petición explícita de pilotos: "no aparece el producto que uso"
- Crecimiento del catálogo curado más allá de 50-60 productos (mantener a mano se vuelve doloroso)
- Necesidad de mostrar el nº de registro oficial al usuario por cuestiones regulatorias

Mientras tanto, **mantener el catálogo curado** ampliándolo a 30-40 productos cuando entren cultivos nuevos.

---

## 8. Trabajo previo necesario

Antes de empezar la Fase 2:

- Confirmar URL/endpoint estable del Excel MAPA (revisión en cada sprint).
- Decidir esquema final de IDs internos para plagas y cultivos (hoy: `pulgon`, `mosca_blanca`, `mildiu`, `oidio`, `arana_roja`, `oruga_col`). Si se amplía a otros cultivos hace falta extender.
- Política de versionado del JSON sincronizado: si rompe schema, ¿cómo hace rollback el frontend?
