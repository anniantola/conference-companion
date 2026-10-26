const CACHE = "conference-companion-engine-1.2.0";
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
  "./src/safe-url.js",
  "./src/json-schema.js",
  "./src/migrations.js",
  "./src/calendar.js",
  "./src/vcard.js",
  "./src/qrcode.js",
  "./src/vendor/qr-scanner/qr-scanner.min.js",
  "./src/vendor/qr-scanner/qr-scanner-worker.min.js",
  "./src/backup.js",
  "./src/zip.js",
  "./schemas/conference-manifest.schema.json",
  "./schemas/conference.schema.json",
  "./schemas/programme.schema.json",
  "./schemas/people.schema.json",
  "./schemas/locations.schema.json",
  "./schemas/branding.schema.json"
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

  // Keep each installed engine coherent while its replacement waits. Network-first
  // scripts can otherwise mix new modules with an old page during note editing.
  const engineUrl = new URL(url.href);engineUrl.search='';
  const isEngineAsset=ENGINE_ASSETS.some(path=>new URL(path,self.location.href).href===engineUrl.href);
  if(url.origin===self.location.origin&&isEngineAsset){
    event.respondWith(caches.open(CACHE).then(cache=>cache.match(engineUrl.href)).then(cached=>cached||fetch(event.request)));
    return;
  }

  // Runtime JSON Schemas belong to the engine and are safe to cache.
  if (url.pathname.includes("/schemas/") && url.pathname.endsWith(".json")) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
    return;
  }

  // Conference package lifecycle is owned by package-store.js + IndexedDB.
  // Avoid a second, independent service-worker cache for conference JSON files.
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
