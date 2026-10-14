// R2 guard: PATCH /stations/:id must be able to clear nullable fields.
// Run: node test/patch-null.mjs
import './_env.mjs';
import http from 'node:http';
import express from 'express';
import { initDb } from '../src/db.js';
import { api } from '../src/routes/api.js';

const assert = (c, m) => { if (!c) { console.error('ASSERT FAILED:', m); process.exit(1); } };
await initDb();
const app = express(); app.use(express.json()); app.use('/api', api);
const srv = http.createServer(app);
await new Promise((r) => srv.listen(4564, r));
const req = async (method, p, body) => {
  const r = await fetch(`http://localhost:4564/api${p}`, {
    method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};

const pipe = (await req('POST', '/pipelines', { name: 'patch-null' })).body;
const dest = (await req('POST', `/pipelines/${pipe.id}/stations`, { name: 'PO', system_prompt: 'p', type: 'post_office' })).body;
const st = (await req('POST', `/pipelines/${pipe.id}/stations`, {
  name: 'S', system_prompt: 'p', model: 'claude-opus-4-8', style: 'cottage', send_to_post_office_id: dest.id,
})).body;
assert(st.model === 'claude-opus-4-8' && st.send_to_post_office_id === dest.id, 'setup');

let r = await req('PATCH', `/stations/${st.id}`, { model: null });
assert(r.body.model === null, `model:null should clear, got ${r.body.model}`);
r = await req('PATCH', `/stations/${st.id}`, { send_to_post_office_id: null });
assert(r.body.send_to_post_office_id === null, 'send_to_post_office_id:null should clear');
r = await req('PATCH', `/stations/${st.id}`, { style: null });
assert(r.body.style === null, 'style:null should clear');
console.log('✓ null clears model, destination, style');

// omitted fields stay untouched; name never becomes null
r = await req('PATCH', `/stations/${st.id}`, { position_x: 7 });
assert(r.body.name === 'S' && r.body.position_x === 7, 'omitted fields untouched');
r = await req('PATCH', `/stations/${st.id}`, { model: 'claude-opus-4-8', send_to_post_office_id: dest.id });
assert(r.body.model === 'claude-opus-4-8' && r.body.send_to_post_office_id === dest.id, 'values still set');
r = await req('PATCH', `/stations/${st.id}`, { send_to_post_office_id: '' });
assert(r.body.send_to_post_office_id === null, 'empty string clears destination (no 500)');
r = await req('PATCH', `/stations/${st.id}`, { name: null });
assert(r.body.name === 'S', 'name:null leaves name alone');
console.log('✓ omitted untouched, set still works');

console.log('patch-null: all passed');
process.exit(0);
