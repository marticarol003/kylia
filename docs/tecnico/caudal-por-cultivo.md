# Dónde vive el caudal, exactamente (16-sep-2026)

Verificado contra producción, no contra el schema.

## DB · qué fila contiene `caudal`

`usuarios.caudal numeric` — **una columna por FILA**, y en Kylia **una fila de
`usuarios` es una parcela**: una siembra tiene su propia fila, con su `id` y con
el `propietario_id` del agricultor (`db/schema.sql`, y `payloadSiembra`).

Comprobado el 16-sep sobre el propietario `c46e9d6d` vía
`/api/campo?vista=verificar`:

| fila | método | caudal | propietario |
|---|---|---|---|
| `264c2a43` | goteo | 1.8 | `c46e9d6d` |
| `ba603bc6` | goteo | 1.8 | `c46e9d6d` |
| `62dcd2da` | goteo | 1.8 | `c46e9d6d` |
| `eff32768` | **aspersión** | **1.8** | `c46e9d6d` |

**Cuatro filas independientes, y las cuatro con el caudal de la finca.** La
última riega por aspersión con el caudal de un goteo. La columna siempre pudo
llevar un valor distinto por fila; **el que las igualaba era el cliente**.

Por eso esto no necesita migración: no falta ninguna columna.

## `config_app` · dónde vive `s.caudal`

En la foto del propietario, dentro de cada siembra:

```
usuarios[propietario].config_app
  └── zonas[]
        └── siembras[]
              ├── caudal            ← número plano, el operativo
              └── riego             ← la PROCEDENCIA, solo aquí
                    ├── capacidad_mmh   (null si dijo "no lo sé")
                    ├── unidad, fuente, confianza
                    ├── datos {…}       las respuestas originales
                    └── estimacion_mmh  orientativa, NUNCA operativa
```

`riego` no viaja a la columna: el motor solo quiere el número. Quien necesita
saber si ese número está medido o supuesto es la pantalla.

**La presencia de `riego` ES la marca de "esta siembra declaró su riego".** Una
siembra antigua no lo lleva, y por eso sigue heredando como siempre.

## `payloadSiembra` · qué valor manda

```js
caudal: window.KyliaRiego.caudalOperativo(s, base)
```

La misma puerta que usa el cliente para decidir. Si cada uno resolviera la
precedencia por su cuenta, se separarían a la primera edición — y entonces la
fila del servidor y lo que decide el móvil dirían cosas distintas sobre la misma
parcela, que es el defecto del 31-jul y otra vez del 11-sep.

## Las dos listas blancas

Son **dos decisiones distintas**, y mezclarlas rompe una de las dos:

| | `FUENTES_AL_MOTOR` | `FUENTES_OPERATIVAS` |
|---|---|---|
| pregunta | ¿puede cruzar al motor? | ¿podemos llamar **fiables** a esos minutos? |
| `derivado_goteo` | ✅ | ✅ |
| `medido_vaso` | ✅ | ✅ |
| `declarado` (tecleado a mano) | ✅ | ❌ |
| `heredado_finca` (legacy) | ✅ | ❌ |
| `estimado_metodo` | ❌ | ❌ |
| `no_lo_se` · `sin_datos` | ❌ | ❌ |
| `invalidada_por_cambio_de_metodo` | ❌ | ❌ |

Son **listas blancas**, no negras, a propósito: con `fuente !== "estimado_metodo"`
cualquier fuente que alguien añada mañana entraría sola, y entraría en silencio.

Un agricultor de siempre que tecleó su caudal, o una siembra antigua que hereda
el de su finca, **siguen recibiendo minutos** — es lo que hacían y romperlo no
arregla nada. Lo que no hacemos es decir que están validados: su estado es
`pendiente_validacion`.

## La puerta única: `capacidadOperativa(valor)`

Rechaza `null`, `undefined`, `""`, `0`, `"0"`, `NaN`, `±Infinity`, negativos,
booleanos y todo lo que caiga fuera del rango agronómico (0,5–80 mm/h).

Antes el criterio estaba repartido entre cuatro sitios que decidían parecido
pero no igual — `capacidadVigente` ("hay un número"), `puedeDarMinutos`
(`>= 0,1`), `estadoSiembra` (lista negra por nombre de fuente) y la
presentación. Con capacidad **0** el estado decía *"completa, lista para
ejecutar"* mientras la presentación no podía dar minutos: **las dos cosas a la
vez, sobre la misma siembra.**

### Invariantes, verificadas por barrido

```
capacidad operativa == null  ⇒  lista_para_ejecutar_riego == false
lista_para_ejecutar_riego    ⇒  presentarRiegoSeguro puede dar minutos
```

`tests/test-capacidad-contrato.mjs` las comprueba sobre **405 combinaciones**
de valor × fuente × método, con un control que confirma que el barrido no pasa
por vacío.

## Cambiar de método invalida la capacidad

`riegoTrasCambioDeMetodo(previo, metodoNuevo)`. Un caudal de 6,7 mm/h derivado
de la geometría de una cinta de goteo **no dice nada sobre un aspersor**:
conservarlo es peor que no tener dato, porque es un número con procedencia
creíble aplicado a una instalación que no es la suya.

El alta ya invalidaba al cambiar de chip; **el panel normal no**. Se podía pasar
de goteo a aspersión, guardar, y quedarse con 6,7 y `derivado_goteo` colgando de
un aspersor. Ahora la decisión vive en el módulo y el panel la usa.

Invalidación **segura**, sin intentar adivinar si el número podría reutilizarse:
`goteo→aspersión`, `aspersión→goteo`, `goteo→manguera`… todas dejan la
configuración sin capacidad hasta volver a medir.

Lo anterior se conserva **anidado bajo `riego.anterior`** — `capacidadVigente`
lee `capacidad_mmh`, `fuente`, `confianza` y `datos` del primer nivel, así que
nada de ahí dentro puede reactivarse solo. Verificado ejecutando la función, no
leyendo el código.

## `configEfectiva` · precedencia exacta

`caudalOperativo(s, finca)`, en `assets/js/riego-capacidad.js`:

1. **`s.riego` existe** (alta nueva, declaró su riego)
   → `s.riego.capacidad_mmh`, y si es `null` → **`null`**.
   **No hereda de la finca ni cae a la tabla por defecto.**
2. **`s.caudal` existe** → ese.
3. **`finca.caudal` existe** (legacy) → ese, marcado `heredado_finca`.
4. **Nada** → `null`. Tampoco se inventa.

Y antes de llegar al motor, `presentarRiegoSeguro`: sin caudal operativo la
orden sale en **L/m²**, no en minutos.

⚠️ **Por qué el filtro va ANTES del motor.** `presentarRiego`, ante un caudal
ausente, sustituye `CAUDAL_DEFAULT_MMH` y devuelve unos minutos con la misma cara
de seguridad que si estuvieran medidos. El bancal real medía 5,4 mm/h donde esa
tabla dice 10. El motor no sabe de dónde viene el número que le pasan, así que
no puede ser él quien decida.

## La cadena completa, y dónde estaba el agujero

```
alta → kylia_zonas → [reload] → parcelasDisponibles → parcelaActiva
     → configEfectiva → presentarRiegoSeguro → motor
```

`parcelasDisponibles()` **no copiaba `caudal` ni `riego`** de la siembra. Con
`configEfectiva` ya arreglada, `p.caudal` seguía siendo `undefined` y **todos los
cultivos volvían a caer al caudal de la finca**: el defecto entero, intacto,
detrás de una función que parecía corregida.

No lo vio el primer test porque sustituía `parcelaActiva` por la siembra. Lo vio
`tests/test-caudal-por-cultivo.mjs`, que recorre la cadena real.
