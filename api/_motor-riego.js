// ─────────────────────────────────────────────────────────────────
// Motor de riego FAO-56 — reexport del núcleo compartido
// ─────────────────────────────────────────────────────────────────
// El motor VIVE en assets/js/motor-riego.js, un único fichero que cargan los
// dos lados: el servidor por este require y el navegador por <script src>.
// Antes había dos copias (aquí y dentro de app/index.html) y aunque las tablas
// no habían derivado, la ventana del balance sí: daban 10,0 vs 38,4 mm de
// déficit sobre los mismos datos. Con un solo fichero no puede repetirse.
//
// Este fichero se queda por compatibilidad: todos los endpoints hacen
// require("./_motor-riego.js") y no hay por qué tocarlos.
// (assets/ no es carpeta de funciones de Vercel; se despliega como estático y
// el tracer de Vercel la incluye en el bundle por este require estático.)

module.exports = require("../assets/js/motor-riego.js");
