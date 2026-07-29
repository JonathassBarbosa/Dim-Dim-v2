const CACHE = 'dimdim-v14-gemini-cloud';
const ASSETS = [
  './', './index.html', './manifest.json', './assets/app.css', './assets/dimdim-logo.svg',
  './js/app.js', './js/api.js', './js/config.js', './js/dom.js', './js/storage.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/mark.png',
  './icons/mark-success.png', './icons/mark-error.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .catch((err) => console.error('sw install falhou:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.hostname.includes('supabase.co') || event.request.method !== 'GET') return;

  // navegação (index.html): sempre tenta a rede primeiro, cai pro cache só se offline
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
