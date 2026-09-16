import express from 'express';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { configSchema, runSchema, comparisonSchema, type Run, type RunRequest, type Memory, type Approval } from './schema.js';
import { Store } from './store.js';
import { credentials, liveProvider, simulatorProvider } from './provider.js';
import { executeRun, newRun } from './harness.js';
import { knowledge } from './tools.js';
import { environment, isHosted } from './environment.js';
import { accessControl } from './access.js';

const app = express();
const env = environment();
const hosted = isHosted(env);
const port = Number(env.PORT || 3000);
const store = new Store(resolve(env.HARNESS_DATA_DIR || (hosted ? '/home/harness-data' : 'data')));
const liveDailyLimit = Number(env.HARNESS_LIVE_DAILY_LIMIT || 60);
if (!Number.isSafeInteger(liveDailyLimit) || liveDailyLimit < 0) throw new Error('HARNESS_LIVE_DAILY_LIMIT must be a nonnegative integer.');
const active = new Map<string, { run: Run; controller: AbortController; pending?: { id: string; resolve: (approved: boolean) => void } }>();
// Runs are checkpointed, but external side effects are never automatically replayed on restart.
for (const run of store.runs()) {
  if (['running', 'awaiting_approval'].includes(run.status)) {
    run.status = 'stopped'; run.output = 'Server restarted during this run. Review the trace before starting a fresh run.';
    delete run.approval; store.saveRun(run);
  }
}
app.disable('x-powered-by');
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use(accessControl(env, port));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
let mutationWindow = Date.now();
let mutations = 0;
app.use('/api', (req, res, next) => {
  if (hosted && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (Date.now() - mutationWindow >= 60000) { mutationWindow = Date.now(); mutations = 0; }
    if (++mutations > 120) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'Too many changes. Wait a minute and try again.' }); }
  }
  next();
});
app.use(express.json({ limit: '64kb' }));
app.get('/api/status', (_req, res) => { const { key, model } = credentials(); res.json({ configured: !!key.trim(), model, hosted, liveDailyLimit: hosted ? liveDailyLimit : null, defaults: configSchema.parse({}) }); });
app.get('/api/knowledge', (_req, res) => res.json(knowledge));
app.get('/api/memories', (req, res) => { const mode = z.enum(['live', 'simulator']).parse(req.query.mode); res.json(store.memories(mode)); });
app.delete('/api/memories/:id', (req, res) => {
  const mode = z.enum(['live', 'simulator']).parse(req.query.mode);
  store.forget(mode, z.string().uuid().parse(req.params.id)); res.json({ ok: true });
});
app.get('/api/runs', (_req, res) => res.json(store.runs().map(r => ({ id: r.id, createdAt: r.createdAt, status: r.status, prompt: r.prompt, mode: r.config.mode, steps: r.steps }))));
app.get('/api/runs/:id', (req, res) => {
  const run = active.get(req.params.id)?.run || store.runs().find(r => r.id === req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found.' });
  res.json(run);
});
function startRun(request: RunRequest, options: { comparisonId?: string; variantLabel?: string; memorySnapshot?: Memory[] } = {}) {
  const { model } = credentials();
  const run = newRun(request, request.config.mode === 'live' ? model : 'Scripted simulator');
  if (options.comparisonId) Object.assign(run, { comparisonId: options.comparisonId, variantLabel: options.variantLabel, memoryScope: 'comparison' });
  const controller = new AbortController();
  const item: (typeof active extends Map<string, infer T> ? T : never) = { run, controller };
  active.set(run.id, item);
  const timeout = setTimeout(() => controller.abort(new Error('Run timeout.')), 5 * 60 * 1000);
  const approve = (approval: Approval) => new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Approval expired after two minutes. Start a new run to try again.')); }, 120000);
    const abort = () => { cleanup(); reject(controller.signal.reason); };
    const cleanup = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); delete item.pending; };
    item.pending = { id: approval.id, resolve: approved => { cleanup(); resolve(approved); } };
    if (controller.signal.aborted) abort(); else controller.signal.addEventListener('abort', abort, { once: true });
  });
  void executeRun(run, store, request.config.mode === 'live' ? liveProvider : simulatorProvider, { signal: controller.signal, approve, memorySnapshot: options.memorySnapshot })
    .finally(() => { clearTimeout(timeout); active.delete(run.id); });
  return run;
}
app.post('/api/runs', (req, res) => {
  if (active.size >= 4) return res.status(429).json({ error: 'Four runs are already active. Finish or stop one before starting another.' });
  const request = runSchema.parse(req.body);
  if (request.config.mode === 'live' && !credentials().key.trim()) return res.status(400).json({ error: hosted ? 'Configure the API key in Azure and refresh the connection first.' : 'Add your API key to .env and refresh the connection first.' });
  if (hosted && request.config.mode === 'live' && !store.reserveLiveRuns(1, liveDailyLimit)) return res.status(429).json({ error: 'The daily live-run limit has been reached. It resets at midnight UTC.' });
  res.status(201).json(startRun(request));
});
app.post('/api/comparisons', (req, res) => {
  const request = comparisonSchema.parse(req.body);
  if (active.size + request.variants.length > 4) return res.status(429).json({ error: 'This comparison needs more free run slots. Finish or stop active experiments, then try again.' });
  const mode = request.variants[0].config.mode;
  if (mode === 'live' && !credentials().key.trim()) return res.status(400).json({ error: hosted ? 'Configure the API key in Azure and refresh the connection first.' : 'Add your API key to .env and refresh the connection first.' });
  if (hosted && mode === 'live' && !store.reserveLiveRuns(request.variants.length, liveDailyLimit)) return res.status(429).json({ error: 'This comparison would exceed the daily live-run limit. It resets at midnight UTC.' });
  const id = randomUUID();
  // All variants start from the same memory snapshot; writes stay inside each variant.
  const memorySnapshot = store.memories(mode);
  const runs = request.variants.map(variant => startRun({ prompt: request.prompt, context: request.context, config: variant.config }, { comparisonId: id, variantLabel: variant.label, memorySnapshot }));
  res.status(201).json({ id, runs });
});
app.post('/api/runs/:id/approval', (req, res) => {
  const body = z.object({ id: z.string().uuid(), approved: z.boolean() }).strict().parse(req.body);
  const item = active.get(req.params.id);
  if (!item?.pending || item.pending.id !== body.id) return res.status(409).json({ error: 'This approval is no longer pending. Refresh the run.' });
  item.pending.resolve(body.approved); res.json({ ok: true });
});
app.post('/api/runs/:id/cancel', (req, res) => {
  const item = active.get(req.params.id);
  if (!item) return res.status(409).json({ error: 'This run has already finished.' });
  item.controller.abort(new Error('Cancelled by user.')); res.json({ ok: true });
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
  res.status(500).json({ error: 'The server could not complete this request. Check local data files and retry.' });
});
if (process.argv.includes('--production')) {
  app.use((req, res, next) => {
    if (req.path.split('/').some(part => part.startsWith('.')) || /^\/(data|server|build|node_modules)(\/|$)/.test(req.path)) return res.sendStatus(404);
    next();
  });
  app.use(express.static(resolve('dist'), { dotfiles: 'deny' }));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true, fs: { deny: ['.env', '.env.*', '**/.git/**', '**/data/**'] } }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.listen(port, hosted ? '0.0.0.0' : '127.0.0.1', () => console.log(`Harness Lab is ready on port ${port} (${hosted ? 'private Azure preview' : 'localhost'}).`));
