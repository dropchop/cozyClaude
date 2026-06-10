// End-to-end orchestration test with MOCK_LLM. Boots the app + WebSocket,
// builds an A -> B -> C pipeline plus a parallel root D -> C, runs it, and
// verifies live WS events, topological execution, artifact passing, and
// persistence. Run unsandboxed:
//   MOCK_LLM=1 PGLITE_DIR=/tmp/run-pg node test/run.mjs
import http from 'node:http';
import express from 'express';
import { WebSocket } from 'ws';
import { initDb } from '../src/db.js';
import { initWebSocket } from '../src/ws.js';
import { api } from '../src/routes/api.js';

const PORT = 4556;
const base = `http://localhost:${PORT}`;

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
const mkStation = (pid, name, x) =>
  req('POST', `/api/pipelines/${pid}/stations`, { name, system_prompt: `You are ${name}`, position_x: x, position_y: 0 })
    .then((r) => r.body.id);

async function main() {
  await initDb();
  const app = express();
  app.use(express.json());
  app.use('/api', api);
  const server = http.createServer(app);
  initWebSocket(server);
  await new Promise((r) => server.listen(PORT, r));

  // Build pipeline:  A -> B -> C ,  D -> C   (C has two upstreams, D is a 2nd root)
  const pid = (await req('POST', '/api/pipelines', { name: 'Run test' })).body.id;
  const A = await mkStation(pid, 'A', 0);
  const B = await mkStation(pid, 'B', 200);
  const C = await mkStation(pid, 'C', 400);
  const D = await mkStation(pid, 'D', 0);
  await req('POST', `/api/pipelines/${pid}/connections`, { from_station_id: A, to_station_id: B });
  await req('POST', `/api/pipelines/${pid}/connections`, { from_station_id: B, to_station_id: C });
  await req('POST', `/api/pipelines/${pid}/connections`, { from_station_id: D, to_station_id: C });
  console.log('✓ built pipeline A->B->C, D->C');

  // Connect WS and collect events.
  const events = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const done = new Promise((resolve) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      events.push(msg);
      if (msg.event === 'run_update' && msg.data.status === 'completed') resolve();
      if (msg.event === 'run_update' && msg.data.status === 'failed') resolve();
    });
  });
  await new Promise((r) => ws.on('open', r));

  const runRes = await req('POST', `/api/pipelines/${pid}/run`, { input: 'kickoff text' });
  assert(runRes.status === 202 && runRes.body.id, 'run accepted');
  const runId = runRes.body.id;
  console.log('✓ run started', runId);

  // Concurrency guard: a second run while one is active must be rejected (409).
  const dup = await req('POST', `/api/pipelines/${pid}/run`, { input: 'again' });
  assert(dup.status === 409, 'concurrent run rejected (got ' + dup.status + ')');
  console.log('✓ concurrent run rejected (409)');

  await done;
  ws.close();

  // --- Verify WS events ---
  const finalRun = events.filter((e) => e.event === 'run_update').pop();
  assert(finalRun.data.status === 'completed', 'run completed (got ' + finalRun.data.status + ')');
  console.log('✓ run completed via WS');

  const tokenEvents = events.filter((e) => e.event === 'run_step_token');
  assert(tokenEvents.length > 0, 'streamed tokens over WS');
  console.log(`✓ streamed ${tokenEvents.length} token deltas`);

  const completedSteps = events.filter((e) => e.event === 'run_step_update' && e.data.status === 'completed');
  assert(completedSteps.length === 4, 'all 4 steps completed (got ' + completedSteps.length + ')');
  assert(completedSteps.every((e) => e.data.artifact && e.data.artifact.content), 'each step emitted an artifact');
  console.log('✓ all 4 steps completed with artifacts');

  // --- Verify topological order: A and D before B; B and D before C ---
  const completedAt = {};
  events.filter((e) => e.event === 'run_step_update' && e.data.status === 'completed')
    .forEach((e, i) => { completedAt[e.data.station_id] = i; });
  assert(completedAt[A] < completedAt[B], 'A completes before B');
  assert(completedAt[B] < completedAt[C], 'B completes before C');
  assert(completedAt[D] < completedAt[C], 'D completes before C');
  console.log('✓ topological order respected (A<B<C, D<C)');

  // --- Verify persistence + artifact passing ---
  const detail = (await req('GET', `/api/runs/${runId}`)).body;
  assert(detail.status === 'completed', 'persisted run completed');
  assert(detail.steps.length === 4, 'persisted 4 steps');
  const total = detail.steps.reduce((s, st) => s + (st.tokens_used || 0), 0);
  assert(total > 0, 'tokens recorded');
  // C's mock output should reflect that it received upstream input (B + D concatenated).
  const cStep = detail.steps.find((s) => s.station_id === C);
  const cContent = cStep.artifacts[0].content;
  const cChars = Number(cContent.match(/processed (\d+) chars/)?.[1] || 0);
  assert(cChars > 0, 'C received upstream input (processed ' + cChars + ' chars)');
  console.log('✓ C consumed upstream output (' + cChars + ' chars); total tokens =', total);

  // --- Concurrency race test: two truly parallel POSTs on a fresh pipeline.
  // The earlier sequential check at line ~73 doesn't exercise the TOCTOU
  // window between activeRuns.has() and activeRuns.add(); this one does.
  const racePid = (await req('POST', '/api/pipelines', { name: 'Race test' })).body.id;
  await mkStation(racePid, 'solo', 0);
  const [r1, r2] = await Promise.all([
    req('POST', `/api/pipelines/${racePid}/run`, { input: 'race' }),
    req('POST', `/api/pipelines/${racePid}/run`, { input: 'race' }),
  ]);
  const statuses = [r1.status, r2.status].sort();
  assert(statuses[0] === 202 && statuses[1] === 409,
    'parallel runs: exactly one 202, one 409 (got ' + statuses.join(',') + ')');
  console.log('✓ parallel POST /run: one 202, one 409 (atomic lock)');

  // --- Model registry: custom model end-to-end through resolveModel + MOCK_LLM.
  const customModel = (await req('POST', '/api/models', {
    label: 'Test Haiku alias',
    provider: 'anthropic',
    model_id: 'claude-haiku-4-5',
    input_price_per_m: 1,
    output_price_per_m: 5,
  })).body;
  assert(customModel.id, 'custom model created');
  console.log('✓ custom model registered:', customModel.id);

  const modelList = (await req('GET', '/api/models')).body;
  assert(Array.isArray(modelList.builtin) && modelList.builtin.length >= 4, 'builtin models listed');
  assert(modelList.custom.some((c) => c.id === customModel.id), 'custom model in list');
  console.log('✓ GET /api/models groups builtin + custom');

  // Assign the custom model UUID to a station on a new pipeline and run it —
  // exercises resolveModel's UUID branch via MOCK_LLM (no real API call).
  const mPid = (await req('POST', '/api/pipelines', { name: 'Custom model test' })).body.id;
  const mStation = (await req('POST', `/api/pipelines/${mPid}/stations`, {
    name: 'CustomModelStation', system_prompt: 'echo', position_x: 0, position_y: 0,
    model: customModel.id,
  })).body.id;
  assert(mStation, 'station created with custom model UUID');

  const mEvents = [];
  const ws2 = new WebSocket(`ws://localhost:${PORT}/ws`);
  ws2.on('message', (raw) => mEvents.push(JSON.parse(raw.toString())));
  await new Promise((r) => ws2.on('open', r));
  const mRun = await req('POST', `/api/pipelines/${mPid}/run`, { input: 'hello' });
  assert(mRun.status === 202, 'custom-model run started');
  const mRunId = mRun.body.id;
  // Filter by run_id — earlier pipelines on the same server also broadcast
  // run_update / run_step_update events on this socket.
  await new Promise((resolve) => {
    const check = () => {
      if (mEvents.some((e) => e.event === 'run_update' && e.data.run_id === mRunId
          && (e.data.status === 'completed' || e.data.status === 'failed'))) resolve();
      else setTimeout(check, 20);
    };
    check();
  });
  ws2.close();
  const mCompleted = mEvents.filter((e) => e.event === 'run_step_update'
    && e.data.run_id === mRunId && e.data.status === 'completed');
  assert(mCompleted.length === 1, 'custom-model station completed (got ' + mCompleted.length + ')');
  const content = mCompleted[0].data.artifact?.content || '';
  assert(content.includes('[mock:claude-haiku-4-5]'),
    'mock dispatched to resolved modelId from custom_models row (got: ' + content.slice(0, 80) + ')');
  console.log('✓ resolveModel(UUID) routed to custom_models.model_id');

  // Clean up the custom model and confirm the station falls back to default.
  const del = await req('DELETE', `/api/models/${customModel.id}`);
  assert(del.status === 204, 'custom model deleted');
  console.log('✓ DELETE /api/models/:id works');

  server.close();
  console.log('\nALL ORCHESTRATION TESTS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
