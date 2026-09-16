// Resolver el PROPIETARIO a partir de un correo, de forma determinista.
//
// EL BUG QUE CIERRA. Dos sitios hacían `email=eq.<x>&select=id&limit=1` y trataban
// esa fila como si fuera la del propietario. Pero una fila de `usuarios` es UNA
// PARCELA, y hasta ahora las parcelas de zona heredaban el correo del agricultor:
// varias filas compartían email y PostgREST, sin `order`, devuelve una
// cualquiera. `recordatorio-wizard` podía acabar mirando la jornada de una zona
// en vez de la del agricultor, y el aviso salía o no salía por sorteo.
//
// La resolución correcta no es "coge una fila", es "colapsa por propietario_id":
// una parcela sola se apunta a sí misma, así que `propietario_id || id` da
// siempre el dueño. Si todas las coincidencias apuntan al MISMO dueño —que es el
// caso normal, con o sin filas históricas que aún lleven email—, hay respuesta. Si
// apuntan a dueños DISTINTOS, eso es un conflicto de datos y no se elige uno a
// dedo: se devuelve el conflicto para que se vea.
const { supabaseSelect } = require("./_supabase.js");

// Devuelve { propietario_id } | { vacio: true } | { conflicto: [ids] }
async function propietarioPorEmail(email) {
  const correo = (email || "").toString().trim().toLowerCase();
  if (!correo) return { vacio: true };

  // SIN `limit`: hay que verlas todas para poder detectar el conflicto. Son
  // pocas por definición (las parcelas de una persona).
  const filas = await supabaseSelect("usuarios",
    `email=eq.${encodeURIComponent(correo)}&select=id,propietario_id`);
  if (!Array.isArray(filas) || filas.length === 0) return { vacio: true };

  const dueños = [...new Set(filas.map(f => f.propietario_id || f.id))];
  if (dueños.length > 1) {
    console.error("[propietario] MISMO EMAIL, DUEÑOS DISTINTOS:",
      JSON.stringify({ email: correo, dueños }));
    return { conflicto: dueños };
  }
  return { propietario_id: dueños[0] };
}

module.exports = { propietarioPorEmail };
