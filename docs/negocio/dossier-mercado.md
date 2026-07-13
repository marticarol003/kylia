# Kylia — Dossier de mercado

> Documento de una sentada sobre **mercado, tamaño, diferenciación y tracción**.
> Pareja del dossier técnico (`docs/tecnico/dossier.md`). Regla de honestidad
> aplicada aquí también: los **datos oficiales van citados**; lo que es
> **estimación va etiquetado como tal**. Ninguna cifra inventada. (2026-07-12)

---

## 1. El mapa de mercado

### 1.1 A quién sirve Kylia (el cliente arquetípico)

> *Hortelano profesional joven (28-40 años), 3-15 hectáreas al aire libre o
> invernadero ligero, cultivos hortícolas, en el arco mediterráneo o vegas
> peninsulares, con smartphone y sin asesor profesional contratado.*

Perfil concreto ("Marc"): segunda generación, decide él su agronomía, obligado por
la PAC a llevar cuaderno digital (hoy en libreta), no tiene 800 €/año para xarvio,
paga 99 €/año sin pestañear si le evita **una** aplicación innecesaria (80-200 €).

**Por qué este segmento y no otro:** acepta tecnología por defecto (cero
evangelización), toma sus propias decisiones (el producto le habla directo, sin
intermediarios), y **convierte a otros** (engancha al padre, al primo, a 2-3
vecinos jóvenes → boca a boca 10×). Está concentrado geográficamente, lo que
permite captación comarca a comarca.

**Geografía de arranque:** Maresme, Empordà, Vega del Segura, Vega de Granada, El
Ejido, Vegas del Guadiana, Mar Menor, La Mojonera.

### 1.2 Segmentos descartados (disciplina de foco, 12-18 meses)

Agricultor mayor tradicional (vendrá del hijo), hobbista (no paga, no genera
dataset), invernadero >30 ha de Almería (ya tiene técnico/xarvio), y
cooperativa/técnico ATRIA — que es **canal** para llegar a Marc, no cliente final.

---

## 2. El tamaño del mercado

> **Aviso de método:** todas las cifras de esta sección son **dato oficial citado**
> (INE Censo Agrario 2020 / EEA 2023 y el análisis de MAPA por OTE y estrato de
> tamaño). Donde el segmento de Kylia no coincide exacto con un corte del Censo (la
> banda "3-15 ha" vs. los estratos 2-5 / 5-10 / 10-20 ha), el SAM se da como
> **rango**, no como número único — se dice, no se disimula.

### 2.1 Anclajes oficiales (dato duro, citado)

| Magnitud | Valor | Fuente |
|---|---|---|
| Explotaciones agrarias en España (Censo 2020) | **914.871** | INE, Censo Agrario 2020 |
| Explotaciones (encuesta estructura 2023) | **784.141** (−12,4 % vs 2020) | INE, EEA 2023 |
| SAU media por explotación (2023) | **30,46 ha** | INE, EEA 2023 |
| Superficie total frutas y hortalizas (2024) | **1.874.537 ha** | MAPA |
| Superficie bajo invernadero (2023) | **55.300 ha** | INE, EEA 2023 |

### 2.2 Embudo hasta el segmento (TAM → SAM → SOM)

El mercado de Kylia **no** son las ~784.000 explotaciones: la mayoría son olivar,
cereal, viña o dehesa, fuera del foco. El dimensionamiento honesto es de abajo
arriba. Las cifras de OTE hortícola y estrato de tamaño son ahora **dato oficial**
(MAPA, análisis del Censo Agrario 2020, Tabla 2):

- **TAM — explotaciones con orientación hortícola en España: ≈ 108.600.**
  - **Horticultura al aire libre: 81.755** explotaciones (**+23 %** vs 2009).
  - **Horticultura de invernadero: 26.823** explotaciones (**+37 %** vs 2009).
  - Dato clave: la horticultura es **la única OTE agrícola que crece** en nº de
    explotaciones (todas las demás — olivar, cereal, viña, leñosos — caen). Kylia
    entra en el único segmento vegetal en expansión.
- **SAM — la banda de tamaño de Kylia.** El Censo agrupa por SAU; la banda de Marc
  (~3-15 ha) cae en los estratos 2-20 ha. En horticultura **al aire libre**:
  - 2-5 ha: **14.496** · 5-10 ha: **11.233** · 10-20 ha: **10.065** →
    **≈ 35.800 explotaciones** en el núcleo de tamaño, solo aire libre.
  - Sumando la mayor parte del invernadero (explotaciones pequeñas: SAU media 1,9 ha)
    y la franja 1-2 ha (10.615), el SAM realista ronda **45.000-55.000 explotaciones**
    antes del filtro geográfico/demográfico.
- **SOM (alcanzable a 18 meses)** — el subconjunto del **arco mediterráneo/vegas**
  con smartphone y sin asesor, captado comarca a comarca desde las 8 zonas de
  arranque + canal cooperativa/jóvenes agricultores. A favor: los jóvenes dirigen el
  **19 % de las explotaciones con invernadero** (vs 8 % en el conjunto agrario) y la
  horticultura es de las OTE con **mejor relevo generacional** — justo el arquetipo
  Marc. El plan operativo fija hitos en **decenas de usuarios** por comarca, no en
  cuota nacional.

### 2.3 De población a ingresos (la aritmética que importa)

Lo defendible no es un TAM grande, sino la **conversión de un ahorro real en pago**:

```
Ingreso ≈ nº_agricultores_segmento × tasa_conversión × precio
Precio  = 99 €/año (o 8 €/mes)          ← ya fijado
ROI para el agricultor: evitar UNA aplicación innecesaria/año (80-200 €) ya paga la suscripción
```

Palancas adicionales de ARPU documentadas: tier cooperativa (una sola cooperativa
aporta más margen que decenas de productores) y, en roadmap, las capas económica y
regulatoria (que justifican precio superior). La **estructura de coste de datos es
~0** (fuentes públicas gratuitas), así que el margen bruto es alto desde el día uno.

> Precisión metodológica: las cifras por OTE y estrato son de las **OTE puras
> agrícolas** del Censo 2020 (excluyen explotaciones mixtas y ganaderas). La banda
> "3-15 ha" de Marc no coincide exactamente con los cortes del Censo (2-5 / 5-10 /
> 10-20 ha), por eso el SAM se da como rango, no como cifra única. Para afinar aún
> más (cruce OTE × tamaño × comunidad autónoma) están los microdatos de INEbase.

---

## 3. Diferenciación de mercado

### 3.1 El reencuadre (la idea fuerte)

> *Los competidores compiten en datos satelitales del campo (1 capa). Kylia compite
> en la decisión completa del agricultor (3 capas: agronómica + económica + regulatoria).*

No es diferencia incremental (UX, precio, localismo), es **cambio de categoría**:
de "agricultura digital" a "inteligencia operativa integral del agricultor".

### 3.2 Las tres capas

1. **Agronómica** — recomendación end-to-end con **producto neutral** del catálogo
   MAPA ("riega 12 L/m² esta tarde", "aplica X 2,5 kg/ha, plazo 7 días"). *Ya
   implementada.* xarvio (BASF) no puede ser neutral; EOSDA/Auravant no bajan al
   producto concreto para no romper con distribuidores.
2. **Económica** — predicción del **precio de venta** de la cosecha (fecha de
   cosecha estimada + precios de lonjas/Mercas + producción nacional por satélite).
   **Nadie en agtech la tiene en producto.** Cambia decisiones de siembra, fecha de
   cosecha y canal. *Roadmap.*
3. **Regulatoria** — asistente proactivo **PAC + fitosanitarios + ecoesquemas**
   ("la PAC cierra en 18 días, te falta el ecoesquema de rotación → +180 €/ha").
   Reemplaza parcialmente a la gestoría (800-2.000 €/año). *Parcial (cuaderno PAC ya
   sale del sistema).*

### 3.3 Mapa competitivo

| Competidor | Modelo | Por qué no completa las 3 capas |
|---|---|---|
| **xarvio** (BASF) | Dashboard para técnicos/agricultores | Dueño de químicos → no puede ser neutral |
| **Auravant** | B2B multifunción para técnicos | Bajar al agricultor pequeño canibaliza su narrativa |
| **VisualNACert** | B2B cooperativa | El cliente final no es el agricultor |
| **EOSDA** | Analítica satelital global | La capa regulatoria española no escala internacional |
| **GeoCampo Pro** | Suite SIGPAC | Capa económica y conversacional fuera de su ADN |
| **Dataris** | B2B maquinaria/ortofotos (drones) para grandes | Cliente y modelo opuestos; no alcanza a 5 ha sin tractor instrumentado |

**Lectura:** todos te dan **datos/mapas para que un técnico decida**; Kylia da **la
decisión directa** al pequeño agricultor. Vienen de la cultura SaaS-dashboard para
técnicos, no de la cultura decisión-operativa para agricultores — no copian las 3
capas sin rediseñar su producto entero. Kylia no compite en su mercado; abre uno
adyacente que ellos no van a ocupar.

### 3.4 El foso propio (moat)

- **Rigor + honestidad como producto** (motor FAO-56 validado, frontera honesta) —
  difícil de replicar por quien solo pinta dashboards, y es lo que da confianza.
- **Dataset contrafactual** (decisión-Kylia × acción-real de cada piloto) — un
  activo de datos que crece con cada campaña y que ningún competidor tiene.
- **Coste de datos ~0** — margen alto; la complejidad de coste solo llega con la
  escala (y para entonces hay ingresos).

---

## 4. Tracción

> Estado real, sin maquillaje. Kylia está en fase de **validación con pilotos
> reales**, no de escala comercial. Lo honesto hoy:

### 4.1 Lo que ya está funcionando

- **3 pilotos silenciosos activos** sobre campos reales, con el método científico
  corriendo (Kylia calla, el cron `diario-b` **congela cada madrugada** la decisión
  en un registro sellado):
  - **Tomate** (eco, goteo) — Breda (Girona).
  - **Cebolla tierna** (eco, aspersión, ~380 m²) — El Tros de l'Uri, La Selva (Girona).
  - **Campo de referencia** (aspersión, ~440 m²) — Sant Boi, como laboratorio abierto
    de comparación (contrafactual Kylia vs. riego real sobre el mismo campo).
- **Primer resultado contrafactual verificado** (piloto de tomate, Breda):
  **23 vs 64 L/m² = ~64 % de ahorro de agua**. Es un dato de motor, no una promesa.
- **Producto en producción** en `kylia.app`, con modo demo (`?demo=1`) **presentado
  en vivo en Lanzadera**.
- **Cuaderno PAC** funcional (el gancho regulatorio ya sale del sistema).

### 4.2 Lo que aún NO hay (honestidad)

- **Sin clientes de pago todavía**: los pilotos son la prueba previa a la conversión.
- **Ningún reveal cerrado aún**: el primer informe final de campaña se cierra a
  **~mediados de agosto 2026** (~2 meses de piloto). Ese es el hito que convierte la
  metodología en evidencia de venta.

### 4.3 El plan de captación (cómo se pasa de pilotos a mercado)

Documentado en `docs/negocio/go-to-market.md`: conversaciones reales (5/semana),
grupos de Telegram/WhatsApp por cultivo, visitas a cooperativas con el panel
agregado, y SEO de cola larga (coste de adquisición → 0). Objetivo temprano:
**30 usuarios Free**, con **20-30 % convirtiendo a Productor** si el producto vale;
si no convierten, la llamada uno a uno es el roadmap.

---

## 5. Fuentes

- INE — [Censo Agrario 2020](https://www.ine.es/censoagrario2020/) y
  [Encuesta sobre la Estructura de las Explotaciones Agrícolas 2023](https://www.ine.es/dyngs/Prensa/EEEA2023.htm).
- MAPA — [Una visión global de la agricultura española a través del análisis del Censo Agrario 2020](https://www.mapa.gob.es/dam/mapa/contenido/ministerio/servicios/servicios-de-informacion/analisis-y-prospectiva/informes-especiales-de-analisis/informemapa_ca2020.pdf) (Tabla 2: explotaciones por OTE y estrato de SAU; datos de horticultura y jóvenes en invernadero).
- MAPA — [Frutas y hortalizas, información general](https://www.mapa.gob.es/es/agricultura/temas/producciones-agricolas/frutas-y-hortalizas/informacion_general)
  y [superficies y producciones anuales de cultivos](https://www.mapa.gob.es/es/estadistica/temas/estadisticas-agrarias/agricultura/superficies-producciones-anuales-cultivos).
- Estrategia interna: `docs/estrategia/anexo-2026-diferenciacion-y-escalado.md`
  (cliente arquetípico, 3 capas, competencia, Dataris) y `docs/negocio/go-to-market.md`.
- Tracción: pilotos reales del proyecto (ver `docs/tecnico/04-piloto-silencioso-y-reveal.md`).
