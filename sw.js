const CACHE = 'flowiq-studio-clean-v158';
const FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/studio.css?v=2026.11.20.158',
  './js/app.js?v=2026.11.20.158',
  './js/core/store.js',
  './js/core/history.js',
  './js/data/model.js',
  './js/data/database.js',
  './js/editor/view.js', './js/editor/property-schema.js',
  './js/runtime/runtime.js',
  './js/runtime/flow-script.js',
  './assets/icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('flowiq-studio-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = request.mode === 'navigate' ? new Request(new URL('./index.html', self.location.href)) : request;
    try {
      const response = await fetch(request, { cache: 'no-store' });
      if (response.ok && response.type === 'basic') await cache.put(key, response.clone());
      return response;
    } catch {
      return (await cache.match(key)) || Response.error();
    }
  })());
});
