// Cost-ceiling integration test. Boots the app + WebSocket, registers a custom
// model with an absurd input price, and runs a one-station pipeline so the
// orchestrator's PRE-CALL cost projection (orchestrator.js maxOutputTokensForBudget)
// fails the run before any LLM call. Verifies the failure surfaces over WS and
// persists. Run unsandboxed:
//   node test/ceiling.mjs
//
// Note: MAX_RUN_COST_USD is read once at orchestrator module-load, so it must be
// set BEFORE importing anything that pulls in the orchestrator. Hence the dynamic
// import() below (mirrors test/cost.mjs), not static top-of-file imports.
//
// Under MOCK_LLM the mock returns cost: 0, so the *post-call cumulative* ceiling
// check can't be tripped deterministically — this test covers the pre-call
// projection guard; the cumulative math is unit-covered by test/cost.mjs.
process.env.MOCK_LLM = '1';
process.env.MAX_RUN_COST_USD = '0.01';
process.env.PGLITE_DIR ||= '/tmp/ceiling-pg';
process.env.ANTHROPIC_API_KEY ||= 'test-key-not-used'; // provider builds an SDK client at import

const http = (await import('node:http')).default;
const express = (await import('express')).default;
const { WebSocket } = await import('ws');
const { initDb } = await import('../src/db.js');
const { initWebSocket } = await import('../src/ws.js');
const { api } = await import('../src/routes/api.js');

const PORT = 4558; // distinct from run.mjs (4556) and integration.mjs (4557)
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

// Poll a predicate to true, but FAIL FAST on timeout — a regression that stops
// the terminal run_update from ever arriving should fail the test, not hang CI.
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

async function main() {
  await initDb();
  const app = express();
  app.use(express.json());
  app.use('/api', api);
  const server = http.createServer(app);
  initWebSocket(server);
  await new Promise((r) => server.listen(PORT, r));

  // A custom model whose input alone costs far more than the $0.01 ceiling:
  // $1,000 per input token (1e9 / 1M). Even one token's projected cost dwarfs it,
  // so the pre-call budget check fails the run before any LLM dispatch.
  const model = (await req('POST', '/api/models', {
    label: 'Ruinously expensive',
    provider: 'anthropic',
    model_id: 'claude-haiku-4-5',
    input_price_per_m: 1_000_000_000,
    output_price_per_m: 1_000_000_000,
  })).body;
  assert(model.id, 'custom model created');

  const pid = (await req('POST', '/api/pipelines', { name: 'Ceiling test' })).body.id;
  const station = (await req('POST', `/api/pipelines/${pid}/stations`, {
    name: 'Spendy', system_prompt: 'You are Spendy', position_x: 0, position_y: 0,
    model: model.id,
  })).body.id;
  assert(station, 'station created with expensive model');
  console.log('✓ built one-station pipeline on a model priced above the ceiling');

  // Collect WS events for this run.
  const events = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  ws.on('message', (raw) => events.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS open timed out')), TIMEOUT_MS);
  });

  const runRes = await req('POST', `/api/pipelines/${pid}/run`, { input: 'this should never reach the model' });
  assert(runRes.status === 202 && runRes.body.id, 'run accepted (fails async)');
  const runId = runRes.body.id;

  // Wait for the terminal run_update for this run (fails fast if it never comes).
  await waitFor(
    () => events.some((e) => e.event === 'run_update' && e.data.run_id === runId
      && (e.data.status === 'completed' || e.data.status === 'failed')),
    'terminal run_update',
  );
  ws.close();

  // --- The run must FAIL with the ceiling message, over WS ---
  const finalRun = events.filter((e) => e.event === 'run_update' && e.data.run_id === runId).pop();
  assert(finalRun.data.status === 'failed',
    'run failed on the cost ceiling (got ' + finalRun.data.status + ')');
  // Require the configured $0.01 amount, not just the phrase — this is what proves
  // our MAX_RUN_COST_USD env override actually took effect (i.e. the env was set
  // before orchestrator.js read it at module load). Matching the bare phrase would
  // still pass against the default $1.00 ceiling and hide a broken import order.
  assert(/exceeded cost ceiling \(\$0\.01\)/.test(finalRun.data.error || ''),
    'run_update error names the $0.01 ceiling (got: ' + finalRun.data.error + ')');
  console.log('✓ run failed via WS with "exceeded cost ceiling ($0.01)"');

  // The station's step must be marked failed (not left pending/running).
  const stepFailed = events.filter((e) => e.event === 'run_step_update'
    && e.data.run_id === runId && e.data.status === 'failed');
  assert(stepFailed.length === 1, 'the station step is marked failed (got ' + stepFailed.length + ')');
  assert(/exceeded cost ceiling \(\$0\.01\)/.test(stepFailed[0].data.error || ''),
    'step error names the $0.01 ceiling (got: ' + stepFailed[0].data.error + ')');
  console.log('✓ station step marked failed with the ceiling error');

  // No LLM ever ran, so no token deltas should have streamed.
  const tokenEvents = events.filter((e) => e.event === 'run_step_token' && e.data.run_id === runId);
  assert(tokenEvents.length === 0, 'no tokens streamed — failed before the LLM call (got ' + tokenEvents.length + ')');
  console.log('✓ no tokens streamed (failed before any LLM dispatch)');

  // --- Persistence: the runs row is failed with the ceiling error ---
  const detail = (await req('GET', `/api/runs/${runId}`)).body;
  assert(detail.status === 'failed', 'persisted run is failed (got ' + detail.status + ')');
  assert(/exceeded cost ceiling \(\$0\.01\)/.test(detail.error || ''),
    'persisted run.error names the $0.01 ceiling (got: ' + detail.error + ')');
  const persistedStep = detail.steps.find((s) => s.station_id === station);
  assert(persistedStep && persistedStep.status === 'failed', 'persisted step is failed');
  console.log('✓ run + step persisted as failed with the ceiling error');

  server.close();
  console.log('\nALL COST-CEILING TESTS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
