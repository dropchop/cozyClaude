// R3 guard: running the tests must never create or open the live data dir
// (backend/data/pgdata). Run: node test/nodata.mjs
//  1. the "pure" unit test (cost.mjs) with no PGLITE_DIR must not open any database;
//  2. every other test that imports the db must import ./_env.mjs before anything else.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const liveDir = path.join(root, 'data');
const assert = (c, m) => { if (!c) { console.error('ASSERT FAILED:', m); process.exit(1); } };

assert(!fs.existsSync(liveDir), `${liveDir} already exists; remove it before running this test`);

const env = { ...process.env };
delete env.PGLITE_DIR;
const r = spawnSync(process.execPath, ['test/cost.mjs'], { cwd: root, env, encoding: 'utf8' });
const leaked = fs.existsSync(liveDir);
if (leaked) fs.rmSync(liveDir, { recursive: true, force: true });
assert(r.status === 0, `cost.mjs failed: ${r.stdout}${r.stderr}`);
assert(!leaked, 'cost.mjs (no PGLITE_DIR) created backend/data');
console.log('✓ cost.mjs opens no database');

const testDir = path.join(root, 'test');
for (const f of fs.readdirSync(testDir).filter((n) => n.endsWith('.mjs') && !n.startsWith('_') && n !== 'nodata.mjs')) {
  const src = fs.readFileSync(path.join(testDir, f), 'utf8');
  if (!/db\.js|api\.js|server\.js|orchestrator/.test(src)) continue;
  const first = src.split('\n').find((l) => /^\s*(import\s|await import\()/.test(l));
  assert(/_env\.mjs/.test(first || ''), `${f}: first import must be ./_env.mjs (got: ${first})`);
}
console.log('✓ every db-touching test imports _env.mjs first');
console.log('nodata: all passed');
