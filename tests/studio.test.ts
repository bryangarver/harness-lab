import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { executeRun, newRun } from '../server/harness.js';
import { simulatorProvider } from '../server/provider.js';
import { experiments, makeVariants, observed } from '../src/studio/experiments.js';

// These are teaching contracts: the supplied scenarios must actually demonstrate their claims.
const outcomes: Record<string, boolean[]> = {
  loop: [false, true, true], tools: [false, true], memory: [false, true], permissions: [false, true],
  context: [false, true, true], retrieval: [false, true], recovery: [false, true], planning: [false, true],
  instructions: [false, true], evaluation: [false, true],
};
for (const experiment of experiments) test(`studio preset demonstrates ${experiment.name}`, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'harness-studio-'));
  try {
    const store = new Store(directory);
    store.remember('simulator', 'I prefer concise answers with one concrete example.', 'test');
    const memorySnapshot = store.memories('simulator');
    const runs = await Promise.all(makeVariants(experiment, 'simulator').map(async variant => {
      const run = newRun({ prompt: experiment.prompt, context: experiment.context || '', config: variant.config }, 'Scripted simulator');
      run.memoryScope = 'comparison';
      return executeRun(run, store, simulatorProvider, { signal: new AbortController().signal, approve: async () => false, memorySnapshot });
    }));
    assert.deepEqual(runs.map(run => observed(experiment.id, run)), outcomes[experiment.id]);
    assert.ok(runs.every(run => run.status !== 'failed'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
