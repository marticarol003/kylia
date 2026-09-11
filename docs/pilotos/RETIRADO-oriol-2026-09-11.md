# ⛔ El informe de Oriol NO se puede enviar (11-sep-2026)

Su cifra central —**ahorro del 34%, 46,2 m³ de exceso**— es un artefacto de un
defecto en la serie de clima, no un resultado.

## Qué pasó

`climaSerie()` en `api/campo.js` pedía el clima al endpoint de **pronóstico** de
open-meteo con `past_days`. Ese endpoint solo guarda **unos 64 días de pasado
real**: con `past_days=92` devuelve el array entero, pero los días más viejos
vienen a `null`. El código hacía `?? 0`.

**Un dato que faltaba se convirtió en "ese día no se evaporó nada".**

    Ferran   ciclo de 101 días, generado 103 días después de plantar
             → ~39 días con ET0 = 0   (39% de la campaña)
    Oriol    ciclo de  49 días, generado  78 días después de plantar
             → ~14 días con ET0 = 0   (29% de la campaña)

Con esos días a cero, la Kylia simulada "no tenía que regar", así que su lámina
recomendada salía muy por debajo de la real y aparecía un ahorro que no existe.

## Los números, rehechos con el archivo (ERA5)

| | aplicó | Kylia publicado | Kylia corregido | resultado real |
|---|---|---|---|---|
| **Oriol** | 360,0 L/m² | 238,5 | **363,0** | −1% · acertó |
| **Ferran** | 412,3 L/m² | 421,8 | **461,6** | −12% · regó de menos |

El de Oriol se comprobó en cuatro ubicaciones plausibles (Palafolls, Santa
Coloma, Breda, Girona): Kylia habría aplicado entre 338 y 363 L/m². El resultado
no depende de acertar la coordenada exacta — el 34% no aparece en ninguna.

## Conclusión

**Ninguno de los dos pilotos ahorró agua.** Los dos acertaron la cantidad. Lo que
sí se sostiene, y está medido, es el REPARTO: Ferran hizo 73 riegos donde hacían
falta 10.

## Qué hay que hacer antes de volver a enviar nada

1. El arreglo de `climaSerie` está en el código y con tests
   (`tests/test-clima-sin-ceros.mjs`), pero **hay que desplegarlo**.
2. **Regenerar los dos reveals desde el servidor**, que es el único que tiene el
   riego real de Supabase. Lo de aquí recalcula solo el lado de Kylia.
3. Revisar cualquier otra cifra publicada que venga de un reveal: el campo de
   440 m² del padre se generó con el mismo `climaSerie`.
