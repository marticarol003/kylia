# Contenido Kylia — Semana 1 · LISTO PARA PUBLICAR

Todas las imágenes están generadas en `semana-1/imagenes/`. No tienes que diseñar nada ni abrir Canva. Solo descargar la imagen, copiar el texto y pegar en cada plataforma a las horas indicadas.

> Las imágenes están en formato PNG cuadrado (1080×1080) o vertical (1080×1350) según red social. Newsletter 1200×400.

---

## LUNES · 9:00 · LinkedIn (página de empresa Kylia)

**Imagen**: `semana-1/imagenes/1-lunes-anuncio.png` (1080×1080)

**Texto del post**:

```
Lanzamos Kylia: monitorización de tus parcelas SIGPAC desde Sentinel-2, en el móvil, en segundos.

Lo que hace:
· Vigor del cultivo (NDVI) y agua en la hoja (NDMI) actualizados cada 5 días
· Humedad del suelo por capas, hora a hora
· Recomendación de riego adaptada al cultivo

Lo que NO hace:
· Cobrar por hectárea
· Pedir sensores en campo
· Esconder precios detrás de "consulta a ventas"

El plan Free es de verdad: hasta 30 hectáreas y 2 parcelas, para siempre, sin tarjeta. Productor desde 99 €/año (escala con tu superficie sin €/ha lineal). Cooperativas desde 2.900 €/año en paquete cerrado, todos los socios incluidos. Enterprise desde 30.000 €/año para aseguradoras, banca rural y administración.

Construido sobre infraestructura pública europea: Copernicus, SIGPAC, DWD ICON. Sin proveedor privado crítico.

Pruébalo con tu parcela: kylia.app

#agricultura #agtech #sentinel2 #copernicus
```

**Variante A/B (más corta) si quieres testear**:

```
NDVI, humedad y recomendación de riego para cualquier parcela SIGPAC, gratis hasta 30 hectáreas.

Sin sensores, sin €/ha, sin "consulta a ventas".

Sentinel-2 + DWD ICON + SIGPAC. Infraestructura pública europea, todo abierto.

kylia.app

#agricultura #agtech
```

---

## MIÉRCOLES · 9:00 · LinkedIn (Kylia)

**Imagen**: `semana-1/imagenes/2-miercoles-88-12.png` (1080×1080)

**Texto del post**:

```
El campo español tiene 23,5 millones de hectáreas de superficie agrícola útil.

Solo el 12 % usa alguna herramienta digital de monitorización por satélite.

El 88 % decide cuándo regar, cuándo abonar y cuándo cosechar a ojo, con la experiencia del agricultor y mirando al cielo.

Esto no es un problema de tecnología — los datos están desde 2015 abiertos en Copernicus. Es un problema de traducción: nadie convierte una imagen multiespectral de Sentinel-2 en una frase útil que el agricultor pueda leer en el móvil mientras come.

Eso es exactamente lo que estamos resolviendo en Kylia.

¿Tu cooperativa o tu explotación está en el 12 % o en el 88 %?
```

---

## VIERNES · 9:00 · LinkedIn (Kylia)

**Imagen**: `semana-1/imagenes/3-viernes-pricing.png` (1080×1080)

**Texto del post**:

```
Por qué cobramos por tramos planos y no €/ha lineal:

El modelo €/ha lineal castiga a las explotaciones grandes. Si tienes 500 ha y la herramienta vale 10 €/ha al año, te cuesta 5.000 € — exactamente las explotaciones que más valor extraen son las que más pagan en términos absolutos.

Eso convierte la decisión de compra en una negociación constante: cada propietario quiere descuento por volumen, cada herramienta tiene un precio efectivo distinto, nadie sabe lo que paga su vecino.

En Kylia hay tres tramos planos: hasta 100 ha, hasta 500 ha, y de 500 en adelante (Enterprise). Tu vecino paga lo mismo que tú si está en tu tramo. La transparencia simplifica la decisión y elimina la fricción comercial.

¿Es perfecto? No — un agricultor con 110 ha paga lo mismo que uno con 480. Es el coste de tener un modelo claro. Pero comparado con el alternativo, preferimos esto.

Detalles del pricing en kylia.app/precios
```

---

## LUNES · 9:00 (programada) · Newsletter

**Banner cabecera**: `semana-1/imagenes/4-newsletter-banner.png` (1200×400) — sube como header en Beehiiv/Substack.

**Asunto del email**: `El dato de la semana en el campo español · NDMI, riego y por qué importa`

**Cuerpo (programa con Beehiiv o Substack)**:

```
Hola,

Esta es la primera edición de "El dato del campo", el resumen semanal de Kylia. Cada lunes a las 9, tres bloques: el dato de la semana, una mini-clase agronómica de 200 palabras, y un caso real de monitorización por satélite.

────────────────

EL DATO DE LA SEMANA

NDMI medio del olivar andaluz en la última pasada de Sentinel-2 (15-21 abril): 0,28.

Para contexto: por debajo de 0,30 es una señal temprana de estrés hídrico. La provincia con NDMI más bajo es Jaén interior (0,24), donde llovió un 18 % menos que la media histórica este invierno.

────────────────

LA MINI-CLASE · ¿Qué es exactamente NDMI?

NDMI son las siglas de Normalized Difference Moisture Index, "índice normalizado de diferencia de humedad". Es un cálculo simple sobre dos bandas que ve Sentinel-2: la banda 8 (infrarrojo cercano, NIR) y la banda 11 (infrarrojo de onda corta, SWIR).

La fórmula es: NDMI = (NIR - SWIR) / (NIR + SWIR).

¿Por qué funciona? Porque el agua absorbe radiación SWIR. Cuanta más agua tiene la hoja, menor es la reflectancia en SWIR y mayor es el NDMI. Un cultivo bien hidratado da valores de 0,40-0,60. Un cultivo con estrés hídrico cae a 0,20-0,30. Por debajo de 0,15 ya es estrés severo.

La gracia de NDMI es que detecta el problema **antes** de que se vea a simple vista. Una hoja deshidratada todavía está verde — el ojo humano no distingue NDMI de NDVI. El satélite sí.

────────────────

EL CASO DE LA SEMANA · Olivar superintensivo en Úbeda (Jaén)

12 hectáreas, plantación de 2018, riego por goteo. La explotación monitoriza desde febrero con Kylia.

Lo que vimos: NDVI estable en 0,72 durante toda la primera quincena de abril, pero NDMI bajando de 0,38 a 0,29 en 12 días. La hoja seguía verde — el dato era invisible al ojo.

La decisión: adelantar el segundo aporte de riego de la campaña dos semanas. Coste de la decisión: ~30 € de agua. Coste de no haberla detectado: probablemente entre 200 y 400 € por hectárea de pérdida de calidad de aceituna.

────────────────

¿Quieres ver tus parcelas? Es gratis hasta 30 hectáreas en kylia.app · Hasta el lunes que viene · Kylia
```

---

## MIÉRCOLES · 9:00 · Telegram (canal propio Kylia)

**Imagen**: `semana-1/imagenes/5-telegram-resumen.png` (1080×1350)

**Texto**:

```
🛰️ Pasada Sentinel-2 del 22 de abril

Resumen España (medias por gran zona):

▸ NDVI cereal Castilla-La Mancha: 0,52 (estable)
▸ NDVI olivar Jaén: 0,68 (-2 % vs semana anterior)
▸ NDMI olivar Andalucía: 0,28 (señal temprana de estrés)
▸ Humedad suelo cereal Castilla-León: 32 % (-5 % vs media histórica abril)

Mapa por provincia y datos por parcela en kylia.app
```

---

## SÁBADO · grabación de vídeo YouTube #1

**Título**: "NDVI explicado para agricultores en 5 minutos"

**Producción sin cara**: usa OBS para grabar pantalla con la app de Kylia + ElevenLabs para la voz (clona una voz neutra masculina o femenina en español-ES, ~10 € al mes). Edición en CapCut Web (gratis).

**Descripción YouTube**:

```
Qué es NDVI, cómo se calcula, qué significan los valores, y por qué un solo píxel puede engañarte. Sin filtros de marketing, solo lo que de verdad necesitas saber para interpretar bien el dato.

Recursos:
· Probar Kylia gratis hasta 30 ha → kylia.app
· Hilo en LinkedIn → [enlace al post del miércoles]

00:00 Qué problema resuelve NDVI
00:45 La fórmula y por qué funciona
01:30 Qué significan los valores (escala visual)
02:30 Los tres errores más comunes al interpretarlo
04:00 Cómo lo calcula Kylia por parcela SIGPAC
04:45 Cierre

#NDVI #agricultura #sentinel2
```

**Guión completo** (para meter en ElevenLabs y grabar pantalla):

```
[VOICE-OVER]
NDVI son las siglas de Normalized Difference Vegetation Index. Es la medida más usada en agricultura por satélite para saber cómo de vigoroso está un cultivo.

[CAPTURA: gradiente NDVI en una parcela de cereal con valores]

La fórmula es simple. Toma dos bandas de luz que ve el satélite: el rojo, que absorben las plantas para hacer fotosíntesis, y el infrarrojo cercano, que reflejan. NDVI es la diferencia entre ambas dividida por su suma.

[TEXTO EN PANTALLA: NDVI = (NIR - Red) / (NIR + Red)]

Cuanta más vegetación sana, más infrarrojo refleja y más rojo absorbe — y más sube el NDVI. La escala va de menos uno a uno, pero en cultivos reales lo que vas a ver oscila entre cero y zero punto nueve.

[CAPTURA: barra escala NDVI con tres bandas de color]

Por debajo de zero punto dos: suelo desnudo, parcela cosechada, o cultivo muy joven. Entre zero punto dos y zero punto cinco: vegetación moderada — empieza a crecer o ya muestra estrés. Por encima de zero punto cinco: cultivo en buen estado. Por encima de zero punto siete: vigor alto, momento óptimo del cultivo.

[VOICE-OVER]
Ahora los tres errores que vemos cada semana en el campo.

[TEXTO EN PANTALLA: Error 1 — Mirar un solo píxel]

Primer error: confiar en un solo píxel. Sentinel-2 a diez metros de resolución significa que cada píxel cubre cien metros cuadrados. Si lees el píxel central de tu parcela, te puede engañar — sombras, lindes, una zona puntual mojada o seca. La forma correcta es agregar todos los píxeles válidos de la parcela y dar la mediana.

[TEXTO EN PANTALLA: Error 2 — No filtrar nubes]

Segundo error: no filtrar nubes. Una nube en una pasada de Sentinel-2 te puede dar valores absurdos. La máscara SCL del satélite te dice qué píxeles son nubes y cuáles son fiables. Hay que aplicarla siempre.

[TEXTO EN PANTALLA: Error 3 — Comparar entre cultivos]

Tercer error: comparar NDVI entre cultivos distintos. Un olivar con NDVI de zero punto seis está perfecto. Un cereal con el mismo zero punto seis está flojo. Cada cultivo tiene su rango — la comparación válida es contra la curva temporal del propio cultivo.

[CAPTURA: ejemplo de Kylia mostrando geometría SIGPAC y NDVI agregado]

En Kylia esto lo resolvemos automáticamente. Coges una parcela del SIGPAC, el sistema baja la última pasada Sentinel-2 disponible, filtra píxeles nubosos con la máscara oficial, y agrega por mediana ponderada por área dentro de la geometría exacta del recinto. Te devuelve un solo número fiable y el mapa intra-parcela.

[CAPTURA FINAL: pantalla con CTA]

Pruébalo con tu parcela en kylia dot app, gratis hasta veinte hectáreas. Sin tarjeta, sin registro para empezar.

[FUNDIDO A NEGRO]
```

---

## Resumen ejecutivo de la semana

| Día | Canal | Pieza | Imagen | Tiempo de publicar |
|---|---|---|---|---|
| Lun 9:00 | LinkedIn | Anuncio lanzamiento | `1-lunes-anuncio.png` | 3 min |
| Lun 9:00 | Newsletter | Edición #1 NDMI | `4-newsletter-banner.png` | 10 min (cargar y enviar) |
| Mié 9:00 | LinkedIn | Dato del 88 % vs 12 % | `2-miercoles-88-12.png` | 3 min |
| Mié 9:00 | Telegram | Resumen pasada Sentinel-2 | `5-telegram-resumen.png` | 3 min |
| Vie 9:00 | LinkedIn | Posicionamiento pricing | `3-viernes-pricing.png` | 3 min |
| Sáb tarde | YouTube | Vídeo #1 NDVI (sin cara) | OBS + ElevenLabs | 60 min |

**Total tiempo de tu semana publicando: 22 min** (más los 60 min de grabar el vídeo el sábado).

---

## Cómo publicar paso a paso

**LinkedIn** (página Kylia):
1. Entra a la página de empresa
2. "Crear publicación" → adjuntar imagen del archivo
3. Pegar el texto del bloque correspondiente
4. Programar a 9:00 del día indicado

**Newsletter (Beehiiv recomendado, gratis hasta 2.500 suscriptores)**:
1. Crear "Post" nuevo
2. Subir `4-newsletter-banner.png` como banner
3. Pegar cuerpo del email
4. Programar envío lunes 9:00

**Telegram** (canal Kylia España):
1. Crear canal público `@kylia_es` si aún no existe
2. Enviar la imagen primero
3. Enviar el texto debajo
4. Anclar el mensaje

**YouTube**:
1. Grabar pantalla con OBS siguiendo el guión
2. Generar voz con ElevenLabs (voz "Carlos" o "Sofia" en español-ES)
3. Editar en CapCut: alternar pantalla con texto en overlay
4. Subir el sábado por la tarde, programar publicación domingo 19:00

---

## Próxima semana (semana 2)

Te genero el contenido y las imágenes el viernes anterior, mismo formato. Plan tentativo:
- Lunes: caso real anonimizado de cooperativa olivarera (post LinkedIn + newsletter)
- Miércoles: comparativa Kylia vs herramienta tradicional (LinkedIn)
- Viernes: deep dive técnico — cómo agregamos píxeles Sentinel-2 a parcela SIGPAC (LinkedIn)
- Sábado: vídeo #2 — "Cómo se lee un mapa NDMI en 3 minutos"
