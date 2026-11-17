const CACHE_NAME = 'escala7gb-v1';
const ASSETS = [
  '/',
  '/index_v14.html',
  '/manifest.json'
];

// 1. Instala e salva o "esqueleto" do app no cache
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// 2. Limpa caches antigos se a versão mudar
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
});

// 3. Intercepta as requisições
self.addEventListener('fetch', (e) => {
  // REQUISIÇÕES DE API (Vercel/Supabase): Network First. Se falhar, o app lida com isso localmente.
  if (e.request.url.includes('/api/')) {
    return; 
  }
  
  // ARQUIVOS ESTÁTICOS (HTML, Ícones): Cache First. Se tiver no cache, abre na hora (offline).
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Atualiza o cache em background enquanto o usuário usa a versão salva
        fetch(e.request).then((networkResponse) => {
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, networkResponse));
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(e.request);
    })
  );
});