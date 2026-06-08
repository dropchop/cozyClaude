// Decorations CRUD + station style persistence, over a real socket. Clean-exit.
//   PGLITE_DIR=/tmp/decor-pg node test/decor.mjs
import http from 'node:http';
import express from 'express';
import { initDb } from '../src/db.js';
import { api } from '../src/routes/api.js';

const base = 'http://localhost:4558';

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

async function main() {
  await initDb();
  const app = express();
  app.use(express.json());
  app.use('/api', api);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(4558, r));

  const pid = (await req('POST', '/api/pipelines', { name: 'Decor Town' })).body.id;

  // --- station style persists on create + patch ---
  let res = await req('POST', `/api/pipelines/${pid}/stations`,
    { name: 'Bakery', system_prompt: 'bake', style: 'bakery', position_x: 10, position_y: 10 });
  assert(res.status === 201 && res.body.style === 'bakery', 'style saved on create');
  const sid = res.body.id;
  console.log('✓ station style saved on create');

  res = await req('PATCH', `/api/stations/${sid}`, { style: 'tower' });
  assert(res.status === 200 && res.body.style === 'tower', 'style updated via patch');
  console.log('✓ station style updated via patch');

  // --- decorations CRUD ---
  res = await req('POST', `/api/pipelines/${pid}/decorations`, { kind: 'tree', position_x: 100, position_y: 120 });
  assert(res.status === 201 && res.body.id && res.body.kind === 'tree', 'decoration created');
  const did = res.body.id;
  console.log('✓ decoration created');

  res = await req('POST', `/api/pipelines/${pid}/decorations`, {});
  assert(res.status === 400, 'decoration without kind rejected');
  console.log('✓ decoration without kind rejected');

  res = await req('GET', `/api/pipelines/${pid}/decorations`);
  assert(res.status === 200 && res.body.length === 1, 'list decorations');
  console.log('✓ list decorations');

  res = await req('PATCH', `/api/decorations/${did}`, { position_x: 250, position_y: 300 });
  assert(res.status === 200 && res.body.position_x === 250 && res.body.position_y === 300, 'move decoration');
  console.log('✓ move decoration');

  // --- full-graph GET includes decorations + station style ---
  res = await req('GET', `/api/pipelines/${pid}`);
  assert(res.body.decorations.length === 1, 'graph includes decorations');
  assert(res.body.stations[0].style === 'tower', 'graph includes station style');
  console.log('✓ full graph includes decorations + style');

  // --- delete ---
  res = await req('DELETE', `/api/decorations/${did}`);
  assert(res.status === 204, 'delete decoration');
  assert((await req('GET', `/api/pipelines/${pid}/decorations`)).body.length === 0, 'decoration gone');
  console.log('✓ delete decoration');

  // --- bulk insert (a dragged-out road) ---
  const items = Array.from({ length: 6 }, (_, i) => ({ kind: 'road', position_x: i * 32, position_y: 0 }));
  res = await req('POST', `/api/pipelines/${pid}/decorations/bulk`, { items });
  assert(res.status === 201 && Array.isArray(res.body) && res.body.length === 6, 'bulk insert 6 road tiles');
  assert(res.body.every((r) => r.id && r.kind === 'road'), 'bulk rows have ids');
  assert((await req('GET', `/api/pipelines/${pid}/decorations`)).body.length === 6, 'list reflects bulk insert');
  console.log('✓ bulk insert (road line)');

  res = await req('POST', `/api/pipelines/${pid}/decorations/bulk`, { items: [] });
  assert(res.status === 400, 'empty bulk rejected');
  console.log('✓ empty bulk rejected');

  // --- cascade: deleting the pipeline removes its decorations (incl. the road) ---
  await req('DELETE', `/api/pipelines/${pid}`);
  res = await req('GET', `/api/pipelines/${pid}/decorations`);
  assert(res.body.length === 0, 'decorations cascade-deleted with pipeline');
  console.log('✓ decorations cascade-delete with pipeline');

  server.close();
  console.log('\nALL DECOR TESTS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
