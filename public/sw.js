// Royal Kat & Kai Vault — Service Worker for Push Notifications
const CACHE_NAME = 'royal-vault-v1';

// Push notification received
self.addEventListener('push', event => {
  let data = { title: 'Royal Vault', body: 'New notification', icon: '/favicon.ico' };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch { /* use defaults */ }

  const options = {
    body: data.body,
    icon: data.icon || '/favicon.ico',
    badge: data.badge || '/favicon.ico',
    tag: data.tag || 'royal-vault-' + Date.now(),
    data: { url: data.url || '/app' },
    vibrate: [200, 100, 200],
    requireInteraction: data.priority || false,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Click notification → open / focus app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/app';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Focus existing tab if open
      for (const client of windowClients) {
        if (client.url.includes('/app') && 'focus' in client) return client.focus();
      }
      // Otherwise open new tab
      return clients.openWindow(url);
    })
  );
});

// Activate — take control immediately
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
