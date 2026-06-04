# Shadow log: cómo una recomendación de Kylia se convierte en texto en Supabase

> Documenta el camino completo de una decisión del motor hasta una fila en la tabla
> `recomendaciones_log` de Supabase — el registro silencioso "lo que Kylia habría
> recomendado, nunca visible al agricultor" que alimenta el reveal del piloto.
>
> Relacionado: [`motor-de-decision.md`](motor-de-decision.md) (cómo se decide),
> [`../estrategia/validacion-laboratorio-vs-sombra.md`](../estrategia/validacion-laboratorio-vs-sombra.md) §4 (por qué debe ser inalterable).
> Última actualización: 2026-06-04.

---

## 1. El camino, de un vistazo

```
generarRecomendaciones()        reglas → objetos {titulo, detalle, prioridad, prod...}
        │  (app/index.html)
        ▼
enviarRecomendacionesAlLog(recs) arma el texto + metadatos + contexto, dedupe diario
        │  app/index.html:4252
        ▼
window.kyliaSync.recomendacionesLog(payload, contexto)
        │  app/index.html:119  →  POST /api/log {recurso:"recomendaciones-log"}
        ▼
handleRecomendacionesLog()       valida y normaliza cada fila
        │  api/log.js:258
        ▼
supabaseInsert("recomendaciones_log", filas)
        │  api/log.js:292
        ▼
tabla recomendaciones_log        una fila por recomendación  (db/schema.sql:40)
```

**Punto clave:** el log se construye en el paso `generarRecomendaciones()` →
`enviarRecomendacionesAlLog(recs)`, que ocurre en `renderRecomendaciones()`
(`app/index.html:4304-4306`) **antes** de la reescritura con IA
(`cargarRecomendacionesIA`, 4309). Es decir, **se guarda el texto determinista de las
reglas, no la prosa de Gemini.** La IA solo cambia lo que se *muestra* en pantalla, en
segundo plano; el registro auditable se queda con la regla.

---

## 2. De objeto a texto: el mapeo exacto

`generarRecomendaciones()` devuelve, por cada recomendación, un objeto con (entre otros)
`titulo`, `detalle`, `prioridad`, `catClass` (`riego`/`tratamiento`/`nutricion`), `id` y
`prod` (producto del catálogo, si aplica). `enviarRecomendacionesAlLog` lo transforma así
(`app/index.html:4274-4293`):

| Campo en Supabase | De dónde sale | Ejemplo |
|---|---|---|
| `texto` | **`[titulo, detalle].join(". ")`** — el texto de la regla | `"Regar hoy ~26 L/m². Déficit de 23 mm ≥ umbral 20."` |
| `tipo` | de `catClass` (whitelist `riego`/`tratamiento`/`nutricion`) | `riego` |
| `cantidad_l_m2` | regex `(\d+) L/m` sobre el título | `26` |
| `nivel` | de `prioridad` (≤2 → `alta`, =3 → `media`, resto → `baja`) | `alta` |
| `producto_id` / `producto_nombre` / `dosis` | de `prod` (catálogo MAPA), si es tratamiento/nutrición | `null` en riego |
| `contexto` (jsonb) | snapshot del estado: NDVI/NDMI, suelo, Tªmáx, humedad, lluvia 3 d, último riego, cultivos, modo | `{ndvi:…, temp_max:…, ultimo_riego:…}` |

Así, **el "texto" es literalmente el título + el detalle de la tarjeta de
recomendación**, concatenados. La trazabilidad (por qué se decidió eso) viaja aparte en
`contexto`.

> Nota: en la demo y el reveal generados por el motor (`db/seed-demo-piloto.sql`) el
> `contexto` lleva las variables del balance FAO-56 (`et0, lluvia, kc, etc, Dr, RAW`).
> En producción hoy el `contexto` lleva el snapshot de pantalla de la tabla anterior.
> Conviene **unificarlo** para que toda fila guarde el balance que justificó la decisión.

---

## 3. Validación en el backend

`handleRecomendacionesLog` (`api/log.js:258`) antes de insertar:
- exige `usuario_id` con forma de UUID;
- acepta `tipo` solo si está en `{riego, tratamiento, nutricion}` (si no → `riego`);
- acepta `nivel` solo si está en `{alta, media, baja}` (si no → `null`);
- recorta `texto` a 500 caracteres y `numOrNull` sobre las cantidades;
- si Supabase no está configurado, responde `{persisted:false}` sin romper.

Luego `supabaseInsert("recomendaciones_log", filas)` hace el INSERT vía la REST API de
Supabase con la `service_role` (servidor, nunca el navegador).

---

## 4. Dedupe y cuándo se dispara

- **Una vez al día por contenido:** `enviarRecomendacionesAlLog` calcula un hash
  `id|titulo|prioridad …@YYYY-MM-DD` y lo guarda en `sessionStorage`
  (`app/index.html:4255-4258`); si no cambió, no reenvía.
- **Se dispara al renderizar** las recomendaciones, es decir, **cuando el agricultor abre
  la app**.

---

## 5. El Diario B: congelado en servidor (cron `/api/diario-b`)

El camino del §1 solo escribe **cuando el agricultor abre la app** → en sombra silenciosa
deja huecos. Para cerrarlos existe el cron **`/api/diario-b.js`** (Vercel, diario ~06:00 UTC,
"primera hora con la previsión del día"). Por cada piloto con coordenadas:
1. baja el clima del día (ET₀ + lluvia, Open-Meteo);
2. lee sus **riegos reales** de `acciones`;
3. reconstruye el balance FAO-56 con el **mismo motor que la app** (`api/_motor-riego.js`,
   importado también por… *pendiente: que el frontend consuma este módulo en vez de su copia
   inline — hoy son código gemelo verificado, no el mismo fichero*);
4. **congela** la decisión de hoy en `recomendaciones_log` con `fecha` = la fecha de la
   decisión (no `now()`) y `contexto` con el balance (`et0, lluvia, kc, Dr, RAW, TAW`).

**Seguridad:** corre en **DRY-RUN por defecto** (calcula y loguea, no escribe). Solo
persiste con `DIARIO_B_LIVE=1` en entorno. Test manual: `GET /api/diario-b?dry=1`. Dedupe
diario por servidor (`yaCongelado`: ¿hay fila de riego para ese usuario hoy?).

Qué resuelve respecto a la lista anterior:
- ✅ **Congelado diario sin retrovisor** (cron, ET₀ observada + previsión de hoy).
- ✅ **`fecha` = fecha de la decisión** (explícita, no el insert).
- ✅ **Dedupe en servidor** (`yaCongelado`), no en `sessionStorage`.
- ✅ **`contexto` con el balance FAO-56** en cada fila.

Pendiente para que sea **inalterable de verdad** ante un evaluador:
- **Append-only a nivel de BD**: revocar update/delete sobre `recomendaciones_log` (políticas
  RLS o permisos), para que ni siquiera el servicio pueda reescribir la historia.
- **Filtro de pilotos**: hoy procesa todo usuario con lat/lon; antes de `LIVE` conviene
  marcar quién es piloto silencioso (flag en `usuarios`/`preferencias`).
- **Unificar el motor**: que el frontend importe `api/_motor-riego.js` en lugar de su copia
  inline (eliminar el riesgo de que deriven).
