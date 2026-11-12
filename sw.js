/* App3 public-cache retirement v20261112-r2. No localStorage/IndexedDB access. */
const KNOWN_APP3_CACHES = new Set(['app3-tester-v1.2.2', 'app3-tester-v1.4.1']);
const scope = new URL(self.registration.scope);
const isApp3 = scope.pathname === '/app3-tester/';
self.addEventListener('install', event => {
  if (isApp3) event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!isApp3 || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  // Fail closed for any old JS/data request during the short handover.
  if (event.request.mode !== 'navigate') {
    event.respondWith(Promise.resolve(new Response('App3 automatic signaling paused', {
      status: 410, headers: {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}
    })));
  }
});
self.addEventListener('activate', event => {
  if (!isApp3) return;
  event.waitUntil((async () => {
    await self.clients.claim();
    for (const name of await caches.keys()) {
      if (KNOWN_APP3_CACHES.has(name)) await caches.delete(name);
    }
    const windows = await self.clients.matchAll({type:'window'});
    await self.registration.unregister();
    for (const client of windows) {
      const url = new URL(client.url);
      if (url.origin === scope.origin && url.pathname.startsWith(scope.pathname)) {
        // Also bypass an old HTTP-cached root document, without clearing HTTP cache.
        await client.navigate(new URL('?status=paused-20261112-r2', scope).href);
      }
    }
  })());
});
