const CACHE_NAME = 'pointpal-cache-v77';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icon-192-v2.png',
  './icon-512-v2.png',
  './apple-touch-icon-180.png',
  './logo-horizontal.png',
  './pip-celebration.png',
  './pip-message.png',
  './pip-streak.png',
  './pip-goal.png',
  './pip-pause.png',
  './pip-comeback.png',
  './pip-point-core.png',
  './pip-tv.png',
  './pip-treasure.png',
  './nav-home.png',
  './nav-prizes.png',
  './nav-history.png',
  './pip-wave.png',
  './pip-flying.png',
  './badge-mail.png',
  './badge-exit.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse.clone()));
          return networkResponse;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
