# Kylia — El piloto silencioso, de extremo a extremo

> Última actualización: **2026-07-12**. Es el circuito que da valor a todo lo demás:
> cómo un campo real se convierte en una **prueba científica** de que seguir a Kylia
> ahorra agua e insumos. Profundizaciones: `shadow-log-recomendaciones.md`,
> `generador-reveal.md`, `runbook-piloto-silencioso.md`.

## La idea en una frase

Kylia **calla** durante una campaña. El agricultor riega/abona como siempre y solo
**registra** lo que hace. Cada madrugada, Kylia calcula en secreto qué habría
recomendado y lo **sella**. Al final, se cruzan las dos series y se enseña la
diferencia. Como Kylia nunca influyó en el agricultor, la comparación es limpia.

---

## Las dos series que se cruzan

```
   LO QUE KYLIA DECIDIÓ                 LO QUE EL AGRICULTOR HIZO
   recomendaciones_log                  acciones
   (sellada, append-only)               (libre, editable)
   escrita por el cron diario-b         escrita por la app / panel / SQL
            │                                    │
            └──────────────┬─────────────────────┘
                           ▼
                   REVEAL (_reveal.js)
              contrafactual FAO-56 (simularKylia)
                           ▼
             informe: ahorro de agua e insumos
```

La clave metodológica: **`recomendaciones_log` es inalterable** (trigger append-only)
y sus filas llevan la fecha de la **decisión**, no del insert. Así nadie puede
"ajustar el pasado" para que Kylia parezca mejor. `acciones` sí es editable porque
son hechos que a veces se corrigen (un caudal mal medido, un riego apuntado tarde).

---

## 1. Alta del piloto

Dos vías equivalentes (ambas dejan una fila en `usuarios`):

- **Onboarding** `/piloto/alta` — formulario + SIGPAC oficial. Hace POST
  `recurso=registro-usuario` a `/api/log`.
- **SQL idempotente** `db/alta-piloto-*.sql` — para altas controladas por coordenada.
  `on conflict (id) do update` (y a propósito **no pisa `caudal`** para no borrar un
  valor medido).

Campos que condicionan el motor: `cultivos` (Kc), `fecha_plantacion` (día 0),
`suelo` (AWC), `metodo_riego` + `caudal` (horas↔mm), `area_m2`, y los dos flags del
piloto: **`piloto_sombra=true`** (Kylia calla) y **`piloto_inicio`** (arranque limpio
del contrafactual, para saltar el baseline sucio del arranque sin tocar el log sellado).

---

## 2. Registro diario (el agricultor)

- **Riegos manuales** → `acciones` (`tipo=riego`, `duracion_min`, `franja_horaria`).
  Registro de 1 toque en `/campo` y en el panel `/pilotos` (retroactivo, sin SQL).
- **Goteo automático de pauta fija** → nadie lo apunta. `diario-b` lo **sintetiza**
  (`materializarGoteoAuto`): genera las filas que faltan desde `riego_auto_desde` cada
  `riego_auto_cada_dias`, a `riego_auto_min` minutos, con `motivo=goteo-auto`.
  Idempotente (salta días ya registrados) y autocurativo (si un día se cayó, la
  siguiente corrida lo rellena). Sin esto, el balance creería el cultivo sin regar y
  dispararía recomendaciones falsas.
- **Abonados/tratamientos** → `acciones` (`tipo=aplicacion`, `motivo=abonado` para el
  cuaderno PAC).

---

## 3. Congelado nocturno (el cron `diario-b`)

`0 6 * * *`. Para cada piloto silencioso con coordenadas:

1. `climaSerie` — ET₀ FAO + lluvia de Open-Meteo desde `fecha_plantacion` hasta hoy.
   Usa **lo disponible esta mañana** (ET₀ observada de días pasados + previsión de hoy):
   sin retrovisor, como una decisión real.
2. `riegosDe` + `materializarGoteoAuto` — la serie completa de riegos reales.
3. `balanceHidrico` + `decisionRiego` — el déficit `Dr` y la decisión (regar/vigilar/orden).
4. Inserta en `recomendaciones_log` con `fecha` = fecha de la decisión y `contexto`
   (et0, lluvia, kc, Dr, RAW, TAW, método, suelo).

Salvaguardas: **DRY-RUN por defecto** (solo escribe con `DIARIO_B_LIVE=1`);
`yaCongelado` evita doble fila el mismo día; auth opcional por `DIARIO_B_TOKEN`.

---

## 4. El reveal (`_reveal.js` + `/api/campo?vista=reveal`)

Al cierre (~2 meses), se cruzan las series. El **ahorro de agua** se calcula con
`simularKylia` (contrafactual FAO-56 desde `piloto_inicio`), **no** leyendo el log
crudo, para no arrastrar días de arranque contaminados. Ejemplo verificado (Breda):
23 vs 64 L/m² = ~64 % de ahorro.

Honestidad del reveal (decisiones de producto explícitas):
- Se comparan **acumulados a igual fecha**; `deficitFinal` explicita el agua que Kylia
  tenía "en cola" (aún no regada) para no inflar el ahorro del que riega menos a menudo.
- **No** se añaden métricas de precisión/adopción/satisfacción: romperían el modelo honesto.
- El informe de texto sale de `informe-cientifico.js` (cascada Claude→Gemini→plantilla).

---

## 5. El campo del padre (`/campo?vista=comparativa`)

Variante del reveal en clave de **ahorro sobre el MISMO campo**: contrafactual Kylia
vs. riego real del padre (sin contar el asentamiento inicial). Cuando el caudal no
está medido, muestra una **banda** (escenario de caudal) que colapsa a una línea al
medirlo con el "truco del vaso". Caso honesto cuando Kylia=0 ("aún no tocaría regar",
sin inflar un 100 %).

---

## 6. Cómo verificar un piloto sin abrir Supabase

Los endpoints GET reflejan el estado real de producción:

```
GET https://kylia.app/api/campo?vista=cuaderno&usuario_id=<uuid>   → riegos + cuaderno
GET https://kylia.app/api/campo?vista=reveal&usuario_id=<uuid>     → el reveal
GET https://kylia.app/api/diario-b?dry=1                           → qué congelaría hoy
```

Un cambio aplicado por SQL/panel se confirma aquí al instante (los `select` son en
vivo, sin caché sobre las lecturas de riegos).
