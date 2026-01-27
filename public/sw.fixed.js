/* Minimal Service Worker for push + simple runtime caching
   - Avoids hardcoded precache list so production build IDs can't break install
   - Provides push + notification handlers with logging
*/

self.addEventListener('install', (ev) => {
  self.skipWaiting();
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(self.clients.claim());
});

// Simple runtime caching for _next/static to improve load without precache
self.addEventListener('fetch', (ev) => {
  try {
    const url = new URL(ev.request.url);
    if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/static/') || url.pathname.endsWith('.css') || url.pathname.endsWith('.js')) {
      ev.respondWith(
        caches.open('runtime-v1').then(cache => cache.match(ev.request).then(r => r || fetch(ev.request).then(resp => { try{ cache.put(ev.request, resp.clone()); }catch(e){} return resp; })))
      );
    }
  } catch (e) {
    // ignore
  }
});

/* Push / Notification handlers */
self.addEventListener('push', (ev) => {
  try {
    console.log('[SW.fixed] push event', ev);
    let payload = {};
    if (ev.data) {
      try { payload = ev.data.json(); } catch (e) { try { payload = { body: ev.data.text() }; } catch (e2) { payload = {}; } }
    }
    const title = payload.title || 'Siakad Helper';
    const options = Object.assign({ body: payload.body || '', data: payload.data || {} }, payload.options || {});
    console.log('[SW.fixed] showNotification', title, options);
    ev.waitUntil(self.registration.showNotification(title, options));
  } catch (e) { console.warn('[SW.fixed] push handler error', e); }
});

self.addEventListener('notificationclick', (ev) => {
  try {
    ev.notification.close();
    const url = ev.notification && ev.notification.data && ev.notification.data.url ? ev.notification.data.url : '/';
    ev.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    }));
  } catch (e) { console.warn('[SW.fixed] notificationclick error', e); }
});
