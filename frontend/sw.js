/* global Response */
const CACHE_NAME = 'escala7gb-v14';const ASSETS = [
  './',
  './index_v14.html',
  './manifest.json'
];

// 1. Instala e salva os ativos disponíveis sem abortar se algum falhar
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        ASSETS.map((url) =>
          fetch(url, { cache: 'no-cache' })
            .then((res) => {
              if (res && res.ok) {
                return cache.put(url, res);
              }
            })
            .catch(() => {})
        )
      );
    })
  );
  self.skipWaiting();
});

// 2. Limpa caches antigos se a versão mudar e assume controle das abas
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// 3. Intercepta as requisições com Stale-While-Revalidate
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || e.request.url.includes('/api/')) return;

e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      const fetchPromise = fetch(e.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok && networkResponse.type === 'basic') {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(e.request, clone);
            });
          }
          return networkResponse || cachedResponse || new Response('', { status: 504 });
        })
        .catch(() => cachedResponse || new Response('', { status: 504 }));

      return cachedResponse || fetchPromise;
    })
  );
});