import express from 'express';
import { query, one } from '../db.js';
import { startRun } from '../orchestrator.js';
import { DEFAULT_MODEL, builtinModelIds } from '../providers/index.js';

const ALLOWED_PROVIDERS = ['anthropic', 'openai', 'google', 'openai-compatible'];

export const api = express.Router();

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  const status = err.status || 500;
  // Only log unexpected (5xx) failures; expected 4xx (e.g. the 409 concurrency
  // guard, 404s) are normal control flow and would just be log noise.
  if (status >= 500) console.error(err);
  res.status(status).json({ error: String(err.message || err) });
});

// ---- Health & meta -------------------------------------------------------

api.get('/health', (_req, res) => res.json({ ok: true }));

api.get('/models', wrap(async (_req, res) => {
  const custom = await query('SELECT * FROM custom_models ORDER BY created_at DESC');
  const builtin = builtinModelIds();
  res.json({
    default: DEFAULT_MODEL,
    builtin,
    custom,
    // Back-compat: callers that read `models.models` still get a flat list of
    // every selectable identifier (built-in name OR custom_models.id).
    models: [...builtin, ...custom.map((c) => c.id)],
  });
}));

// ---- Custom model registry --------------------------------------------------

api.post('/models', wrap(async (req, res) => {
  const { label, provider, model_id, base_url, input_price_per_m, output_price_per_m } = req.body || {};
  if (!label || !provider || !model_id) {
    return res.status(400).json({ error: 'label, provider, and model_id are required' });
  }
  if (!ALLOWED_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `provider must be one of: ${ALLOWED_PROVIDERS.join(', ')}` });
  }
  const row = await one(
    `INSERT INTO custom_models (label, provider, model_id, base_url, input_price_per_m, output_price_per_m)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [label, provider, model_id, base_url || null, Number(input_price_per_m) || 0, Number(output_price_per_m) || 0]
  );
  res.status(201).json(row);
}));

api.delete('/models/:id', wrap(async (req, res) => {
  await query('DELETE FROM custom_models WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

// ---- Pipelines -----------------------------------------------------------

api.get('/pipelines', wrap(async (_req, res) => {
  const rows = await query('SELECT * FROM pipelines ORDER BY updated_at DESC');
  res.json(rows);
}));

api.post('/pipelines', wrap(async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const row = await one(
    'INSERT INTO pipelines (name, description) VALUES ($1, $2) RETURNING *',
    [name, description || null]
  );
  res.status(201).json(row);
}));

// Full pipeline graph: pipeline + stations + connections.
api.get('/pipelines/:id', wrap(async (req, res) => {
  const pipeline = await one('SELECT * FROM pipelines WHERE id = $1', [req.params.id]);
  if (!pipeline) return res.status(404).json({ error: 'not found' });
  const stations = await query('SELECT * FROM stations WHERE pipeline_id = $1', [req.params.id]);
  const connections = await query('SELECT * FROM connections WHERE pipeline_id = $1', [req.params.id]);
  const decorations = await query('SELECT * FROM decorations WHERE pipeline_id = $1', [req.params.id]);
  res.json({ ...pipeline, stations, connections, decorations });
}));

api.patch('/pipelines/:id', wrap(async (req, res) => {
  const { name, description } = req.body;
  const row = await one(
    `UPDATE pipelines
     SET name = COALESCE($2, name), description = COALESCE($3, description), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [req.params.id, name ?? null, description ?? null]
  );
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
}));

api.delete('/pipelines/:id', wrap(async (req, res) => {
  await query('DELETE FROM pipelines WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

// ---- Stations ------------------------------------------------------------

api.post('/pipelines/:id/stations', wrap(async (req, res) => {
  const { name, system_prompt, position_x, position_y, model, style } = req.body;
  if (!name || !system_prompt) {
    return res.status(400).json({ error: 'name and system_prompt are required' });
  }
  const row = await one(
    `INSERT INTO stations (pipeline_id, name, system_prompt, model, style, position_x, position_y)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [req.params.id, name, system_prompt, model || null, style || null, position_x ?? 0, position_y ?? 0]
  );
  res.status(201).json(row);
}));

api.patch('/stations/:id', wrap(async (req, res) => {
  const { name, system_prompt, model, style, position_x, position_y } = req.body;
  const row = await one(
    `UPDATE stations SET
       name = COALESCE($2, name),
       system_prompt = COALESCE($3, system_prompt),
       model = COALESCE($4, model),
       style = COALESCE($5, style),
       position_x = COALESCE($6, position_x),
       position_y = COALESCE($7, position_y)
     WHERE id = $1 RETURNING *`,
    [req.params.id, name ?? null, system_prompt ?? null, model ?? null, style ?? null,
      position_x ?? null, position_y ?? null]
  );
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
}));

api.delete('/stations/:id', wrap(async (req, res) => {
  await query('DELETE FROM stations WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

// ---- Connections ---------------------------------------------------------

api.post('/pipelines/:id/connections', wrap(async (req, res) => {
  const { from_station_id, to_station_id } = req.body;
  if (!from_station_id || !to_station_id) {
    return res.status(400).json({ error: 'from_station_id and to_station_id are required' });
  }
  if (from_station_id === to_station_id) {
    return res.status(400).json({ error: 'cannot connect a station to itself' });
  }
  const row = await one(
    `INSERT INTO connections (pipeline_id, from_station_id, to_station_id)
     VALUES ($1, $2, $3) RETURNING *`,
    [req.params.id, from_station_id, to_station_id]
  );
  res.status(201).json(row);
}));

api.delete('/connections/:id', wrap(async (req, res) => {
  await query('DELETE FROM connections WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

// ---- Decorations (cosmetic map objects) ----------------------------------

api.get('/pipelines/:id/decorations', wrap(async (req, res) => {
  const rows = await query('SELECT * FROM decorations WHERE pipeline_id = $1', [req.params.id]);
  res.json(rows);
}));

api.post('/pipelines/:id/decorations', wrap(async (req, res) => {
  const { kind, position_x, position_y } = req.body;
  if (!kind) return res.status(400).json({ error: 'kind is required' });
  const row = await one(
    `INSERT INTO decorations (pipeline_id, kind, position_x, position_y)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.params.id, kind, position_x ?? 0, position_y ?? 0]
  );
  res.status(201).json(row);
}));

// Bulk insert (e.g. a dragged-out road). Body: { items: [{kind, position_x, position_y}] }
api.post('/pipelines/:id/decorations/bulk', wrap(async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) return res.status(400).json({ error: 'items array is required' });
  const rows = [];
  for (const it of items) {
    if (!it || !it.kind) continue;
    const row = await one(
      `INSERT INTO decorations (pipeline_id, kind, position_x, position_y)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, it.kind, it.position_x ?? 0, it.position_y ?? 0]
    );
    rows.push(row);
  }
  res.status(201).json(rows);
}));

api.patch('/decorations/:id', wrap(async (req, res) => {
  const { position_x, position_y } = req.body;
  const row = await one(
    `UPDATE decorations SET
       position_x = COALESCE($2, position_x),
       position_y = COALESCE($3, position_y)
     WHERE id = $1 RETURNING *`,
    [req.params.id, position_x ?? null, position_y ?? null]
  );
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
}));

api.delete('/decorations/:id', wrap(async (req, res) => {
  await query('DELETE FROM decorations WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

// ---- Runs ----------------------------------------------------------------

// Kick off a run. Returns immediately with the run id; progress streams via WS.
api.post('/pipelines/:id/run', wrap(async (req, res) => {
  const input = req.body?.input || '';
  const run = await startRun(req.params.id, input);
  res.status(202).json(run);
}));

api.get('/pipelines/:id/runs', wrap(async (req, res) => {
  const rows = await query(
    'SELECT * FROM runs WHERE pipeline_id = $1 ORDER BY created_at DESC',
    [req.params.id]
  );
  res.json(rows);
}));

// Full run detail: run + steps + artifacts.
api.get('/runs/:id', wrap(async (req, res) => {
  const run = await one('SELECT * FROM runs WHERE id = $1', [req.params.id]);
  if (!run) return res.status(404).json({ error: 'not found' });
  const steps = await query(
    'SELECT * FROM run_steps WHERE run_id = $1 ORDER BY started_at NULLS LAST',
    [req.params.id]
  );
  for (const step of steps) {
    step.artifacts = await query(
      'SELECT * FROM artifacts WHERE run_step_id = $1 ORDER BY created_at',
      [step.id]
    );
  }
  res.json({ ...run, steps });
}));
