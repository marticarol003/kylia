# Kylia · Anexo estratégico — Diferenciación, cliente y escalado

**Mayo 2026 · Martí Carol**

*Proyecto desarrollado en colaboración con la UPC. Participante en Santander X Explorer.*

Este anexo complementa `vision-y-roadmap.html` con seis cuestiones que se trabajaron en sesión específica:

1. Cliente arquetípico para los primeros 12-18 meses.
2. Diferenciación frente a competencia sectorial — reencuadre del eje competitivo.
3. La IA como motor fundamental del producto: del agente conversacional con tools.
4. El futuro de la agricultura y los cuatro vectores de convergencia con IA.
5. Opcionalidad estratégica: por qué Kylia es robusta a varios escenarios futuros.
6. Path a enterprise: cómo se llega a las grandes empresas sin morir en el intento.

El documento principal mantiene la tesis y la hoja de ruta a 5 años. Este anexo aterriza decisiones operativas y refina la narrativa para inversores, pilotos y partners.

---

## 1. Cliente arquetípico: el joven hortícola incorporado

El error más caro al inicio es querer servir a "cualquier cliente": agricultor, técnico, propietario, gran empresa. Un producto para todos es un producto para nadie. La disciplina estratégica exige elegir uno y solo uno para los primeros 12-18 meses.

### 1.1 Arquetipo

> **Marc, 32 años. El Maresme. 8 hectáreas de lechuga, col y calabacín al aire libre. Segunda generación. Vive con sus padres en la casa del campo. Vende a una cooperativa local y a 3 fruterías en Barcelona. Usa Instagram y WhatsApp todo el día, sigue cuentas como @AgroJordi. Su padre quiere hacer las cosas como siempre; él quiere modernizar pero no tiene 800 €/año para xarvio. Lleva el cuaderno PAC en libreta y le agobia. Una mala decisión de riego o tratamiento le rompe el margen de la semana.**

En una frase para pitch:

> *Hortelano profesional joven (28-40 años), 3-15 hectáreas al aire libre o invernadero ligero, cultivos hortícolas hispanos, en el arco mediterráneo o vegas peninsulares, con smartphone y sin asesor profesional contratado.*

### 1.2 Por qué él y no otro arquetipo

| Razón | Implicación |
|---|---|
| Acepta tecnología por defecto | Cero coste de evangelización. No hay que convencerle de usar una app. |
| Toma sus propias decisiones agronómicas | El producto le habla directamente, no requiere intermediarios. |
| Necesita datos para defenderse frente al padre | Valor emocional añadido: la app le da munición argumental. |
| Obligado por la PAC a llevar cuaderno digital | Hoy lo hace en libreta o Excel. La app le quita ese marrón gratis. |
| Convierte a otros perfiles | Engancha al padre (cliente 2), al primo (3) y a 2-3 vecinos jóvenes. Boca a boca 10x más fuerte. |
| Paga 99 €/año sin pestañear | Si evita *una* aplicación innecesaria al año (80-200 €), ROI trivial. |
| Concentrado geográficamente | Maresme, Empordà, Vega del Segura, Vega de Granada, El Ejido, Vegas del Guadiana, Mar Menor, La Mojonera. Captación comarca a comarca. |

### 1.3 Arquetipos descartados (de momento)

- **Agricultor mayor tradicional**: bajo techo digital. Vendrá del hijo, no directamente.
- **Hobbista / huerto urbano**: no paga 99 € y no genera dataset agronómico real.
- **Productor ecológico**: buen segundo perfil, pero requiere catálogo de productos eco aún no mapeado.
- **Invernadero mediano >30 ha (Almería)**: ya tiene técnico y/o paga xarvio. Aquí se pierde.
- **Cooperativa / técnico ATRIA**: es *canal* para llegar a Marc, no cliente final hoy.

### 1.4 Canales de captación específicos

- **Instagram + TikTok** orgánico con cuenta personal del fundador. Estos chicos compran a personas, no a marcas.
- **Asociaciones de jóvenes agricultores**: ASAJA Jóvenes, COAG Jóvenes, UPA Jóvenes, Unió Joves (Cat). Cada una con grupos WhatsApp activos.
- **Ferias especializadas**: Fruit Attraction (Madrid, octubre); secundarias Sant Miquel (Lleida), Hortícola del Maresme.
- **Congresos PAC y cuaderno digital**: charlas comarcales constantes con asistencia obligada.
- **LinkedIn build-in-public**: posts contando el proceso atraen a otros incorporados al campo.

### 1.5 Implicaciones operativas

Si el arquetipo es Marc, todo lo que se haga durante los próximos 12 meses debe pasar el filtro "¿esto le sirve a Marc?". En particular:

- **Landing**: hablarle a él, no al sector. Foto de hortícola joven con móvil en mano, no de dron sobre cereal.
- **Catálogo**: priorizar hortícolas al aire libre + invernadero ligero. Olivar/viña/cereal fuera por ahora.
- **Cuaderno PAC exportable**: subir prioridad. Es su mayor dolor regulatorio.
- **Tono UX**: directo, no paternal. Marc no necesita que le expliques qué es NDVI; necesita que le digas qué hacer.
- **WhatsApp como canal de soporte principal**: ya está, refuérzalo.
- **Pricing**: 99 €/año está bien. Considerar también 8 €/mes para que sea "una caña al mes".

---

## 2. Diferenciación frente a competencia — reencuadre del eje competitivo

### 2.1 El problema con la respuesta "estándar"

Cuando un evaluador pregunta "¿en qué te diferencias de Auravant, VisualNACert, xarvio, EOSDA, GeoCampo Pro?", las respuestas habituales son:

- "Mejor UX"
- "Más barato"
- "Más local"
- "Más rápido en iterar"

Todas son verdad pero ninguna es suficiente. Son diferencias **incrementales** dentro del mismo eje competitivo. El evaluador serio piensa: "vale, pero ellos tienen más capital, más equipo y más años".

### 2.2 La idea fuerte: cambio de eje competitivo

> *Los cinco competidores compiten en datos satelitales del campo (1 capa). Kylia compite en la decisión completa del agricultor (3 capas: agronómica + económica + regulatoria).*

Esto no es diferencia incremental, es cambio de categoría. Pasamos de "agricultura digital" a "inteligencia operativa integral del agricultor".

### 2.3 Las tres capas

#### Capa agronómica — recomendación end-to-end con producto neutral

"Riega 12 L/m² esta tarde", "Aplica oxicloruro de cobre 2,5 kg/ha en Coop X a 12 €/kg, plazo 7 días". Catálogo MAPA neutral con validador anti-alucinación. Esto ya está implementado.

- **xarvio** no puede ser neutral (es BASF, empuja BASF).
- **EOSDA, Auravant** no llegan al producto concreto deliberadamente — no quieren romper relaciones con distribuidores.

#### Capa económica — predicción de precio de venta de la cosecha

**Esta es la pieza diferencial más grande, y nadie en agro-tech la tiene en producto.** Combina:

- Fecha estimada de cosecha (modelo fenológico sobre cultivo y zona).
- Precios históricos de Mercabarna, Mercamadrid, lonjas comarcales (datos públicos).
- Producción nacional estimada (satélite, fácil para hortícolas).
- Meteorología extendida.

Output al agricultor:

> *"Tu calabacín saldrá la semana del 12-18 de julio. Precio estimado: 0,42-0,55 €/kg. Si retrasas la cosecha 5 días, los modelos apuntan a 0,55-0,68 €/kg porque dos zonas productoras del Levante terminan campaña ese fin de semana."*

Cambia decisiones de siembra, fecha de cosecha y canal de venta. Hoy esa información solo la tienen los grandes mayoristas y comisionistas — los agricultores pequeños la desconocen sistemáticamente.

#### Capa regulatoria — asistente proactivo PAC + fitosanitarios + ecoesquemas

El agricultor tiene tres jefes: el clima, el mercado y la administración. La administración es la que más miedo da y la que peor herramienta tiene. Kylia notifica proactivamente:

- *"La PAC cierra en 18 días, tu solicitud actual no incluye el ecoesquema de rotación → +180 €/ha. ¿Quieres añadirlo?"*
- *"El producto X que aplicaste el mes pasado pierde su autorización el 15 de julio. Tienes stock por 3 ha, úsalo antes."*
- *"Aviso oficial de COREN/Junta: zona de riesgo de mildiu en 30 km en próximos 7 días."*

Esto es lo que hoy hace una gestoría agraria por 800-2.000 €/año, reactiva y en papel. Una capa regulatoria en la app reemplaza parcialmente a la gestoría con ahorro real.

### 2.4 Por qué los competidores no van a copiar las tres capas

| Competidor | Por qué no completa las 3 capas |
|---|---|
| Auravant | Producto multifuncional B2B para técnicos. Bajar a "decisión integral del agricultor pequeño" canibaliza su narrativa profesional. |
| xarvio (BASF) | Dueño de productos químicos. Cualquier neutralidad de catálogo daña su negocio matriz. |
| VisualNACert | Modelo B2B cooperativa, el cliente final no es el agricultor. Capa económica y regulatoria no son su producto. |
| EOSDA | Producto global con énfasis en analytics satelital. Capa regulatoria española es trabajo local que no escala internacionalmente. |
| GeoCampo Pro | Suite de gestión integrada SIGPAC. Ya cubre parte de la regulatoria, pero la capa económica y la conversacional con IA están fuera de su ADN. |
| Dataris | Analítica B2B de maquinaria/ortofotos para explotaciones grandes. Cliente y modelo (drones + maquinaria) opuestos al pequeño agricultor; ni capa económica ni regulatoria PAC. Ver §2.5. |

### 2.5 Dataris y el ecosistema agtech español

**Dataris** (dataris.es · Alicante · cofundador Guillermo Mateo · acelerada en Lanzadera) es otra agtech española que conviene conocer para demostrar dominio del ecosistema local más allá de los grandes (xarvio/BASF). **No es competidor frontal: juega en el campo opuesto.**

Qué hace — plataforma **B2B de analítica de operaciones para explotaciones grandes**, cuatro patas:

1. **Análisis multimaquinaria** — lee ficheros de máquinas (KML, Shapefile) para evaluar calidad de aplicación aérea, fertilización y cosecha.
2. **Análisis de ortofotos con IA** — contar plantas, densidad, vigor (vía drones).
3. **Operaciones digitales** — pasar partes de papel a digital, funciona sin internet.
4. **GIS agrícola** — mapeo y delimitación de parcelas.

Cliente: operaciones grandes ("Trusted by the leaders"), industria azucarera, palma, centros de I+D, gente con drones.

| Eje | Dataris | Kylia |
|---|---|---|
| Cliente | Gran explotación / industria / I+D | Pequeño agricultor (3-15 ha), B2C |
| Quién actúa | El técnico / gestor de la operación | El agricultor que riega, con el móvil en el campo |
| Qué entrega | Mapas, análisis de maquinaria y ortofotos (datos para interpretar) | La decisión: "riega 12 L/m² esta tarde" |
| Input | Drones, ficheros de maquinaria, ortofotos | Satélite gratis + meteo + SIGPAC (cero hardware) |
| Capas | Una: analítica de campo | Tres: agronómica + económica + regulatoria |
| Catálogo de producto | No | Catálogo MAPA curado + validador anti-alucinación |
| Foso de datos | Operacional de cada cliente | Dataset contrafactual (decisión-Kylia × acción-real) |

Lectura: Dataris es la misma categoría que Auravant/xarvio — **te da datos/mapas para que un técnico decida**; Kylia da la decisión directa al pequeño agricultor. Su modelo (drones + maquinaria instrumentada) **no escala al agricultor de 5 ha sin tractor instrumentado**. Riesgo a vigilar: su pata de ortofotos-IA es buena tecnología y podría bajar a fincas medianas, pero estructuralmente no alcanza al arquetipo Marc.

### 2.6 Frase resumen para pitch o respuesta a evaluador

> *La diferenciación no es UX, ni dataset, ni neutralidad — esas son consecuencias. La diferenciación real es de categoría: mientras los cinco competidores compiten en datos satelitales del campo (1 capa), Kylia compite en la decisión completa del agricultor (3 capas: agronómica con producto concreto, económica con predicción de precio de venta, regulatoria con asistente PAC + fitosanitarios + ecoesquemas). Ninguno de los cinco tiene las tres capas hoy, ni puede tenerlas sin rediseñar su producto entero — porque vienen de la cultura SaaS-dashboard para técnicos, no de la cultura decisión-operativa para agricultores. Kylia no compite en el mismo mercado que ellos; abre uno adyacente que ellos no van a ocupar.*

---

## 3. La IA como motor fundamental: del agente conversacional con tools

### 3.1 Tres niveles de profundidad de "IA en el producto"

| Nivel | Qué hace | Estado en Kylia |
|---|---|---|
| 1. IA decorativa | Genera párrafos sobre datos ya calculados | ✓ Implementado (Gemini análisis + reescritura) |
| 2. IA selectora | Elige entre opciones predefinidas | ✓ Parcial (sugerencia-producto) |
| 3. **IA agente** | **Razona, decide y actúa con tools sobre los datos** | Pendiente |

El salto cualitativo está del nivel 2 al 3. Ahí está la diferenciación estructural.

### 3.2 Arquitectura "Kylia Agente"

El núcleo del producto deja de ser una app con secciones (parcela, recomendaciones, historial, alertas) y pasa a ser **un agente conversacional con tools que cubre las tres capas** (agronómica, económica, regulatoria). El usuario habla; el agente razona, llama herramientas, valida y responde con acción.

**Stack de tools del agente (8-12 inicialmente):**

- `obtener_estado_parcela` (NDVI, NDMI, humedad de suelo, ET₀)
- `prevision_meteo`
- `balance_hidrico`
- `consultar_catalogo_mapa` (productos autorizados por cultivo + plaga)
- `historico_usuario`
- `predecir_precio_cosecha` (capa económica)
- `verificar_regulacion_pac` (capa regulatoria)
- `red_pares_zona` (observaciones de otros agricultores en 10 km)
- `registrar_accion` (escribe en cuaderno de explotación)
- `simular_escenario` (AquaCrop-lite, Fase 2 del documento principal)

### 3.3 Ejemplo de interacción real

Marc abre Kylia el martes a las 14:30, en el campo, manos sucias. Pulsa el botón micrófono:

> Marc: *"Kylia, mis tomateras están con manchas amarillas en las hojas bajeras, ¿qué hago?"*

El agente, internamente:

1. `obtener_estado_parcela` → NDVI 0.48, descenso 0.07 en 7 días
2. `prevision_meteo` → 3 días con humedad nocturna 88%, 25°C
3. `red_pares_zona` → 2 reportes de mildiu en 8 km esta semana
4. `historico_usuario` → última aplicación cobre hace 28 días
5. Razona: alto riesgo mildiu, no deficiencia nutricional
6. `consultar_catalogo_mapa` → oxicloruro de cobre autorizado, 2,5 kg/ha
7. `verificar_regulacion_pac` → cumple ecoesquema y plazo
8. Genera respuesta:

> Kylia: *"Por lo que veo, no parece deficiencia: tres días con humedad nocturna >85% + 2 vecinos cerca con mildiu confirmado + tu NDVI bajando 0.07 en una semana = inicio de mildiu probable. Te recomiendo oxicloruro de cobre 2,5 kg/ha hoy antes de las 19h. Plazo de seguridad 15 días. ¿Quieres que lo registre en tu cuaderno PAC cuando lo apliques?"*

Marc dice "Sí". El agente registra la aplicación, actualiza el plazo de seguridad, genera el aviso de cosecha y guarda el dataset para entrenamiento futuro.

**Esto es IA como motor.** Ningún competidor lo tiene. Técnicamente no es ciencia ficción: es ingeniería de 6-10 semanas usando Claude tool use o function calling de Gemini.

### 3.4 Por qué es diferenciación radical

Hoy todos los competidores funcionan así: "Aquí tienes 12 capas de mapas, interpreta tú". El agricultor pequeño no quiere 12 capas, quiere **una conversación**. El producto IA-agente le habla, le pregunta, le actúa.

Para el evaluador, esto resuelve la pregunta "¿qué te diferencia?" con una sola frase:

> *"Los competidores son herramientas de consulta para técnicos. Kylia es un agente IA con tools que toma decisiones operativas integrales junto al agricultor. Distinto producto, distinta categoría."*

### 3.5 Plan operativo del agente

| Fase | Plazo | Entregable |
|---|---|---|
| MVP agente | 8-12 semanas | Endpoint `/api/agent` con 6 tools básicas + UI chat en la app |
| Tools diferenciadoras | +4 semanas | Predictor de precio + asistente regulatorio |
| WhatsApp como canal | +4 semanas | Mismo agente, misma memoria, segundo canal |

### 3.6 Costes estimados a escala

| Usuarios activos | Consultas/día | Coste IA (Sonnet 4.6 o Gemini 2.5 Pro) |
|---|---|---|
| 200 | 600 | 6-30 €/día |
| 2.000 | 6.000 | 60-300 €/día → optimizar con cache + modelo barato para queries simples |
| 20.000 | 60.000 | Pasa a tener sentido fine-tunear modelo propio (Fase 4 del doc principal) |

---

## 4. El futuro de la agricultura: cuatro vectores de convergencia con IA

### 4.1 Fuerzas estructurales reales (no opinables)

- **Demografía**: edad media del agricultor español >61 años. Solo el 8% tiene menos de 40. Cada año cierran 10-15.000 explotaciones. En 1990 había 1,6 M; hoy 700.000.
- **Cambio climático**: España va a perder 5-15% de superficie cultivable útil para 2050 por sequía y salinización. Vega del Segura, Almería, La Mancha — en estrés hídrico crítico ya hoy.
- **Regulación EU**: Pacto Verde + Farm to Fork → 50% menos fitosanitarios en 2030, 20% menos fertilizantes nitrogenados.
- **Costes input al alza**: energía, agua, fertilizante, mano de obra (la que queda).
- **Demanda creciente**: 9.700 M de humanos en 2050. Hace falta 60-70% más alimento con menos recursos.
- **Geopolítica**: COVID + Ucrania mostraron que la soberanía alimentaria es vulnerabilidad. Europa quiere producir más en casa.

Conclusión: la agricultura tiene que producir más con menos, en condiciones más duras, con menos gente y más regulación. **La IA no es un lujo, es la única vía**.

### 4.2 Los cuatro vectores

#### A. Agricultura de precisión a nivel parcela (ya está pasando)

Satélite + drones + sensores + IA generan mapas de variabilidad dentro de la parcela. Riego variable, abonado variable, pulverización selectiva. Resultado probado: 20-40% menos agua, 15-30% menos fertilizante, 20-50% menos fitosanitario. Terreno de Auravant, xarvio, John Deere, Climate FieldView.

#### B. Robótica agrícola (5-15 años para llegar al campo medio)

Tractores autónomos, robots de cosecha de fresa/lechuga, control de malas hierbas con láser (Carbon Robotics, FarmWise), pulverización selectiva planta-a-planta. Elimina hasta el 90% del químico y resuelve la falta de mano de obra. CapEx alto: solo accesible a explotaciones grandes durante 10+ años más.

#### C. IA como asesor agronómico ubicuo — *aquí juega Kylia*

Acceso al consejo experto para los 500 millones de pequeños agricultores que no tienen agrónomo. Decisión a decisión, en su idioma, en su contexto. Captura outcomes que mejoran el modelo. **La democratización del conocimiento agronómico**, análogo a lo que Internet hizo con el conocimiento general.

#### D. Sistema agroalimentario inteligente (10-20 años)

IA que predice demanda → agricultor planifica cultivo. Mercados optimizados, contratos prefijados, seguros paramétricos automáticos, carbono y nitrógeno medidos y monetizados, trazabilidad granja-a-plato. Requiere coordinación regulatoria europea y madurez previa de las capas A-C.

### 4.3 Convergencia: el agente IA es el orquestador

Los cuatro vectores convergen. **El agente IA del nivel C es el orquestador que conecta los otros tres**: te dice qué hacer, llama a tu robot (B), consulta tu satélite y sensores (A), registra para el sistema alimentario (D).

### 4.4 El escenario ideal — el agricultor amplificado

El sector vende dos visiones, ambas equivocadas:

- *Grandes corporaciones*: "agricultura 4.0, transformación digital, IoT, big data". El agricultor se convierte en operador de software complejo que paga 800 €/ha/año. La mayoría se queda fuera.
- *Puristas nostálgicos*: "el campo siempre necesitará al agricultor con su intuición; la tecnología deshumaniza". La realidad demográfica los aplasta.

El escenario ideal es uno tercero, que casi nadie articula bien: **el agricultor amplificado**.

> Un agricultor de 8 hectáreas en el Maresme, con smartphone, sensores baratos de suelo, visita semanal de drone de la cooperativa y un agente IA que conoce su parcela mejor que él mismo, puede producir lo mismo que una explotación de 80 hectáreas hace 20 años, usando 50% menos agua, 70% menos químico, cumpliendo toda la regulación sin papeleo manual, vendiendo directamente a restaurantes con precios en tiempo real, asegurándose paramétricamente, asesorado 24/7 al nivel de un agrónomo senior. Y dedicando su atención humana a lo que importa: oficio artesanal, decisiones estratégicas, relación con el cliente final.

El agricultor no se reemplaza, **se libera del trabajo cognitivo de baja calidad** (cuándo regar, qué dosis, qué papel firmar) para dedicarse al trabajo de alto valor. Es lo mismo que pasó con el médico tras el copiloto IA: no se eliminó al médico, se liberó de tareas repetitivas para enfocarse en lo difícil.

### 4.5 Frase síntesis

> *El agente IA agronómico es para el agricultor del siglo XXI lo que el tractor fue para el del siglo XX: no le reemplaza, le multiplica. Quien construya ese agente para el mundo hispanohablante define cómo se hace agricultura en la mitad del planeta durante los próximos 30 años.*

---

## 5. Opcionalidad estratégica: por qué Kylia es robusta a varios escenarios

### 5.1 No hay UN futuro, hay varios escenarios

| Escenario | Qué pasa | Probabilidad estimada |
|---|---|---|
| A. **Agricultor amplificado** | Pequeño sobrevive gracias a IA + sensores baratos + robótica accesible | 30-45% |
| B. **Consolidación industrial** | Pequeños cierran, todo lo absorben mega-explotaciones corporativas | 30-40% |
| C. **Ruptura urbana / vertical farming** | Parte de la hortícola migra a granjas verticales y producción urbana intensiva | 10-20% |
| D. **Disrupción climática severa** | Cambio climático fuerza migración geográfica + cambio brusco de cultivos | 10-15% |
| E. **Status quo digital lento** | Cambios graduales, los grandes adoptan IA, los pequeños no | 15-20% |

Las probabilidades no suman 100% porque los escenarios no son excluyentes — la realidad será una mezcla. Lo más probable es A+B simultáneos: muchos pequeños cierran, los que sobreviven son los digitalmente activos.

### 5.2 La opcionalidad de Kylia

> En TODOS los escenarios, el agente IA agronómico tiene valor. Solo cambia quién lo usa y quién lo paga.

| Escenario | Cliente principal |
|---|---|
| A. Agricultor amplificado | Agricultor pequeño directamente (B2C) |
| B. Consolidación industrial | Gestor de mega-explotación corporativa (enterprise) |
| C. Ruptura urbana | Operador de granja vertical (nicho premium) |
| D. Disrupción climática | Supervivientes adaptando cultivos rápidamente |
| E. Status quo lento | Digitalmente activos de cualquier tamaño |

Kylia tiene **opcionalidad estratégica**: si te equivocas de cliente al principio, el producto sigue siendo valioso para otro cliente. La tecnología subyacente (agente + tools + dataset agronómico) NO depende del escenario que se materialice.

### 5.3 Lo que SÍ es altamente probable (>80%)

- El agrónomo humano seguirá siendo escaso.
- La regulación agronómica seguirá creciendo.
- El coste de un agente IA seguirá bajando.

Estas tres tendencias garantizan demanda de la categoría, independientemente del escenario.

---

## 6. Path a enterprise: cómo se llega a las grandes empresas

### 6.1 Lo que NO funciona — empezar por enterprise

Es el error más caro de las startups B2B. Ciclo de venta 9-18 meses, exigen integración SAP, SLA 99.9%, certificaciones ISO/SOC2, KAM dedicado. El primer contrato te enseña que el producto que necesitan es DISTINTO del que tenías. Mueres antes de cerrarlo.

### 6.2 Lo que SÍ funciona — el patrón Stripe / Bloomberg / Airbnb

Construir producto y marca con 500-2.000 pequeños agricultores. Demostrar ROI y retención. **Con eso en la mano, las cooperativas y aseguradoras te llaman a ti.** La validación viene del campo, no del despacho.

| Referente | Empezó vendiendo a... | Hoy también vende a... |
|---|---|---|
| Stripe | Developers de startups web | Amazon, Shopify, todo el sector pagos |
| Bloomberg | Traders de renta fija | Toda la industria financiera global |
| Airbnb | Diseñadores en convenciones SF | Compite con grandes cadenas hoteleras |
| Salesforce | SMB con CRM básico | 60% del CRM enterprise mundial |

### 6.3 Camino realista de Kylia a enterprise (5-7 años)

| Año | Movimiento | Métrica clave |
|---|---|---|
| 1-2 | 500-2.000 agricultores pequeños pagando | Retención >50% a 12 meses, NPS >40 |
| 2-3 | Primer piloto B2B con cooperativa pequeña (10-30 socios) | 1 contrato anual, revenue share por hectárea |
| 3-4 | Primera aseguradora paramétrica firma contrato de datos | 1 contrato de 6 cifras |
| 4-5 | Primera gran cooperativa o cadena en white-label (Anecoop, Mercadona) | Revenue share por hectárea bajo su marca |
| 5-7 | API B2B abierta para integradores agrícolas | 3-5 partners API consumiendo |

### 6.4 Cuatro vías concretas de monetización enterprise

#### Vía 1 — API B2B
Tu agente, tus tools, tu catálogo MAPA — como servicio. Cliente paga por consultas/mes o por hectáreas gestionadas. Clientes objetivo: cooperativas grandes (Cajamar, Anecoop), distribuidores de inputs, administraciones autonómicas.

#### Vía 2 — White-label
Cooperativa o cadena pone su marca encima del producto. "Mercadona Agronomía Inteligente by Kylia". Revenue share por hectárea.

#### Vía 3 — Enterprise edition
Misma tecnología con multi-parcela, multi-usuario, dashboard agregado, integración SAP, SLA. 5-50 €/ha/año. Solo viable con equipo dedicado (no founder solo).

#### Vía 4 — Datos agregados
Dataset comportamental anonimizado vendido a aseguradoras (Agroseguro), administraciones (MAPA, consejerías autonómicas), industria alimentaria (Bonduelle, Cidacos, Bonny). No compite con el cliente directo, lo complementa.

### 6.5 Los agentes IA en enterprise — categoría real

No es territorio especulativo. La ola B2B de agentes IA ya está en marcha:

- Salesforce Einstein agents (lanzados 2024, miles de empresas)
- Microsoft Copilot para ventas/marketing/finanzas
- IBM watsonx agents en industria pesada
- Workato + Zapier AI agents en operaciones
- HubSpot AI agents en SMB

**Kylia se posiciona como "el agente IA del sector agro hispanohablante"** en esta ola. Misma trayectoria que Salesforce: nacer para SMB, llegar a enterprise con producto validado y narrativa de categoría.

---

## 7. Implicaciones operativas a 18 meses

### 7.1 Foco estricto

- Cliente único: **Marc, el joven hortícola incorporado peninsular** (no cualquier agricultor, no técnico, no propietario, no gran empresa).
- Producto: **agente IA conversacional con tools** sobre las 3 capas (agronómica + económica + regulatoria).
- Geografía: **arco mediterráneo y vegas peninsulares** (no LATAM, no cereal extensivo, no olivar/viña).
- Plan de negocio: **bootstrap o Pre-Seed pequeño**, no Serie A enterprise.

### 7.2 Lo que NO se hace durante este periodo

- Fine-tuning de modelo propio (Fase 4 del doc principal queda en visión, no en plan ejecutable).
- Expansión a LATAM (Fase 5 del doc principal queda en visión).
- Venta directa a cooperativas grandes (esperar validación con pequeños).
- Multi-cultivo (cereal, olivar, viña) — quedarse en hortícola.
- Hardware (sensores propios, drones propios) — usar lo que ya existe.
- Marketplace de inputs (puede ser una capa monetizable más adelante, hoy distrae).

### 7.3 Lo que SÍ se prioriza

1. **Captación de 20-50 pilotos** en los próximos 6 meses, comarca por comarca.
2. **MVP del agente IA** con 6-8 tools (8-12 semanas).
3. **Capa económica** (predictor de precio de venta) — diferenciador único, prioridad alta.
4. **Capa regulatoria** (asistente PAC + fitosanitarios) — valor económico inmediato.
5. **WhatsApp como segundo canal** del agente.
6. **Cuaderno PAC exportable** — solución a un dolor regulatorio inmediato de Marc.
7. **Dataset de outcomes validados** — el moat futuro.

### 7.4 Narrativa unificada (interna y externa)

> *Kylia es el agente IA agronómico para el agricultor pequeño hispanohablante. Donde la competencia ofrece dashboards de datos satelitales para técnicos profesionales, Kylia ofrece decisiones operativas integrales — agronómicas, económicas y regulatorias — para el agricultor que toma él mismo las decisiones de su explotación. A 5-10 años, Kylia es la capa de inteligencia agronómica del mundo hispanohablante, intermediando entre el agricultor, las cooperativas, las aseguradoras y la administración pública.*

---

## Bibliografía interna relacionada

- `vision-y-roadmap.html` — tesis completa, hoja de ruta a 5 años, diferenciación frente a IAs generalistas.
- `negocio/go-to-market.md` — plan de lanzamiento y canales.
- `tecnico/arquitectura.md` — stack actual y decisiones técnicas.
- `tecnico/estado-y-roadmap.md` — estado funcional y siguientes pasos.

---

*Anexo estratégico interno · Kylia · mayo 2026 · Martí Carol.*
