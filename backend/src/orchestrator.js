import { query, one } from './db.js';
import { runAgent, resolveModel, DEFAULT_MODEL, maxOutputTokensForBudget } from './providers/index.js';
import { broadcast } from './ws.js';

// One active run per pipeline — prevents an accidental double "Start the Day"
// from firing two parallel pipeline runs.
const activeRuns = new Set();
// `??` (not `||`) so an operator can explicitly set the env var to 0 without
// getting silently rewritten back to the default.
const MAX_INPUT_CHARS = Number(process.env.MAX_INPUT_CHARS ?? 40000);
const MAX_RUN_COST_USD = Number(process.env.MAX_RUN_COST_USD ?? 1.0);

/**
 * Create a run record and kick off execution in the background.
 * Returns the run row immediately so the API can respond; all subsequent
 * progress is streamed to the UI over WebSocket.
 */
export async function startRun(pipelineId, input = '') {
  // Claim the slot atomically. The previous shape (has → await DB → add) had
  // a TOCTOU: two simultaneous POSTs both passed the `has` check before either
  // reached `add`, so both kicked off parallel runs. `add` must come right
  // after the check, with the rest of the work guarded by a try/catch that
  // releases the slot if anything fails before executeRun owns it.
  if (activeRuns.has(pipelineId)) {
    const err = new Error('a run is already in progress for this neighborhood');
    err.status = 409;
    throw err;
  }
  activeRuns.add(pipelineId);

  try {
    const pipeline = await one('SELECT * FROM pipelines WHERE id = $1', [pipelineId]);
    if (!pipeline) {
      const err = new Error('pipeline not found');
      err.status = 404;
      throw err;
    }

    const stations = await query('SELECT * FROM stations WHERE pipeline_id = $1', [pipelineId]);
    if (stations.length === 0) {
      const err = new Error('pipeline has no stations');
      err.status = 400;
      throw err;
    }

    const connections = await query('SELECT * FROM connections WHERE pipeline_id = $1', [pipelineId]);

    const run = await one(
      `INSERT INTO runs (pipeline_id, status, input, started_at)
       VALUES ($1, 'running', $2, now()) RETURNING *`,
      [pipelineId, input]
    );
    broadcast('run_update', { run_id: run.id, pipeline_id: pipelineId, status: 'running' });

    // Execute without blocking the HTTP response. executeRun's own finally
    // releases the active-run slot for the success path.
    executeRun(run, stations, connections, input).catch(async (err) => {
      console.error('run execution error:', err);
      await failRun(run.id, pipelineId, String(err.message || err));
    });

    return run;
  } catch (e) {
    activeRuns.delete(pipelineId);
    throw e;
  }
}

async function executeRun(run, stations, connections, input) {
  const pipelineId = run.pipeline_id;
  try {

  // Pre-create a pending run_step per station so the UI can render the grid.
  const stepByStation = {};
  for (const station of stations) {
    const step = await one(
      `INSERT INTO run_steps (run_id, station_id, status) VALUES ($1, $2, 'pending') RETURNING *`,
      [run.id, station.id]
    );
    stepByStation[station.id] = step;
    broadcast('run_step_update', {
      run_id: run.id, station_id: station.id, step_id: step.id, status: 'pending',
    });
  }

  // Build the DAG.
  const upstream = {};
  const downstream = {};
  const indegree = {};
  for (const s of stations) { upstream[s.id] = []; downstream[s.id] = []; indegree[s.id] = 0; }
  for (const c of connections) {
    if (!(c.from_station_id in downstream) || !(c.to_station_id in upstream)) continue;
    downstream[c.from_station_id].push(c.to_station_id);
    upstream[c.to_station_id].push(c.from_station_id);
    indegree[c.to_station_id] += 1;
  }

  // Topological sort (Kahn).
  const order = [];
  const ready = stations.filter((s) => indegree[s.id] === 0).map((s) => s.id);
  const indeg = { ...indegree };
  while (ready.length > 0) {
    const id = ready.shift();
    order.push(id);
    for (const next of downstream[id]) {
      indeg[next] -= 1;
      if (indeg[next] === 0) ready.push(next);
    }
  }
  if (order.length !== stations.length) {
    await failRun(run.id, pipelineId, 'pipeline graph has a cycle');
    return;
  }

  const stationById = Object.fromEntries(stations.map((s) => [s.id, s]));
  const outputByStation = {};
  let totalCost = 0;

  for (const stationId of order) {
    const station = stationById[stationId];
    const step = stepByStation[stationId];

    const ups = upstream[stationId];
    const rawInput = ups.length === 0
      ? input
      : ups
        .map((uid) => `=== Output from "${stationById[uid].name}" ===\n${outputByStation[uid] || ''}`)
        .join('\n\n');
    // Cap input length so multi-upstream stations can't balloon the request.
    const stationInput = rawInput.length > MAX_INPUT_CHARS
      ? `${rawInput.slice(0, MAX_INPUT_CHARS)}\n\n[…truncated for length]`
      : rawInput;

    await query(`UPDATE run_steps SET status = 'running', started_at = now() WHERE id = $1`, [step.id]);
    broadcast('run_step_update', {
      run_id: run.id, station_id: stationId, step_id: step.id, status: 'running',
    });

    // Project worst-case cost BEFORE the call so one station can't blow past
    // the run ceiling. Cap each call's max_tokens to whatever output budget
    // remains at this model's price; if even the input alone would exceed the
    // ceiling, fail the run before billing anything. resolveModel falls back
    // to DEFAULT_MODEL automatically if the station's model field is missing
    // or references a deleted custom model.
    const modelRecord = (await resolveModel(station.model)) || (await resolveModel(DEFAULT_MODEL));
    const approxInputTokens = Math.ceil(stationInput.length / 4);
    const remaining = MAX_RUN_COST_USD - totalCost;
    const budgetMaxTokens = maxOutputTokensForBudget(modelRecord, remaining, approxInputTokens);
    if (budgetMaxTokens <= 0) {
      const message = `run exceeded cost ceiling ($${MAX_RUN_COST_USD.toFixed(2)})`;
      await query(
        `UPDATE run_steps SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`,
        [step.id, message]
      );
      broadcast('run_step_update', {
        run_id: run.id, station_id: stationId, step_id: step.id, status: 'failed', error: message,
      });
      await failRun(run.id, pipelineId, message);
      return;
    }
    const perCallMaxTokens = Math.min(modelRecord.defaultMaxTokens, budgetMaxTokens);

    let result;
    try {
      result = await runAgent({
        system: station.system_prompt,
        input: stationInput,
        model: station.model,
        maxTokens: perCallMaxTokens,
        onText: (delta) => broadcast('run_step_token', {
          run_id: run.id, station_id: stationId, step_id: step.id, delta,
        }),
      });
    } catch (err) {
      const message = String(err.message || err);
      await query(
        `UPDATE run_steps SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`,
        [step.id, message]
      );
      broadcast('run_step_update', {
        run_id: run.id, station_id: stationId, step_id: step.id, status: 'failed', error: message,
      });
      await failRun(run.id, pipelineId, `station "${station.name}" failed: ${message}`);
      return;
    }

    outputByStation[stationId] = result.text;

    const artifact = await one(
      `INSERT INTO artifacts (run_step_id, type, content) VALUES ($1, 'text', $2) RETURNING *`,
      [step.id, result.text]
    );
    await query(
      `UPDATE run_steps SET status = 'completed', tokens_used = $2, cost_usd = $3, finished_at = now()
       WHERE id = $1`,
      [step.id, result.tokens, result.cost]
    );
    broadcast('run_step_update', {
      run_id: run.id, station_id: stationId, step_id: step.id, status: 'completed',
      tokens_used: result.tokens, cost_usd: result.cost,
      artifact: { id: artifact.id, type: 'text', content: result.text },
    });

    // Stop the run if cumulative cost crosses the ceiling.
    totalCost += result.cost || 0;
    if (totalCost > MAX_RUN_COST_USD) {
      await failRun(run.id, pipelineId, `run exceeded cost ceiling ($${MAX_RUN_COST_USD.toFixed(2)})`);
      return;
    }
  }

  await query(`UPDATE runs SET status = 'completed', finished_at = now() WHERE id = $1`, [run.id]);
  broadcast('run_update', { run_id: run.id, pipeline_id: pipelineId, status: 'completed' });
  } finally {
    activeRuns.delete(pipelineId);
  }
}

async function failRun(runId, pipelineId, message) {
  try {
    await query(
      `UPDATE runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`,
      [runId, message]
    );
    broadcast('run_update', { run_id: runId, pipeline_id: pipelineId, status: 'failed', error: message });
  } catch (e) {
    console.error('failRun itself errored:', e);
  }
}
