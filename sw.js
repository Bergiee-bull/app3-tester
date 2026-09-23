const CACHE = "app3-tester-v1.4.0";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./src/styles.css?v=1.4.0",
  "./src/app.js?v=1.4.0",
  "./src/signal.js",
  "./src/storage.js",
  "./src/portfolio.js?v=1.4.0",
  "./src/asset_registry.js",
  "./src/charts.js?v=1.4.0",
  "./src/reconciliation.js?v=1.4.0",
  "./src/strategy_history.js?v=1.4.0",
  "./src/benchmark_data.js?v=1.4.0",
  "./src/market_status.js?v=1.4.0",
  "./data/push_config.json",
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
  if (url.pathname.endsWith("/data/app3_signal.json")
    || url.pathname.endsWith("/data/benchmark_series.json")
    || url.pathname.endsWith("/data/app3_strategy_history.json")
    || url.pathname.endsWith("/data/public_market_update_status.json")) {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request, { cache: "no-store" });
        if (!response.ok) throw new Error(`Public data request failed: ${response.status}`);
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
        return response;
      } catch (error) {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
