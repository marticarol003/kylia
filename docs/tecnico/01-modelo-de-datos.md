# Kylia — Modelo de datos

> Última actualización: **2026-07-12**. Fuente: `db/schema.sql` + todos los ALTERs
> aplicados en `db/*.sql`. El esquema **vivo** en Supabase es la base + los ALTERs;
> `schema.sql` por sí solo está incompleto.

Supabase Postgres, accedido vía PostgREST con la service key. Siete tablas base;
la tabla `usuarios` ha crecido por ALTERs idempotentes conforme entraban los
pilotos. Cada tabla se corresponde con un `recurso` de `api/log.js`.

---

## 1. `usuarios` — ficha del piloto/parcela

Una fila por campo. Es el objeto central: casi todo cuelga de su `id` (UUID
generado en el cliente y guardado en `localStorage`).

**Columnas base** (`schema.sql`): `id uuid PK`, `email`, `nombre`, `telefono`,
`lat`, `lon`, `ciudad`, `cultivos text[]`, `cultivos_secundarios text`,
`parcela jsonb`, `tarifa_agua`, `metodo_riego`, `manejo`, `origen`,
`preferencias jsonb`, `ua`, `fecha_alta`.

**Columnas añadidas por ALTER** (esquema real, no en `schema.sql`):

| Columna | Tipo | Para qué |
|---|---|---|
| `suelo` | text | `arenoso`/`franco`/`arcilloso` → AWC del balance FAO-56 |
| `fecha_plantacion` | date | Día 0 de la fenología (Kc, raíz creciente) |
| `caudal` | numeric | Pluviometría del emisor (mm/h = L/m²·h); convierte horas ↔ mm |
| `area_m2` | numeric | Superficie; escala mm ↔ litros y regaderas |
| `capacidad_regadera` | numeric | Litros por regadera (riego manual) |
| `piloto_sombra` | boolean | `true` → piloto silencioso: Kylia calla, diario-b congela |
| `piloto_inicio` | date | Arranque limpio del contrafactual del reveal (salta baseline sucio) |
| `riego_auto` | boolean | El goteo riega solo con pauta fija |
| `riego_auto_min` | int | Minutos por riego automático |
| `riego_auto_cada_dias` | int | Cada cuántos días riega el automático |
| `riego_auto_desde` | date | Fecha ancla de la pauta (paridad de la serie) |
| `suelo_oferta` | jsonb | **Caché** de la oferta de nutrientes del suelo (salida de `_suelo-oferta.js`) |

`metodo_riego` ∈ {`goteo`, `aspersion`, `surco`, `manguera`, `regadera`}.
`manejo` ∈ {`convencional`, `ecologico`}.

---

## 2. `recomendaciones_log` — lo que Kylia habría recomendado

El registro silencioso. **Nunca visible al agricultor.** Lo escribe el cron
`diario-b` (riego) y podría escribirlo la app (otras dimensiones). Es la mitad
"Kylia" del reveal.

Columnas: `id bigserial`, `usuario_id`, `fecha timestamptz` (= fecha de la
**decisión**, no del insert), `tipo`, `texto`, `cantidad_l_m2`, `producto_id`,
`producto_nombre`, `dosis`, `nivel`, `coste_estimado_eur`, `contexto jsonb`.

`contexto` guarda la trazabilidad de la decisión de riego: `fuente`, `et0`,
`lluvia`, `kc`, `Dr`, `RAW`, `TAW`, `metodo_riego`, `suelo`, `sin_fenologia`.

> **Append-only (sellada).** Un trigger `trg_reclog_append_only` (definido en
> `db/diario-b-produccion.sql`) lanza excepción ante cualquier UPDATE o DELETE.
> Esto hace el registro inalterable y por tanto creíble para el reveal. Para
> limpiezas puntuales se desactiva y reactiva el trigger explícitamente
> (`db/limpiar-filas-prueba-2026-07.sql`). **Ojo:** este trigger está en
> `recomendaciones_log`, NO en `acciones`.

---

## 3. `jornadas` — el diario diario

Una fila por `(usuario_id, fecha)` (unique). Marca que el agricultor cerró el
diario ese día. `fuente_decision text[]` registra en qué se apoyó; `comentario`
libre.

---

## 4. `acciones` — lo que el agricultor hizo de verdad

Riegos y aplicaciones (abonado / tratamiento). Es la mitad "agricultor" del
reveal, y la tabla que más se toca. **No tiene trigger append-only**: se puede
UPDATE/DELETE libremente (por eso existe el botón "borrar riego").

Columnas clave: `usuario_id`, `jornada_id`, `fecha` (insert), `fecha_local date`
(día real del riego), `tipo` (`riego`/`aplicacion`), `cantidad_l_m2`,
`franja_horaria` (`manana`/`mediodia`/`tarde`/`noche`), `duracion_min`,
`producto_id`, `producto_nombre`, `sustancia_activa`, `dosis`, `cultivo`,
`plazo_seguridad_dias`, `fue_otro`, `motivo`, `coste_estimado_eur`, `notas`.

Convenciones de `motivo` en riegos:
- `null` → riego manual apuntado por el agricultor/admin.
- `goteo-auto` → riego **sintetizado** por `diario-b` (goteo de pauta fija que
  nadie apunta; ver `materializarGoteoAuto`). Idempotente y autocurativo.
- `abonado` (en `aplicacion`) → línea del cuaderno de fertilización PAC.

Relación horas ↔ lámina: `cantidad_l_m2 = caudal(mm/h) × duracion_min/60`. El
front recalcula la lámina mostrada desde `duracion_min × caudal` actual, así que
`caudal` es la fuente de verdad y `cantidad_l_m2` un snapshot.

---

## 5. `observaciones` — plaga / enfermedad / estrés

`tipo`, `descripcion`, `severidad int`, `cultivo`, `fecha_local`. Alimenta las
heurísticas de plagas y el diario.

---

## 6. `mediciones` — histórico satélite/suelo

Una fila por `(usuario_id, fecha, fuente)` (unique). `ndvi`, `ndmi`,
`ndmi_stdev`, capas de humedad de suelo (`suelo_0_7`, `suelo_7_28`,
`suelo_28_100`), `fuente` (`sentinel-2` por defecto). NDRE se añadió después en
el pipeline de `sentinel.js` (proxy de nitrógeno).

---

## 7. `eventos` — tracking de uso ligero

Sustituye a un Plausible/GA. `nombre`, `props jsonb`, `url`, `ua`. `usuario_id`
con `on delete set null` (el evento sobrevive al borrado del usuario).

---

## 8. Índices

`(usuario_id, fecha desc)` en `recomendaciones_log`, `acciones`, `observaciones`,
`jornadas`, `mediciones`, `eventos`; `(fecha_alta desc)` en `usuarios`. Cubren la
consulta dominante: "las filas de este usuario, más recientes primero".

---

## 9. Ficheros SQL (qué es cada uno)

| Fichero | Qué hace |
|---|---|
| `schema.sql` | Reset destructivo: crea las 7 tablas base + índices |
| `fix-usuarios-columnas.sql` | ALTERs idempotentes de las columnas agronómicas |
| `diario-b-produccion.sql` | Trigger append-only de `recomendaciones_log` + activación |
| `anadir-suelo-oferta.sql` | Columna `usuarios.suelo_oferta` (caché SoilGrids) |
| `alta-piloto-*.sql`, `alta-campo-padre*.sql` | Alta idempotente de cada piloto (por `on conflict (id)`) |
| `cambios-riegos-*.sql` | Registro retroactivo de riegos reportados por pilotos |
| `fix-caudal-y-baseline-tomate.sql` | Corrección de caudal/baseline del piloto de tomate |
| `limpiar-*.sql` | Borrado controlado de filas de prueba (desactiva/reactiva trigger) |
| `seed-demo-piloto.sql` | Datos de la demo (`?demo=1`) |
| `ver-piloto-*.sql` | Consultas de verificación (solo SELECT) |

Regla: **si añades un campo a una tabla, refléjalo también en el handler de
`api/log.js`** que la escribe; PostgREST rechaza columnas que no conoce.
