// Service worker: shows reminders pushed by the server even while the app is closed,
// and handles the notification buttons (Done / Snooze).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || '⏰ Reminder', {
    body: d.body || '',
    tag: d.tag,
    data: d,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200],
    timestamp: d.t || Date.now(),
    actions: !d.id ? [] : d.task === false ? [{ action: 'snooze', title: '⏰ Snooze 10 min' }]
      : [{ action: 'done', title: '✓ Done' }, { action: 'snooze', title: '⏰ Snooze 10 min' }],
  }));
});

self.addEventListener('notificationclick', e => {
  const d = e.notification.data || {};
  e.notification.close();
  if (e.action === 'snooze') e.waitUntil(snooze(d));
  else e.waitUntil(openApp(d.id ? (e.action === 'done' ? '#done=' : '#open=') + encodeURIComponent(d.id) : ''));
});

async function openApp(hash) {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const win = wins.find(w => new URL(w.url).origin === self.location.origin);
  if (win) { win.postMessage({ type: 'open', hash }); return win.focus(); }
  return self.clients.openWindow('/' + hash);
}

async function snooze(d) {
  const key = await syncKey();
  if (key) {
    const r = await fetch('/api/push/snooze', { method: 'POST', headers: { 'x-sync-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ ...d, minutes: 10 }) }).catch(() => null);
    if (r && r.ok) return;
  }
  return openApp(d.id ? '#snooze=' + encodeURIComponent(d.id) : '');   // couldn't reach the server: let the app do it
}

// the page keeps the sync code in IndexedDB so this worker can use it
function syncKey() {
  return new Promise(res => {
    const r = indexedDB.open('daily-checklist', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => res(null);
    r.onsuccess = () => {
      try {
        const q = r.result.transaction('kv').objectStore('kv').get('syncKey');
        q.onsuccess = () => res(q.result || null);
        q.onerror = () => res(null);
      } catch { res(null); }
    };
  });
}
