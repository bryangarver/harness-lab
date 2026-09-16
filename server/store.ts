import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Memory, Run } from './schema.js';

// Synchronous atomic writes keep this single-process teaching app simple and durable.
// Use a transactional database before supporting multiple server processes.
export class Store {
  constructor(public directory: string) { mkdirSync(directory, { recursive: true }); }
  private read<T>(name: string, fallback: T): T {
    const file = join(this.directory, name);
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as T : fallback;
  }
  private write(name: string, value: unknown) {
    const file = join(this.directory, name);
    writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }
  memories(mode: string): Memory[] { return this.read(`memory-${mode}.json`, []); }
  remember(mode: string, content: string, source: string) {
    const rows = this.memories(mode);
    const existing = rows.find(m => m.content.toLowerCase() === content.toLowerCase());
    if (existing) return existing;
    if (rows.length >= 100) throw new Error('Memory is full (100 entries). Delete an entry before saving another.');
    const memory = { id: randomUUID(), content, source, createdAt: new Date().toISOString() };
    this.write(`memory-${mode}.json`, [...rows, memory]);
    return memory;
  }
  forget(mode: string, id: string) { this.write(`memory-${mode}.json`, this.memories(mode).filter(m => m.id !== id)); }
  saveRun(run: Run) {
    const { approval: _approval, ...snapshot } = run;
    const rows = this.runs().filter(r => r.id !== run.id);
    this.write('runs.json', [snapshot, ...rows].slice(0, 30));
  }
  runs(): Run[] { return this.read('runs.json', []); }
  reserveLiveRuns(count: number, limit: number, date = new Date().toISOString().slice(0, 10)) {
    const previous = this.read('live-usage.json', { date, count: 0 });
    const used = previous.date === date ? previous.count : 0;
    if (used + count > limit) return false;
    // Reserve before starting the whole batch; cancellation/restart never refunds usage.
    this.write('live-usage.json', { date, count: used + count });
    return true;
  }
}
