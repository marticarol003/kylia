// ─────────────────────────────────────────────────────────────────
// Motor de optimización coste ↔ calidad — núcleo PURO y compartido
// ─────────────────────────────────────────────────────────────────
// Decide la combinación de insumos MÁS BARATA que garantiza una calidad
// mínima de laboratorio (p. ej. °Brix). Upgradea la decisión de NUTRICIÓN
// (heurística NDVI<0.5, ver docs/tecnico/motor-de-decision.md §5) a una
// optimización con restricciones, auditable y trazable.
//
//   minimizar   C(x) = Σ precio_i · x_i           (coste de insumos)
//   sujeto a    Q(x) ≥ calidadMinima              (umbral de laboratorio)
//               x_min ≤ x ≤ x_max                 (límites agronómicos)
//
// Calidad Q(x) = superficie de respuesta (FAO/agronomía estándar):
//   Q(x) = b0 + Σ b_i·x_i + Σ b_ii·x_i²
// El coef. cuadrático negativo refleja que un EXCESO de insumo (N, riego)
// puede BAJAR la calidad (diluye azúcares). Sin estado, sin dependencias:
// se resuelve por búsqueda en rejilla de grueso-a-fino (robusta a la no
// convexidad de los términos cuadráticos; los insumos son pocos, ≤5).
//
// Principio Kylia: el motor calcula las CANTIDADES; la IA solo las explica.

// ── Modelos de calidad por grupo de cultivo (PROVISIONALES, sin calibrar) ──
// Coeficientes orientativos: deben calibrarse con datos de laboratorio del
// piloto (insumos aplicados + calidad medida) por mínimos cuadrados. Hasta
// entonces, los resultados son cualitativos (igual que el resto de §5/§8).
const MODELOS_CALIDAD = {
  // Cultivos de fruto medidos en °Brix (azúcar): tomate, pimiento, etc.
  fruto: {
    metrica: "°Brix",
    insumos: ["nitrogeno", "fosforo", "potasio", "riego"],
    intercepto: 8.0,
    lineal: { nitrogeno: 0.040, fosforo: 0.030, potasio: 0.050, riego: 0.012 },
    cuadratico: { nitrogeno: -0.00025, potasio: -0.00020, riego: -0.000012 },
  },
};

// Precios (€/unidad) y límites agronómicos por insumo. Editar por piloto.
const PRECIOS_DEFAULT = { nitrogeno: 1.2, fosforo: 1.8, potasio: 1.5, riego: 0.8 };
const LIMITES_DEFAULT = {
  nitrogeno: [20, 140],   // kg/ha
  fosforo:   [10, 90],    // kg/ha
  potasio:   [10, 120],   // kg/ha
  riego:     [200, 900],  // mm/campaña
};

// Mapa cultivo → grupo (mismos cultivos que el motor de riego).
const GRUPO_CULTIVO = {
  tomate: "fruto", pimiento: "fruto", berenjena: "fruto", calabacin: "fruto",
};

function modeloPara(cultivoId) {
  return MODELOS_CALIDAD[GRUPO_CULTIVO[cultivoId] || "fruto"];
}

// Q(x): calidad para un vector de insumos x (en el orden de modelo.insumos).
function calidad(modelo, x) {
  let q = modelo.intercepto;
  modelo.insumos.forEach((n, i) => {
    q += (modelo.lineal[n] || 0) * x[i];
    q += (modelo.cuadratico[n] || 0) * x[i] * x[i];
  });
  return q;
}

function coste(precios, insumos, x) {
  return insumos.reduce((s, n, i) => s + (precios[n] || 0) * x[i], 0);
}

function linspace(lo, hi, n) {
  if (n <= 1) return [(lo + hi) / 2];
  const paso = (hi - lo) / (n - 1);
  return Array.from({ length: n }, (_, i) => lo + paso * i);
}

// Optimización: insumos más baratos con Q(x) ≥ calidadMinima.
// Búsqueda en rejilla grueso-a-fino: barre el box, se queda con el punto
// factible más barato, encoge el box a su alrededor y repite. Robusto y
// sin dependencias (clave para serverless).
function optimizarCoste(modelo, precios, limites, calidadMinima, opts = {}) {
  const nombres = modelo.insumos;
  const pasos = opts.pasos || 8;
  const refinamientos = opts.refinamientos != null ? opts.refinamientos : 5;

  const lo0 = nombres.map((n) => limites[n][0]);
  const hi0 = nombres.map((n) => limites[n][1]);
  let lo = lo0.slice();
  let hi = hi0.slice();
  let mejor = null;

  for (let r = 0; r <= refinamientos; r++) {
    const ejes = nombres.map((_, i) => linspace(lo[i], hi[i], pasos));
    let mejorPasada = null;

    // Producto cartesiano por "odómetro" (sin recursión).
    const idx = nombres.map(() => 0);
    const total = ejes.reduce((p, e) => p * e.length, 1);
    for (let k = 0; k < total; k++) {
      const x = nombres.map((_, i) => ejes[i][idx[i]]);
      if (calidad(modelo, x) >= calidadMinima - 1e-9) {
        const c = coste(precios, nombres, x);
        if (!mejorPasada || c < mejorPasada.coste) mejorPasada = { x, coste: c };
      }
      // incrementa el odómetro
      for (let i = 0; i < idx.length; i++) {
        if (++idx[i] < ejes[i].length) break;
        idx[i] = 0;
      }
    }

    if (!mejorPasada) break; // ni en el box actual se alcanza la calidad
    if (!mejor || mejorPasada.coste < mejor.coste) mejor = mejorPasada;

    // Encoge el box ±1 celda alrededor del mejor punto, acotado al original.
    nombres.forEach((_, i) => {
      const celda = (hi[i] - lo[i]) / (pasos - 1);
      lo[i] = Math.max(lo0[i], mejor.x[i] - celda);
      hi[i] = Math.min(hi0[i], mejor.x[i] + celda);
    });
  }

  if (!mejor) {
    const xMax = hi0.slice();
    return {
      exito: false,
      mensaje: `No es posible alcanzar ${calidadMinima} ${modelo.metrica}. ` +
        `Calidad máxima posible ≈ ${calidad(modelo, xMax).toFixed(1)} ${modelo.metrica} ` +
        `(insumos al máximo).`,
      insumos: Object.fromEntries(nombres.map((n, i) => [n, round(xMax[i])])),
      costeTotal: round(coste(precios, nombres, xMax)),
      calidad: round(calidad(modelo, xMax)),
    };
  }

  return {
    exito: true,
    mensaje: "Óptimo encontrado.",
    insumos: Object.fromEntries(nombres.map((n, i) => [n, round(mejor.x[i])])),
    costeTotal: round(mejor.coste),
    calidad: round(calidad(modelo, mejor.x)),
  };
}

// Curva de compromiso: coste mínimo para cada nivel de calidad objetivo.
// Sirve para fijar el precio de venta (coste + margen) y elegir el umbral.
function curvaCosteCalidad(modelo, precios, limites, calidades) {
  return calidades
    .map((q) => {
      const r = optimizarCoste(modelo, precios, limites, q);
      return r.exito ? { calidad: q, coste: r.costeTotal } : null;
    })
    .filter(Boolean);
}

// Ajusta los coeficientes de Q(x) a datos de laboratorio (regresión por
// mínimos cuadrados sobre términos lineales + cuadráticos). Devuelve un
// modelo calibrado listo para optimizarCoste. Ecuaciones normales puras
// (sin librerías): resuelve (AᵀA) b = Aᵀy por eliminación gaussiana.
function ajustarModelo(filas, insumos, columnaCalidad, metrica = "calidad") {
  // A = [1 | x_i | x_i²], una fila por muestra.
  const A = filas.map((f) => {
    const lin = insumos.map((n) => Number(f[n]));
    const cuad = lin.map((v) => v * v);
    return [1, ...lin, ...cuad];
  });
  const y = filas.map((f) => Number(f[columnaCalidad]));
  const b = resolverMinimosCuadrados(A, y);

  const n = insumos.length;
  const modelo = {
    metrica,
    insumos,
    intercepto: b[0],
    lineal: Object.fromEntries(insumos.map((nm, i) => [nm, b[1 + i]])),
    cuadratico: Object.fromEntries(insumos.map((nm, i) => [nm, b[1 + n + i]])),
  };
  const r2 = coefDeterminacion(A, y, b);
  return { modelo, r2 };
}

// ── Álgebra mínima (sin dependencias) ──
function resolverMinimosCuadrados(A, y) {
  const m = A.length;
  const k = A[0].length;
  // Normal equations: M = AᵀA (k×k), v = Aᵀy (k)
  const M = Array.from({ length: k }, () => new Array(k).fill(0));
  const v = new Array(k).fill(0);
  for (let r = 0; r < m; r++) {
    for (let i = 0; i < k; i++) {
      v[i] += A[r][i] * y[r];
      for (let j = 0; j < k; j++) M[i][j] += A[r][i] * A[r][j];
    }
  }
  return resolverGauss(M, v);
}

function resolverGauss(M, v) {
  const k = v.length;
  const A = M.map((row, i) => [...row, v[i]]); // matriz aumentada
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    }
    [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col] || 1e-12;
    for (let j = col; j <= k; j++) A[col][j] /= d;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const factor = A[r][col];
      for (let j = col; j <= k; j++) A[r][j] -= factor * A[col][j];
    }
  }
  return A.map((row) => row[k]);
}

function coefDeterminacion(A, y, b) {
  const pred = A.map((row) => row.reduce((s, v, i) => s + v * b[i], 0));
  const media = y.reduce((s, v) => s + v, 0) / y.length;
  const ssRes = y.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0);
  const ssTot = y.reduce((s, v) => s + (v - media) ** 2, 0) || 1e-12;
  return 1 - ssRes / ssTot;
}

function round(x) {
  return Math.round(x * 100) / 100;
}

function ecuacionTexto(modelo) {
  const partes = [`${modelo.intercepto.toFixed(4)}`];
  for (const n of modelo.insumos) {
    const bl = modelo.lineal[n] || 0;
    if (bl) partes.push(`${bl >= 0 ? "+" : ""}${bl.toPrecision(3)}·${n}`);
    const bq = modelo.cuadratico[n] || 0;
    if (bq) partes.push(`${bq >= 0 ? "+" : ""}${bq.toPrecision(3)}·${n}²`);
  }
  return "Q(x) = " + partes.join(" ");
}

module.exports = {
  MODELOS_CALIDAD,
  PRECIOS_DEFAULT,
  LIMITES_DEFAULT,
  GRUPO_CULTIVO,
  modeloPara,
  calidad,
  optimizarCoste,
  curvaCosteCalidad,
  ajustarModelo,
  ecuacionTexto,
};
