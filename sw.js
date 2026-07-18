// Service worker de Kylia: recibe los push de avisos y los muestra.
// El payload lo envía /api/aviso-lechugas: { titulo, cuerpo, url, tag }.

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) {}
  event.waitUntil(self.registration.showNotification(d.titulo || "Kylia", {
    body:  d.cuerpo || "",
    icon:  "/assets/img/icon-192.png",
    badge: "/assets/img/icon-192.png",
    tag:   d.tag || "kylia-aviso",   // el aviso del día sustituye al anterior
    data:  { url: d.url || "/campo" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/campo";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
    for (const w of ws) if (w.url.includes("/campo") && "focus" in w) return w.focus();
    return clients.openWindow(url);
  }));
});
