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

`db/reserva-alta-2026-09-18.sql`. Se ejecutó en producción el 19-sep en su
**primera** versión —que solo creaba la tabla— y después su bloque de permisos,
con la tabla vacía y el código sin desplegar.

Esa primera versión tenía cuatro carencias que la auditoría marcó como
bloqueantes: `create table if not exists` no valida la forma, no se cualificaba
el esquema, `service_role` no recibía privilegios explícitos y la normalización
del correo solo la garantizaba `api/_acceso.js`.

La versión actual **está pensada para volver a ejecutarse sobre ese estado**.
Va dentro de una transacción y se comporta así:

| estado de la base | qué hace |
|---|---|
| la tabla no existe | la crea entera, con PK y check |
| existe y es correcta | no toca nada; reaplica RLS, grants y el default |
| existe, correcta, sin el check | comprueba que **todas** las filas ya cumplen y solo entonces lo añade |
| el check existe pero dice otra cosa | lo **sustituye** por el del contrato. No toca ningún otro constraint |
| el check es correcto pero `NOT VALID` | lo **valida**, después de comprobar las filas |
| `service_role` arrastra `UPDATE`/`DELETE` | se le **revoca todo** y se le conceden solo `SELECT` e `INSERT` |
| el default de `creado` es otro | lo deja en `now()`. No se adivina: se fija |
| una columna extra `NOT NULL` sin default | **aborta**: ese esquema impediría el `INSERT` que hace Kylia |
| alguna fila sin normalizar | **aborta** con el recuento. No reescribe ningún correo |
| estructura incompatible | **aborta** diciendo qué falla, y revierte la transacción entera |

El estado final es el mismo salga de donde salga: los privilegios se revocan
antes de concederlos y el default se fija en vez de comprobarse, así que la
migración no depende de cómo estuviera la base.

No hay `DROP`, ni `DELETE`, ni `UPDATE`, ni `INSERT` de reparación, ni
renombrados. Una segunda ejecución sobre una base correcta es un no-op
funcional. Todo va cualificado con `public.`: no depende del `search_path`.

### Comprobaciones de solo lectura

Ninguna de estas consultas escribe. **No se han ejecutado desde aquí.**

**1 · La tabla, y que RLS esté activa**

```sql
select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'reservas_alta';
-- relrowsecurity = true
```

**2 · Las columnas**

```sql
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'reservas_alta'
 order by ordinal_position;
-- email          text                     NO   (null)
-- propietario_id uuid                     NO   (null)
-- creado         timestamp with time zone NO   now()
```

**3 · Los constraints: PK solo sobre email, y el check con su definición**

```sql
select c.conname, c.contype, c.convalidated,
       pg_catalog.pg_get_constraintdef(c.oid) as definicion
  from pg_catalog.pg_constraint c
 where c.conrelid = 'public.reservas_alta'::regclass
 order by c.conname;
-- la PK tiene que ser PRIMARY KEY (email), sin más columnas
-- reservas_alta_email_normalizado_ck → CHECK ((email = lower(btrim(email))))
-- convalidated = true en las dos
--
-- ⚠️ Un CHECK con la expresión buena pero convalidated = false NO cumple el
-- contrato: existe, se lee igual y no garantiza nada sobre lo que ya había.
```

**3 bis · El default de `creado`, y que no haya columnas que rompan el INSERT**

```sql
select column_name, is_nullable, column_default, is_generated, is_identity
  from information_schema.columns
 where table_schema = 'public' and table_name = 'reservas_alta'
 order by ordinal_position;
-- creado → column_default = now()
-- ninguna columna ajena a las tres puede ser NOT NULL, sin default, no
-- generada y no de identidad: el código solo inserta (email, propietario_id)
```

**4 · Los privilegios**

```sql
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'reservas_alta'
 order by grantee, privilege_type;
-- NI 'PUBLIC', NI anon, NI authenticated
-- service_role: SELECT e INSERT
```

Y la comprobación efectiva, que es la que de verdad importa porque tiene en
cuenta lo heredado de `PUBLIC`:

```sql
select
  has_table_privilege('anon',          'public.reservas_alta', 'select') as anon_select,
  has_table_privilege('anon',          'public.reservas_alta', 'insert') as anon_insert,
  has_table_privilege('authenticated', 'public.reservas_alta', 'select') as auth_select,
  has_table_privilege('authenticated', 'public.reservas_alta', 'insert') as auth_insert,
  has_table_privilege('service_role',  'public.reservas_alta', 'select') as srv_select,
  has_table_privilege('service_role',  'public.reservas_alta', 'insert') as srv_insert,
  has_table_privilege('service_role',  'public.reservas_alta', 'update') as srv_update,
  has_table_privilege('service_role',  'public.reservas_alta', 'delete') as srv_delete;
-- los cuatro primeros false · srv_select y srv_insert true
-- srv_update y srv_delete: FALSE. La migración revoca todo a service_role
-- antes de concederle los dos que usa, así que un privilegio heredado de
-- Supabase ya no sobrevive.
```

⚠️ `has_table_privilege` incluye lo heredado de `PUBLIC`. Por eso vale más que
mirar solo `role_table_grants`: si `anon` saliera `true` ahí, hay un grant
heredado que la revocación no alcanzó.

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
