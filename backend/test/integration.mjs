// Boots the REAL combined server (API + static UI + WebSocket), seeds a
// pipeline, serves index.html, and runs the seeded pipeline end-to-end with
// MOCK_LLM. Clean-exit. Run unsandboxed:
//   MOCK_LLM=1 PGLITE_DIR=/tmp/it-pg node test/integration.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocket } from 'ws';
import { initDb, query, one } from '../src/db.js';
import { initWebSocket } from '../src/ws.js';
import { api } from '../src/routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4557;
const base = `http://localhost:${PORT}`;
const assert = (c, m) => { if (!c) throw new Error('ASSERT FAILED: ' + m); };

function get(p) {
  return new Promise((resolve, reject) => {
    http.get(base + p, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    }).on('error', reject);
  });
}
function post(p, body) {
  return new Promise((resolve, reject) => {
    const d = JSON.stringify(body);
    const r = http.request(base + p, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
    });
    r.on('error', reject); r.write(d); r.end();
  });
}

async function main() {
  await initDb();

  // Seed inline (mirror of seed.mjs) so the test is self-contained.
  const p = await one(`INSERT INTO pipelines (name) VALUES ($1) RETURNING *`, ['IT Pipeline']);
  const mk = (name, x) => one(
    `INSERT INTO stations (pipeline_id, name, system_prompt, position_x, position_y) VALUES ($1,$2,$3,$4,0) RETURNING *`,
    [p.id, name, `You are ${name}`, x]);
  const a = await mk('Research', 0); const b = await mk('Write', 300);
  await query(`INSERT INTO connections (pipeline_id, from_station_id, to_station_id) VALUES ($1,$2,$3)`, [p.id, a.id, b.id]);

  const app = express();
  app.use(express.json());
  app.use('/api', api);
  const distDir = path.join(__dirname, '..', '..', 'frontend', 'dist');
  const hasDist = fs.existsSync(distDir);
  if (hasDist) {
    app.use(express.static(distDir));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
  }
  const server = http.createServer(app);
  initWebSocket(server);
  await new Promise((r) => server.listen(PORT, r));

  // 1. Static UI served
  if (hasDist) {
    const idx = await get('/');
    assert(idx.status === 200 && idx.body.includes('<div id="root">'), 'index.html served');
    console.log('✓ frontend index.html served by backend');
  } else {
    console.log('• frontend/dist not built — skipping static check');
  }

  // 2. API reachable through combined server
  const list = await get('/api/pipelines');
  assert(list.status === 200, 'api reachable');
  console.log('✓ API reachable through combined server');

  // 3. Run the seeded pipeline with live WS
  const events = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const done = new Promise((resolve) => {
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      events.push(m);
      if (m.event === 'run_update' && ['completed', 'failed'].includes(m.data.status)) resolve(m.data.status);
    });
  });
  await new Promise((r) => ws.on('open', r));
  const run = await post(`/api/pipelines/${p.id}/run`, { input: 'topic: autumn' });
  assert(run.status === 202, 'run accepted');
  const status = await done;
  ws.close();
  assert(status === 'completed', 'run completed (' + status + ')');
  console.log('✓ seeded pipeline ran to completion over combined server');

  const detail = (await post('/api/pipelines/' + p.id + '/run', { input: 'x' })).body; // ensure repeatable
  assert(detail.status, 'second run also accepted');
  console.log('✓ second run accepted');

  server.close();
  console.log('\nINTEGRATION TEST PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
