// Self-contained smoke test: boots the real Express app + PGlite, exercises the
// REST API over a real socket, then exits. Run unsandboxed:
//   PGLITE_DIR=/tmp/smoke-pg node test/smoke.mjs
import http from 'node:http';
import express from 'express';
import { initDb } from '../src/db.js';
import { api } from '../src/routes/api.js';

const base = 'http://localhost:4555';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(base + path, {
      method,
      headers: { 'content-type': 'application/json' },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const assert = (cond, msg) => { if (!cond) { throw new Error('ASSERT FAILED: ' + msg); } };

async function main() {
  await initDb();
  const app = express();
  app.use(express.json());
  app.use('/api', api);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(4555, r));

  let res = await req('GET', '/api/health');
  assert(res.status === 200 && res.body.ok, 'health');
  console.log('✓ health');

  res = await req('POST', '/api/pipelines', { name: 'Smoke', description: 'test' });
  assert(res.status === 201 && res.body.id, 'create pipeline');
  const pid = res.body.id;
  console.log('✓ create pipeline', pid);

  res = await req('POST', `/api/pipelines/${pid}/stations`,
    { name: 'Researcher', system_prompt: 'research', position_x: 100, position_y: 100 });
  assert(res.status === 201, 'station A');
  const a = res.body.id;

  res = await req('POST', `/api/pipelines/${pid}/stations`,
    { name: 'Writer', system_prompt: 'write', position_x: 400, position_y: 100 });
  const b = res.body.id;
  console.log('✓ two stations');

  res = await req('POST', `/api/pipelines/${pid}/connections`,
    { from_station_id: a, to_station_id: b });
  assert(res.status === 201, 'connection');
  console.log('✓ connection');

  res = await req('GET', `/api/pipelines/${pid}`);
  assert(res.body.stations.length === 2, 'station count');
  assert(res.body.connections.length === 1, 'connection count');
  console.log('✓ full graph read back:', res.body.stations.length, 'stations,', res.body.connections.length, 'connection');

  // self-loop rejected
  res = await req('POST', `/api/pipelines/${pid}/connections`,
    { from_station_id: a, to_station_id: a });
  assert(res.status === 400, 'self-loop rejected');
  console.log('✓ self-loop rejected');

  // station update (move on canvas)
  res = await req('PATCH', `/api/stations/${a}`, { position_x: 250 });
  assert(res.status === 200 && res.body.position_x === 250, 'station move');
  console.log('✓ station move persisted');

  // delete connection
  const conns = (await req('GET', `/api/pipelines/${pid}`)).body.connections;
  res = await req('DELETE', `/api/connections/${conns[0].id}`);
  assert(res.status === 204, 'delete connection');
  assert((await req('GET', `/api/pipelines/${pid}`)).body.connections.length === 0, 'connection gone');
  console.log('✓ delete connection');

  server.close();
  console.log('\nALL SMOKE TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
