# Email 01 — Bienvenida (envío inmediato al alta)

**Trigger**: usuario completa registro en `/app.html`

**De**: Kylia <hola@kylia.app>
**Asunto**: Bienvenido a Kylia. Tu primera parcela en 60 segundos.
**Pre-header**: Tres pasos para empezar a ver vigor, humedad y alertas.

---

```
Hola {{nombre}},

Acabas de crear tu cuenta en Kylia. Bienvenido.

Tres cosas que conviene hacer hoy mismo, en este orden:

1. Añade tu primera parcela.
   Click aquí → {{enlace_app}}/parcelas/nueva

   Solo necesitas la referencia SIGPAC (provincia, municipio, polígono, parcela, recinto). Si no la tienes a mano, también puedes hacer click en el mapa.

2. Mira los tres números que te devuelve.
   NDVI = vigor del cultivo (0 a 1). NDMI = agua en la hoja. Humedad de suelo = porcentaje en la capa 0-30 cm.

3. Activa las alertas.
   Las mandamos por email, máximo una a la semana, solo cuando hay un dato fuera de rango. Si quieres también por Telegram, conecta aquí: {{enlace_telegram}}

¿Algo no funciona? Responde a este mismo email, lo recibo yo, no un bot.

Hasta pronto,
Martí — fundador de Kylia
hola@kylia.app

PS — La newsletter "El dato del campo" sale cada lunes a las 9. Te he suscrito por defecto al ser nuevo usuario. Puedes darte de baja en cualquier email con un click. Si prefieres no recibirla, lo entiendo: {{enlace_baja_newsletter}}
```

---

# Email 02 — Alerta semanal de estrés (envío automático cuando se cumple condición)

**Trigger**: NDMI por debajo de 0,30 en alguna parcela del usuario en la última pasada Sentinel-2.

**De**: Kylia <alertas@kylia.app>
**Asunto**: 🚨 Señal temprana de estrés en {{alias_parcela}}
**Pre-header**: NDMI {{ndmi}} (umbral 0,30). Conviene revisar el riego en 48 h.

```
Hola {{nombre}},

Una de tus parcelas tiene una señal temprana de estrés hídrico.

Parcela: {{alias_parcela}} ({{cultivo}}, {{area_ha}} ha)
SIGPAC: {{sigpac_ref}}

Lo que vemos en la última pasada Sentinel-2 ({{fecha_pasada}}):
· NDMI: {{ndmi}}        ← este es el dato preocupante (umbral 0,30)
· NDVI: {{ndvi}}        ← el vigor todavía aguanta
· Humedad suelo: {{humedad_suelo}} %

Por qué importa:
NDMI mide el agua presente en la hoja. Cuando cae por debajo de 0,30 indica que la planta empieza a cerrar estomas para protegerse, aunque a simple vista la hoja todavía está verde. Si dejas pasar 1-2 semanas sin actuar, el NDVI también empieza a caer y ya hay pérdida de productividad real.

Qué te sugiere Kylia:
{{accion_sugerida_humana}}

Ver detalle de la parcela → {{enlace_parcela}}

Si crees que el dato no encaja con lo que ves en campo, dímelo: alertas@kylia.app. Aprendemos cuando nos corregís.

Equipo Kylia
```

---

# Email 03 — Recibo de pago / factura (Stripe envía la factura, este es el resumen humano)

**Trigger**: invoice.paid de Stripe.

**De**: Kylia <facturacion@kylia.app>
**Asunto**: Recibo Kylia · {{periodo}} · {{importe_total}}
**Pre-header**: Cuenta activa hasta {{fecha_proxima_renovacion}}.

```
Hola {{nombre}},

Hemos cobrado correctamente la suscripción de Kylia.

Concepto:    {{plan}}
Periodo:     {{fecha_inicio}} — {{fecha_fin}}
Subtotal:    {{subtotal}}
IVA (21 %):  {{iva}}
Total:       {{total}}

Próxima renovación automática: {{fecha_proxima_renovacion}}.

Factura PDF (formato oficial) → {{enlace_factura_pdf}}

Si necesitas cambiar datos fiscales o método de pago, hazlo aquí: {{enlace_facturacion}}

Cualquier duda, contesta a este email.

Equipo Kylia
```

---

# Email 04 — Recordatorio renovación anual (7 días antes)

**Trigger**: 7 días antes de la fecha de renovación, solo para suscripciones anuales.

**De**: Kylia <facturacion@kylia.app>
**Asunto**: Tu plan {{plan}} se renueva en 7 días
**Pre-header**: Importe {{importe}}. Cancela aquí si no quieres continuar.

```
Hola {{nombre}},

Tu suscripción anual de Kylia se renueva el {{fecha_renovacion}}.

Plan: {{plan}}
Importe: {{importe}} (IVA incluido)
Método: {{metodo_pago_resumen}}

Si quieres seguir, no tienes que hacer nada: el cobro será automático.

Si prefieres cancelar, hazlo en un click aquí, sin preguntas: {{enlace_cancelar}}

Y si quieres cambiar de plan (subir o bajar), aquí: {{enlace_cambiar_plan}}

Gracias por seguir con nosotros un año más.

Equipo Kylia
```

---

# Email 05 — Newsletter semanal "El dato del campo" (programación lunes 9:00)

**Trigger**: programado en Beehiiv cada lunes 9:00.

**De**: Kylia <campo@kylia.app>
**Asunto** (variable cada semana): el ejemplo es la edición #1
**Pre-header** (variable cada semana)

> Plantilla genérica que rota tres bloques: dato de la semana · mini-clase agronómica · caso real anonimizado.

```
[BANNER] semana-1/imagenes/4-newsletter-banner.png

EL DATO DEL CAMPO · KYLIA · {{numero_edicion}}

────────────────

EL DATO DE LA SEMANA

{{dato_semana_titular}}

{{dato_semana_explicacion_corta}}

────────────────

LA MINI-CLASE · {{tema_clase}}

{{texto_mini_clase}}

────────────────

EL CASO DE LA SEMANA · {{titulo_caso}}

{{cuerpo_caso}}

────────────────

¿Quieres ver tus parcelas? Es gratis hasta 30 hectáreas en kylia.app

Hasta el lunes que viene · Kylia
```
