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
