// ─────────────────────────────────────────────────────────────────
// La configuración de la app, reconstruida desde la fila de `usuarios`
// ─────────────────────────────────────────────────────────────────
// `usuarios.config_app` es el espejo de lo que el agricultor tiene en el móvil,
// y solo se escribe CUANDO CAMBIA algo (ver el handler config-app en log.js).
// De ahí el agujero que cierra este fichero: quien configuró su campo antes de
// que existiera esa columna —o quien no ha vuelto a tocar nada desde entonces—
// tiene la fila llena y el espejo vacío. Entraba con el enlace del correo, el
// dispositivo adoptaba a su propietario… y veía la app EN BLANCO, que es
// exactamente lo que el enlace venía a evitar.
//
// Lo que se sintetiza es SOLO la finca, y es una correspondencia 1:1: cada
// columna de la fila es un campo del panel de configuración, contorno incluido.
// No se inventa nada.
//
// LAS ZONAS NO SE SINTETIZAN, y es deliberado. Una zona de la app es un recinto
// de SIGPAC (`referencia`, superficie oficial, si llega al umbral del satélite)
// con sus siembras dentro; la tabla no guarda ni la referencia ni la agrupación,
// así que reconstruirlas sería inventarse el reparto de un recinto. Y una zona
// sin `referencia` además rompería el editor, que las indexa por esa clave.
// Devolver la finca deja la app utilizable; devolver zonas falsas la deja mal.

// Mismo criterio de "vacía" que usa el guardado al subir: contenido de verdad,
// no un objeto que existe. Una fila que solo tiene email no es una finca, y
// escribirla en el móvil sería pisar los valores por defecto con nada.
function tieneContenido(f) {
  return Boolean(
    f.parcela ||
    (Array.isArray(f.cultivos) && f.cultivos.length) ||
    f.area_m2 != null ||
    f.fecha_plantacion
  );
}

// Las claves son las del panel de /app (DEFAULTS en app/index.html), que no se
// llaman como las columnas. Se omite lo que no tiene valor para que al
// restaurar manden los valores por defecto de la app y no un null.
function configDesdeFila(fila) {
  if (!fila || typeof fila !== "object" || !tieneContenido(fila)) return null;

  const finca = {};
  const poner = (clave, valor) => { if (valor != null) finca[clave] = valor; };

  poner("nombre",              fila.nombre);
  poner("ciudad",              fila.ciudad);
  poner("lat",                 fila.lat);
  poner("lon",                 fila.lon);
  poner("parcela",             fila.parcela);
  poner("metodoRiego",         fila.metodo_riego);
  poner("manejo",              fila.manejo);
  poner("suelo",               fila.suelo);
  poner("fechaPlantacion",     fila.fecha_plantacion);
  poner("caudal",              fila.caudal);
  poner("areaParcela",         fila.area_m2);
  poner("capacidadRegadera",   fila.capacidad_regadera);
  if (Array.isArray(fila.cultivos) && fila.cultivos.length) finca.cultivos = fila.cultivos;

  // Sin `zonas`, y no es un olvido: al restaurar, la app escribe la lista que le
  // llegue, así que mandar una vacía BORRARÍA las zonas que hubiera en ese
  // dispositivo. Ausente significa "de esto no sé nada, no lo toques".
  return { finca, sintetizada: true };
}

// Las columnas que hacen falta para lo de arriba. Se nombran aquí para que quien
// añada un campo al panel lo añada en un solo sitio.
// `cultivos_secundarios` NO está: la columna sigue en la base con lo que se
// escribió en su día, pero el campo se retiró del alta el 13-ago-2026 porque
// ningún motor lo leía nunca — se pedía en el formulario, se guardaba, se subía
// al servidor y se restauraba, y ahí se acababa.
const COLUMNAS_FINCA =
  "nombre,ciudad,lat,lon,cultivos,parcela,metodo_riego," +
  "manejo,suelo,fecha_plantacion,caudal,area_m2,capacidad_regadera";

module.exports = { configDesdeFila, COLUMNAS_FINCA };
