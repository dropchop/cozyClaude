// Run-budget integration test (MOCK_LLM, with a simulated per-call cost):
//  - one click shares ONE cost ceiling across the towns its mail reaches,
//  - the pre-call projection counts the system prompt,
//  - a failed run closes every step it never reached (none left pending),
//  - every step/token event names its town (pipeline_id).
// Env is set before the dynamic imports because the orchestrator reads it at load.
//   node test/budget.mjs
process.env.MOCK_LLM = '1';
process.env.MAX_RUN_COST_USD = '0.01';
process.env.MOCK_LLM_COST_USD = '0.006'; // two mock calls cross the $0.01 ceiling
await import('./_env.mjs'); // scratch PGLITE_DIR
process.env.ANTHROPIC_API_KEY ||= 'test-key-not-used'; // provider builds an SDK client at import

const http = (await import('node:http')).default;
const express = (await import('express')).default;
const { WebSocket } = await import('ws');
const { initDb } = await import('../src/db.js');
const { initWebSocket } = await import('../src/ws.js');
const { api } = await import('../src/routes/api.js');
const { query, one } = await import('../src/db.js');
const { resolveModel } = await import('../src/providers/index.js');

const PORT = 4570;
const base = `http://localhost:${PORT}`;
const TIMEOUT_MS = 10_000;

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(base + path, { method, headers: { 'content-type': 'application/json' } }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const assert = (c, m) => { if (!c) throw new Error('ASSERT FAILED: ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function waitFor(predicate, label) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + TIMEOUT_MS;
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() > deadline) return reject(new Error('timed out waiting for ' + label));
      setTimeout(tick, 20);
    };
    tick();
  });
}
const station = (pid, name, extra = {}) => req('POST', `/api/pipelines/${pid}/stations`, {
  name, system_prompt: `You are ${name}`, position_x: 0, position_y: 0, ...extra,
}).then((r) => r.body.id);
const town = (name) => req('POST', '/api/pipelines', { name }).then((r) => r.body.id);
const tube = (pid, from, to) => req('POST', `/api/pipelines/${pid}/connections`, { from_station_id: from, to_station_id: to });

async function main() {
  await initDb();
  const app = express();
  app.use(express.json());
  app.use('/api', api);
  const server = http.createServer(app);
  initWebSocket(server);
  await new Promise((r) => server.listen(PORT, r));

  const events = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  ws.on('message', (raw) => events.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  const terminal = (runId) => events.some((e) => e.event === 'run_update' && e.data.run_id === runId
    && (e.data.status === 'completed' || e.data.status === 'failed'));

  // --- S1: towns P and Q mail each other. Each run makes one $0.006 call, so the
  // click's $0.01 must stop the chain in Q's run; per-run budgets would let it
  // ping-pong until MAX_MAIL_DEPTH.
  const P = await town('Ping'); const Q = await town('Pong');
  const A = await station(P, 'A'); const B = await station(Q, 'B');
  const poP = await station(P, 'PO-P', { type: 'post_office' });
  const poQ = await station(Q, 'PO-Q', { type: 'post_office' });
  await req('PATCH', `/api/stations/${poP}`, { send_to_post_office_id: poQ });
  await req('PATCH', `/api/stations/${poQ}`, { send_to_post_office_id: poP });
  await req('PUT', `/api/stations/${poP}/distributions`, { station_ids: [A] });
  await req('PUT', `/api/stations/${poQ}/distributions`, { station_ids: [B] });
  await tube(P, A, poP); await tube(Q, B, poQ);

  const first = (await req('POST', `/api/pipelines/${P}/run`, { input: 'hi' })).body;
  await waitFor(() => terminal(first.id), 'first run');
  await waitFor(() => events.some((e) => e.event === 'run_update' && e.data.pipeline_id === Q
    && (e.data.status === 'completed' || e.data.status === 'failed')), 'mail run in Q');
  await sleep(800); // room for any further relay to start
  const runsP = (await req('GET', `/api/pipelines/${P}/runs`)).body;
  const runsQ = (await req('GET', `/api/pipelines/${Q}/runs`)).body;
  assert(runsP.length === 1 && runsQ.length === 1,
    `one click stops after the shared budget: P=${runsP.length} Q=${runsQ.length} runs (want 1 and 1)`);
  assert(runsQ[0].status === 'failed' && /exceeded cost ceiling \(\$0\.01\)/.test(runsQ[0].error || ''),
    `Q's mail run fails on the click's ceiling (got ${runsQ[0].status}: ${runsQ[0].error})`);
  console.log('✓ mail-triggered runs share the click\'s cost ceiling');

  // --- S2 + S7: a 4000-char system prompt on a $1000/M-input model projects to
  // ~$1 of input, so the run must fail BEFORE the call, and the downstream
  // station it never reached must be closed, not left pending.
  const pricey = (await req('POST', '/api/models', {
    label: 'Pricey', provider: 'anthropic', model_id: 'claude-haiku-4-5',
    input_price_per_m: 1000, output_price_per_m: 1000,
  })).body;
  const R = await town('Prompty');
  const S = await station(R, 'S', { system_prompt: 'x'.repeat(4000), model: pricey.id });
  const T = await station(R, 'T');
  await tube(R, S, T);
  const run = (await req('POST', `/api/pipelines/${R}/run`, { input: 'hi' })).body;
  await waitFor(() => terminal(run.id), 'prompt run');
  const detail = (await req('GET', `/api/runs/${run.id}`)).body;
  assert(detail.status === 'failed' && /exceeded cost ceiling/.test(detail.error || ''),
    `system prompt counts toward the projection (got ${detail.status}: ${detail.error})`);
  assert(!events.some((e) => e.event === 'run_step_token' && e.data.run_id === run.id), 'no LLM call was made');
  console.log('✓ pre-call projection counts the system prompt');
  const byStation = Object.fromEntries(detail.steps.map((s) => [s.station_id, s.status]));
  assert(byStation[S] === 'failed' && byStation[T] === 'skipped',
    `steps closed on failure (got S=${byStation[S]} T=${byStation[T]})`);
  const tEvent = events.find((e) => e.event === 'run_step_update' && e.data.run_id === run.id
    && e.data.station_id === T && e.data.status === 'skipped');
  assert(tEvent, 'the skipped step is broadcast');
  console.log('✓ a failed run leaves no step pending');

  // --- S4: custom-model prices. Negative or missing prices on a paid provider
  // would run outside the ceiling; only openai-compatible may be free.
  const addModel = (body) => req('POST', '/api/models', { label: 'm', model_id: 'claude-opus-4-8', ...body });
  for (const [label, body, want] of [
    ['negative prices', { provider: 'openai-compatible', base_url: 'http://localhost:11434/v1', input_price_per_m: -5, output_price_per_m: -25 }, 400],
    ['non-numeric price', { provider: 'openai-compatible', base_url: 'http://localhost:11434/v1', input_price_per_m: 'abc', output_price_per_m: 1 }, 400],
    ['anthropic at $0', { provider: 'anthropic', input_price_per_m: 0, output_price_per_m: 0 }, 400],
    ['google with no prices', { provider: 'google' }, 400],
    ['free local model', { provider: 'openai-compatible', base_url: 'http://localhost:11434/v1' }, 201],
  ]) {
    const got = (await addModel(body)).status;
    assert(got === want, `${label}: want ${want}, got ${got}`);
  }
  // Rows saved before validation are billed at no less than the list price.
  const legacy = await one(`INSERT INTO custom_models (label, provider, model_id, input_price_per_m, output_price_per_m)
    VALUES ('old', 'anthropic', 'claude-opus-4-8', -5, 0) RETURNING id`);
  const rec = await resolveModel(legacy.id);
  assert(rec.inputPrice === 5 && rec.outputPrice === 25, `legacy alias billed at list price (got ${rec.inputPrice}/${rec.outputPrice})`);
  await query('DELETE FROM custom_models WHERE id = $1', [legacy.id]);
  const dated = await one(`INSERT INTO custom_models (label, provider, model_id) VALUES ('dated', 'anthropic', 'claude-haiku-4-5-20251001') RETURNING id`);
  const datedRec = await resolveModel(dated.id);
  assert(datedRec.inputPrice === 1 && datedRec.outputPrice === 5, `dated alias billed at list price (got ${datedRec.inputPrice}/${datedRec.outputPrice})`);
  console.log('✓ custom-model prices validated; legacy aliases (dated too) floored at list price');

  // A legacy paid model with no list price to fall back on must not run unmetered.
  const free = await one(`INSERT INTO custom_models (label, provider, model_id) VALUES ('Old Gemini', 'google', 'gemini-x') RETURNING id`);
  const G = await town('Unpriced');
  await station(G, 'Gem', { model: free.id });
  const gRun = (await req('POST', `/api/pipelines/${G}/run`, { input: 'hi' })).body;
  await waitFor(() => terminal(gRun.id), 'unpriced run');
  const gDetail = (await req('GET', `/api/runs/${gRun.id}`)).body;
  assert(gDetail.status === 'failed' && /"Old Gemini" has no price/.test(gDetail.error || ''),
    `unpriced paid model refused (got ${gDetail.status}: ${gDetail.error})`);
  assert(!events.some((e) => e.event === 'run_step_token' && e.data.run_id === gRun.id), 'no call made for the unpriced model');
  console.log('✓ a paid model with no price refuses to run');

  // --- S8 (server side): every step and token event carries its run's town.
  const townOf = {};
  for (const e of events) if (e.event === 'run_update') townOf[e.data.run_id] = e.data.pipeline_id;
  const stepEvents = events.filter((e) => e.event === 'run_step_update' || e.event === 'run_step_token');
  assert(stepEvents.length > 0 && stepEvents.every((e) => e.data.pipeline_id && e.data.pipeline_id === townOf[e.data.run_id]),
    'every run_step_update/run_step_token names its pipeline_id');
  console.log('✓ step and token events carry pipeline_id');

  ws.close();
  server.close();
  console.log('\nALL BUDGET TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
