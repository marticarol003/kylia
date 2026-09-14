# Qué mide cada número de Kylia (y cuál NO se puede publicar)

Escrito el 14-sep-2026, porque cuatro cosas distintas se estaban llamando igual y
eso ya costó dos informes de piloto retirados.

---

## Las cuatro clases, y no son intercambiables

### 1 · Consistencia técnica del modelo
**Qué mide:** que el motor calcule lo que dice calcular. Se contrasta contra una
implementación independiente del estándar (`pyfao56`).

**Lo que hay hoy:**
- `RMSE(ETc) = 0,000000 mm/día` en 60 ventanas de clima real. La **demanda del
  cultivo es exacta**: Kylia *es* FAO-56 en la ETc, no "se inspira".
- `RMSE(Dr)` entre 1,4 mm (invierno) y 10,7 mm (verano, 24% del depósito). La
  divergencia es estructural —Kc único contra Kc dual— y va **siempre hacia el
  lado conservador**: Kylia cree el suelo más seco y riega antes.

**Lo que NO es:** precisión agronómica. Es distancia a otro modelo.

⚠️ **El "62% de concordancia" NO es una métrica de accuracy y no se publica como
tal.** Es el índice de Jaccard entre las decisiones de Kylia y las de `pyfao56`
en los días en que alguno de los dos riega. Subirlo no es acertar más: es
converger con otro modelo. Migrar a Kc dual con sus mismos parámetros lo llevaría
cerca del 100% **por construcción**, y no habría mejorado nada en el campo.

### 2 · Comparación contrafactual (Kylia vs agricultor)
**Qué mide:** sobre el clima, suelo y cultivo REALES de una parcela, cuánta agua
habría aplicado Kylia, frente a la que aplicó el agricultor.

**Cómo se calcula:** `simularKylia` sobre la serie de la parcela, sin ver el
riego real (si lo viera, en goteo de pauta fija nunca dispararía). El agua
aplicada sale de `acciones`, convertida a mm con el caudal.

**Condiciones para que exista:** cobertura de clima ≥ 95%, riegos cuantificados,
láminas no absurdas. Si alguna falla, `publicable: false` y **las cifras no se
calculan** — no se marcan como dudosas y se dejan ahí para que alguien las copie.

### 3 · Ahorro POTENCIAL
**Qué es:** la diferencia de (2), expresada como porcentaje de lo que aplicó el
agricultor. Es lo que el reveal publica, y siempre en condicional: *"habrías
ahorrado"*, nunca *"ahorraste"*.

**Su incertidumbre, medida y que hay que declarar con el número:**

| fuente | cuánto mueve la lámina |
|---|---|
| clase de suelo (SoilGrids, prior a 250 m) | **5,5-12,1%** |
| Kc único vs dual | **−9% a +6%** según método de riego |
| mezcla archivo/pronóstico (corregida el 14-sep) | hasta **+17,9%** |

Un 15% honesto se escribe *"entre un 10 y un 20%"*.

### 4 · Ahorro DEMOSTRADO
**Qué sería:** la diferencia medida entre una parcela donde se sigue a Kylia y un
control comparable, con la cosecha medida en las dos.

**Cuánto tenemos: CERO.** En un piloto ciego el agricultor riega a su manera, así
que no hay nada que demostrar: solo que simular. `ahorro_demostrado: false` va en
el payload del reveal, siempre, hasta que exista un ensayo que lo sostenga.

El único montaje que podría darlo es el ensayo del bancal (zona A con Kylia
contra zona B del padre), y **hoy las dos zonas han recibido la misma agua**, así
que tampoco.

---

## Regla de publicación

| clase | ¿se puede enseñar fuera? |
|---|---|
| 1 · ETc exacta contra FAO-56 | **Sí.** Aguanta cualquier régimen climático |
| 1 · concordancia 62% | **No como accuracy.** Es distancia a otro modelo |
| 2 · contrafactual | Sí, diciendo que es una simulación |
| 3 · ahorro potencial | Sí, en condicional y con su banda |
| 4 · ahorro demostrado | **No existe. No se afirma.** |

Y lo que sí está medido y no depende de ningún modelo: **el REPARTO**. Ferran
hizo 73 riegos donde hacían falta 13. Eso es aritmética sobre su propio registro,
no una simulación, y es el argumento más sólido que tiene Kylia hoy.

---

## Reproducir una decisión dentro de un año

Congelado hoy en cada fila de `recomendaciones_log`: el clima del día (con su
fuente y si se sabía la lluvia), el cultivo y la fase, el reloj usado, el estado
hídrico y sus acumulados, la parcela tal como estaba —caudal y superficie
incluidos—, los supuestos de los que se fía el balance, el motivo en código, y
**`motor_version` + `motor_reglas`**.

Con eso se puede saber QUÉ decidió y CON QUÉ. Lo que todavía no se puede es
**recalcularlo bit a bit**, porque falta la serie climática entera: el balance de
un día depende de los 90 anteriores, y el archivo de Open-Meteo puede reescribir
su propio pasado (ERA5 se reprocesa).

### Propuesta, sin implementar

No meter la serie en cada fila —serían 90 días × 4 variables por decisión y por
piloto, a diario—. Tres opciones, de menos a más trabajo:

1. **Huella de la serie.** Un hash de la serie usada (fechas + ET₀ + lluvia +
   fuente) en cada decisión, y la serie completa guardada UNA vez por parcela y
   día en una tabla aparte. Si el hash coincide, la reconstrucción es exacta; si
   no, se sabe que la fuente cambió bajo los pies. Barato y detecta el problema,
   aunque no lo arregla.
2. **Instantánea diaria por parcela.** Una fila al día por parcela con la serie
   completa en JSONB. Para 3 pilotos son ~1.100 filas al año; para 300, 110.000 —
   sigue siendo poco, pero ya conviene comprimir o quedarse con los últimos N días.
   Reconstrucción exacta garantizada.
3. **Congelar el día cerrado.** Cuando un día pasa a ser pasado y el archivo lo
   cubre, guardar ESE valor como definitivo para esa parcela y no volver a
   pedirlo. La serie deja de depender de que la API no cambie de opinión, y de
   paso se ahorran peticiones. Es la más limpia y la que más toca el código.

La (1) es la que daría más por menos: sin ella, hoy no hay forma de detectar que
una serie ha cambiado bajo una decisión ya publicada.
