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
// How many times a single piece of mail may be relayed post-office → post-office
// before delivery is refused. Bounds cross-town loops (A→B→A→…) and self-sends.
const MAX_MAIL_DEPTH = Number(process.env.MAX_MAIL_DEPTH ?? 3);

/**
 * Create a run record and kick off execution in the background.
 * Returns the run row immediately so the API can respond; all subsequent
 * progress is streamed to the UI over WebSocket.
 */
export async function startRun(pipelineId, input = '', opts = {}) {
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
    executeRun(run, stations, connections, input, opts).catch(async (err) => {
      console.error('run execution error:', err);
      await failRun(run.id, pipelineId, String(err.message || err));
    });

    return run;
  } catch (e) {
    activeRuns.delete(pipelineId);
    throw e;
  }
}

async function executeRun(run, stations, connections, input, opts = {}) {
  const pipelineId = run.pipeline_id;
  const { entryStations = null, entryInput = '', mailDepth = 0 } = opts;
  try {

  const stationById = Object.fromEntries(stations.map((s) => [s.id, s]));

  // Cross-town deliveries seed specific "entry" stations (a post office's
  // distribution targets). In that case we run only the sub-DAG reachable from
  // those entries — each seeded with the delivered mail — instead of the whole
  // town from its roots. A normal run (entryStations === null) runs everything.
  const entrySet = new Set((entryStations || []).filter((id) => id in stationById));
  let activeStations = stations;
  if (entryStations) {
    const downAll = {};
    for (const s of stations) downAll[s.id] = [];
    for (const c of connections) {
      if (c.from_station_id in downAll && c.to_station_id in stationById) {
        downAll[c.from_station_id].push(c.to_station_id);
      }
    }
    const reachable = new Set();
    const queue = [...entrySet];
    while (queue.length > 0) {
      const id = queue.shift();
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const next of downAll[id]) if (!reachable.has(next)) queue.push(next);
    }
    activeStations = stations.filter((s) => reachable.has(s.id));
    if (activeStations.length === 0) {
      // Every distribution target was deleted before the mail arrived — nothing
      // to run, but the run is a clean no-op, not a failure.
      await query(`UPDATE runs SET status = 'completed', total_tokens = 0, total_cost_usd = 0, finished_at = now() WHERE id = $1`, [run.id]);
      broadcast('run_update', { run_id: run.id, pipeline_id: pipelineId, status: 'completed', total_tokens: 0, total_cost_usd: 0 });
      return;
    }
  }
  const activeIds = new Set(activeStations.map((s) => s.id));

  // Pre-create a pending run_step per active station so the UI can render the grid.
  const stepByStation = {};
  for (const station of activeStations) {
    const step = await one(
      `INSERT INTO run_steps (run_id, station_id, status) VALUES ($1, $2, 'pending') RETURNING *`,
      [run.id, station.id]
    );
    stepByStation[station.id] = step;
    broadcast('run_step_update', {
      run_id: run.id, station_id: station.id, step_id: step.id, status: 'pending',
    });
  }

  // Build the DAG over the active set. Edges INTO an entry station are dropped so
  // each seeded entry is a root that receives the delivered mail (not upstream
  // output) — this is what makes a sub-DAG delivery start at the chosen buildings.
  const upstream = {};
  const downstream = {};
  const indegree = {};
  for (const s of activeStations) { upstream[s.id] = []; downstream[s.id] = []; indegree[s.id] = 0; }
  for (const c of connections) {
    if (!activeIds.has(c.from_station_id) || !activeIds.has(c.to_station_id)) continue;
    if (entrySet.has(c.to_station_id)) continue;
    downstream[c.from_station_id].push(c.to_station_id);
    upstream[c.to_station_id].push(c.from_station_id);
    indegree[c.to_station_id] += 1;
  }

  // Topological sort (Kahn).
  const order = [];
  const ready = activeStations.filter((s) => indegree[s.id] === 0).map((s) => s.id);
  const indeg = { ...indegree };
  while (ready.length > 0) {
    const id = ready.shift();
    order.push(id);
    for (const next of downstream[id]) {
      indeg[next] -= 1;
      if (indeg[next] === 0) ready.push(next);
    }
  }
  if (order.length !== activeStations.length) {
    await failRun(run.id, pipelineId, 'pipeline graph has a cycle');
    return;
  }

  const outputByStation = {};
  let totalCost = 0;
  let totalTokens = 0;

  for (const stationId of order) {
    const station = stationById[stationId];
    const step = stepByStation[stationId];

    const ups = upstream[stationId];
    const rawInput = entrySet.has(stationId)
      ? entryInput // a seeded delivery target receives the mail, not upstream output
      : ups.length === 0
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

    // Post offices don't call an LLM. They forward their gathered input ("mail")
    // to another town's post office (fire-and-forget) and pass it through to any
    // local downstream stations. Delivery problems become a receipt, never a run
    // failure.
    if (station.type === 'post_office') {
      const receipt = await deliverMail(station, stationInput, mailDepth);
      outputByStation[stationId] = stationInput;
      const artifact = await one(
        `INSERT INTO artifacts (run_step_id, type, content) VALUES ($1, 'text', $2) RETURNING *`,
        [step.id, receipt]
      );
      await query(
        `UPDATE run_steps SET status = 'completed', tokens_used = 0, input_tokens = 0,
           output_tokens = 0, cost_usd = 0, finished_at = now() WHERE id = $1`,
        [step.id]
      );
      broadcast('run_step_update', {
        run_id: run.id, station_id: stationId, step_id: step.id, status: 'completed',
        tokens_used: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0,
        artifact: { id: artifact.id, type: 'text', content: receipt },
      });
      continue;
    }

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
      await failRun(run.id, pipelineId, message,
        { tokens: totalTokens, cost: totalCost });
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
      await failRun(run.id, pipelineId, `station "${station.name}" failed: ${message}`,
        { tokens: totalTokens, cost: totalCost });
      return;
    }

    outputByStation[stationId] = result.text;

    const inTok = result.usage?.input_tokens || 0;
    const outTok = result.usage?.output_tokens || 0;
    console.log(
      `[run ${run.id}] station "${station.name}" model=${result.model} ` +
      `in=${inTok} out=${outTok} tokens=${result.tokens} cost=$${(result.cost || 0).toFixed(6)}`
    );

    const artifact = await one(
      `INSERT INTO artifacts (run_step_id, type, content) VALUES ($1, 'text', $2) RETURNING *`,
      [step.id, result.text]
    );
    await query(
      `UPDATE run_steps SET status = 'completed', tokens_used = $2, input_tokens = $3,
         output_tokens = $4, cost_usd = $5, finished_at = now()
       WHERE id = $1`,
      [step.id, result.tokens, inTok, outTok, result.cost]
    );
    broadcast('run_step_update', {
      run_id: run.id, station_id: stationId, step_id: step.id, status: 'completed',
      tokens_used: result.tokens, input_tokens: inTok, output_tokens: outTok, cost_usd: result.cost,
      artifact: { id: artifact.id, type: 'text', content: result.text },
    });

    // Stop the run if cumulative cost crosses the ceiling.
    totalCost += result.cost || 0;
    totalTokens += result.tokens || 0;
    if (totalCost > MAX_RUN_COST_USD) {
      await failRun(run.id, pipelineId, `run exceeded cost ceiling ($${MAX_RUN_COST_USD.toFixed(2)})`,
        { tokens: totalTokens, cost: totalCost });
      return;
    }
  }

  await query(
    `UPDATE runs SET status = 'completed', total_tokens = $2, total_cost_usd = $3, finished_at = now()
     WHERE id = $1`,
    [run.id, totalTokens, totalCost]
  );
  broadcast('run_update', {
    run_id: run.id, pipeline_id: pipelineId, status: 'completed',
    total_tokens: totalTokens, total_cost_usd: totalCost,
  });
  } finally {
    activeRuns.delete(pipelineId);
  }
}

/**
 * Forward a post office's mail to the post office it addresses, which fans the
 * mail out to its own town's distribution targets via a single fresh run. This
 * is fire-and-forget: we await only the target run's *creation*, never its
 * completion, so the sending run is never blocked. Returns a human-readable
 * receipt string (shown as the post office's step output) describing the outcome;
 * it never throws — a busy/missing/looping destination is a receipt, not a failure.
 */
async function deliverMail(station, mail, mailDepth) {
  if (!station.send_to_post_office_id) return '📮 No destination set — mail not sent.';
  if (mailDepth >= MAX_MAIL_DEPTH) {
    return `📮 Not forwarded — mail already relayed ${MAX_MAIL_DEPTH} times (loop guard).`;
  }
  const targetPO = await one(
    `SELECT * FROM stations WHERE id = $1 AND type = 'post_office'`,
    [station.send_to_post_office_id]
  );
  if (!targetPO) return '📮 Destination post office no longer exists — not delivered.';
  const targetTown = await one('SELECT name FROM pipelines WHERE id = $1', [targetPO.pipeline_id]);
  const townName = targetTown?.name ?? 'town';
  const dist = await query(
    'SELECT target_station_id FROM mail_distributions WHERE post_office_station_id = $1',
    [targetPO.id]
  );
  const targetIds = dist.map((r) => r.target_station_id);
  if (targetIds.length === 0) {
    return `📮 Delivered to "${townName}", but it distributes to no buildings — mail went nowhere.`;
  }
  try {
    await startRun(targetPO.pipeline_id, '', {
      entryStations: targetIds, entryInput: mail, mailDepth: mailDepth + 1,
    });
    return `📮 Delivered to "${townName}" → ${targetIds.length} building(s).`;
  } catch (err) {
    if (err.status === 409) return `📮 "${townName}" is busy with a run — mail not delivered.`;
    return `📮 Delivery to "${townName}" failed: ${String(err.message || err)}`;
  }
}

async function failRun(runId, pipelineId, message, totals = {}) {
  try {
    await query(
      `UPDATE runs SET status = 'failed', error = $2, total_tokens = $3, total_cost_usd = $4,
         finished_at = now() WHERE id = $1`,
      [runId, message, totals.tokens ?? null, totals.cost ?? null]
    );
    broadcast('run_update', {
      run_id: runId, pipeline_id: pipelineId, status: 'failed', error: message,
      total_tokens: totals.tokens ?? null, total_cost_usd: totals.cost ?? null,
    });
  } catch (e) {
    console.error('failRun itself errored:', e);
  }
}
