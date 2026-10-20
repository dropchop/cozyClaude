// Numeric env settings: a typo must refuse to boot, never switch a cost or loop
// guard off (`n >= NaN` is always false). No DB, no network. Run: node test/config.mjs
import './_env.mjs'; // nothing here opens the DB, but keep the suite's rule
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.ANTHROPIC_API_KEY ||= 'test-key-not-used'; // provider builds an SDK client at import
const { numEnv } = await import('../src/config.js');
const { maxOutputTokensForBudget } = await import('../src/providers/index.js');

const assert = (c, m) => { if (!c) { console.error('ASSERT FAILED:', m); process.exit(1); } };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

const withEnv = (v, fn) => { process.env.APB_TEST_NUM = v; try { return fn(); } finally { delete process.env.APB_TEST_NUM; } };
assert(numEnv('APB_TEST_NUM', 3) === 3, 'unset -> default');
assert(withEnv('', () => numEnv('APB_TEST_NUM', 3)) === 3, 'empty -> default');
assert(withEnv('0', () => numEnv('APB_TEST_NUM', 3)) === 0, 'explicit 0 is honoured');
assert(withEnv(' 2.5 ', () => numEnv('APB_TEST_NUM', 3)) === 2.5, 'whitespace trimmed');
for (const bad of ['abc', '3x', 'NaN', 'Infinity', '-1']) {
  assert(withEnv(bad, () => throws(() => numEnv('APB_TEST_NUM', 3))), `"${bad}" must throw`);
}
console.log('✓ numEnv parses strictly');

// A NaN budget must allow nothing, not everything.
assert(maxOutputTokensForBudget({ inputPrice: 1, outputPrice: 5 }, NaN, 10) === 0, 'NaN budget -> 0 tokens');
console.log('✓ maxOutputTokensForBudget fails closed on a NaN budget');

// Booting the orchestrator with a bad value must fail loudly, naming the variable.
const orch = fileURLToPath(new URL('../src/orchestrator.js', import.meta.url));
const boot = (extra) => {
  const env = { ...process.env, ...extra };
  for (const k of ['MAX_INPUT_CHARS', 'MAX_RUN_COST_USD', 'MAX_MAIL_DEPTH']) if (!(k in extra)) delete env[k];
  return spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(orch)})`], { env, encoding: 'utf8' });
};
assert(boot({}).status === 0, 'orchestrator imports with defaults: ' + boot({}).stderr);
for (const name of ['MAX_INPUT_CHARS', 'MAX_RUN_COST_USD', 'MAX_MAIL_DEPTH']) {
  const r = boot({ [name]: 'abc' });
  assert(r.status !== 0 && r.stderr.includes(name), `${name}=abc must refuse to boot (status ${r.status})`);
}
console.log('✓ a non-numeric MAX_* refuses to boot');

// server.js too: a bad PORT stops it before it opens anything. Run from an empty
// directory (dotenv finds no .env) with a scratch PGLITE_DIR, so even a server
// that wrongly starts (old code listens on a pipe named "abc") touches no real data.
const server = fileURLToPath(new URL('../src/server.js', import.meta.url));
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'apb-cfg-'));
const bad = spawnSync(process.execPath, [server], {
  cwd: empty, env: { ...process.env, PORT: 'abc', PGLITE_DIR: path.join(empty, 'pg') }, encoding: 'utf8', timeout: 15000,
});
fs.rmSync(empty, { recursive: true, force: true });
assert(bad.status !== 0 && bad.stderr.includes('PORT'), `PORT=abc must refuse to boot (status ${bad.status})`);
console.log('✓ a non-numeric PORT refuses to boot');

console.log('\nALL CONFIG TESTS PASSED');
