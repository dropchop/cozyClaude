import express from 'express';
import { query, one, transaction } from '../db.js';
import { startRun } from '../orchestrator.js';
import { DEFAULT_MODEL, builtinModelList, mayBeFree } from '../providers/index.js';

const ALLOWED_PROVIDERS = ['anthropic', 'openai', 'google', 'openai-compatible'];

export const api = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const httpError = (status, message) => Object.assign(new Error(message), { status });

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
  const builtin = builtinModelList(); // [{ id, input, output }]
  res.json({
    default: DEFAULT_MODEL,
    builtin,
    custom,
    // Back-compat: callers that read `models.models` still get a flat list of
    // every selectable identifier (built-in name OR custom_models.id).
    models: [...builtin.map((b) => b.id), ...custom.map((c) => c.id)],
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
  if (base_url && provider !== 'openai-compatible') {
    // Only openai-compatible honors base_url; for other providers it would be stored and silently ignored.
    return res.status(400).json({ error: 'base_url is only supported for openai-compatible models' });
  }
  if (base_url) {
    let u;
    try { u = new URL(base_url); } catch { u = null; }
    if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) {
      return res.status(400).json({ error: 'base_url must be an http(s) URL' });
    }
  }
  if (provider === 'openai-compatible' && !base_url) {
    return res.status(400).json({ error: 'base_url is required for openai-compatible models' });
  }
  const [inPrice, outPrice] = [input_price_per_m, output_price_per_m]
    .map((v) => (v === undefined || v === null || v === '' ? 0 : Number(v)));
  if (![inPrice, outPrice].every((p) => Number.isFinite(p) && p >= 0)) {
    return res.status(400).json({ error: 'prices must be numbers >= 0 (USD per 1M tokens)' });
  }
  if (!mayBeFree(provider) && !(inPrice > 0 && outPrice > 0)) {
    return res.status(400).json({ error: `input and output prices are required for ${provider} models` });
  }
  const row = await one(
    `INSERT INTO custom_models (label, provider, model_id, base_url, input_price_per_m, output_price_per_m)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [label, provider, model_id, base_url || null, inPrice, outPrice]
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
  const { name, system_prompt, position_x, position_y, model, style, type, send_to_post_office_id } = req.body;
  if (!name || !system_prompt) {
    return res.status(400).json({ error: 'name and system_prompt are required' });
  }
  const row = await one(
    `INSERT INTO stations (pipeline_id, name, system_prompt, model, style, type, send_to_post_office_id, position_x, position_y)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [req.params.id, name, system_prompt, model || null, style || null, type || 'agent',
      send_to_post_office_id || null, position_x ?? 0, position_y ?? 0]
  );
  res.status(201).json(row);
}));

api.patch('/stations/:id', wrap(async (req, res) => {
  const body = req.body || {};
  const { name, system_prompt, type, position_x, position_y } = body;
  // model, style and the mail destination are nullable: a present key (even null
  // or "") clears the column; an absent key leaves it alone. The rest keep
  // COALESCE semantics (they are NOT NULL).
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const val = (k) => (body[k] === '' || body[k] === undefined ? null : body[k]);
  const row = await one(
    `UPDATE stations SET
       name = COALESCE($2, name),
       system_prompt = COALESCE($3, system_prompt),
       model = CASE WHEN $4 THEN $5 ELSE model END,
       style = CASE WHEN $6 THEN $7 ELSE style END,
       type = COALESCE($8, type),
       send_to_post_office_id = CASE WHEN $9 THEN $10 ELSE send_to_post_office_id END,
       position_x = COALESCE($11, position_x),
       position_y = COALESCE($12, position_y)
     WHERE id = $1 RETURNING *`,
    [req.params.id, name ?? null, system_prompt ?? null,
      has('model'), val('model'), has('style'), val('style'), type ?? null,
      has('send_to_post_office_id'), val('send_to_post_office_id'),
      position_x ?? null, position_y ?? null]
  );
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
}));

api.delete('/stations/:id', wrap(async (req, res) => {
  await query('DELETE FROM stations WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

// ---- Post offices (cross-town mail) --------------------------------------

// Every post-office station across all towns, with its town name — populates the
// "sends mail to" picker. Callers filter out the current town client-side.
api.get('/post-offices', wrap(async (_req, res) => {
  const rows = await query(
    `SELECT s.id, s.name, s.pipeline_id, p.name AS pipeline_name
       FROM stations s JOIN pipelines p ON p.id = s.pipeline_id
      WHERE s.type = 'post_office'
      ORDER BY p.name, s.name`
  );
  res.json(rows);
}));

// A post office's fan-out targets (local buildings it distributes arrivals to).
api.get('/stations/:id/distributions', wrap(async (req, res) => {
  const rows = await query(
    'SELECT target_station_id FROM mail_distributions WHERE post_office_station_id = $1',
    [req.params.id]
  );
  res.json(rows.map((r) => r.target_station_id));
}));

// Replace-all: set the post office's distribution targets to exactly `station_ids`.
// Validated, then swapped in one transaction, so a bad id never loses the old set.
api.put('/stations/:id/distributions', wrap(async (req, res) => {
  const raw = req.body?.station_ids;
  if (!Array.isArray(raw) || !raw.every(isUuid)) throw httpError(400, 'station_ids must be an array of station ids');
  const ids = [...new Set(raw)];
  await transaction(async (q) => {
    const [po] = isUuid(req.params.id)
      ? await q(`SELECT pipeline_id FROM stations WHERE id = $1 AND type = 'post_office'`, [req.params.id])
      : [];
    if (!po) throw httpError(404, 'post office not found');
    const targets = await q(
      'SELECT id FROM stations WHERE id = ANY($1::uuid[]) AND pipeline_id = $2 AND id <> $3',
      [ids, po.pipeline_id, req.params.id]
    );
    if (targets.length !== ids.length) {
      throw httpError(400, "every target must be another building in the post office's own town");
    }
    await q('DELETE FROM mail_distributions WHERE post_office_station_id = $1', [req.params.id]);
    for (const targetId of ids) {
      await q(
        'INSERT INTO mail_distributions (post_office_station_id, target_station_id) VALUES ($1, $2)',
        [req.params.id, targetId]
      );
    }
  });
  res.json(ids);
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
  if (!isUuid(from_station_id) || !isUuid(to_station_id) || !isUuid(req.params.id)) {
    throw httpError(400, 'station and neighborhood ids must be uuids');
  }
  // Check and insert in one transaction so two concurrent tubes can't form a loop.
  const row = await transaction(async (q) => {
    const ends = await q('SELECT id FROM stations WHERE id = ANY($1::uuid[]) AND pipeline_id = $2',
      [[from_station_id, to_station_id], req.params.id]);
    if (ends.length !== 2) throw httpError(400, 'both houses must be in this neighborhood');
    const edges = await q('SELECT from_station_id, to_station_id FROM connections WHERE pipeline_id = $1', [req.params.id]);
    if (edges.some((e) => e.from_station_id === from_station_id && e.to_station_id === to_station_id)) {
      throw httpError(409, 'those houses are already connected');
    }
    // A path to → … → from means this tube would close a loop, and the run would fail.
    const next = {};
    for (const e of edges) (next[e.from_station_id] ||= []).push(e.to_station_id);
    const seen = new Set();
    const stack = [to_station_id];
    while (stack.length) {
      const id = stack.pop();
      if (id === from_station_id) throw httpError(400, 'that tube would make a loop');
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(next[id] || []));
    }
    const [inserted] = await q(
      `INSERT INTO connections (pipeline_id, from_station_id, to_station_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, from_station_id, to_station_id]
    );
    return inserted;
  });
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

// Newest first. ?limit=N returns only the latest N (the HUD asks for 1).
api.get('/pipelines/:id/runs', wrap(async (req, res) => {
  const limit = req.query.limit === undefined ? null : Number(req.query.limit);
  if (limit !== null && !(Number.isInteger(limit) && limit > 0)) throw httpError(400, 'limit must be a positive integer');
  const rows = await query(
    'SELECT * FROM runs WHERE pipeline_id = $1 ORDER BY created_at DESC LIMIT $2',
    [req.params.id, limit]
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
