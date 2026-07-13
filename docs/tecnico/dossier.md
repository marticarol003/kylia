# Kylia — Dossier técnico

> Documento de una sentada. Explica **qué es Kylia**, **en base a qué toma cada
> recomendación**, y **por qué es defendible**. Escrito desde el código real
> (2026-07-12). Para el detalle de implementación (endpoints, esquema, SQL), ver
> la serie `00`–`04` de esta carpeta.

---

## 1. La tesis en un párrafo

Kylia le dice a un agricultor de horticultura pequeña **cuánto regar y cuánto
abonar**, y **por qué**, sin que instale ningún sensor ni aprenda nada nuevo. Todo
se deriva de **satélite y modelos matemáticos** alimentados con datos públicos y
gratuitos. El producto no compite en "más datos" (ahí pierden hasta los grandes),
sino en **traducir agronomía rigurosa a una decisión simple y honesta** para un
segmento que hoy nadie atiende: parcelas de decenas o cientos de m², sin
infraestructura, sin presupuesto de €/ha.

**Dos premisas que hay que entender antes que nada, porque explican cada decisión
de diseño:**

1. **Cero hardware.** Si algo no se puede leer desde el espacio o calcular con un
   modelo, no forma parte del producto. No hay sondas, ni estaciones, ni visitas.
2. **Honestidad radical.** Lo que no se puede medir con fundamento, se **declara
   como desconocido** en vez de inventarlo. Esto no es modestia: es la única forma
   de que la recomendación resista el escrutinio de un agrónomo, y es lo que hace
   creíble la prueba comercial (el "reveal", §5).

---

## 2. En base a qué se toma cada recomendación

Esta es la sección que hay que interrogar a fondo. Cada recomendación tiene
un **modelo con nombre y apellidos**, no una caja negra.

### 2.1 Riego — modelo FAO-56 (el estándar mundial de la FAO)

La recomendación de riego ("riega hoy ~X L/m²" / "vigila" / "todo en orden") sale
de un **balance hídrico del suelo FAO-56** (Allen et al., 1998), el método de
referencia para calcular necesidades de riego. La lógica, día a día:

- **Demanda de agua del cultivo** = `Kc × ET₀`.
  - `ET₀` (evapotranspiración de referencia) viene **medida** de Open-Meteo (modelo
    meteorológico, gratis), no estimada por nosotros.
  - `Kc` (coeficiente de cultivo) sale de las tablas oficiales FAO-56 y **cambia con
    la fase del cultivo** (inicial → desarrollo → media → final), interpolado por
    día desde la fecha de plantación.
- **Oferta de agua del suelo** = capacidad de retención según la **textura**
  (arenoso/franco/arcilloso, Tabla 19 FAO-56) y la **profundidad de raíz**, que
  **crece día a día** conforme se desarrolla la planta (§8.3 FAO-56).
- **Lluvia efectiva**: la lluvia por debajo de 2 mm/día no cuenta (se evapora sin
  infiltrar) — criterio conservador FAO-56.
- **Decisión**: cuando el déficit acumulado alcanza el umbral de agua fácilmente
  disponible (`RAW`), toca regar; la lámina se ajusta por la **eficiencia del método**
  (goteo 90 %, aspersión 75 %, etc.) y se traduce a la **unidad del agricultor**
  (minutos de riego, número de regaderas, o L/m²).

> **Validación:** el motor está contrastado contra `pyfao56`, la implementación de
> referencia de la Universidad estatal de Kansas, con error prácticamente nulo
> (ETc RMSE ≈ 0). No es "nuestra fórmula": es FAO-56 reproducido fielmente.

### 2.2 Nutrición — balance de masa de nutrientes

La recomendación de abonado ("necesitas ~X kg de N, Y de P₂O₅, Z de K₂O") sale de
un **balance de masa**, el equivalente nutricional del balance hídrico:

```
Necesidad = Extracción del cultivo × Rendimiento esperado − Aporte del suelo
```

- **Extracción**: kg de cada nutriente que el cultivo retira por tonelada cosechada.
  Coeficientes tomados del **centro de los rangos de las guías de abonado españolas**
  (no un valor inventado; la relación N:P:K por cultivo es lo robusto).
- **Aporte del suelo**: ver §2.4.

### 2.3 Nitrógeno del cultivo — señal satelital real (NDRE)

Para saber si la planta va **corta de nitrógeno ahora mismo**, se usa el índice
**NDRE** de Sentinel-2 (banda *red-edge*, donde absorbe la clorofila; el N foliar va
casi todo en clorofila). Es la misma señal que usan los sistemas comerciales de
nitrógeno variable (Yara N-Sensor, etc.). **La planta es el sensor**: su cubierta
integra el estado real de N sin tocar el suelo. Junto al NDVI (vigor) y el NDMI
(agua en la hoja), son las tres lecturas satelitales del producto.

### 2.4 Suelo — SoilGrids + modelo de mineralización

El "aporte del suelo" del balance de nutrición se estima **sin analítica de
laboratorio ni muestra**, con una consulta por coordenada a **SoilGrids** (mapa
global de propiedades del suelo del ISRIC, licencia abierta). De ahí sale nitrógeno
total, materia orgánica, pH, textura y densidad. Un **modelo de mineralización de
primer orden** convierte el N orgánico del suelo en el N que la planta podrá usar
esta campaña. Funciona a cualquier escala porque es un *lookup* por coordenada, no
una imagen (no depende del tamaño del píxel sobre la parcela).

### 2.5 Plagas y productos — catálogo oficial + IA acotada

Ante una plaga, Kylia sugiere producto **solo entre un catálogo curado del registro
oficial MAPA** de fitosanitarios. La IA (Gemini) **elige entre candidatos que ya le
pasamos**; nunca inventa un producto ni una dosis fuera del registro.

---

## 3. La frontera honesta (léase con lupa: es el activo, no el disclaimer)

Cualquiera que evalúe el producto en serio probará dónde miente. La respuesta es:
**está codificado dónde NO sabemos**, y se dice en pantalla. Por subsistema:

| Recomendación | Qué es sólido (defendible ante un agrónomo) | Qué se declara como estimación / desconocido |
|---|---|---|
| **Riego** | FAO-56 validado contra `pyfao56`. Agua medida > modelo. | El caudal del emisor si el agricultor no lo midió (se da como banda). |
| **Nutrición (N,P,K)** | Estructura del balance y relación N:P:K por cultivo. | Sin analítica → extracción **bruta** (sobreestima), marcado explícitamente. |
| **Suelo (satélite)** | Nitrógeno vía mineralización (prior regional creíble). | **Fósforo y potasio NO se derivan de satélite → se dejan en blanco.** No se fingen. |
| **Plagas** | El catálogo MAPA es oficial. | La elección fina es heurística/IA sobre candidatos curados. |

El día que un cliente o un competidor audite los números, cuadran. Esa es la
diferencia con las agtech que enseñan un dashboard bonito sobre datos que no
soportan una segunda pregunta.

---

## 4. Los datos: todo público, gratuito y autoritativo

Ninguna fuente cuesta dinero en el núcleo, y todas son de organismos oficiales o
científicos. Esto es margen bruto y también defensibilidad (no dependemos de un
proveedor que nos pueda subir el precio o cerrar el grifo):

| Fuente | Organismo | Aporta |
|---|---|---|
| Sentinel-2 (Copernicus Data Space) | ESA / UE | NDVI, NDMI, NDRE (vigor, agua, nitrógeno) |
| Open-Meteo | modelo meteo abierto | ET₀ FAO + lluvia diaria |
| SIGPAC | Ministerio (MAPA) | Geometría oficial de la parcela |
| SoilGrids | ISRIC (científico) | Propiedades del suelo por coordenada |
| Registro de fitosanitarios | MAPA | Catálogo legal de productos |

El texto de las recomendaciones y del informe se genera con una **cascada a coste
cero** (Claude opcional → Gemini gratis → plantilla determinista): nunca dependemos
de un pago para producir el entregable.

---

## 5. Cómo se prueba que funciona: el piloto silencioso y el "reveal"

Aquí está el activo comercial más difícil de copiar. En vez de pedirle fe al
agricultor, se demuestra con su propio campo:

1. Kylia **calla** una campaña entera. El agricultor riega/abona **como siempre** y
   solo **registra** lo que hace.
2. Cada madrugada, un proceso automático calcula **qué habría recomendado Kylia** ese
   día y lo **sella en un registro inalterable** (con la fecha de la decisión, sin
   retrovisor).
3. Al final se cruzan las dos series —lo que Kylia decidió vs. lo que el agricultor
   hizo— y se enseña el **ahorro real de agua e insumos** sobre el mismo campo.

Como Kylia **nunca influyó** en el agricultor durante la prueba, la comparación es
metodológicamente limpia (equivale a un contrafactual). En el piloto de tomate de
Breda, el contrafactual dio **23 vs 64 L/m² = ~64 % de ahorro de agua**, verificado.

Y es honesto hasta en la comparación: se contrastan acumulados a igual fecha y se
explicita el agua que Kylia tenía "en cola" sin regar, para no inflar el ahorro.
**No** se añaden métricas cosméticas (precisión, satisfacción) que no soporten
auditoría.

Resultado: cada piloto que completa la campaña genera (a) una prueba de venta
irrebatible para ese agricultor, (b) un caso replicable para su cooperativa/vecinos,
y (c) un dato propietario que engrosa nuestro dataset de validación.

---

## 6. Por qué es defendible (el "moat")

- **Rigor + honestidad como producto.** El motor FAO-56 validado y la frontera
  honesta no son fáciles de replicar por alguien que solo sabe pintar un dashboard;
  y son exactamente lo que da confianza al que decide sobre su cosecha.
- **Segmento desatendido.** Los grandes (maquinaria, ortofotos, €/ha) no bajan a
  parcelas de decenas de m². Un ChatGPT genérico no tiene el balance FAO-56 con la
  fenología, el suelo y el caudal del agricultor concreto.
- **Método de prueba propio.** El piloto silencioso + reveal convierte cada campaña
  en evidencia y en dato. Es un volante que gira con cada piloto.
- **Estructura de coste ~0 en datos.** Margen bruto alto desde el día uno; la
  complejidad de coste solo llega con la escala (y entonces ya hay ingresos).

---

## 7. Estado real hoy (sin humo)

- **Riego FAO-56**: en producción, validado, corriendo a diario sobre pilotos reales.
- **Nutrición + cuaderno PAC**: motor completo y cableado; el cuaderno de abonado
  (gancho regulatorio RD 1051/2022) sale del sistema.
- **Suelo por satélite (SoilGrids)**: construido y verificado con datos reales de los
  pilotos; el nitrógeno del suelo ya descuenta del abonado. P/K, pendientes por
  decisión honesta (no hay fuente satelital fiable).
- **Pilotos silenciosos activos**: tomate (Breda), cebolla tierna (La Selva), y el
  "campo del padre" como laboratorio abierto de comparación.
- **Lo heurístico** (afinado de plagas, algunos coeficientes): identificado como tal
  y en cola de validación. No se vende como ciencia cerrada.

> En resumen: lo que está en verde (riego, balance, prueba del piloto) es lo que
> sostiene la propuesta hoy; lo demás es roadmap con el mismo estándar de honestidad.
