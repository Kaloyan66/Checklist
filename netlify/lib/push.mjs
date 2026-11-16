// Web Push reminders: each sync space has push subscriptions (one per device) and a schedule
// of upcoming reminders that the page computes. A scheduled function sends whatever is due.
import * as webpush from 'web-push';
import { sha256 } from './common.mjs';

const EARLY = 30_000;              // send up to 30 s early (the job runs once a minute)
const TOO_LATE = 2 * 3600_000;     // skip reminders more than 2 h overdue (e.g. after an outage)
const SENT_TTL = 24 * 3600_000;    // remember what was sent for a day, so nothing goes out twice

const read = (store, key, fallback) => store.get(key, { type: 'json' }).then(v => v ?? fallback);

export async function vapidKeys(store) {
  let keys = await read(store, 'vapid', null);
  if (!keys) {
    await store.setJSON('vapid', webpush.generateVAPIDKeys());
    keys = await read(store, 'vapid', null);       // re-read: if two requests raced, both use the stored pair
  }
  return keys;
}

export const cleanEntry = e => ({
  t: Number(e.t), tag: String(e.tag || '').slice(0, 160), id: String(e.id || '').slice(0, 60), task: e.task !== false,
  title: String(e.title || '').slice(0, 200), body: String(e.body || '').slice(0, 300),
});

// the cron job only looks at sync spaces listed here: { ns: time of the next reminder }
export async function reindex(store, ns) {
  const [subs, schedule, extra] = await Promise.all([read(store, `${ns}/subs`, {}), read(store, `${ns}/schedule`, []), read(store, `${ns}/extra`, [])]);
  const next = Math.min(...[...schedule, ...extra].map(e => e.t));
  const index = await read(store, 'push-index', {});
  if (Object.keys(subs).length && Number.isFinite(next)) index[ns] = next; else delete index[ns];
  await store.setJSON('push-index', index);
}

export async function addSubscription(store, ns, sub) {
  const subs = await read(store, `${ns}/subs`, {});
  subs[await sha256(sub.endpoint)] = sub;
  await store.setJSON(`${ns}/subs`, subs);
  await reindex(store, ns);
}
export async function removeSubscription(store, ns, endpoint) {
  const subs = await read(store, `${ns}/subs`, {});
  delete subs[await sha256(endpoint)];
  await store.setJSON(`${ns}/subs`, subs);
  await reindex(store, ns);
}

export async function saveSchedule(store, ns, entries, now = Date.now()) {
  const sent = await read(store, `${ns}/sent`, {});
  const list = entries.map(cleanEntry).filter(e => Number.isFinite(e.t) && e.tag && e.t > now - 60_000 && !sent[e.tag])
    .sort((a, b) => a.t - b.t).slice(0, 1000);
  await store.setJSON(`${ns}/schedule`, list);
  await reindex(store, ns);
  return list.length;
}
export async function addSnooze(store, ns, entry, minutes, now = Date.now()) {
  const extra = await read(store, `${ns}/extra`, []);
  extra.push(cleanEntry({ ...entry, t: now + minutes * 60_000, tag: `${String(entry.tag || entry.id)}~${now}` }));
  await store.setJSON(`${ns}/extra`, extra.slice(-100));
  await reindex(store, ns);
}

async function defaultSend(sub, payload, keys) {
  return webpush.sendNotification(sub, payload, {
    TTL: 3600, urgency: 'high',
    vapidDetails: { subject: process.env.URL || 'mailto:reminders@example.com', publicKey: keys.publicKey, privateKey: keys.privateKey },
  });
}

// send one notification to every device subscribed in this sync space; forget devices that unsubscribed
export async function sendToAll(store, ns, message, send = defaultSend) {
  const [subs, keys] = await Promise.all([read(store, `${ns}/subs`, {}), vapidKeys(store)]);
  let sent = 0, changed = false;
  for (const [k, sub] of Object.entries(subs)) {
    try { await send(sub, JSON.stringify(message), keys); sent++; }
    catch (err) { if (err?.statusCode === 404 || err?.statusCode === 410) { delete subs[k]; changed = true; } }
  }
  if (changed) await store.setJSON(`${ns}/subs`, subs);
  return sent;
}

export async function deliverDue(store, ns, now = Date.now(), send = defaultSend) {
  const [schedule, extra, sent] = await Promise.all([read(store, `${ns}/schedule`, []), read(store, `${ns}/extra`, []), read(store, `${ns}/sent`, {})]);
  const due = e => e.t <= now + EARLY;
  let count = 0;
  for (const e of [...schedule, ...extra].filter(due).sort((a, b) => a.t - b.t)) {
    if (sent[e.tag] || now - e.t > TOO_LATE) continue;
    count += await sendToAll(store, ns, { title: e.title, body: e.body, tag: e.tag, id: e.id, task: e.task, t: e.t }, send);
    sent[e.tag] = now;
  }
  for (const [tag, t] of Object.entries(sent)) if (now - t > SENT_TTL) delete sent[tag];
  await Promise.all([
    store.setJSON(`${ns}/schedule`, schedule.filter(e => !due(e))),
    store.setJSON(`${ns}/extra`, extra.filter(e => !due(e))),
    store.setJSON(`${ns}/sent`, sent),
  ]);
  await reindex(store, ns);
  return count;
}

export async function deliverAll(store, now = Date.now(), send = defaultSend) {
  const index = await read(store, 'push-index', {});
  let count = 0;
  for (const [ns, next] of Object.entries(index)) if (next <= now + EARLY) count += await deliverDue(store, ns, now, send);
  return count;
}
