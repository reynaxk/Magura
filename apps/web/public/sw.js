/* Magura service worker: push notifications + tap to open. No offline caching (prices must be live). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { title: 'Magura', body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || 'Magura', {
      body: d.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { href: d.href || '/' },
      tag: d.href || undefined,
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const href = (e.notification.data && e.notification.data.href) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          w.navigate(href);
          return w.focus();
        }
      }
      return self.clients.openWindow(href);
    }),
  );
});
