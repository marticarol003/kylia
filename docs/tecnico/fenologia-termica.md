# Fenología por temperatura (grados-día) — 8-sep-2026

> El motor de riego dejó de contar días y pasó a contar calor. Este documento
> explica por qué, de dónde salen las constantes y contra qué se ha validado.
> Misma regla que el resto de `docs/tecnico/`: **dato oficial citado**, **dato de
> motor reproducible**, **estimación** etiquetada.
>
> Código: `assets/js/motor-riego.js` (`FAO_GDD`, `curvaFenologica`,
> `ventanaMadurez`), `api/_clima-termico.js`, `api/campo.js` (`vista=madurez`).
> Constantes reproducibles: `node scripts/derivar-gdd.mjs`.
> Tests: `tests/test-fenologia-termica.mjs`.

---

## 1. El defecto

FAO-56 publica, en su Tabla 11, la duración de las cuatro fases de cada cultivo
**en días**. El motor las usaba tal cual para situar la fenología: `Kc`, la
profundidad radicular y la fracción de agotamiento salían todas de "cuántos días
hace que se plantó".

El problema es que esas longitudes **no son una propiedad del cultivo**. Vienen
atadas a una región y a una fecha de plantación concretas —la propia tabla lo
dice en cada fila: *"70 days · April/May · Mediterranean"*— porque los días solo
miden el desarrollo si la temperatura es la de esa referencia.

### El caso que lo destapó

Piloto de cebolleta de **El Tros de l'Uri** (La Selva, 41,674 N 2,766 E):

| | |
|---|---|
| Plantación | 24-jun-2026 |
| Primera cosecha (real) | 12-ago-2026 |
| **Ciclo real** | **49 días** |
| Ciclo del modelo | 70 días → 2-sep-2026 |
| **Error** | **21 días (43%)** |

Y el comentario del código afirmaba que esos 70 días ya estaban *"comprimidos y
adelantados por el calor"*. No lo estaban: **70 es exactamente el total de la
fila mediterránea de green onion en la Tabla 11** (25+30+10+5), plantación de
abril/mayo. La compresión que se creía aplicada eran justo los 21 días de error.

### No era un error de FAO: era un error de unidad

Integrando la temperatura **real** de ese campo (Open-Meteo, archivo diario), la
misma suma térmica que Oriol acumuló en 49 días de verano necesita:

| Fecha de plantación | Días para los mismos 1.061 °C·día |
|---|---|
| 1 de abril | 87 |
| **1 de mayo** | **70** |
| **24 de junio (lo real)** | **50** |
| 15 de julio | 51 |

Setenta, clavado, en la fecha de referencia de FAO. Los dos números eran
correctos; lo que estaba mal era contarlos en días. Y la conclusión no depende de
la temperatura base elegida: con Tbase 4,4 °C salen 68 días y con 10 °C, 74.

---

## 2. La solución, que es la de FAO56rev

La revisión de FAO-56 **sustituye las longitudes fijas en días por grados-día
acumulados** para definir las fases de la curva Kc. Aquí se sigue ese criterio.

```
GDD del día = max(0, (Tmax + Tmin)/2 − Tbase)      [método de la media simple]
```

Las `L` en días **se quedan**, pero cambian de papel: ya no son el reloj, son el
**eje** sobre el que está dibujada la curva Kc. El calor acumulado se traduce a
un punto de ese eje, fase por fase, y a partir de ahí `kcDelDia`, `faseDelDia` y
`zrDelDia` son exactamente las funciones de siempre.

Se traduce **por fases y no con una regla de tres sobre el total** porque el
calor no se reparte como los días: una fase de abril acumula mucho menos por día
que la misma fase en julio, y aplanar eso deformaría la curva.

### Cuándo NO se usa

`curvaFenologica()` devuelve `null` —y todo el motor vuelve al calendario, sin
cambiar un decimal— si falta la tabla térmica del cultivo, si no hay fecha de
plantación, si la serie no trae temperaturas, o **si la serie no llega al día de
la plantación**. Esto último importa: con el arranque del ciclo sin contar, la
suma térmica va corta y el cultivo parecería más joven de lo que es, que es
justo el defecto que veníamos a arreglar. Mejor calendario honesto que
termómetro a medias.

Por eso existe `api/_clima-termico.js`: la API de pronóstico de Open-Meteo solo
da 92 días de pasado y un tomate son 145, así que el arranque del ciclo se pide
a la API de archivo y se pega con el pronóstico.

---

## 3. De dónde salen las constantes

**No están inventadas ni ajustadas a nuestros pilotos.** Método (el de la
companion paper de FAO56rev, ver §6), reproducible con
`node scripts/derivar-gdd.mjs`:

1. Para cada cultivo se toma su fila mediterránea de la Tabla 11 de FAO-56: sus
   longitudes de fase **y su fecha de plantación de referencia**.
2. Se planta virtualmente en esa fecha, en La Selva (donde están los pilotos, y
   clima mediterráneo costero como el de la tabla), y se integra la temperatura
   diaria real de **21 años (2005-2025)** sobre esas mismas fases.
3. El resultado —cuánto calor pide cada fase— ya no depende del calendario.

Se usa la **mediana** de los 21 años, no la media: un verano extremo no debe
mover una constante.

| Cultivo | Tbase | ciclo (d) | ini + des + med + fin | total | P10–P90 | Referencia FAO-56 |
|---|---|---|---|---|---|---|
| lechuga | 4,0 | 75 | 220 + 408 + 251 + 192 | **1.071** | 996–1.130 | 75 d · abril · Medit. |
| espinaca | 4,0 | 60 | 220 + 254 + 228 + 89 | **791** | 720–845 | 60 d · abril · Medit. |
| brassica | 4,0 | 130 | 521 + 468 + 370 + 78 | **1.437** | 1.217–1.521 | 130 d · septiembre |
| tomate | 10,0 | 145 | 211 + 491 + 671 + 376 | **1.749** | 1.605–1.832 | 145 d · abril/mayo · Medit. |
| pimiento | 10,0 | 125 | 271 + 481 + 583 + 252 | **1.587** | 1.454–1.664 | 125 d · abril/junio · Europa y Medit. |
| berenjena | 10,5 | 130 | 339 + 568 + 513 + 179 | **1.599** | 1.498–1.677 | 130 d · mayo/junio · Medit. |
| calabacín | 10,0 | 100 | 128 + 307 + 335 + 219 | **989** | 891–1.081 | 100 d · abril · Medit. |
| cebolla | 6,0 | 70 | 154 + 323 + 335 + 176 | **988** | 909–1.049 | 70 d · abril/mayo · Medit. |

El **P10–P90 es ±7-8%** del total. De ahí sale la anchura de la ventana (§5).

---

## 4. Validación

Los dos únicos ciclos cerrados que existen. **Ninguno de los dos entra en la
derivación de §3**: son comprobación, no ajuste.

| Piloto | Cultivo | Plantado | Cosecha real | Modelo térmico | Modelo de calendario |
|---|---|---|---|---|---|
| El Tros de l'Uri · La Selva | cebolleta | 24-jun-2026 | 12-ago-2026 | 9-ago → **−3 d** | 2-sep → **+21 d** |
| Campo del padre · Sant Boi | lechuga | 5-jun-2026 | 30-jul-2026 | 24-jul → **−6 d** | 19-ago → **+20 d** |

**El sesgo es negativo en los dos**, y eso es lo que tiene que pasar: el modelo
predice **madurez agronómica** y el agricultor corta unos días después, cuando le
cuadra. Por eso lo que se enseña es una ventana *"a partir de"*, nunca una fecha
de cosecha (§5).

Con n=2 esto no es una validación estadística. Lo que le da peso es que **dos
caminos independientes llegan al mismo sitio**: la fila de FAO para plantación de
primavera y la temperatura medida en el campo de Oriol. La serie de cosechas de
este otoño es lo que lo convertirá en un RMSE.

### El defecto no era solo de planificación: era de riego

Si el cultivo parece más joven de lo que es, se le aplica un Kc más bajo. Sobre
el ciclo real de Oriol, con su ET₀ real (dato de motor, `tests/test-fenologia-termica.mjs`):

| | ETc del ciclo |
|---|---|
| Reloj de calendario (lo que hacía Kylia) | 259,4 mm |
| Reloj térmico | 281,8 mm |
| **Diferencia** | **+22,4 mm (8,7%)** |

Kylia venía **pidiendo menos agua de la que el cultivo gastaba**, y el hueco se
concentra entre los días 21 y 35 del ciclo, que en ese piloto fue el pico de
demanda de julio: ahí el Kc de calendario iba hasta un 15% por debajo.

---

## 5. La ventana de madurez

`ventanaMadurez()` proyecta el calor que falta con el pronóstico real (~16 días)
y, más allá, con las **normales mensuales del propio sitio** (medias de 10 años,
`api/_clima-termico.js`). Sin ninguna de las dos cosas devuelve `null`: no se
inventa una fecha.

**Es una ventana de MADUREZ, no una fecha de cosecha.** Kylia no puede saber
cuándo va a cortar el agricultor: eso lo deciden el precio de la semana, el
comprador y si tiene gente ese día. Prometer una fecha sería fallar siempre y por
motivos que el modelo no puede ver. Es la misma disciplina que con los
fitosanitarios: Kylia no dice qué aplicar, ayuda a registrar lo aplicado.

La anchura tiene dos términos y cada uno tiene fuente:

```
media_ventana = 4 días  +  8% de los días que faltan
                 ↑           ↑
     error del modelo    calor que aún no ha caído
     (−3 y −6 d medidos) (P10-P90 interanual, ±7-8%)
```

El primero no encoge al acercarse la madurez, porque el error del modelo sigue
ahí el día antes de cosechar. El segundo sí.

**Comportamiento sobre el ciclo real de Oriol** (fijado en los tests): las cinco
ventanas calculadas entre el día 6 y el día 44 del ciclo **contienen todas la
fecha real de cosecha**, y la ventana se estrecha de ±8 a ±4 días conforme se
acerca. El 30 de junio —seis días después de plantar— la fecha probable era el
13-ago y la realidad fue el 12-ago.

---

## 6. Fuentes

- **FAO-56**, Allen et al. (1998), [Tabla 11 — Lengths of crop development stages](https://www.fao.org/4/x0490e/x0490e0b.htm). De aquí salen las `L` y las fechas de plantación de referencia. Green onion, Mediterráneo: 25/30/10/5 = 70 d, abril/mayo.
- **Pereira & Paredes (2025)**, [*Base and upper temperature thresholds to support the calculation of growing degree days aiming at their use with the FAO56rev crop coefficients curve: A review*](https://www.sciencedirect.com/science/article/pii/S037837742500469X), Agricultural Water Management. Tabula Tbase/Tupper para 117 cultivos. De aquí las temperaturas base: lechuga 3,5-4,5 °C; espinaca ~4 °C; coles 3-5 °C; tomate 10 °C; pimiento 10 °C; berenjena 10-11 °C.
- **Paredes et al. (2025)**, [*Estimating the lengths of crop growth stages to define the crop coefficient curves using growing degree days (GDD): Application of the revised FAO56 guidelines*](https://www.sciencedirect.com/science/article/pii/S037837742500472X). El companion paper: es el método de §3, y confirma que **FAO56rev sustituye las longitudes fijas en días por GDD**.
- **Open-Meteo**, [API de archivo](https://open-meteo.com/en/docs/historical-weather-api) (temperatura diaria 2005-2025) y API de pronóstico.
- Interno: `db/cosecha-cebolleta-2026-08-27.sql` (el ciclo de 49 días, con su porqué), `docs/tecnico/motor-de-decision.md` §3.

---

## 7. Lo que falta

1. **Cerrar la validación con la serie de cosechas de este otoño.** Con 5-6
   ciclos y varios cultivos esto pasa de "dos casos que concuerdan" a un RMSE
   publicable, como se hizo con pyfao56.
2. **Corregir con el satélite.** El cron escribe NDVI y OSAVI desde el 1-ago: la
   meseta de esa curva y el inicio de su caída **son** la señal de madurez
   observada. Predecir por calor y corregir por satélite es el peldaño que
   convierte la estimación en medición. Requiere serie acumulada, no código.
3. **Trasplante contra siembra directa.** Mueve el día 0 varias semanas y el
   esquema no lo distingue: hoy `fecha_plantacion` significa las dos cosas.
4. **Cosecha escalonada.** La cebolleta se arranca a manojos durante semanas: "la
   fecha" no existe, y por eso el piloto se cierra el día que EMPIEZA. La ventana
   de madurez encaja bien con eso, pero el modelo de datos todavía no.
