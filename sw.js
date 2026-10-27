/* Health log service worker: opens instantly from cache, updates in the background.
   Only this site's own files are cached. Requests to Google are never touched. */
const CACHE = 'health-log-v3';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const key = e.request.mode === 'navigate' ? './index.html' : e.request;
    const hit = await cache.match(key, { ignoreSearch: true });
    const update = fetch(e.request, { cache: 'no-cache' }).then((res) => {
      if (res && res.ok) cache.put(key, res.clone());
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(update); return hit; }
    return (await update) || new Response('Offline', { status: 503 });
  }));
});
