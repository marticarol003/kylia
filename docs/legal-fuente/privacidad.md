# Política de Privacidad

**Última actualización**: 28 de abril de 2026

> **Aviso**: borrador inicial preparado por IA. Antes de publicar revísalo con un DPO o abogado especializado en RGPD. Cláusulas con `[REVISAR]` requieren información concreta de tu setup.

---

## 1. Responsable del tratamiento

- **Razón social**: `[REVISAR — sociedad o nombre del autónomo]`
- **NIF/CIF**: `[REVISAR]`
- **Domicilio**: `[REVISAR]`
- **Email**: `privacidad@kylia.app`
- **Delegado de Protección de Datos (DPO)**: no requerido por el artículo 37 RGPD en esta fase (no hacemos tratamiento masivo de categorías especiales). Si esto cambia, lo actualizaremos aquí.

## 2. Qué datos tratamos y con qué finalidad

### 2.1 Datos que nos das directamente

| Dato | Finalidad | Base legal | Conservación |
|------|-----------|------------|--------------|
| Email, nombre | Crear cuenta, identificación | Ejecución del contrato (art. 6.1.b RGPD) | Mientras la cuenta esté activa + 5 años fiscales |
| Teléfono | Contacto técnico, alertas opcionales | Consentimiento (art. 6.1.a) | Hasta retirada del consentimiento |
| Datos de pago (tarjeta) | Cobro de la suscripción | Ejecución del contrato | No se almacenan en Kylia, los gestiona Stripe |
| Cooperativa, NIF empresa | Facturación B2B | Ejecución del contrato + obligación legal fiscal | 6 años (art. 30 Código de Comercio) |

### 2.2 Datos que generamos

| Dato | Finalidad | Base legal | Conservación |
|------|-----------|------------|--------------|
| Referencias SIGPAC, geometrías, alias de parcela | Prestar el servicio | Ejecución del contrato | Mientras la parcela esté declarada + 12 meses |
| Observaciones (NDVI, NDMI, alertas) | Histórico agronómico | Ejecución del contrato | Mientras la parcela esté declarada + 12 meses |
| IP, user agent, logs de acceso | Seguridad y antifraude | Interés legítimo (art. 6.1.f) | 90 días |
| Cookies analíticas (si das consentimiento) | Mejora del producto | Consentimiento | Ver [Política de Cookies](/cookies) |

### 2.3 Lo que NO tratamos

- **No tratamos categorías especiales** (salud, ideología, origen étnico…) en ningún caso.
- **No identificamos personas a través de la imagen satélite**: la resolución Sentinel-2 (10 m/píxel) no permite identificar individuos.
- **No vendemos ni cedemos datos a terceros con fines comerciales**.

## 3. Con quién compartimos datos (encargados de tratamiento)

| Proveedor | Finalidad | País | Base de transferencia |
|-----------|-----------|------|------------------------|
| Vercel Inc. | Hosting de la aplicación | EEUU | Cláusulas Contractuales Tipo + Data Privacy Framework |
| Supabase Inc. | Base de datos + auth | EEUU (datos en EU) | CCT + DPF; instancia en región europea |
| Stripe Payments | Cobros y facturación | EEUU/Irlanda | CCT + DPF |
| Beehiiv / `[proveedor email]` | Newsletter y emails transaccionales | EEUU | CCT + DPF |
| ESA / Copernicus (Sentinel-2) | Imágenes satélite (datos abiertos) | EU | No aplica (datos públicos abiertos) |
| Ministerio de Agricultura (SIGPAC) | Geometrías de parcelas | España | No aplica (datos públicos abiertos) |
| `[REVISAR — añadir cualquier otro proveedor]` | | | |

Todos los encargados firman contratos conformes al artículo 28 RGPD.

## 4. Tus derechos

Como titular de los datos puedes ejercer los siguientes derechos:

- **Acceso**: saber qué datos tenemos sobre ti.
- **Rectificación**: corregir datos inexactos.
- **Supresión** ("derecho al olvido"): eliminar tus datos cuando ya no sean necesarios.
- **Oposición**: oponerte a tratamientos basados en interés legítimo.
- **Limitación**: pedir que se limite el tratamiento mientras se resuelve una reclamación.
- **Portabilidad**: recibir tus datos en formato estructurado y que se transmitan a otro proveedor.
- **Retirar el consentimiento** en cualquier momento, sin que afecte a la licitud del tratamiento previo.

**Cómo ejercerlos**: escribe a `privacidad@kylia.app` desde la dirección con la que te diste de alta o adjunta copia de documento identificativo. Responderemos en el plazo máximo de **un mes**.

**Reclamación**: si consideras que tus derechos no han sido respetados, puedes reclamar ante la **Agencia Española de Protección de Datos** ([www.aepd.es](https://www.aepd.es)), C/ Jorge Juan 6, 28001 Madrid.

## 5. Seguridad

Aplicamos medidas técnicas y organizativas razonables: cifrado en tránsito (TLS 1.3) y en reposo, control de accesos por roles, logs de auditoría, copias de seguridad cifradas, formación interna en seguridad. Trabajamos en la línea de los principios ENS-Bajo y SOC 2 Type II, sin certificación formal a esta fecha.

## 6. Brechas de seguridad

En caso de brecha que pueda afectar a tus derechos:

- Notificaremos a la AEPD en menos de **72 horas** desde su detección.
- Si el riesgo para ti es alto, te lo comunicaremos directamente sin demora indebida.

## 7. Menores

El servicio está dirigido a profesionales del sector agrícola. No tratamos datos de menores de 14 años. Si detectamos que se ha creado una cuenta de un menor sin autorización parental, la cancelaremos.

## 8. Cambios en esta política

Si hacemos cambios materiales te avisaremos por email con al menos **15 días** de antelación.

## 9. Contacto

`privacidad@kylia.app`
