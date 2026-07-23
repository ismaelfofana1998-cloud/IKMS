const CACHE = "ikms-livreur-v4";
const SHELL = [
  "./index.html",
  "./app.html",
  "./assets/css/theme.css",
  "./assets/css/livreur.css",
  "./assets/js/pwa.js",
  "./assets/js/login.js",
  "./assets/js/app.js",
  "./assets/js/auth.js",
  "./assets/js/repository.js",
  "./assets/js/supabase-client.js",
  "./assets/icons/app-192.png",
  "./assets/icons/app-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.endsWith("/config.public.js")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
