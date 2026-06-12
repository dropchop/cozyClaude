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
  // Run-level rollups persist on the runs row and match the sum of the steps.
  assert(Number(detail.total_tokens) === total,
    'run.total_tokens matches step sum (got ' + detail.total_tokens + ' vs ' + total + ')');
  assert(detail.total_cost_usd != null, 'run.total_cost_usd persisted');
  // Each step carries the input/output split, summing back to tokens_used.
  const splitOk = detail.steps.every((st) =>
    (Number(st.input_tokens) || 0) + (Number(st.output_tokens) || 0) === (Number(st.tokens_used) || 0));
  assert(splitOk, 'each step input+output sums to tokens_used');
  console.log('✓ run-level totals + per-step input/output split persisted');
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
  assert(modelList.builtin.every((b) => b.id && typeof b.input === 'number' && typeof b.output === 'number'),
    'builtin entries carry id + numeric input/output prices');
  assert(modelList.custom.some((c) => c.id === customModel.id), 'custom model in list');
  console.log('✓ GET /api/models groups builtin (with prices) + custom');

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

  // Delete the custom model while a station still references it, then re-run:
  // resolveModel must fall back to the default instead of crashing the run.
  const del = await req('DELETE', `/api/models/${customModel.id}`);
  assert(del.status === 204, 'custom model deleted');
  console.log('✓ DELETE /api/models/:id works');

  const fbEvents = [];
  const ws3 = new WebSocket(`ws://localhost:${PORT}/ws`);
  ws3.on('message', (raw) => fbEvents.push(JSON.parse(raw.toString())));
  await new Promise((r) => ws3.on('open', r));
  const fbRun = await req('POST', `/api/pipelines/${mPid}/run`, { input: 'after delete' });
  assert(fbRun.status === 202, 'fallback run started');
  const fbRunId = fbRun.body.id;
  await new Promise((resolve) => {
    const check = () => {
      if (fbEvents.some((e) => e.event === 'run_update' && e.data.run_id === fbRunId
          && (e.data.status === 'completed' || e.data.status === 'failed'))) resolve();
      else setTimeout(check, 20);
    };
    check();
  });
  ws3.close();
  const fbFinal = fbEvents.filter((e) => e.event === 'run_update' && e.data.run_id === fbRunId).pop();
  assert(fbFinal.data.status === 'completed',
    'run with deleted-model station still completes via default fallback (got ' + fbFinal.data.status + ')');
  const fbStep = fbEvents.filter((e) => e.event === 'run_step_update'
    && e.data.run_id === fbRunId && e.data.status === 'completed').pop();
  assert(fbStep.data.artifact.content.includes('[mock:claude-sonnet-4-6]'),
    'deleted-model station fell back to DEFAULT_MODEL (got: ' + fbStep.data.artifact.content.slice(0, 80) + ')');
  console.log('✓ deleted custom model → station falls back to default, run completes');

  // ===== Post office: cross-town mail =====
  // Town B (receiver): Bakery + Mill are the hub's distribution targets; Pastry is
  // downstream of Bakery (must run via the sub-DAG); Lonely is unconnected and not
  // a target (must NOT run). A hub `poB` distributes arrivals to Bakery + Mill.
  const pidB = (await req('POST', '/api/pipelines', { name: 'Town B' })).body.id;
  const bakery = await mkStation(pidB, 'Bakery', 0);
  const mill = await mkStation(pidB, 'Mill', 200);
  const pastry = await mkStation(pidB, 'Pastry', 400);
  const lonely = await mkStation(pidB, 'Lonely', 600);
  await req('POST', `/api/pipelines/${pidB}/connections`, { from_station_id: bakery, to_station_id: pastry });
  const poB = (await req('POST', `/api/pipelines/${pidB}/stations`, {
    name: 'B Post Office', system_prompt: 'mail', type: 'post_office', position_x: 800, position_y: 0,
  })).body.id;
  const putDist = await req('PUT', `/api/stations/${poB}/distributions`, { station_ids: [bakery, mill] });
  assert(putDist.status === 200, 'B distribution set (got ' + putDist.status + ')');
  const getDist = (await req('GET', `/api/stations/${poB}/distributions`)).body;
  assert(getDist.length === 2 && getDist.includes(bakery) && getDist.includes(mill), 'distribution persisted');
  const poList = (await req('GET', '/api/post-offices')).body;
  assert(poList.some((p) => p.id === poB && p.pipeline_name === 'Town B'), 'GET /post-offices lists B hub with town name');
  console.log('✓ Town B built: 📮 distributes arrivals to Bakery + Mill');

  // Town A (sender): Worker -> A Post Office, which is addressed to B's hub.
  const pidA = (await req('POST', '/api/pipelines', { name: 'Town A' })).body.id;
  const worker = await mkStation(pidA, 'Worker', 0);
  const poA = (await req('POST', `/api/pipelines/${pidA}/stations`, {
    name: 'A Post Office', system_prompt: 'mail', type: 'post_office',
    send_to_post_office_id: poB, position_x: 200, position_y: 0,
  })).body.id;
  await req('POST', `/api/pipelines/${pidA}/connections`, { from_station_id: worker, to_station_id: poA });
  console.log('✓ Town A built: Worker -> 📮 -> Town B');

  const poEvents = [];
  const wsp = new WebSocket(`ws://localhost:${PORT}/ws`);
  wsp.on('message', (raw) => poEvents.push(JSON.parse(raw.toString())));
  await new Promise((r) => wsp.on('open', r));

  const aRun = await req('POST', `/api/pipelines/${pidA}/run`, { input: 'fresh bread' });
  assert(aRun.status === 202, 'Town A run started');
  const aRunId = aRun.body.id;
  // Wait for A to finish AND B's delivered (fire-and-forget) run to finish.
  await new Promise((resolve) => {
    const check = () => {
      const aDone = poEvents.some((e) => e.event === 'run_update' && e.data.run_id === aRunId && e.data.status === 'completed');
      const bDone = poEvents.some((e) => e.event === 'run_update' && e.data.pipeline_id === pidB && e.data.status === 'completed');
      if (aDone && bDone) resolve(); else setTimeout(check, 20);
    };
    check();
  });
  wsp.close();

  const poAStep = poEvents.find((e) => e.event === 'run_step_update' && e.data.station_id === poA && e.data.status === 'completed');
  assert(poAStep && /Delivered to "Town B"/.test(poAStep.data.artifact.content), 'A hub shows a delivery receipt');
  console.log('✓ sender receipt:', poAStep.data.artifact.content);

  const bRunsList = (await req('GET', `/api/pipelines/${pidB}/runs`)).body;
  assert(bRunsList.length === 1, 'exactly one delivered run in Town B (got ' + bRunsList.length + ')');
  const bDetail = (await req('GET', `/api/runs/${bRunsList[0].id}`)).body;
  const ranIds = bDetail.steps.map((s) => s.station_id);
  assert(bDetail.steps.length === 3, 'sub-DAG ran exactly 3 stations (got ' + bDetail.steps.length + ')');
  assert(ranIds.includes(bakery) && ranIds.includes(mill) && ranIds.includes(pastry), 'Bakery + Mill seeded, Pastry (downstream) ran');
  assert(!ranIds.includes(lonely), 'unreachable Lonely did not run');
  const bakeryStep = bDetail.steps.find((s) => s.station_id === bakery);
  const bakeryChars = Number(bakeryStep.artifacts[0].content.match(/processed (\d+) chars/)?.[1] || 0);
  assert(bakeryChars > 0, 'Bakery received the delivered mail (' + bakeryChars + ' chars)');
  console.log('✓ one delivered B run: Bakery+Mill seeded, Pastry ran, Lonely skipped, mail received');

  // ===== Loop / self-town guard =====
  // A hub mailing another hub in its OWN town must not spawn a re-entrant run while
  // the town is busy — the run lock makes delivery skip with a receipt. Also checks
  // that a hub with no destination reports it rather than erroring.
  const pidS = (await req('POST', '/api/pipelines', { name: 'Town S' })).body.id;
  const sWorker = await mkStation(pidS, 'SWorker', 0);
  const sHub2 = (await req('POST', `/api/pipelines/${pidS}/stations`, {
    name: 'S Hub 2', system_prompt: 'mail', type: 'post_office', position_x: 400, position_y: 0,
  })).body.id;
  await req('PUT', `/api/stations/${sHub2}/distributions`, { station_ids: [sWorker] });
  const sHub1 = (await req('POST', `/api/pipelines/${pidS}/stations`, {
    name: 'S Hub 1', system_prompt: 'mail', type: 'post_office',
    send_to_post_office_id: sHub2, position_x: 200, position_y: 0,
  })).body.id;
  await req('POST', `/api/pipelines/${pidS}/connections`, { from_station_id: sWorker, to_station_id: sHub1 });

  const sEvents = [];
  const wss = new WebSocket(`ws://localhost:${PORT}/ws`);
  wss.on('message', (raw) => sEvents.push(JSON.parse(raw.toString())));
  await new Promise((r) => wss.on('open', r));
  const sRun = await req('POST', `/api/pipelines/${pidS}/run`, { input: 'loop me' });
  const sRunId = sRun.body.id;
  await new Promise((resolve) => {
    const check = () => {
      if (sEvents.some((e) => e.event === 'run_update' && e.data.run_id === sRunId && e.data.status === 'completed')) resolve();
      else setTimeout(check, 20);
    };
    check();
  });
  wss.close();
  const sHub1Step = sEvents.find((e) => e.event === 'run_step_update' && e.data.station_id === sHub1 && e.data.status === 'completed');
  assert(/busy with a run/.test(sHub1Step.data.artifact.content), 'self-town delivery skipped via run lock (got: ' + sHub1Step.data.artifact.content + ')');
  const sHub2Step = sEvents.find((e) => e.event === 'run_step_update' && e.data.station_id === sHub2 && e.data.status === 'completed');
  assert(/No destination set/.test(sHub2Step.data.artifact.content), 'hub with no destination reports it');
  const sRuns = (await req('GET', `/api/pipelines/${pidS}/runs`)).body;
  assert(sRuns.length === 1, 'no re-entrant run spawned in own town (got ' + sRuns.length + ')');
  console.log('✓ self-town mail blocked by run lock; no re-entrant run');

  server.close();
  console.log('\nALL ORCHESTRATION TESTS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
