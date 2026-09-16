import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { accessControl } from '../server/access.js';
import { Store } from '../server/store.js';

const owner = '11111111-2222-4333-8444-555555555555';
// node:http preserves the explicit Host header used to emulate Azure routing.
function fetch(url: string, options: { method?: string; headers: Record<string, string> }) {
  return new Promise<{ status: number }>((resolve, reject) => {
    const req = httpRequest(url, options, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode! })); });
    req.on('error', reject); req.end();
  });
}
const hosted = { HARNESS_HOSTED: 'true', HARNESS_ALLOWED_ORIGINS: 'https://example.com', HARNESS_OWNER_ID: owner, WEBSITE_SITE_NAME: 'test-app', WEBSITE_AUTH_ENABLED: 'True' };
async function withServer(env: NodeJS.ProcessEnv, run: (base: string) => Promise<void>) {
  const app = express(); app.use(accessControl(env, 3000)); app.use((_req, res) => res.json({ allowed: true }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}`); } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
const headers = { Host: 'example.com', 'X-MS-CLIENT-PRINCIPAL-ID': owner, 'X-MS-CLIENT-PRINCIPAL-IDP': 'aad' };
test('private preview requires Azure authentication and the exact owner identity', async () => {
  await withServer(hosted, async base => {
    assert.equal((await fetch(base, { headers })).status, 200);
    assert.equal((await fetch(base, { headers: { Host: 'example.com' } })).status, 403);
    assert.equal((await fetch(base, { headers: { ...headers, 'X-MS-CLIENT-PRINCIPAL-ID': 'other-user' } })).status, 403);
    assert.equal((await fetch(base, { headers: { ...headers, 'X-MS-CLIENT-PRINCIPAL-IDP': 'other-provider' } })).status, 403);
  });
  await withServer({ ...hosted, WEBSITE_AUTH_ENABLED: 'False' }, async base => {
    assert.equal((await fetch(base, { headers })).status, 503);
  });
});
test('hosted requests reject untrusted hosts, foreign origins, and mutations with no origin', async () => {
  await withServer(hosted, async base => {
    assert.equal((await fetch(base, { headers: { ...headers, Host: 'evil.example' } })).status, 403);
    assert.equal((await fetch(base, { method: 'POST', headers })).status, 403);
    assert.equal((await fetch(base, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(base, { method: 'POST', headers: { ...headers, Origin: 'https://example.com' } })).status, 200);
  });
});
test('hosted access cannot start with an empty owner or an unsafe origin', () => {
  assert.throws(() => accessControl({ ...hosted, HARNESS_OWNER_ID: '' }, 3000));
  assert.throws(() => accessControl({ ...hosted, HARNESS_ALLOWED_ORIGINS: '*' }, 3000));
  assert.throws(() => accessControl({ ...hosted, HARNESS_ALLOWED_ORIGINS: 'http://example.com' }, 3000));
});
test('live-run reservations are atomic for a comparison and persist across restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'harness-budget-'));
  try {
    const store = new Store(directory);
    assert.equal(store.reserveLiveRuns(3, 4, '2026-09-16'), true);
    assert.equal(store.reserveLiveRuns(2, 4, '2026-09-16'), false);
    assert.equal(new Store(directory).reserveLiveRuns(1, 4, '2026-09-16'), true);
    assert.equal(store.reserveLiveRuns(1, 4, '2026-09-16'), false);
    assert.equal(store.reserveLiveRuns(4, 4, '2026-09-17'), true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
