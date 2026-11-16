const CACHE_NAME = 'flowiq-studio-v42-2026-11-16-63';
const APP_FILES = [
  './',
  './index.html',
  './manifest.json',
  './js/studio.js?v=2026.11.16.63',
  './js/datamodel.js?v=2026.11.16.63',
  './js/vfs.js?v=2026.11.16.63',
  './js/backup.js?v=2026.11.16.63',
  './js/engine.js?v=2026.11.16.63',
  './assets/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('flowiq-studio-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cacheKey = request.mode === 'navigate'
      ? new Request(new URL('./index.html', self.location.href).href)
      : request;
    try {
      const fresh = await fetch(request, { cache: 'no-store' });
      if (fresh && fresh.ok && fresh.type === 'basic') {
        await cache.put(cacheKey, fresh.clone());
      }
      return fresh;
    } catch (error) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
      return Response.error();
    }
  })());
});
