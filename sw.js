const CACHE = "app3-tester-v1.2.1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./src/styles.css?v=1.2.1",
  "./src/app.js?v=1.2.1",
  "./src/signal.js",
  "./src/storage.js",
  "./src/portfolio.js?v=1.2.1",
  "./src/asset_registry.js",
  "./src/charts.js?v=1.2.1",
  "./src/benchmark_data.js?v=1.2.1",
  "./data/asset_registry.json",
  "./assets/icons/app3.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.endsWith("/data/app3_signal.json") || url.pathname.endsWith("/data/benchmark_series.json")) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
