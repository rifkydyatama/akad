// public/sw.js
// Runtime-only Service Worker — no precache. Enhanced notifications with actions.

const RUNTIME_CACHE = 'runtime-cache-v1';

self.addEventListener('install', (event) => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

// Runtime caching for static assets
self.addEventListener('fetch', (event) => {
  try {
    const url = new URL(event.request.url);
    if (
      url.origin === self.location.origin &&
      (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/static/') ||
        event.request.destination === 'image' || event.request.destination === 'style' || event.request.destination === 'script')
    ) {
      event.respondWith(
        caches.open(RUNTIME_CACHE).then(async (cache) => {
          try {
            const response = await fetch(event.request);
            if (response && response.ok) cache.put(event.request, response.clone());
            return response;
          } catch (err) {
            const cached = await cache.match(event.request);
            return cached || fetch(event.request);
          }
        })
      );
    }
  } catch (e) {
    // ignore
  }
});

// Enhanced PUSH handler
self.addEventListener('push', (event) => {
  let payload = { title: 'Siakad Helper', body: 'Notifikasi baru!', url: '/' };
  if (event.data) {
    try { payload = event.data.json(); } catch { try { payload.body = event.data.text(); } catch { /* ignore */ } }
  }

  const timestamp = payload.timestamp || Date.now();
  const image = payload.image || null;

  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/badge-72.png',
    image: image || undefined,
    tag: 'siakad-notification',
    renotify: true,
    vibrate: [200, 100, 200],
    requireInteraction: true,
    timestamp,
    data: {
      url: payload.url || '/',
      original: payload
    },
    actions: [
      { action: 'view_schedule', title: 'Lihat Jadwal' },
      { action: 'close', title: 'Tutup' }
    ]
  };

  event.waitUntil(self.registration.showNotification(payload.title || 'Siakad Helper', options));
});

// Handle action buttons and clicks
self.addEventListener('notificationclick', (event) => {
  const action = event.action;
  const notif = event.notification;
  const data = notif?.data || {};
  notif.close();

  // Action: close — simply close the notification
  if (action === 'close') {
    return;
  }

  // Action: view_schedule or default click -> open provided URL
  const urlToOpen = (data && data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        try {
          if (client.url === urlToOpen && 'focus' in client) return client.focus();
        } catch (e) { /* ignore cross-origin access */ }
      }
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});

// Optional message handler to skip waiting from the page
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
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
    icon: '/icon-192.png',
    badge: '/badge-72.png',
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
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});// public/sw.js
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
    icon: '/icon-192.png',
    badge: '/badge-72.png',
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
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});