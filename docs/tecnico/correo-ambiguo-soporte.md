# Un correo con dos propietarios: cómo lo resuelve soporte

**Qué es.** `propietarioPorEmail()` (`api/_propietario.js`) colapsa por
`propietario_id`: si todas las filas de `usuarios` con ese correo apuntan al
mismo dueño, hay respuesta; si apuntan a dueños **distintos**, devuelve
`{ conflicto: [ids] }` y no elige a dedo.

Con conflicto, `_acceso.pedir()` **no crea acceso y no manda enlace**. El
agricultor recibe exactamente la misma respuesta que todos los demás:

> Si ese correo tiene un campo en Kylia, el enlace ya va de camino. Caduca en 15
> minutos. Si no lo recibes, contacta con soporte.

Esa frase es la única salida visible, y es deliberadamente igual para el correo
que existe, el que no existe y el que está en conflicto. Decirle "tu cuenta
tiene un problema" confirmaría que ese correo está en el sistema, y eso es
justo lo que no se puede filtrar.

## Cómo se llega a un conflicto

Se llegaba escribiendo un correo ajeno: `registro-usuario` lo guardaba en la
fila del dispositivo que lo tecleaba y la cuenta del dueño pasaba a tener dos
filas con el mismo correo y dueños distintos. **Ese camino está cerrado**: el
correo solo se asocia en `_acceso.canjear()`, tras un canje válido, y solo en la
fila propietaria.

Lo que queda son conflictos **históricos**, anteriores al cierre. No se limpian
solos ni hay migración: se resuelven uno a uno, y a mano, porque cada uno es una
persona con parcelas de verdad.

## Cómo encontrarlos

En los logs del servidor:

```
[propietario] MISMO EMAIL, DUEÑOS DISTINTOS: {"email":"…","dueños":["…","…"]}
[acceso] email con varios propietarios, no se manda enlace: {…}
```

La primera sale cada vez que alguien intenta resolver ese correo; la segunda,
cada vez que esa persona pide un enlace y se queda sin él.

## Cómo se resuelve

**La regla que manda: no se sobrescribe ninguna cuenta.** Un conflicto son dos
explotaciones que comparten un dato, no una duplicada. Fusionarlas por su
cuenta le borraría las parcelas a alguien.

1. **Mirar qué hay en cada lado.** Para cada `propietario_id` en conflicto:
   sus filas de `usuarios` (`propietario_id=eq.<id>`), qué parcelas son, desde
   cuándo, y si alguna tiene actividad reciente en `acciones` o
   `recomendaciones_log`. Una suele ser la explotación de verdad y la otra un
   dispositivo que tecleó el correo y nunca llegó a usarse.

2. **Hablar con la persona.** Por el correo del conflicto, sin decirle que hay
   un conflicto: preguntarle qué parcelas tiene y desde cuándo. Sus respuestas
   dicen cuál de los dos lados es suyo. Esto no se deduce de la base de datos.

3. **Quitar el correo del lado que NO es suyo.** Es la única escritura
   necesaria, y es la mínima: dejar el correo en un solo propietario devuelve la
   resolución a un único dueño y el enlace vuelve a salir. La otra cuenta **no
   se borra ni se toca por lo demás**: sigue con sus parcelas, simplemente deja
   de responder a ese correo.

   ```sql
   -- SOLO tras confirmar con la persona cuál es su cuenta.
   -- Deja el correo en <dueño-bueno> y lo quita del otro. No borra filas.
   update usuarios set email = null
    where email = '<correo>' and coalesce(propietario_id, id) <> '<dueño-bueno>';
   ```

4. **Comprobar antes de decir nada.** `propietarioPorEmail('<correo>')` tiene
   que devolver un único `propietario_id`. Entonces sí: pedir el enlace desde la
   app y comprobar que llega.

5. **Si las dos cuentas son de la misma persona** —dos móviles, dos altas—, se
   deja el correo en la que tenga el histórico bueno y se le dice que entre por
   el enlace. Sus cultivos del otro dispositivo siguen ahí: la pantalla de
   "cultivos en esta cuenta y en este dispositivo" le deja quedárselos y
   subirlos cuando quiera, sin que se pierda ninguno de los dos juegos.

## Lo que NO se hace

- **No** se elige un propietario "el más probable" para desatascar el enlace.
- **No** se fusionan dos cuentas moviendo filas de una a otra.
- **No** se borra la cuenta "sobrante".
- **No** se le dice al agricultor que su correo está duplicado antes de saber
  cuál es el suyo: hasta entonces no sabemos siquiera si las dos son de él.
