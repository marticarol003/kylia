# Estrategia de validación: laboratorio abierto vs sombra silenciosa

> Cómo demostramos que Kylia es **válida y funcional** sin engañarnos. Dos entornos
> de prueba con roles opuestos a propósito, más una validación de software. Este
> documento fija la **regla que los separa** y por qué es metodológica, no estética.
>
> Relacionado: [`docs/tecnico/motor-de-decision.md`](../tecnico/motor-de-decision.md) §3.4 y §8.
> Última actualización: 2026-06-03.

---

## 1. Los tres niveles (recordatorio)

| Nivel | Qué demuestra | Dónde | Coste |
|---|---|---|---|
| **1 · Laboratorio abierto** (split-plot) | Que **funciona**: ahorro sin perder cosecha (se observa el resultado real) | Campo del padre | Alto, 1 temporada |
| **2 · FAO-56 vs `pyfao56`** | Que es **correcta**: el motor coincide con el estándar internacional | Software, sin agricultores | Bajo |
| **3 · Sombra silenciosa** | **Escala + relato + dataset del reveal** (divergencia en fincas reales) | Todos los pilotos | Bajo |

Se refuerzan: el Nivel 2 hace creíbles los números del Nivel 3; el Nivel 1 da la
prueba de resultado que el 3 no puede; el 3 da la escala que el 1 (n pequeño) no tiene.

---

## 2. La distinción central: ¿Kylia habla o calla?

Los Niveles 1 y 3 ocurren los dos "en el campo", pero son **opuestos a propósito**:

| | 🥬 **Laboratorio abierto** (campo del padre) | 🤫 **Sombra silenciosa** (pilotos) |
|---|---|---|
| **Kylia…** | **habla**: emite la recomendación y se actúa sobre ella | **calla**: observa y registra, no aconseja |
| **El agricultor…** | aplica lo que dice Kylia (o se compara contra su manejo) | hace lo de siempre, sin saber qué opina Kylia |
| **Qué aporta** | **prueba + calibración** (se ve el resultado real) | **escala + divergencia** (qué habría hecho distinto) |
| **Control experimental** | total (es familia, se mide todo) | ninguno (vida real) |
| **Tamaño** | pequeño, controlado | muchos pilotos |

### La regla de oro
**En el campo del padre, Kylia habla. En los pilotos, Kylia calla.**

No es un detalle de tono: es **metodológico**. Si en el piloto silencioso le diésemos
al agricultor la opinión de Kylia, **cambiaría su comportamiento** y destruiríamos
justo lo que queremos medir — qué habría hecho él por su cuenta frente a qué habría
decidido Kylia. Esa contaminación es el problema de **endogeneidad**: la decisión del
asesor pasaría a formar parte de la causa. Por eso la sombra es *silenciosa*.

En el laboratorio abierto pasa lo contrario: **queremos** que Kylia mande, porque ahí
no medimos divergencia sino que **aprendemos, calibramos y comprobamos el resultado**.

---

## 3. Por qué se complementan (y ninguno basta solo)

- El **laboratorio abierto** es el único sitio donde se puede *probar* que Kylia
  acertó, porque se observa el contrafactual (la cosecha bajo el plan de Kylia) y se
  afinan los parámetros del motor (Kc, suelo, eficiencia de riego). Lo que la sombra
  nunca puede ver.
- La **sombra silenciosa** es el único sitio que da números de divergencia sobre
  fincas reales y a escala. Pero no prueba el resultado: solo observa.

Juntos dicen: *"Kylia habría decidido distinto (sombra) **y** decidir así no cuesta
cosecha (campo del padre)"*. Por separado, ninguno lo afirma. El techo de honestidad
que aceptamos: la sombra demuestra "aplicaste de más sobre lo que el cultivo
necesitaba" (alta confianza); el campo del padre añade "y ahorrar eso no cuesta
cosecha". Solo juntos = "casi a ciencia cierta".

---

## 4. Qué hace creíble la sombra silenciosa (registro a prueba de manipulación)

Para que el reveal sea creíble, el registro de la decisión silenciosa ("Diario B")
debe ser **inalterable a posteriori**. Requisitos:

1. **Congelado cada día**: un proceso programado fija la decisión de Kylia con la
   información disponible **ese** día (sin retrovisor: no se recalcula con datos que
   llegaron después).
2. **Sellado en el tiempo**: cada registro lleva su fecha/hora de creación y se
   guarda en almacenamiento **append-only** (no se reescribe la historia).
3. **Auditable**: el agricultor (y un evaluador) pueden ver al final la serie completa
   de decisiones congeladas junto a lo que él hizo de verdad.
4. **Frontera honesta**: en el reveal solo se ponen **€ donde el modelo está validado
   (agua)**; plagas y nutrición se reportan de forma cualitativa.

> ⚠️ **Estado (2026-06-03):** este "Diario B" **aún no está construido**. Hoy Kylia
> calcula la decisión pero **no la persiste congelada** para el reveal. Es el siguiente
> paso técnico y es lo que convierte "confía en mí" en "aquí está el registro sellado".
> Sin él, la sombra no es creíble; con él, lo es por diseño.

---

## 5. Dónde encajan las 6 lechugas del campo del padre

No son el split-plot riguroso (eso sería un cultivo serio durante una temporada). Son
el **sandbox** del Nivel 1: un banco de pruebas a mano para *sentir* las decisiones del
motor de riego, ver si tienen sentido y **calibrarlo** (Kc de la lechuga, tipo de suelo,
eficiencia de la regadera) **antes y mientras** corren los pilotos silenciosos. Es el
banco de pruebas, no la prueba. Detalle operativo (mm→litros vía área, datos que
necesita el motor) en la nota de proyecto del experimento.
