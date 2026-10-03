// Stores the checklist online so every device that knows the sync code sees the same data.
// The code itself is never stored: data lives under a SHA-256 hash of it.
import { getStore } from '@netlify/blobs';

const MAX_STATE = 4_000_000;   // characters; images are stored separately
const MAX_IMAGE = 5_500_000;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
const sha256 = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
  .map(b => b.toString(16).padStart(2, '0')).join('');

export async function handle(req, store) {
  const code = req.headers.get('x-sync-key') || '';
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(code)) return json({ error: 'invalid sync code' }, 401);
  const ns = await sha256('checklist-sync:' + code);
  const { pathname } = new URL(req.url);

  // images, addressed by the SHA-256 of their data URL
  const img = pathname.match(/\/img\/([a-f0-9]{64})$/);
  if (img) {
    const key = `${ns}/img/${img[1]}`;
    if (req.method === 'GET') {
      const data = await store.get(key);
      return data == null ? json({ error: 'not found' }, 404)
        : new Response(data, { headers: { 'content-type': 'text/plain', 'cache-control': 'private, max-age=31536000, immutable' } });
    }
    if (req.method === 'PUT') {
      const data = await req.text();
      if (data.length > MAX_IMAGE || !data.startsWith('data:image/')) return json({ error: 'invalid image' }, 400);
      if (await sha256(data) !== img[1]) return json({ error: 'hash mismatch' }, 400);
      await store.set(key, data);
      return json({ ok: true });
    }
    return json({ error: 'method not allowed' }, 405);
  }

  // the checklist itself; writes must name the revision they were based on
  const key = `${ns}/state`;
  if (req.method === 'GET') return json((await store.get(key, { type: 'json' })) || { rev: null, state: null });
  if (req.method === 'PUT') {
    const body = await req.text();
    if (body.length > MAX_STATE) return json({ error: 'too large' }, 413);
    let data;
    try { data = JSON.parse(body); } catch { return json({ error: 'invalid json' }, 400); }
    if (!data?.state || !Array.isArray(data.state.tasks)) return json({ error: 'invalid state' }, 400);
    const cur = await store.get(key, { type: 'json' });
    if ((cur?.rev ?? null) !== (data.baseRev ?? null)) return json(cur, 409);   // someone else wrote first: merge and retry
    const next = { rev: crypto.randomUUID(), state: data.state };
    await store.setJSON(key, next);
    return json({ rev: next.rev });
  }
  return json({ error: 'method not allowed' }, 405);
}

export default req => handle(req, getStore({ name: 'checklist-sync', consistency: 'strong' }));

export const config = { path: ['/api/sync', '/api/sync/img/*'] };
