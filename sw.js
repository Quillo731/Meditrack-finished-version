const CACHE_NAME = "ilac-hatirlatici-v1";
const APP_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./game.js",
  "./manifest.json",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow("./index.html");
      return undefined;
    }),
  );
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "İlaç Hatırlatıcı",
    body: "Yeni bir ilaç bildirimi var.",
    tag: "ilac-bildirimi",
  };

  if (event.data) {
    try {
      payload = event.data.json();
    } catch (error) {
      payload.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "İlaç Hatırlatıcı", {
      body: payload.body || "Yeni bir ilaç bildirimi var.",
      tag: payload.tag || "ilac-bildirimi",
      icon: "icon.svg",
      badge: "icon.svg",
    }),
  );
});

