# Runbook operativo: poner pilotos en marcha y que quede todo registrado

> Pasos prácticos para (A) activar el **piloto silencioso** y (B) montar el
> **campo del padre** (laboratorio abierto). "Que quede todo registrado" son dos
> flujos: lo que **Kylia decide** (cron Diario B → `recomendaciones_log`) y lo que
> el **agricultor hace** (su diario → `acciones`/`jornadas`).
>
> Detalle técnico del registro en [`shadow-log-recomendaciones.md`](shadow-log-recomendaciones.md)
> (§5 el cron, §6 el runbook). Diferencia conceptual sombra vs laboratorio en
> [`../estrategia/validacion-laboratorio-vs-sombra.md`](../estrategia/validacion-laboratorio-vs-sombra.md).
> Última actualización: 2026-06-04.

---

## A · Pilotos silenciosos (Kylia CALLA)

En estos pilotos Kylia observa y **no muestra recomendaciones** (modo piloto) — para no
contaminar las decisiones del agricultor. Su decisión se **congela** cada noche en servidor.

### A.0 · Una sola vez — infraestructura
1. **Limpia los datos de prueba** si cargaste el seed (el paso siguiente sella la tabla):
   ```sql
   delete from recomendaciones_log where usuario_id = '7c1e9a04-2b6f-4d8a-9f10-3a5e7c0b1d22';
   ```
2. **Ejecuta en el SQL Editor de Supabase** (en orden):
   - `db/diario-b-produccion.sql` → registro append-only (sellado) + columna `piloto_sombra`.
   - `db/onboarding-riego-unidades.sql` → columnas `caudal`, `area_m2`, `capacidad_regadera`.
3. **Variables de entorno en Vercel**:
   - `DIARIO_B_LIVE = 1`  (activa la escritura; sin esto el cron corre en dry-run y no graba)
   - `DIARIO_B_TOKEN = <un secreto>`  (protege el endpoint)

### A.1 · Por cada piloto
4. **Que complete el onboarding en la app** una vez: parcela (ubicación), cultivo,
   **tipo de suelo**, **fecha de plantación** y método de riego. Sin estos datos el motor
   no puede decidir bien (ver `motor-de-decision.md` §3.2e).
5. **Márcalo como piloto silencioso** en Supabase:
   ```sql
   update usuarios set piloto_sombra = true where email = 'su-email@ejemplo.com';
   ```
6. *(Recomendado)* añádelo a `PILOTOS_JSON` en Vercel → recibe el recordatorio de las 17:00
   para **rellenar su diario** (eso registra lo que él hizo de verdad: riegos, tratamientos).

### A.2 · Comprobar que graba
7. **Prueba en seco** (no escribe): abre `https://kylia.app/api/diario-b?dry=1` → debe listar
   las decisiones de tus pilotos marcados.
8. **Al día siguiente** de activar, comprueba en Supabase que hay **una fila por piloto** en
   `recomendaciones_log` con `contexto.fuente = "diario-b"` y `fecha` de ese día.

> **En una frase:** SQL de producción → marcar pilotos (`piloto_sombra=true`) →
> `DIARIO_B_LIVE=1` → comprobar al día siguiente. A partir de ahí el cron congela solo la
> decisión de cada piloto cada noche, abran la app o no.

---

## B · El campo del padre (laboratorio abierto — Kylia HABLA)

Aquí es **al revés** que los silenciosos: quieres que Kylia **muestre** la recomendación para
seguirla, medir y calibrar (las 6 lechugas regadas con regadera). Es el Nivel 1 de validación.

### B.1 · Dar de alta el campo (en la app, modo demo)
1. Entra en la app en **modo demo** (las recomendaciones se ven; en modo piloto estarían ocultas).
2. Completa el onboarding con los datos **reales** del bancal:
   - **Ubicación** del campo (para clima/ET₀).
   - **Cultivo**: lechuga.
   - **Tipo de suelo**: arenoso / franco / arcilloso (si tenéis análisis, mejor).
   - **Fecha de plantación**: 2026-06-04.
   - **Método de riego**: **Regadera**.
   - **Superficie (m²)** del bancal y **capacidad de la regadera (L)** → con esto Kylia te dice
     directamente *"echa 2 regaderas"* en vez de litros/m².
3. A partir de ahí, **sigue la recomendación** y **registra cada riego** en el diario de la app
   (cuántas regaderas / litros). Eso llena `acciones` con lo que hicisteis de verdad.

### B.2 · Para que quede registrado lo que Kylia decidió (comparar luego)
4. Marca también el usuario del campo como `piloto_sombra = true`:
   ```sql
   update usuarios set piloto_sombra = true where email = 'campo-padre@ejemplo.com';
   ```
   Así el cron **congela cada noche** la decisión de Kylia para ese campo, además de que tú la
   ves en la app. (El dedupe evita duplicados si la app ya registró la del día.)
5. **Al final del ciclo**, el análisis es cruzar:
   - `recomendaciones_log` (lo que Kylia habría hecho, en mm/regaderas) **vs**
   - `acciones` (lo que regasteis de verdad) → divergencia + ahorro/estrés.

### B.3 · Notas del experimento (6 lechugas)
- **El satélite no aplica** a esta escala (Sentinel-2 son píxeles de 10 m): se valida el motor
  de **riego (clima/FAO-56)**, que es el modelo estrella. Las tarjetas de satélite saldrán vacías.
- **La regadera es una ventaja**: el agua es **medida** (cuentas regaderas) → números limpios.
- Los **primeros días** Kylia puede quedarse algo corta (plántula regada a mano = suelo húmedo,
  Kc_ini real sube). Es esperado.
- Mantén las 6 lechugas iguales en todo lo demás; si quieres "jugar", riega 3 como diga Kylia y
  3 como siempre, para notar la diferencia (con n=3 es anecdótico, no prueba).

---

## Resumen de archivos implicados
| Qué | Dónde |
|---|---|
| Sellar registro + flag piloto | `db/diario-b-produccion.sql` |
| Columnas de unidad de riego | `db/onboarding-riego-unidades.sql` |
| Cron que congela la decisión | `api/diario-b.js` (Vercel cron 06:00 UTC) |
| Motor de riego (compartido) | `api/_motor-riego.js` |
| Recordatorio del diario | `api/recordatorio-wizard.js` + `PILOTOS_JSON` |
