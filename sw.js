self.addEventListener("install", function (event) {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", function (event) {
  event.respondWith(fetch(event.request));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : self.location.origin + self.registration.scope;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {
    for (const client of clients) {
      if ("focus" in client) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  }));
});
