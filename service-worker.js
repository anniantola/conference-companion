const CACHE = "conference-companion-engine-1.0.0";
const ENGINE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./bootstrap.js",
  "./manifest.webmanifest",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./src/package-store.js",
  "./src/model.js",
  "./src/user-store.js",
  "./src/validation.js",
  "./src/calendar.js",
  "./src/vcard.js",
  "./src/qrcode.js",
  "./src/backup.js",
  "./src/zip.js"
];

self.addEventListener("install", event => {
  // Do not call skipWaiting(): an engine update should activate on a clean launch,
  // never by force-reloading a user who may be editing notes/photos.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ENGINE_ASSETS)));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("conference-companion-engine-") && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Conference package lifecycle is owned by package-store.js + IndexedDB.
  // Avoid a second, independent service-worker cache for JSON package files.
  if (url.pathname.endsWith(".json")) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (url.pathname.endsWith(".webmanifest") || url.pathname.endsWith("/service-worker.js")) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  if (event.request.mode === "navigate" || url.pathname.endsWith(".js") || url.pathname.endsWith(".css") || url.pathname.endsWith(".html")) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200 && url.origin === self.location.origin) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => event.request.mode === "navigate" ? caches.match("./index.html") : caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response && response.status === 200 && url.origin === self.location.origin) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});
