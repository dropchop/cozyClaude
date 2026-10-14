// R1 guard: a page on another origin must not drive the API or the WebSocket.
// Boots the REAL server.js as a child (MOCK_LLM, scratch db) on its own port.
// Run: node test/origin.mjs
import './_env.mjs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4561;
const base = `http://localhost:${PORT}`;
const assert = (c, m) => { if (!c) { console.error('ASSERT FAILED:', m); child.kill(); process.exit(1); } };

const child = spawn(process.execPath, ['src/server.js'], {
  cwd: root,
  env: { ...process.env, MOCK_LLM: '1', PORT: String(PORT), ALLOWED_ORIGINS: 'https://box.tailnet.ts.net:5173' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server did not start')), 15000);
  child.stdout.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(t); resolve(); } });
  child.on('exit', () => reject(new Error('server exited early')));
});

const get = (origin, p = '/api/pipelines', init = {}) =>
  fetch(base + p, { ...init, headers: { ...(origin ? { Origin: origin } : {}), ...(init.headers || {}) } });

// hostile origin: refused, and no CORS grant
let r = await get('https://evil.example');
assert(r.status === 403, `evil GET should be 403, got ${r.status}`);
assert(!r.headers.get('access-control-allow-origin'), 'evil GET must carry no allow-origin');
r = await get('https://evil.example', '/api/health', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST' } });
assert(r.status === 403 && !r.headers.get('access-control-allow-origin'), 'evil preflight refused');
r = await get('https://evil.example', '/api/models', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ label: 'x', provider: 'openai-compatible', model_id: 'm', base_url: 'https://evil.example/v1' }),
});
assert(r.status === 403, `evil POST /models should be 403, got ${r.status}`);
console.log('✓ cross-origin HTTP refused');

// allowed callers
r = await get(null);
assert(r.status === 200, 'no Origin (curl, server-side) allowed');
r = await get(`http://localhost:${PORT}`);
assert(r.status === 200, 'same-origin (prod, served by backend) allowed');
r = await get('http://localhost:5173');
assert(r.status === 200 && r.headers.get('access-control-allow-origin') === 'http://localhost:5173', 'vite dev origin allowed, echoed');
r = await get('http://127.0.0.1:5173');
assert(r.status === 200, 'vite dev origin on 127.0.0.1 allowed');
r = await get('https://box.tailnet.ts.net:5173');
assert(r.status === 200, 'ALLOWED_ORIGINS entry allowed');
console.log('✓ same-origin, vite dev and ALLOWED_ORIGINS allowed');

// DNS rebinding: a foreign Host is refused even when Origin matches it, and even with no Origin.
const raw = (headers) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: PORT, path: '/api/pipelines', headers }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
});
assert((await raw({ Host: `rebind.evil.test:${PORT}`, Origin: `http://rebind.evil.test:${PORT}` })) === 403, 'rebound Host+Origin refused');
assert((await raw({ Host: `rebind.evil.test:${PORT}` })) === 403, 'rebound Host with no Origin refused');
assert((await raw({ Host: `box.tailnet.ts.net:${PORT}` })) === 200, 'Host from ALLOWED_ORIGINS hostname allowed');
assert((await raw({ Host: `dns.example:${PORT}` })) === 403, 'unlisted Host refused');
console.log('✓ DNS rebinding (Host check)');

// WebSocket
const wsOutcome = (origin) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`, origin ? { headers: { Origin: origin } } : {});
  ws.on('message', () => { ws.close(); resolve('open'); });
  ws.on('unexpected-response', (_q, res) => resolve(`rejected ${res.statusCode}`));
  ws.on('error', () => resolve('error'));
  setTimeout(() => resolve('timeout'), 5000);
});
assert((await wsOutcome('https://evil.example')) === 'rejected 403', 'evil WS refused');
assert((await wsOutcome('http://localhost:5173')) === 'open', 'vite dev WS allowed');
assert((await wsOutcome(null)) === 'open', 'no-Origin WS allowed');
const wsHost = (host) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Host: host, Origin: `http://${host}` } });
  ws.on('message', () => { ws.close(); resolve('open'); });
  ws.on('unexpected-response', (_q, res) => resolve(`rejected ${res.statusCode}`));
  ws.on('error', () => resolve('error'));
});
assert((await wsHost(`rebind.evil.test:${PORT}`)) === 'rejected 403', 'rebound WS refused');
console.log('✓ WebSocket origin check');

child.kill();
console.log('origin: all passed');
