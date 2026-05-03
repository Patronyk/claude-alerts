const CACHE_NAME = 'claude-alerts-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// Handle incoming push notifications
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Claude Alert', body: event.data ? event.data.text() : 'New notification' };
  }

  const title = data.title || 'Claude Alert';
  const scope = self.registration.scope;
  const options = {
    body: data.body || data.message || '',
    icon: scope + 'icon-192.png',
    badge: scope + 'icon-192.png',
    tag: data.tag || 'claude-alert-' + Date.now(),
    data: {
      url: data.click_action || data.url || scope,
      timestamp: Date.now(),
      topic: data.topic || ''
    },
    vibrate: [200, 100, 200],
    requireInteraction: false
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // Store notification in cache for history
      storeNotification({ title, body: options.body, timestamp: options.data.timestamp, topic: options.data.topic })
    ])
  );
});

// Handle notification click
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

// Store notification in IndexedDB for history display
async function storeNotification(notification) {
  try {
    const db = await openDB();
    const tx = db.transaction('notifications', 'readwrite');
    const store = tx.objectStore('notifications');
    store.add(notification);
    // Keep only last 50
    const all = await getAllFromStore(store);
    if (all.length > 50) {
      const oldest = all.slice(0, all.length - 50);
      oldest.forEach(n => store.delete(n.timestamp));
    }
  } catch (e) {
    // IndexedDB not critical
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

// Message handler for communication with main page
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
