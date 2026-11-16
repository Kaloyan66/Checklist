// Push notification endpoints: key, subscribe/unsubscribe a device, test, upload the reminder schedule, snooze.
import { openStore, json, namespaceOf } from '../lib/common.mjs';
import { vapidKeys, addSubscription, removeSubscription, saveSchedule, addSnooze, sendToAll } from '../lib/push.mjs';

export async function handle(req, store) {
  const action = new URL(req.url).pathname.split('/').pop();
  if (action === 'key' && req.method === 'GET') return json({ publicKey: (await vapidKeys(store)).publicKey });

  const ns = await namespaceOf(req);
  if (!ns) return json({ error: 'invalid sync code' }, 401);
  if (req.method !== 'POST' && req.method !== 'PUT') return json({ error: 'method not allowed' }, 405);
  const raw = await req.text();
  if (raw.length > 500_000) return json({ error: 'too large' }, 413);
  let body;
  try { body = raw ? JSON.parse(raw) : {}; } catch { return json({ error: 'invalid json' }, 400); }

  switch (action) {
    case 'subscribe': {
      const sub = body.subscription;
      if (!/^https:\/\//.test(sub?.endpoint || '') || !sub?.keys?.p256dh || !sub?.keys?.auth) return json({ error: 'invalid subscription' }, 400);
      await addSubscription(store, ns, { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
      return json({ ok: true });
    }
    case 'unsubscribe':
      await removeSubscription(store, ns, String(body.endpoint || ''));
      return json({ ok: true });
    case 'test':
      return json({ sent: await sendToAll(store, ns, { title: '🔔 Notifications are working', body: 'Your reminders will show up like this.', tag: 'test-' + Date.now() }) });
    case 'schedule':
      if (!Array.isArray(body.entries)) return json({ error: 'invalid schedule' }, 400);
      return json({ stored: await saveSchedule(store, ns, body.entries) });
    case 'snooze': {
      const minutes = Math.min(Math.max(Number(body.minutes) || 10, 1), 24 * 60);
      await addSnooze(store, ns, body, minutes);
      return json({ ok: true });
    }
  }
  return json({ error: 'not found' }, 404);
}

export default req => handle(req, openStore());

export const config = { path: '/api/push/*' };
