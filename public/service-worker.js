const CACHE = "ikms-public-v5";
const SHELL = [
  "./expediteur.html",
  "./suivi.html",
  "./assets/css/theme.css",
  "./assets/css/public.css",
  "./assets/css/app-shell.css",
  "./assets/css/expedition-externe.css",
  "./assets/css/expedition-form.css",
  "./assets/css/expedition-responsive.css",
  "./assets/js/pwa.js",
  "./assets/js/suivi.js",
  "./assets/js/supabase-client.js",
  "./assets/js/expedition-externe.js",
  "./assets/js/expedition-validation.js",
  "./assets/js/expedition-pricing.js",
  "./assets/js/expedition-submit.js",
  "./assets/js/entreprise-contexte.js",
  "./assets/js/geo.js",
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
        .catch(() => caches.match(request).then((cached) => cached || caches.match("./expediteur.html")))
    );
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
