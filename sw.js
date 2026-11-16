const CACHE_NAME = 'flowiq-studio-v2';
const APP_FILES = [
  './',
  './index.html',
  './manifest.json',
  './js/studio.js',
  './js/datamodel.js',
  './js/vfs.js',
  './assets/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
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

  // Always ask the network for the newest app shell and modules first.
  // Keep the last good response only as an offline fallback.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cacheKey = request.mode === 'navigate' ? './index.html' : request;
    try {
      const fresh = await fetch(request, { cache: 'no-cache' });
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
