import { query, one } from './db.js';
import { runAgent } from './anthropic.js';
import { broadcast } from './ws.js';

/**
 * Create a run record and kick off execution in the background.
 * Returns the run row immediately so the API can respond; all subsequent
 * progress is streamed to the UI over WebSocket.
 */
export async function startRun(pipelineId, input = '') {
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

  // Execute without blocking the HTTP response.
  executeRun(run, stations, connections, input).catch(async (err) => {
    console.error('run execution error:', err);
    await failRun(run.id, pipelineId, String(err.message || err));
  });

  return run;
}

async function executeRun(run, stations, connections, input) {
  const pipelineId = run.pipeline_id;

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

  for (const stationId of order) {
    const station = stationById[stationId];
    const step = stepByStation[stationId];

    const ups = upstream[stationId];
    const stationInput = ups.length === 0
      ? input
      : ups
        .map((uid) => `=== Output from "${stationById[uid].name}" ===\n${outputByStation[uid] || ''}`)
        .join('\n\n');

    await query(`UPDATE run_steps SET status = 'running', started_at = now() WHERE id = $1`, [step.id]);
    broadcast('run_step_update', {
      run_id: run.id, station_id: stationId, step_id: step.id, status: 'running',
    });

    let result;
    try {
      result = await runAgent({
        system: station.system_prompt,
        input: stationInput,
        model: station.model,
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
  }

  await query(`UPDATE runs SET status = 'completed', finished_at = now() WHERE id = $1`, [run.id]);
  broadcast('run_update', { run_id: run.id, pipeline_id: pipelineId, status: 'completed' });
}

async function failRun(runId, pipelineId, message) {
  await query(
    `UPDATE runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`,
    [runId, message]
  );
  broadcast('run_update', { run_id: runId, pipeline_id: pipelineId, status: 'failed', error: message });
}
