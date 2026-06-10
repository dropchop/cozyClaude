// Thin REST client. All paths are same-origin (Vite proxies /api to the backend).

async function http(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error; } catch { /* ignore */ }
    throw new Error(detail || `${method} ${path} -> ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  listPipelines: () => http('GET', '/api/pipelines'),
  createPipeline: (name, description) => http('POST', '/api/pipelines', { name, description }),
  getPipeline: (id) => http('GET', `/api/pipelines/${id}`),
  deletePipeline: (id) => http('DELETE', `/api/pipelines/${id}`),

  models: () => http('GET', '/api/models'),
  createModel: (model) => http('POST', '/api/models', model),
  deleteModel: (id) => http('DELETE', `/api/models/${id}`),

  addStation: (pid, station) => http('POST', `/api/pipelines/${pid}/stations`, station),
  updateStation: (id, patch) => http('PATCH', `/api/stations/${id}`, patch),
  deleteStation: (id) => http('DELETE', `/api/stations/${id}`),

  addConnection: (pid, from_station_id, to_station_id) =>
    http('POST', `/api/pipelines/${pid}/connections`, { from_station_id, to_station_id }),
  deleteConnection: (id) => http('DELETE', `/api/connections/${id}`),

  addDecoration: (pid, kind, position_x, position_y) =>
    http('POST', `/api/pipelines/${pid}/decorations`, { kind, position_x, position_y }),
  addDecorations: (pid, items) =>
    http('POST', `/api/pipelines/${pid}/decorations/bulk`, { items }),
  moveDecoration: (id, position_x, position_y) =>
    http('PATCH', `/api/decorations/${id}`, { position_x, position_y }),
  deleteDecoration: (id) => http('DELETE', `/api/decorations/${id}`),

  run: (pid, input) => http('POST', `/api/pipelines/${pid}/run`, { input }),
  getRun: (id) => http('GET', `/api/runs/${id}`),
};
