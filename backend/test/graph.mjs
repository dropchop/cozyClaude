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

  // --- Legacy rows the API now refuses: cleaned at boot (cross-town), or named
  // in the run error (a loop, since only the owner knows which tube to drop).
  const Y = await town('Legacy');
  const L1 = await station(Y, 'L1'); const L2 = await station(Y, 'L2');
  const lpo = await station(Y, 'LPO', { type: 'post_office' });
  await query(`INSERT INTO connections (pipeline_id, from_station_id, to_station_id) VALUES ($1, $2, $3), ($1, $3, $2), ($1, $2, $4)`, [Y, L1, L2, far]);
  await query(`INSERT INTO mail_distributions (post_office_station_id, target_station_id) VALUES ($1, $2), ($1, $3), ($1, $1)`, [lpo, L1, far]);
  await initDb();
  const yTubes = await query('SELECT from_station_id, to_station_id FROM connections WHERE pipeline_id = $1', [Y]);
  assert(yTubes.length === 2 && !yTubes.some((c) => c.to_station_id === far), `boot drops the cross-town tube only (got ${yTubes.length})`);
  const yDist = (await req('GET', `/api/stations/${lpo}/distributions`)).body;
  assert(yDist.length === 1 && yDist[0] === L1, `boot drops cross-town and self distributions (got ${JSON.stringify(yDist)})`);
  r = await req('PUT', `/api/stations/${lpo}/distributions`, { station_ids: [L1, L2] });
  assert(r.status === 200, `that post office's checklist is editable again (got ${r.status})`);
  const loopRun = (await req('POST', `/api/pipelines/${Y}/run`, { input: 'hi' })).body;
  let loopDetail;
  for (let i = 0; i < 100; i++) {
    loopDetail = (await req('GET', `/api/runs/${loopRun.id}`)).body;
    if (loopDetail.status !== 'running') break;
    await new Promise((res) => setTimeout(res, 50));
  }
  assert(loopDetail.status === 'failed' && /cycle: "L[12]" → "L[12]" → "L[12]"; remove one/.test(loopDetail.error || ''),
    `a legacy loop names its houses (got ${loopDetail.status}: ${loopDetail.error})`);
  console.log('✓ legacy cross-town rows cleaned at boot; a legacy loop is named in the run error');

  // --- Boot cleanup never drops a tube that is valid on its own, whatever the
  // ids: each pair keeps exactly one row, filed under its houses' town.
  const H = await town('Home'); const O = await town('Other');
  const u = await station(H, 'u'); const v = await station(H, 'v'); const w = await station(H, 'w');
  const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  await query('DROP INDEX uq_connections_pair');
  await query(`INSERT INTO connections (id, pipeline_id, from_station_id, to_station_id) VALUES
    ($1, $4, $6, $7), ($2, $5, $6, $7),  -- real u->v has the HIGHER id (the reviewer's pair)
    ($3, $4, $6, $8), ($9, $5, $6, $8),  -- real u->w has the lower id
    ($10, $5, $7, $8), ($11, $4, $7, $8), ($12, $4, $7, $8)`, // v->w: wrong-town lowest, two real copies
  [uuid(99), uuid(50), uuid(10), H, O, u, v, w, uuid(90), uuid(5), uuid(20), uuid(30)]);
  await initDb();
  for (const [label, from, to] of [['u->v', u, v], ['u->w', u, w], ['v->w', v, w]]) {
    const rows = await query('SELECT pipeline_id FROM connections WHERE from_station_id = $1 AND to_station_id = $2', [from, to]);
    assert(rows.length === 1 && rows[0].pipeline_id === H, `${label}: one real tube survives boot (got ${rows.length})`);
  }
  console.log('✓ boot cleanup keeps every real tube, whatever the ids of its wrong-town copies');

  // --- The runs list can be limited to the latest run (the HUD reads only that).
  await query(`INSERT INTO runs (pipeline_id, status, created_at) VALUES ($1, 'completed', now() - interval '1 minute'), ($1, 'failed', now())`, [H]);
  const all = (await req('GET', `/api/pipelines/${H}/runs`)).body;
  const latest = (await req('GET', `/api/pipelines/${H}/runs?limit=1`)).body;
  assert(all.length === 2 && latest.length === 1 && latest[0].status === 'failed', `?limit=1 returns only the newest (got ${latest.length})`);
  assert((await req('GET', `/api/pipelines/${H}/runs?limit=abc`)).status === 400, 'bad limit is 400');
  console.log('✓ runs list honours ?limit');

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
