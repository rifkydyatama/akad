// public/sw.js
// -------------------------------------------------------------------------
// Service Worker Runtime-Only (Bersih tanpa Precache Error)
// -------------------------------------------------------------------------

const RUNTIME_CACHE = 'runtime-cache-v1';

// 1. Install: Langsung aktifkan SW baru (Skip Waiting)
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// 2. Activate: Ambil alih kontrol klien segera
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 3. Fetch: Cache ringan untuk aset statis (Runtime Caching)
self.addEventListener('fetch', (event) => {
  try {
    const url = new URL(event.request.url);

    // Hanya cache file aset statis & gambar dari origin yang sama
    if (
      url.origin === self.location.origin &&
      (url.pathname.startsWith('/_next/static/') ||
       url.pathname.startsWith('/static/') ||
       event.request.destination === 'image' ||
       event.request.destination === 'style' ||
       event.request.destination === 'script')
    ) {
      event.respondWith(
        caches.open(RUNTIME_CACHE).then(async (cache) => {
          // Strategi: Network First, falling back to Cache
          // (Coba download dulu, kalau gagal/offline baru pakai cache)
          try {
            const response = await fetch(event.request);
            if (response && response.ok) {
              cache.put(event.request, response.clone());
            }
            return response;
          } catch (err) {
            const cached = await cache.match(event.request);
            return cached || Promise.reject('no-match');
          }
        })
      );
    }
    // Selain itu biarkan default (langsung ke jaringan)
  } catch (e) {
    // Ignore error parsing
  }
});

// 4. PUSH Event: Menangani Notifikasi Masuk
self.addEventListener('push', (event) => {
  let payload = { title: 'Siakad Helper', body: 'Notifikasi baru!', url: '/' };
  
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (e) {
      payload.body = event.data.text();
    }
  }

  const options = {
    body: payload.body,
    icon: '/icon-192.png', // Pastikan file ini ada
    badge: '/badge-72.png', // Pastikan file ini ada
    data: { url: payload.url || '/' }
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Siakad Helper', options)
  );
});

// 5. Notification Click: Buka aplikasi saat notif diklik
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Cek apakah tab sudah terbuka
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // Kalau tidak, buka tab baru
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});