# Onboarding · deuda aplazada a propósito (16-sep-2026)

Lo que sigue se detectó implementando el onboarding del piloto y se deja FUERA
de forma consciente. No son descubrimientos nuevos que haya que volver a buscar:
están localizados, con fichero y línea.

## 1 · `presentarRiego` no declara `caudalEstimado` en el camino corriente

> ✅ **MITIGADO** el 16-sep con `presentarRiegoSeguro`: ningún camino llama ya al
> motor directamente, y sin caudal operativo la orden sale en L/m². Lo que sigue
> describe por qué el motor solo no basta.


`assets/js/motor-riego.js` expone `caudalEstimado` solo cuando la orden supera
las 2 h y hay que fraccionarla. En el camino de todos los días (`return { unidad:
"min", valor, mm, texto }`) no dice si el caudal era del agricultor o de
`CAUDAL_DEFAULT_MMH`.

Hoy no hace falta porque la fiabilidad de los minutos la decide
`KyliaRiego.estadoSiembra`, que sí lo sabe. Pero significa que **cualquier
consumidor que pregunte solo al motor no puede distinguirlo**, y `api/campo.js`
llama a `presentarRiego` directamente.

Fijado en `tests/test-onboarding-riego.mjs` §10, como es y no como debería ser.
La puerta (`presentarRiegoSeguro`) vive fuera del motor a propósito: el motor no
sabe de dónde viene el caudal que le pasan, así que no puede ser él quien decida.

## 2 · El caudal del panel de configuración sigue sin procedencia

`#input-caudal` y la calculadora `cc-*` (`app/index.html`, `abrirCalcCaudal`)
escriben un número pelado en `cfgFinca.caudal`. El alta y el editor de cultivos
ya guardan `riego: { capacidad_mmh, fuente, confianza, datos }`; el panel no.

Un caudal editado ahí queda indistinguible de uno medido.

## 3 · Sectorización

Si el agricultor riega por sectores, `area_m2` es la del cultivo pero el caudal
efectivo es el del sector. No se modela en ninguna parte. Para el piloto se
asume un sector por cultivo.

## 4 · `cantidad_l_m2` significa dos cosas

Medida real del agricultor cuando la escribe `api/log.js`; derivada de
duración × caudal cuando la escribe `api/diario-b.js:170`. Ya costó una ronda
entera durante la migración de láminas.

## 5 · `riegoMinutos` (siembra) vs `riego_auto_min` (finca)

Dos campos, dos niveles, significado parecido.

## 6 · `area_m2` de la finca no cuadra con la suma de sus siembras

5.228 m² en la finca contra 1.880 + 2.174 + 1.172 = 5.226 en `zona[0]`, con la
cuarta parcela aparte. Legacy del alta anterior a las zonas.

## 7 · Tres zonas sin `referencia` SIGPAC

En la configuración real hay zonas creadas por un camino que no pasa por el
selector de recintos.

## 8 · Suelo: solo se usa la clase

`aguaSuelo` lee únicamente arenoso/franco/arcilloso → `SUELO_AWC`. SoilGrids
devuelve arcilla, arena, pH, materia orgánica y densidad, y de todo eso solo se
aprovecha la textura (y la MO para el nitrógeno). Mueve la lámina un ±10% y no
está medido en ninguna de las tres parcelas piloto.
