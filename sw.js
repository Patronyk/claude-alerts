// Service worker for Claude Alerts.
// Decodes ntfy.sh's web-push payload shape (server/types.go: webPushPayload):
//   { event: "message", subscription_id, message: { id, title, message, topic, click, time, ... } }
//   { event: "subscription_expiring" }
const SW_VERSION = 'claude-alerts-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    const text = event.data ? event.data.text() : '';
    data = { event: 'message', message: { title: 'Claude Alert', message: text } };
  }

  const scope = self.registration.scope;
  const icon = scope + 'icon-192.png';

  if (data.event === 'subscription_expiring') {
    event.waitUntil(self.registration.showNotification('Claude Alerts — Action needed', {
      body: 'Push subscription is expiring. Open the app and tap Enable Notifications again.',
      icon, badge: icon,
      tag: 'claude-alerts-subscription-expiring',
      requireInteraction: true,
      data: { url: scope, kind: 'subscription_expiring' }
    }));
    return;
  }

  if (data.event === 'message' && data.message) {
    const m = data.message;
    const title = m.title || m.topic || 'Claude Alert';
    const body = m.message || '';
    const topic = m.topic || '';
    const timestamp = m.time ? m.time * 1000 : Date.now();
    const tag = 'claude-alert-' + (m.id || Date.now());
    const click = m.click || scope;

    event.waitUntil(Promise.all([
      self.registration.showNotification(title, {
        body, icon, badge: icon, tag,
        vibrate: [200, 100, 200],
        timestamp,
        data: { url: click, timestamp, topic, messageId: m.id || '' }
      }),
      storeNotification({ title, body, timestamp, topic })
    ]));
    return;
  }

  // Unknown event — must show something or the browser may revoke push permission.
  event.waitUntil(self.registration.showNotification('Claude Alert', {
    body: 'Notification received',
    icon, badge: icon,
    data: { url: scope }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const scope = self.registration.scope;
  const raw = event.notification.data?.url || scope;
  const target = raw.startsWith('http') ? raw : new URL(raw, scope).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(scope) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(target);
      }
    })
  );
});

async function storeNotification(notification) {
  try {
    const db = await openDB();
    const tx = db.transaction('notifications', 'readwrite');
    const store = tx.objectStore('notifications');
    store.add(notification);
    const all = await getAllFromStore(store);
    if (all.length > 50) {
      const oldest = all.slice(0, all.length - 50);
      oldest.forEach(n => store.delete(n.timestamp));
    }
  } catch (e) {
    // IndexedDB is best-effort; the notification still shows.
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('claude-alerts', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('notifications')) {
        db.createObjectStore('notifications', { keyPath: 'timestamp' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = reject;
  });
}

function getAllFromStore(store) {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = reject;
  });
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'GET_NOTIFICATIONS') {
    openDB().then(db => {
      const tx = db.transaction('notifications', 'readonly');
      const store = tx.objectStore('notifications');
      return getAllFromStore(store);
    }).then(notifications => {
      event.source.postMessage({ type: 'NOTIFICATIONS', data: notifications.reverse() });
    }).catch(() => {
      event.source.postMessage({ type: 'NOTIFICATIONS', data: [] });
    });
  }
});
