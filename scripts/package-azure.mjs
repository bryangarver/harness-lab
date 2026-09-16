import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const release = resolve('releases', new Date().toISOString().replace(/[:.]/g, '-'));
const stage = join(release, 'app');
mkdirSync(stage, { recursive: true });
// An allowlist prevents credentials, saved memories, and workstation dependencies
// from accidentally becoming part of a public deployment artifact.
for (const directory of ['dist', 'build/server']) cpSync(directory, join(stage, directory), { recursive: true });
const original = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = { name: original.name, version: original.version, private: true, type: 'module', engines: { node: '24.x' },
  scripts: { start: original.scripts.start, build: 'npm ci --omit=dev --ignore-scripts --no-audit --no-fund' }, dependencies: original.dependencies };
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
delete lock.packages[''].devDependencies;
lock.packages[''].engines = manifest.engines;
writeFileSync(join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(stage, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
const zip = join(release, 'harness-lab.zip');
execFileSync('/usr/bin/zip', ['-qr', zip, '.'], { cwd: stage });
const checksum = createHash('sha256').update(readFileSync(zip)).digest('hex');
writeFileSync(join(release, 'SHA256SUMS'), `${checksum}  harness-lab.zip\n`);
console.log(`Azure release: ${zip}\nSHA-256: ${checksum}\nNo .env, data, or node_modules were included. Azure installs locked production dependencies.`);
