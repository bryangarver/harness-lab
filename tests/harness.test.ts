import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configSchema, runSchema, type Config } from '../server/schema.js';
import { Store } from '../server/store.js';
import { calculate, toolDefinitions, validateTool } from '../server/tools.js';
import { executeRun, newRun } from '../server/harness.js';
import { createLiveProvider, simulatorProvider, type Provider } from '../server/provider.js';

function fixture(t: { after: (fn: () => void) => void }) { const dir = mkdtempSync(join(tmpdir(), 'harness-test-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return new Store(dir); }
async function simulate(store: Store, prompt: string, overrides: Partial<Config> = {}, approved = true, context = '') {
  const run = newRun(runSchema.parse({ prompt, context, config: overrides }), 'Scripted simulator');
  return executeRun(run, store, simulatorProvider, { signal: new AbortController().signal, approve: async () => approved });
}
function callProvider(name: string, args: unknown): Provider {
  return async () => ({ items: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: 'call', id: 'fc', status: 'completed' }], text: '', inputTokens: 0, outputTokens: 0 });
}

test('calculator handles precedence and rejects code, malformed numbers, and zero division', () => {
  assert.equal(calculate('(180 * 3) + (45 * 2)'), 630);
  assert.equal(calculate('-2 * (3 + .5)'), -7);
  assert.equal(calculate('17 % 5'), 2);
  for (const bad of ['process.exit()', '1;2', '1 2', '1..2', '1/0', '2%0', '(2+3', '2+']) assert.throws(() => calculate(bad));
});
test('strict tool schemas reject disabled tools and extra properties', () => {
  const config = configSchema.parse({ tools: false });
  assert.throws(() => validateTool('calculate', { expression: '2+2' }, config));
  assert.throws(() => validateTool('shell', {}, config));
  assert.throws(() => validateTool('save_memory', { content: 'x', extra: true }, config));
  assert.ok(toolDefinitions(config).every(t => t.strict && t.parameters.additionalProperties === false));
});
test('the loop returns a tool result to the simulator before answering', async t => {
  const run = await simulate(fixture(t), 'Calculate 24 * 7.', { expected: '168' });
  assert.equal(run.status, 'completed'); assert.equal(run.steps, 2); assert.equal(run.toolCalls, 1);
  assert.match(run.output, /168/); assert.equal(run.evaluation?.passed, true);
  assert.deepEqual(run.events.map(e => e.type), ['context', 'model', 'tool', 'result', 'model', 'answer', 'evaluation']);
});
test('one-turn budget stops even after a successful tool; stopped answers cannot pass evaluations', async t => {
  const run = await simulate(fixture(t), 'Calculate 24 * 7.', { maxSteps: 1, expected: 'harness' });
  assert.equal(run.status, 'stopped'); assert.equal(run.steps, 1); assert.equal(run.evaluation?.passed, false);
});
test('memory writes pause, approved facts survive reopening the store, and recall does not write', async t => {
  const store = fixture(t);
  const request = newRun(runSchema.parse({ prompt: 'Remember that I prefer concise answers.', config: {} }), 'simulator');
  let sawApproval = false;
  await executeRun(request, store, simulatorProvider, { signal: new AbortController().signal, approve: async approval => {
    sawApproval = true; assert.equal(request.status, 'awaiting_approval'); assert.equal(approval.tool, 'save_memory'); assert.equal(store.memories('simulator').length, 0); return true;
  } });
  assert.equal(sawApproval, true);
  const reopened = new Store(store.directory);
  assert.equal(reopened.memories('simulator').length, 1); assert.equal(reopened.memories('live').length, 0);
  const recall = await simulate(reopened, 'What do you remember about my preferences?');
  assert.match(recall.output, /prefer concise/); assert.equal(recall.toolCalls, 0); assert.equal(reopened.memories('simulator').length, 1);
  const off = await simulate(reopened, 'What do you remember about my preferences?', { memory: false });
  assert.doesNotMatch(off.output, /prefer concise/);
  reopened.forget('simulator', reopened.memories('simulator')[0].id); assert.equal(reopened.memories('simulator').length, 0);
});
test('denied and expired approvals never write memory', async t => {
  const store = fixture(t);
  const denied = await simulate(store, 'Remember that my codeword is TEST.', {}, false);
  assert.equal(store.memories('simulator').length, 0); assert.match(denied.output, /denied/i); assert.equal(denied.approval, undefined);
  const expired = newRun(runSchema.parse({ prompt: 'Remember that I like tests.', config: {} }), 'simulator');
  await executeRun(expired, store, simulatorProvider, { signal: new AbortController().signal, approve: async () => { throw new Error('Approval expired.'); } });
  assert.equal(expired.status, 'completed'); assert.equal(expired.approval, undefined); assert.equal(store.memories('simulator').length, 0);
});
test('repeated model attempts cannot bypass a denied write', async t => {
  const store = fixture(t); let approvals = 0;
  const run = newRun(runSchema.parse({ prompt: 'Remember a fact', config: { maxSteps: 3 } }), 'fake');
  await executeRun(run, store, callProvider('save_memory', { content: 'denied fact' }), { signal: new AbortController().signal, approve: async () => { approvals++; return false; } });
  assert.equal(approvals, 1); assert.equal(store.memories('simulator').length, 0); assert.equal(run.status, 'stopped');
});
test('cancellation during approval leaves no memory and no pending approval', async t => {
  const store = fixture(t); const controller = new AbortController();
  const run = newRun(runSchema.parse({ prompt: 'Remember that I prefer tea.', config: {} }), 'simulator');
  await executeRun(run, store, simulatorProvider, { signal: controller.signal, approve: async () => { controller.abort(); return true; } });
  assert.equal(run.status, 'cancelled'); assert.equal(run.approval, undefined); assert.equal(store.memories('simulator').length, 0);
});
test('context trimming changes what is sent; memory off excludes saved facts', async t => {
  const store = fixture(t); const context = 'x'.repeat(110) + ' CODEWORD';
  const narrow = await simulate(store, 'Show the context', { contextChars: 100 }, true, context);
  const wide = await simulate(store, 'Show the context', { contextChars: 1000 }, true, context);
  assert.doesNotMatch(narrow.output, /CODEWORD/); assert.match(wide.output, /CODEWORD/); assert.ok(narrow.events.some(e => e.type === 'warning'));
});
test('retrieval supplies real documents and missing retrieval supplies no policy', async t => {
  const store = fixture(t);
  const on = await simulate(store, 'What is the hotel policy?'); assert.match(on.output, /180/); assert.match(on.output, /travel-policy/);
  const off = await simulate(store, 'What is the hotel policy?', { retrieval: false }); assert.doesNotMatch(off.output, /180/);
});
test('planning adds a real tool turn and changes the budget outcome', async t => {
  const store = fixture(t);
  const on = await simulate(store, 'Calculate 24 * 7', { planning: true, maxSteps: 2 }); assert.equal(on.status, 'stopped'); assert.equal(on.toolCalls, 2);
  const off = await simulate(store, 'Calculate 24 * 7', { maxSteps: 2 }); assert.equal(off.status, 'completed');
});
test('a transient calculator failure is retried once only when enabled', async t => {
  const store = fixture(t);
  const recovered = await simulate(store, 'Calculate 144 / 12.', { failOnce: true, retry: true });
  assert.match(recovered.output, /12/); assert.equal(recovered.events.filter(e => e.type === 'retry').length, 1);
  const failed = await simulate(store, 'Calculate 144 / 12.', { failOnce: true, retry: false });
  assert.match(failed.output, /calculation failed/i); assert.equal(failed.events.filter(e => e.type === 'retry').length, 0);
});
test('unknown tools and malformed arguments return errors without execution', async t => {
  const store = fixture(t);
  for (const name of ['shell', 'save_memory']) {
    const run = newRun(runSchema.parse({ prompt: 'test', config: { maxSteps: 1, approvals: false } }), 'fake');
    await executeRun(run, store, callProvider(name, { command: 'arbitrary' }), { signal: new AbortController().signal, approve: async () => true });
    assert.ok(run.events.some(e => e.type === 'warning')); assert.equal(store.memories('simulator').length, 0);
  }
});
test('incomplete model output does not execute a partial tool call', async t => {
  const store = fixture(t); const provider: Provider = async args => ({ ...await callProvider('save_memory', { content: 'must not save' })(args), incomplete: true });
  const run = newRun(runSchema.parse({ prompt: 'test', config: { approvals: false } }), 'fake');
  await executeRun(run, store, provider, { signal: new AbortController().signal, approve: async () => true });
  assert.equal(run.status, 'stopped'); assert.equal(run.toolCalls, 0); assert.equal(store.memories('simulator').length, 0);
});
test('instruction changes alter the simulator output, and failed checks are explicit', async t => {
  const store = fixture(t);
  const upper = await simulate(store, 'Calculate 24 * 7', { instructions: 'Use uppercase.', expected: '169' });
  assert.equal(upper.output, upper.output.toUpperCase()); assert.equal(upper.evaluation?.passed, false);
  const bullets = await simulate(store, 'Calculate 24 * 7', { instructions: 'Use bullet points.' }); assert.match(bullets.output, /^- /);
});
test('OpenAI SDK protocol preserves reasoning state and connects tool call IDs across turns', async t => {
  const requests: Record<string, unknown>[] = [];
  const transport: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const first = requests.length === 1;
    return new Response(JSON.stringify({ id: `resp_${requests.length}`, object: 'response', status: 'completed', output: first ? [
      { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque-state' },
      { type: 'function_call', id: 'fc_1', name: 'calculate', call_id: 'call_1', arguments: '{"expression":"24 * 7"}', status: 'completed' },
    ] : [{ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'The answer is 168.', annotations: [] }] }], usage: { input_tokens: 50, output_tokens: 20, total_tokens: 70 } }), { headers: { 'Content-Type': 'application/json' } });
  };
  const provider = createLiveProvider({ getCredentials: () => ({ key: 'test-only-credential', model: 'gpt-5.6-sol' }), fetch: transport });
  const run = newRun(runSchema.parse({ prompt: 'Calculate 24 * 7', config: { mode: 'live' } }), 'gpt-5.6-sol');
  await executeRun(run, fixture(t), provider, { signal: new AbortController().signal, approve: async () => true });
  assert.equal(run.status, 'completed'); assert.equal(run.output, 'The answer is 168.'); assert.equal(requests.length, 2);
  assert.equal(requests[0].model, 'gpt-5.6-sol'); assert.equal(requests[0].store, false);
  assert.deepEqual(requests[0].include, ['reasoning.encrypted_content']);
  const nextInput = requests[1].input as Record<string, unknown>[];
  assert.ok(nextInput.some(i => i.type === 'reasoning' && i.encrypted_content === 'opaque-state'));
  assert.ok(nextInput.some(i => i.type === 'function_call_output' && i.call_id === 'call_1' && JSON.parse(String(i.output)).result === 168));
  assert.equal(run.usage.input, 100); assert.equal(run.usage.output, 40);
  assert.doesNotMatch(JSON.stringify(run), /test-only-credential|opaque-state/);
});
test('OpenAI authentication errors do not echo provider payloads or credentials', async () => {
  const provider = createLiveProvider({ getCredentials: () => ({ key: 'private-test-key', model: 'gpt-5.6-sol' }), fetch: async () => new Response(JSON.stringify({ error: { message: 'private-test-key', type: 'invalid_request_error' } }), { status: 401, headers: { 'Content-Type': 'application/json' } }) });
  await assert.rejects(() => provider({ input: [], instructions: '', prompt: '', context: '', memories: [], config: configSchema.parse({ retry: false }), signal: new AbortController().signal }), error => error instanceof Error && /401/.test(error.message) && !error.message.includes('private-test-key'));
});
