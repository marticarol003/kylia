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

Estado de los guardarraíles:
- ✅ **Append-only a nivel de BD**: `db/diario-b-produccion.sql` instala un trigger que bloquea
  UPDATE/DELETE en `recomendaciones_log` (para cualquier rol, incluida la service_role).
- ✅ **Filtro de pilotos**: el cron solo procesa usuarios con `piloto_sombra=true` (columna nueva
  del mismo SQL). Seguro por defecto: sin pilotos marcados, congela cero.
- ⏳ **Unificar el motor**: el frontend (`app/index.html`) aún usa su copia inline del balance,
  no importa `api/_motor-riego.js`. Hoy son **gemelos verificados**; aplazado a propósito (es un
  refactor del app monolítico, arriesgado sin test end-to-end). Deuda técnica conocida.

---

## 6. Runbook de activación (dry-run → producción)

El cron ya está desplegado en **dry-run** (calcula y loguea, no escribe). Para activarlo:

1. **Limpia datos de prueba** si cargaste `db/seed-demo-piloto.sql` (antes del paso 2, que
   sella la tabla):
   `delete from recomendaciones_log where usuario_id = '7c1e9a04-2b6f-4d8a-9f10-3a5e7c0b1d22';`
2. **Ejecuta `db/diario-b-produccion.sql`** en el SQL Editor de Supabase (flag `piloto_sombra`
   + trigger append-only).
3. **Marca los pilotos** reales:
   `update usuarios set piloto_sombra = true where email = '…';`
   Verifica que cada uno tiene `lat/lon`, `cultivos`, `suelo` y `fecha_plantacion`.
4. **Prueba en seco** sin escribir: `GET /api/diario-b?dry=1` → revisa que devuelve las
   decisiones esperadas de esos pilotos.
5. **Activa la escritura**: en Vercel, `DIARIO_B_LIVE=1` (y `DIARIO_B_TOKEN=<secreto>` para
   proteger el endpoint). El cron de las 06:00 UTC empezará a congelar.
6. **Comprueba** al día siguiente que hay una fila por piloto en `recomendaciones_log` con
   `contexto.fuente = "diario-b"` y `fecha` = ese día.

Revertir: `DIARIO_B_LIVE` fuera (vuelve a dry-run) y/o `drop trigger trg_reclog_append_only …`.
