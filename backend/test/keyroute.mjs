// R1 guard: a provider key must never be sent to an arbitrary base_url, and
// custom-model base_urls are validated. Local capture server only; no real LLM.
// Run: node test/keyroute.mjs
import './_env.mjs';
process.env.ANTHROPIC_API_KEY ||= 'test-key-not-used';
process.env.OPENAI_API_KEY = 'sk-CANARY-openai-key';
process.env.OPENAI_ORG_ID = 'org-CANARY';
process.env.OPENAI_PROJECT_ID = 'proj-CANARY';
delete process.env.OPENAI_COMPATIBLE_API_KEY;
delete process.env.MOCK_LLM; // this test exercises the real provider path against a local sink

const http = (await import('node:http')).default;
const express = (await import('express')).default;
const { initDb } = await import('../src/db.js');
const { api } = await import('../src/routes/api.js');
const { runAgent, credentialsFor } = await import('../src/providers/index.js');

const assert = (c, m) => { if (!c) { console.error('ASSERT FAILED:', m); process.exit(1); } };

// 1. pure routing rules
let c = credentialsFor({ provider: 'openai-compatible', baseUrl: 'https://attacker.example/v1' });
assert(c.apiKey !== process.env.OPENAI_API_KEY, 'openai-compatible must not receive OPENAI_API_KEY');
c = credentialsFor({ provider: 'openai', baseUrl: 'https://attacker.example/v1' });
assert(!c.baseUrl, 'openai (key-bearing) must ignore a custom base_url');
console.log('✓ credentialsFor');

// 2. end to end through runAgent against a local capture server
const seen = [];
let sinkStatus = 200;
const sink = http.createServer((req, res) => {
  seen.push(`${req.headers.authorization || ''} ${req.headers['openai-organization'] || ''} ${req.headers['openai-project'] || ''}`);
  req.resume();
  if (sinkStatus !== 200) { res.writeHead(sinkStatus, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"bad key"}}'); }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n');
});
await new Promise((r) => sink.listen(4562, r));
await initDb();
const app = express(); app.use(express.json()); app.use('/api', api);
const srv = http.createServer(app);
await new Promise((r) => srv.listen(4563, r));
const post = (body) => fetch('http://localhost:4563/api/models', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
let res = await post({ label: 'local', provider: 'openai-compatible', model_id: 'm', base_url: 'http://localhost:4562/v1' });
assert(res.status === 201, `valid custom model should be 201, got ${res.status}`);
const row = await res.json();
await runAgent({ system: 's', input: 'i', model: row.id }).catch(() => {});
assert(seen.length > 0, 'capture server received the call');
assert(seen.every((a) => !a.includes('CANARY')), `key/org/project leaked to base_url: ${seen}`);
console.log('✓ no key or org/project id sent to custom base_url');

// 401 from an openai-compatible endpoint names the variable to set.
sinkStatus = 401;
const err401 = await runAgent({ system: 's', input: 'i', model: row.id }).then(() => null, (e) => e);
assert(err401 && /OPENAI_COMPATIBLE_API_KEY/.test(err401.message), `401 should mention OPENAI_COMPATIBLE_API_KEY, got: ${err401 && err401.message}`);
console.log('✓ 401 hint');

// 3. base_url validation
res = await post({ label: 'x', provider: 'openai-compatible', model_id: 'm', base_url: 'not a url' });
assert(res.status === 400, `garbage base_url should be 400, got ${res.status}`);
res = await post({ label: 'x', provider: 'openai-compatible', model_id: 'm' });
assert(res.status === 400, `openai-compatible without base_url should be 400, got ${res.status}`);
res = await post({ label: 'x', provider: 'openai', model_id: 'm', base_url: 'http://localhost:4562/v1' });
assert(res.status === 400, `base_url on provider openai should be 400, got ${res.status}`);
res = await post({ label: 'x', provider: 'google', model_id: 'm', base_url: 'http://localhost:4562/v1' });
assert(res.status === 400, `base_url on provider google should be 400, got ${res.status}`);
res = await post({ label: 'x', provider: 'openai-compatible', model_id: 'm', base_url: 'file:///etc/passwd' });
assert(res.status === 400, `non-http base_url should be 400, got ${res.status}`);
console.log('✓ base_url validation');

console.log('keyroute: all passed');
process.exit(0);
