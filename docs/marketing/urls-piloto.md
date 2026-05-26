# URLs personalizadas para el envío del piloto

Cada enlace lleva un parámetro `?u=<slug>` que queda registrado en Supabase
en el campo `usuarios.origen` y en cada evento de la tabla `eventos`. Esto
permite saber, después del envío, quién (o de qué grupo) abrió la app, hizo
onboarding, registró riegos, etc.

El parámetro se captura en el primer load y se persiste en `localStorage`
como `kylia_origen`. Es invisible para el agricultor.

---

## Cómo usar

**Patrón de URL**:

```
https://kylia.app/app?u=<slug>
```

- `<slug>` debe ser corto, sin acentos, en minúsculas, con guiones.
- Ejemplos: `juan-llobregat`, `grupo-aceite-tarragona`, `pep-vilanova`.

**Recomendación**: usa un slug por persona si conoces el nombre, o uno por
grupo de WhatsApp si vas a difusión amplia.

---

## Ejemplos genéricos por grupo de WhatsApp

| Slug                       | URL completa                                       |
|----------------------------|----------------------------------------------------|
| `grupo-padre-1`            | https://kylia.app/app?u=grupo-padre-1              |
| `grupo-padre-2`            | https://kylia.app/app?u=grupo-padre-2              |
| `grupo-regantes-llobregat` | https://kylia.app/app?u=grupo-regantes-llobregat   |
| `grupo-aceite-tarragona`   | https://kylia.app/app?u=grupo-aceite-tarragona     |
| `grupo-coop-cerveza`       | https://kylia.app/app?u=grupo-coop-cerveza         |

Sustituye los slugs según el grupo donde vayas a enviar el link.

---

## Ejemplos por persona (cuando los nombres te los proporcione tu padre)

| Persona        | Slug             | URL                                       |
|----------------|------------------|-------------------------------------------|
| Juan Soler     | `juan-soler`     | https://kylia.app/app?u=juan-soler        |
| Pep Vilanova   | `pep-vilanova`   | https://kylia.app/app?u=pep-vilanova      |
| Marta Riu      | `marta-riu`      | https://kylia.app/app?u=marta-riu         |
| Antonio López  | `antonio-lopez`  | https://kylia.app/app?u=antonio-lopez     |

> Cambia los nombres por los reales antes de enviar. Cada uno ve la misma app,
> tú ves quién ha hecho qué consultando la tabla `usuarios` en Supabase
> (columna `origen`) y filtrando por slug.

---

## Cómo consultar quién ha abierto qué (en Supabase Studio)

En el SQL Editor de Supabase, una vez que la gente empiece a entrar:

```sql
-- Listado de pilotos con su origen
select id, nombre, email, ciudad, cultivos, origen, fecha_alta
from usuarios
order by fecha_alta desc;

-- Cuántos eventos hay por origen (efectividad del canal)
select u.origen, count(*) as eventos
from eventos e
left join usuarios u on u.id = e.usuario_id
group by u.origen
order by eventos desc;

-- Pilotos que han completado al menos una jornada
select u.nombre, u.origen, count(j.id) as jornadas
from usuarios u
left join jornadas j on j.usuario_id = u.id
group by u.id
order by jornadas desc;
```

---

## Plantilla de mensaje WhatsApp

Texto base. Pega un emoji al inicio para que destaque.

```
🌱 Hola, te paso una herramienta gratis de agricultura por satélite que
estamos probando esta campaña. Es web, sin instalar nada, solo abres el
link en el móvil:

https://kylia.app/app?u=grupo-padre-1

Si te animas, en menos de 1 minuto ves tu parcela y a partir de ahí solo
tienes que ir cerrando un diario rápido al final del día (riego, qué
aplicaste, qué viste). Yo estoy detrás resolviendo dudas — escríbeme
por WhatsApp al 634891471 si algo no encaja.

Gracias por probar.
```

Sustituye `grupo-padre-1` por el slug que toque en cada grupo.
