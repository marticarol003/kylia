// ─────────────────────────────────────────────────────────────────
// De dónde se acepta que venga una petición del navegador
// ─────────────────────────────────────────────────────────────────
// Hasta ahora TODOS los endpoints respondían `Access-Control-Allow-Origin: *`,
// que es lo que se pone cuando no quieres pensar en CORS. El coste real de esa
// línea: cualquier página de cualquier dominio podía llamar a /api/ia desde el
// navegador de sus visitantes y gastar nuestra cuota de Gemini con el tráfico de
// otro. Ahora solo se devuelve la cabecera si el origen está en la lista.
//
// ⚠️ LO QUE ESTO **NO** HACE, y conviene no confundirlo: CORS es una regla que
// aplica el NAVEGADOR. Un `curl` o un script no manda `Origin` y le da igual la
// respuesta, así que esto no para el abuso automatizado. Para eso está el límite
// de uso (_limite.js), que sí cuenta peticiones vengan de donde vengan. Las dos
// cosas son complementarias y ninguna sustituye a la otra.
//
// Se echa de menos `Vary: Origin`: sin él, una CDN puede cachear la respuesta
// con el ACAO de otro origen y servirla cruzada.

const PERMITIDOS = [
  /^https:\/\/(www\.)?kylia\.app$/,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/,          // despliegues de vista previa
  /^http:\/\/localhost(:\d+)?$/,                   // desarrollo
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

function permitido(origen) {
  return !!origen && PERMITIDOS.some(re => re.test(origen));
}

// Pone las cabeceras de CORS que correspondan a ESTA petición.
// Sin `Origin` (peticiones servidor-a-servidor: crons, GitHub Actions) no se
// pone nada y la petición sigue su curso con normalidad — CORS no aplica ahí.
function cabecerasCors(req, res, metodos = "POST, OPTIONS") {
  const origen = (req.headers?.origin || "").toString();
  res.setHeader("Vary", "Origin");
  if (permitido(origen)) {
    res.setHeader("Access-Control-Allow-Origin", origen);
    res.setHeader("Access-Control-Allow-Methods", metodos);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  return permitido(origen) || !origen;
}

// La IP del que llama, para contar por quién. En Vercel viene en
// x-forwarded-for (el primero de la lista es el cliente; el resto, proxies).
function ipDe(req) {
  const xff = (req.headers?.["x-forwarded-for"] || "").toString();
  const primera = xff.split(",")[0].trim();
  return primera || (req.headers?.["x-real-ip"] || "").toString() || "desconocida";
}

module.exports = { cabecerasCors, permitido, ipDe, PERMITIDOS };
