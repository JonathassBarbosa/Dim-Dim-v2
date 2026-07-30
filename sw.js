const CACHE = 'dimdim-v19-open-finance-back';
const ASSETS = [
  './', './index.html', './legal.html', './manifest.json', './assets/app.css', './assets/dimdim-logo.svg',
  './js/app.js', './js/api.js', './js/config.js', './js/dom.js', './js/storage.js',
  './js/notifications.js', './js/open-finance.js',
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

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || 'Você tem uma nova atualização financeira.' };
  }
  const title = payload.title || 'DimDim';
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || 'Abra o app para conferir.',
    icon: './icons/icon-192.png',
    badge: './icons/mark.png',
    tag: payload.tag || 'dimdim-notification',
    renotify: true,
    data: {
      url: payload.url || './#notifications',
      notificationId: payload.tag || null
    }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || './#notifications', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin) {
          client.postMessage({ type: 'OPEN_NOTIFICATIONS' });
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
