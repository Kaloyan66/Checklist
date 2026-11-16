// Helpers shared by the Netlify functions.
import { getStore } from '@netlify/blobs';

export const openStore = () => getStore({ name: 'checklist-sync', consistency: 'strong' });

export const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

export const sha256 = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
  .map(b => b.toString(16).padStart(2, '0')).join('');

// Everything a device stores lives under a hash of its sync code; the code itself is never stored.
export async function namespaceOf(req) {
  const code = req.headers.get('x-sync-key') || '';
  return /^[A-Za-z0-9_-]{20,100}$/.test(code) ? sha256('checklist-sync:' + code) : null;
}
