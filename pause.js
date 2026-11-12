/* Ask only existing App3 registrations to fetch the retirement worker. */
(async () => {
  if (!('serviceWorker' in navigator)) return;
  const scope = new URL('./', location.href).href;
  for (const registration of await navigator.serviceWorker.getRegistrations()) {
    if (registration.scope !== scope) continue;
    const worker = registration.active || registration.waiting || registration.installing;
    if (!worker) continue;
    const script = new URL(worker.scriptURL);
    if (script.origin === location.origin && script.pathname === '/app3-tester/sw.js') {
      await registration.update();
    }
  }
})().catch(() => { /* The neutral status remains visible even if offline. */ });
