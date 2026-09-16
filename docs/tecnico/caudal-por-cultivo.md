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
