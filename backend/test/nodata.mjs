// R3 guard: running the tests must never create or open the live data dir
// (backend/data/pgdata). Run: node test/nodata.mjs
//  1. the "pure" unit test (cost.mjs) with no PGLITE_DIR must not open any database;
//  2. every other test that imports the db must import ./_env.mjs before anything else.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const liveDir = path.join(root, 'data');
const assert = (c, m) => { if (!c) { console.error('ASSERT FAILED:', m); process.exit(1); } };

// Snapshot of the live data dir (every path, size and mtime). The tests must leave
// it exactly as found, whether or not it exists. This test never modifies it.
function snapshot(dir) {
  if (!fs.existsSync(dir)) return 'absent';
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      const st = fs.lstatSync(f);
      out.push(`${f} ${st.size} ${st.mtimeMs}`);
      if (e.isDirectory()) walk(f);
    }
  };
  walk(dir);
  return out.sort().join('\n');
}
const before = snapshot(liveDir);

const env = { ...process.env };
delete env.PGLITE_DIR;
const r = spawnSync(process.execPath, ['test/cost.mjs'], { cwd: root, env, encoding: 'utf8' });
assert(r.status === 0, `cost.mjs failed: ${r.stdout}${r.stderr}`);
assert(snapshot(liveDir) === before, 'cost.mjs (no PGLITE_DIR) changed backend/data');
console.log('✓ cost.mjs opens no database');

const testDir = path.join(root, 'test');
for (const f of fs.readdirSync(testDir).filter((n) => n.endsWith('.mjs') && !n.startsWith('_') && n !== 'nodata.mjs')) {
  const src = fs.readFileSync(path.join(testDir, f), 'utf8');
  if (!/db\.js|api\.js|server\.js|orchestrator/.test(src)) continue;
  const first = src.split('\n').find((l) => /^\s*(import\s|await import\()/.test(l));
  assert(/_env\.mjs/.test(first || ''), `${f}: first import must be ./_env.mjs (got: ${first})`);
}
console.log('✓ every db-touching test imports _env.mjs first');

// _env.mjs removes the scratch dir it created, and leaves a caller-supplied one alone.
const probe = (envDir) => {
  const e = { ...process.env };
  delete e.PGLITE_DIR;
  if (envDir) e.PGLITE_DIR = envDir;
  const o = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import './test/_env.mjs'; import fs from 'node:fs'; fs.writeFileSync(process.env.PGLITE_DIR + '/x', '1'); console.log(process.env.PGLITE_DIR);"],
  { cwd: root, env: e, encoding: 'utf8' });
  return o.stdout.trim();
};
const made = probe(null);
assert(made.includes('apb-test-pg-'), `unexpected scratch dir: ${made}`);
assert(!fs.existsSync(made), `scratch dir ${made} was not removed on exit`);
const keep = fs.mkdtempSync(path.join(os.tmpdir(), 'apb-keep-'));
probe(keep);
assert(fs.existsSync(path.join(keep, 'x')), 'caller-supplied PGLITE_DIR must not be removed');
fs.rmSync(keep, { recursive: true, force: true });
console.log('✓ _env.mjs cleans up only its own scratch dir');
console.log('nodata: all passed');
