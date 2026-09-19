# Acceso por enlace: qué hay que tener puesto y cómo se comprueba

Estado de la rama `codex-onboarding-parcelas-20260916`, sobre `c98562e`
(producción). **Nada de esto está desplegado todavía.**

## Qué cambia para el agricultor

Hoy, en producción, un correo tecleado en la app se escribe en su fila de
`usuarios`. Eso tenía una consecuencia medida: si alguien escribía el correo de
otra persona, su cuenta pasaba a tener dos filas con el mismo correo y dueños
distintos, `propietarioPorEmail()` devolvía conflicto —correctamente— y esa
persona **dejaba de recibir enlaces de acceso, en silencio**.

Con estos commits, el correo solo se asocia a una cuenta **tras canjear un
enlace de un solo uso**, que es el único momento en que está acreditado. Y el
propietario de una cuenta nueva nace en ese canje, no antes.

## Infraestructura

| | Para qué | Estado (19-sep-2026) |
|---|---|---|
| `SESION_SECRET` | Firma la cookie de sesión. Mínimo 16 caracteres. Cambiarla echa fuera a todo el mundo: dura 90 días | puesta por Martí · **no verificada por código** |
| `RESEND_API_KEY` | Entregar el correo | puesta · **no verificada por código** |
| Dominio verificado en Resend | Sin él, Resend solo entrega al buzón de la cuenta: los enlaces llegarían solo a Martí | `kylia.app` verificado |
| `ACCESO_FROM` | ⚠️ **Sin esta variable, `_acceso.js` usa `onboarding@resend.dev` aunque el dominio esté verificado.** Ver `api/_acceso.js:83` | puesta |
| `APP_BASE_URL` | La base del enlace. Por defecto `https://kylia.app`, que es lo correcto | sin poner, por defecto |
| Tabla `reservas_alta` | La exclusión entre instancias | **ejecutada el 19-sep** |

Sin `SESION_SECRET` o sin `RESEND_API_KEY`, `pedir()` y `canjear()` responden
503 `acceso_no_configurado` diciendo qué falta, con cero adopción y cero
escritura. Sin la tabla, las altas nuevas responden 503 `falta: ["reservas_alta"]`
y las cuentas existentes siguen funcionando.

⚠️ Lo que pone "puesta" viene de que Martí lo dice. **Ningún test lo comprueba**
y desde aquí no hay acceso a Vercel ni a Resend.

## La migración

`db/reserva-alta-2026-09-18.sql`, ejecutada en dos tiempos: primero el
`create table` —la primera versión del fichero no llevaba permisos— y después
`revoke` + `enable row level security`, con la tabla todavía vacía y el código
sin desplegar. Comprobado por consulta que `anon` y `authenticated` ya no
aparecen en `information_schema.role_table_grants`.

Las cuatro comprobaciones de solo lectura están al final del propio `.sql`.

## Orden de despliegue

1. La migración. **Hecha.**
2. Las variables de entorno. **Hechas** (sin verificar por código).
3. Desplegar la rama.
4. Smoke test con un buzón real.

Desplegar antes de migrar no rompe a nadie: las altas nuevas darían un error
explícito y las cuentas existentes seguirían entrando.

## Smoke test

Con un correo de verdad, y mirando la respuesta de red en el navegador:

1. Pedir el enlace desde la app. Respuesta 200 y genérica.
2. **Que llegue el correo**, y que venga desde `ACCESO_FROM`, no desde
   `onboarding@resend.dev`.
3. Abrirlo. En la respuesta del canje tiene que venir `Set-Cookie:
   kylia_sesion=…` con `HttpOnly`, `Secure` y `SameSite=Lax`.
4. Recargar: se sigue dentro, sin volver a pedir el correo.
5. `vista=hoy` devuelve **solo** sus parcelas.
6. Volver a abrir el mismo enlace: ya no vale.
7. En la base: `select count(*) from reservas_alta` — una fila por correo nuevo,
   ni una más aunque se hayan pedido varios enlaces.

## Rollback

⚠️ **Dejar la tabla en la base NO protege a un código que no la usa.** Si se
revierte a `c98562e`, `pedir()` vuelve a reservar con `crypto.randomUUID()` por
petición y los propietarios duplicados vuelven a ser posibles. La tabla se queda
ahí, inerte.

Y un duplicado creado durante el rollback deja ese correo en **conflicto
permanente**: al volver hacia adelante esa persona sigue sin recibir enlaces, y
hay que arreglarlo a mano con `docs/tecnico/correo-ambiguo-soporte.md`.

El rollback es seguro para los datos que ya existen. No es gratis para los
correos que pasen por él mientras esté revertido.

## Lo que sigue sin estar probado

- **La clave primaria contra Postgres real.** No hay `psql` ni Docker en la
  máquina de desarrollo y `DATABASE_URL` está vacío. Los tests modelan el 23505
  de PostgREST y fijan que código y migración no se separen, pero eso no es una
  prueba contra la base.
- **El circuito real**: correo entregado, cookie emitida y permisos. Hasta el
  smoke test, esto es código correcto sin verificar en producción.
- **El tope de 5 envíos por hora no es atómico.** Medido: 20 peticiones
  simultáneas producen 20 correos; en secuencial sí corta en 5. No crea cuentas
  ni filtra nada —la reserva sigue siendo única—, pero permite spam a coste
  propio. Pendiente de decisión aparte.
