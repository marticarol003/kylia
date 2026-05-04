# Acuerdo de Tratamiento de Datos (DPA) — Kylia Enterprise

**Versión**: 1.0
**Fecha**: 28 de abril de 2026

> **Aviso**: borrador inicial. Para uso real con clientes Enterprise debe revisarse con un abogado especializado en RGPD y adaptarse a la jurisdicción del cliente.

---

## Reunidos

De una parte, **`[Kylia razón social]`**, con CIF `[REVISAR]`, domicilio en `[REVISAR]` (en adelante, el "Encargado del Tratamiento" o "Kylia").

De otra parte, **`[Cliente: razón social]`**, con CIF `[___]`, domicilio en `[___]`, representada por `[___]` (en adelante, el "Responsable del Tratamiento" o "Cliente").

Ambas partes se reconocen capacidad legal para suscribir el presente Acuerdo de Tratamiento de Datos (en adelante, "DPA"), que complementa al Contrato de Servicio firmado entre ellas.

## 1. Objeto

El Cliente contrata a Kylia la prestación del servicio descrito en el Contrato. En el marco de dicho servicio, Kylia tratará datos personales por cuenta y bajo instrucciones del Cliente.

Este DPA regula el tratamiento conforme al artículo 28 del RGPD.

## 2. Naturaleza del tratamiento

### 2.1 Categorías de interesados

- Empleados, técnicos y socios del Cliente con acceso al servicio.
- En su caso, los agricultores asociados a la cooperativa Cliente.

### 2.2 Categorías de datos

- Datos de identificación: nombre, email, teléfono.
- Datos profesionales: cooperativa, rol, parcelas asignadas.
- Datos derivados de uso: logs, IP, dispositivo.

### 2.3 Categorías especiales

**No se tratan categorías especiales** (artículo 9 RGPD).

### 2.4 Finalidad

Prestar el servicio Kylia descrito en el Contrato, incluyendo:

- Autenticación y autorización.
- Visualización de parcelas e índices agronómicos.
- Generación de alertas y comunicaciones de servicio.
- Soporte técnico.

## 3. Duración

El DPA estará vigente mientras lo esté el Contrato de Servicio. Las obligaciones de confidencialidad y devolución/eliminación de datos sobreviven a la terminación.

## 4. Obligaciones de Kylia

Kylia se obliga a:

1. Tratar los datos exclusivamente conforme a las instrucciones documentadas del Cliente.
2. Garantizar la confidencialidad de su personal con acceso a datos.
3. Adoptar medidas técnicas y organizativas apropiadas (anexo II).
4. Asistir al Cliente en el ejercicio de derechos de los interesados.
5. Asistir al Cliente en sus obligaciones de seguridad, notificación de brechas y evaluaciones de impacto.
6. Notificar al Cliente cualquier brecha de seguridad sin demora indebida y, como máximo, en **48 horas**.
7. Devolver o eliminar los datos al finalizar el Contrato, según indique el Cliente, salvo obligación legal de conservación.
8. Permitir auditorías razonables (anexo III).

## 5. Subencargados

El Cliente autoriza el uso de los subencargados listados en el **Anexo I**.

Cualquier alta o cambio de subencargado se notificará al Cliente con **30 días** de antelación. El Cliente puede oponerse por motivos razonables relacionados con protección de datos; si la oposición es justificada y no podemos sustituir al subencargado, ambas partes podrán resolver el Contrato sin penalización.

## 6. Transferencias internacionales

Algunos subencargados están en países fuera del EEE. Las transferencias se realizan al amparo de:

- Cláusulas Contractuales Tipo (Decisión UE 2021/914).
- EU-US Data Privacy Framework, cuando aplique.
- Medidas suplementarias técnicas (cifrado en reposo y tránsito) y organizativas.

## 7. Brechas de seguridad

En caso de brecha:

- Kylia notificará al Cliente en máximo 48 h.
- Aportará los datos necesarios para que el Cliente cumpla con su deber de notificación a la AEPD (72 h).
- Cooperará en la mitigación.

## 8. Auditoría

El Cliente puede auditar el cumplimiento de Kylia una vez al año mediante revisión documental remota. Auditorías presenciales requieren causa justificada y preaviso de 30 días, a coste del Cliente salvo que la auditoría revele incumplimientos sustanciales.

## 9. Indemnización

Las responsabilidades por incumplimientos del DPA se rigen por las cláusulas de limitación de responsabilidad del Contrato de Servicio.

---

## ANEXO I — Subencargados autorizados

| Subencargado | Servicio | Localización datos |
|--------------|----------|--------------------|
| Vercel Inc. | Hosting | Frankfurt (eu-central-1) |
| Supabase Inc. | Base de datos + auth | Frankfurt (eu-central-1) |
| Stripe Payments Europe | Cobros | Irlanda |
| Beehiiv / `[proveedor email]` | Email transaccional | EEUU (con CCT + DPF) |
| `[REVISAR si añadís más]` | | |

## ANEXO II — Medidas técnicas y organizativas

- Cifrado en tránsito: TLS 1.3 obligatorio.
- Cifrado en reposo: AES-256 en base de datos y backups.
- Control de acceso: principio de mínimo privilegio, MFA obligatorio para personal interno.
- Logs de auditoría con retención mínima de 12 meses.
- Backups cifrados, retención 30 días, RPO ≤ 24 h.
- Plan de continuidad y respuesta a incidentes documentado.
- Formación periódica del personal en protección de datos.
- Verificación previa a contratar nuevo personal con acceso a datos.

## ANEXO III — Procedimiento de auditoría

1. El Cliente solicita auditoría con 30 días de preaviso.
2. Kylia entrega: política de seguridad, certificaciones vigentes, listado de subencargados, registro de actividades de tratamiento, último informe de pen-test si lo hubiera.
3. Reunión virtual de aclaración (90 min máximo).
4. Auditoría presencial solo si hay incumplimientos sustanciales no resueltos.

---

**Firmado en `[ciudad]`, a `[fecha]`**

Por Kylia: `__________________________`
Por el Cliente: `__________________________`
