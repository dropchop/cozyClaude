// Graph integrity: tubes (connections), post-office distributions, and the boot
// sweep of runs a restart cut off. Real server + scratch PGlite.
//   node test/graph.mjs
import './_env.mjs';
import http from 'node:http';
import express from 'express';
import { initDb, query, one } from '../src/db.js';
import { api } from '../src/routes/api.js';

const PORT = 4571;
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
const town = (name) => req('POST', '/api/pipelines', { name }).then((r) => r.body.id);
const station = (pid, name, extra = {}) => req('POST', `/api/pipelines/${pid}/stations`, {
  name, system_prompt: `You are ${name}`, position_x: 0, position_y: 0, ...extra,
}).then((r) => r.body.id);
const tube = (pid, from, to) => req('POST', `/api/pipelines/${pid}/connections`, { from_station_id: from, to_station_id: to });

async function main() {
  await initDb();
  const app = express();
  app.use(express.json());
  app.use('/api', api);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(PORT, r));

  const P = await town('Here'); const X = await town('Elsewhere');
  const A = await station(P, 'A'); const B = await station(P, 'B'); const C = await station(P, 'C');
  const far = await station(X, 'Far');

  // --- S6: tubes
  let r = await tube(P, A, B);
  assert(r.status === 201, `first tube 201 (got ${r.status})`);
  r = await tube(P, A, B);
  assert(r.status === 409, `duplicate tube refused with 409 (got ${r.status})`);
  r = await tube(P, A, far);
  assert(r.status === 400, `tube to another town refused (got ${r.status})`);
  r = await tube(X, A, B);
  assert(r.status === 400, `tube filed under the wrong town refused (got ${r.status})`);
  assert((await tube(P, B, C)).status === 201, 'B->C allowed');
  r = await tube(P, C, A);
  assert(r.status === 400 && /loop/.test(r.body.error), `tube closing a loop refused (got ${r.status} ${r.body?.error})`);
  r = await tube(P, A, 'not-a-uuid');
  assert(r.status === 400, `malformed id is 400, not 500 (got ${r.status})`);
  const conns = (await req('GET', `/api/pipelines/${P}`)).body.connections;
  assert(conns.length === 2, `exactly the two good tubes stored (got ${conns.length})`);
  console.log('✓ tubes: no duplicates, no cross-town, no loops');

  // --- S5: distributions
  const po = await station(P, 'PO', { type: 'post_office' });
  r = await req('PUT', `/api/stations/${po}/distributions`, { station_ids: [B] });
  assert(r.status === 200, `valid distribution set (got ${r.status})`);
  for (const [label, ids] of [['malformed id', [C, 'not-a-uuid']], ['other-town target', [far]], ['itself', [po]], ['not an array', 'x']]) {
    r = await req('PUT', `/api/stations/${po}/distributions`, { station_ids: ids });
    assert(r.status === 400, `${label} refused with 400 (got ${r.status})`);
    const kept = (await req('GET', `/api/stations/${po}/distributions`)).body;
    assert(kept.length === 1 && kept[0] === B, `${label}: old set kept (got ${JSON.stringify(kept)})`);
  }
  r = await req('PUT', `/api/stations/${A}/distributions`, { station_ids: [B] });
  assert(r.status === 404, `distributions on a non-post-office refused (got ${r.status})`);
  console.log('✓ distributions: validated, and a refused update keeps the old set');

  // --- S6, existing databases: duplicates written before the unique index
  // existed must not stop the boot; one copy of each tube survives.
  await query('DROP INDEX uq_connections_pair');
  await query('INSERT INTO connections (pipeline_id, from_station_id, to_station_id) VALUES ($1, $2, $3), ($1, $2, $3)', [P, A, B]);
  await initDb();
  const ab = await query('SELECT id FROM connections WHERE from_station_id = $1 AND to_station_id = $2', [A, B]);
  assert(ab.length === 1, `boot dedupes legacy duplicate tubes (got ${ab.length})`);
  assert(await one(`SELECT 1 FROM pg_indexes WHERE indexname = 'uq_connections_pair'`), 'unique index rebuilt at boot');
  console.log('✓ boot dedupes legacy duplicate tubes and builds the unique index');

  // --- S7: a run left open by a restart is closed at boot.
  const run = await one(`INSERT INTO runs (pipeline_id, status, started_at) VALUES ($1, 'running', now()) RETURNING id`, [P]);
  const ran = await one(`INSERT INTO run_steps (run_id, station_id, status) VALUES ($1, $2, 'running') RETURNING id`, [run.id, A]);
  const waiting = await one(`INSERT INTO run_steps (run_id, station_id, status) VALUES ($1, $2, 'pending') RETURNING id`, [run.id, B]);
  await initDb();
  const after = await one('SELECT status, error FROM runs WHERE id = $1', [run.id]);
  assert(after.status === 'failed' && /interrupted/.test(after.error), `open run closed at boot (got ${after.status})`);
  const s1 = await one('SELECT status FROM run_steps WHERE id = $1', [ran.id]);
  const s2 = await one('SELECT status FROM run_steps WHERE id = $1', [waiting.id]);
  assert(s1.status === 'failed' && s2.status === 'skipped', `open steps closed at boot (got ${s1.status}, ${s2.status})`);
  console.log('✓ boot closes runs and steps a restart cut off');

  server.close();
  console.log('\nALL GRAPH TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
