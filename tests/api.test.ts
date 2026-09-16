import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import type { Run } from '../server/schema.js';

let child: ChildProcess; let base: string; let directory: string;
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'harness-api-'));
  const socket = createServer().listen(0, '127.0.0.1'); await once(socket, 'listening');
  const address = socket.address(); assert.ok(address && typeof address !== 'string'); const port = address.port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), HARNESS_DATA_DIR: directory }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/status`)).ok) return; } catch {} await pause(100); }
  throw new Error('Test server did not start.');
});
after(async () => { if (child && child.exitCode === null) { const closed = once(child, 'close'); child.kill('SIGTERM'); await closed; } if (directory) rmSync(directory, { recursive: true, force: true }); });
async function json(path: string, body?: unknown, method = 'POST') {
  const response = await fetch(`${base}/api${path}`, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
async function waitFor(id: string, predicate: (run: Run) => boolean) {
  for (let i = 0; i < 60; i++) { const { data } = await json(`/runs/${id}`); if (predicate(data)) return data as Run; await pause(50); }
  throw new Error('Run did not reach the expected state.');
}

test('status returns no credentials; invalid requests and foreign origins are rejected', async () => {
  const status = await json('/status'); assert.equal(typeof status.data.configured, 'boolean'); assert.equal(status.data.key, undefined); assert.equal(status.data.apiKey, undefined);
  assert.equal((await json('/runs', { prompt: '', config: {} })).status, 400);
  assert.equal((await json('/runs', { prompt: 'x', config: { maxSteps: 100 } })).status, 400);
  assert.equal((await json('/memories?mode=../../outside')).status, 400);
  const foreign = await fetch(`${base}/api/runs`, { method: 'POST', headers: { Origin: 'https://foreign.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'test', config: {} }) });
  assert.equal(foreign.status, 403);
});
test('HTTP run completes and can be loaded from history', async () => {
  const created = await json('/runs', { prompt: 'Calculate 24 * 7.', config: { expected: '168' } }); assert.equal(created.status, 201);
  const run = await waitFor(created.data.id, r => r.status === 'completed'); assert.match(run.output, /168/); assert.equal(run.evaluation?.passed, true);
  const history = await json('/runs'); assert.ok(history.data.some((row: { id: string }) => row.id === run.id));
});
test('approval endpoint rejects stale IDs, and denial blocks the write', async () => {
  const created = await json('/runs', { prompt: 'Remember that this is an API test.', config: {} });
  const run = await waitFor(created.data.id, r => r.status === 'awaiting_approval'); assert.ok(run.approval);
  const stale = await json(`/runs/${run.id}/approval`, { id: crypto.randomUUID(), approved: true }); assert.equal(stale.status, 409);
  assert.equal((await json('/memories?mode=simulator')).data.length, 0);
  assert.equal((await json(`/runs/${run.id}/approval`, { id: run.approval.id, approved: false })).status, 200);
  await waitFor(run.id, r => r.status === 'completed'); assert.equal((await json('/memories?mode=simulator')).data.length, 0);
  assert.equal((await json(`/runs/${run.id}/approval`, { id: run.approval.id, approved: true })).status, 409);
});
test('approved memory survives a new run and can be forgotten', async () => {
  const created = await json('/runs', { prompt: 'Remember that my test codeword is violet.', config: {} });
  const run = await waitFor(created.data.id, r => r.status === 'awaiting_approval'); assert.ok(run.approval);
  await json(`/runs/${run.id}/approval`, { id: run.approval.id, approved: true }); await waitFor(run.id, r => r.status === 'completed');
  const recall = await json('/runs', { prompt: 'What do you remember about me?', config: {} });
  const recalled = await waitFor(recall.data.id, r => r.status === 'completed'); assert.match(recalled.output, /violet/);
  const memories = (await json('/memories?mode=simulator')).data; assert.equal(memories.length, 1);
  const deleted = await fetch(`${base}/api/memories/${memories[0].id}?mode=simulator`, { method: 'DELETE' }); assert.equal(deleted.status, 200);
  assert.equal((await json('/memories?mode=simulator')).data.length, 0);
});
test('cancelling an approval terminates the run without a write', async () => {
  const created = await json('/runs', { prompt: 'Remember that this must never be saved.', config: {} });
  const run = await waitFor(created.data.id, r => r.status === 'awaiting_approval');
  assert.equal((await json(`/runs/${run.id}/cancel`, {})).status, 200);
  const cancelled = await waitFor(run.id, r => r.status === 'cancelled'); assert.equal(cancelled.approval, undefined);
  assert.equal((await json('/memories?mode=simulator')).data.length, 0);
});
test('the development server refuses direct access to the local credentials file', async () => {
  const response = await fetch(`${base}/.env`); assert.ok([403, 404].includes(response.status));
});

test('a comparison runs three turn budgets against one shared scenario', async () => {
  const comparison = await json('/comparisons', { prompt: 'Calculate 24 * 7.', context: 'Shared brief.', variants: [1, 2, 4].map((maxSteps, i) => ({ label: `Harness ${i}`, config: { maxSteps } })) });
  assert.equal(comparison.status, 201); assert.equal(comparison.data.runs.length, 3);
  const runs = await Promise.all(comparison.data.runs.map((r: Run) => waitFor(r.id, value => ['completed', 'stopped'].includes(value.status))));
  assert.deepEqual(runs.map(r => r.status), ['stopped', 'completed', 'completed']);
  for (const run of runs) { assert.equal(run.comparisonId, comparison.data.id); assert.equal(run.memoryScope, 'comparison'); assert.equal(run.prompt, 'Calculate 24 * 7.'); assert.equal(run.context, 'Shared brief.'); }
  assert.match(runs[1].output, /168/); assert.match(runs[2].output, /168/);
});
test('comparison writes are isolated and all variants receive the same initial memory', async () => {
  const seed = await json('/runs', { prompt: 'Remember that our initial codeword is violet.', config: { approvals: false } });
  await waitFor(seed.data.id, r => r.status === 'completed');
  const initial = (await json('/memories?mode=simulator')).data;
  const comparison = await json('/comparisons', { prompt: 'Remember that this comparison codeword is amber.', variants: [{ label: 'Immediate write', config: { approvals: false } }, { label: 'Approved write', config: { approvals: true } }] });
  assert.equal(comparison.status, 201);
  const first = await waitFor(comparison.data.runs[0].id, r => r.status === 'completed');
  const second = await waitFor(comparison.data.runs[1].id, r => r.status === 'awaiting_approval');
  assert.deepEqual(first.events.find(e => e.type === 'context')?.data, second.events.find(e => e.type === 'context')?.data);
  assert.ok(second.approval);
  await json(`/runs/${second.id}/approval`, { id: second.approval.id, approved: true });
  const approved = await waitFor(second.id, r => r.status === 'completed');
  for (const run of [first, approved]) {
    const result = run.events.find(e => e.title === 'save_memory returned a result')?.data as { scope: string; memory: { id: string; content: string } };
    assert.equal(result.scope, 'comparison'); assert.match(result.memory.content, /amber/); assert.match(run.output, /not added to the persistent store/i);
  }
  assert.deepEqual((await json('/memories?mode=simulator')).data, initial);
  await fetch(`${base}/api/memories/${initial[0].id}?mode=simulator`, { method: 'DELETE' });
});
test('comparison validation and capacity rejection do not launch a partial batch', async () => {
  const variant = { label: 'Harness', config: {} };
  for (const variants of [[variant], Array(5).fill(variant), [variant, { label: 'Other', config: { mode: 'live' } }]]) assert.equal((await json('/comparisons', { prompt: 'Calculate 1 + 1.', variants })).status, 400);
  const pending = await json('/runs', { prompt: 'Remember that this pending fact should never persist.', config: {} });
  await waitFor(pending.data.id, r => r.status === 'awaiting_approval');
  const before = (await json('/runs')).data.map((r: Run) => r.id);
  assert.equal((await json('/comparisons', { prompt: 'Calculate 1 + 1.', variants: Array(4).fill(variant) })).status, 429);
  assert.deepEqual((await json('/runs')).data.map((r: Run) => r.id), before);
  await json(`/runs/${pending.data.id}/cancel`, {}); await waitFor(pending.data.id, r => r.status === 'cancelled');
});
