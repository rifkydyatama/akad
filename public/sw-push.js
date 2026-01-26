/* Push/Notification helper imported by generated sw.js */
self.addEventListener('push', (ev) => {
  let payload = {};
  try {
    payload = ev.data ? ev.data.json() : {};
  } catch (err) {
    try { payload = { body: ev.data.text() }; } catch (e) { payload = {}; }
  }

  const title = payload.title || 'Siakad Helper';
  const options = Object.assign({
    body: payload.body || '',
    tag: payload.tag,
    renotify: payload.renotify || false,
    data: payload.data || {}
  }, payload.options || {});

  ev.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  const url = ev.notification && ev.notification.data && ev.notification.data.url ? ev.notification.data.url : '/';
  ev.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
