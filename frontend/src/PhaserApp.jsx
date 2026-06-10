import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { TownCanvas } from './TownCanvas.jsx';
import { BuildPalette } from './BuildPalette.jsx';
import { Inspector } from './Inspector.jsx';
import { useWebSocket } from './useWebSocket.js';
import { HOUSE_STYLES } from './phaser/textures.js';
import { bus } from './phaser/bus.js';

export default function PhaserApp() {
  const [pipelines, setPipelines] = useState([]);
  const [pipelineId, setPipelineId] = useState(null);
  const [models, setModels] = useState({ default: '', models: [] });
  const [buildMode, setBuildMode] = useState(false);
  const [brush, setBrush] = useState(null);
  const [lineMode, setLineMode] = useState('L');
  const [selected, setSelected] = useState(null); // station being inspected
  const [input, setInput] = useState('Write a two-line poem about autumn.');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [ioTick, setIoTick] = useState(0); // nudge to recompute inspector I/O as a run streams

  const dataRef = useRef(null);
  const pidRef = useRef(null);
  const outputsRef = useRef({}); // station id → last output text
  pidRef.current = pipelineId;

  // ---- load ----
  const refetchModels = useCallback(() => {
    api.models().then(setModels).catch(() => {});
  }, []);

  useEffect(() => {
    refetchModels();
    api.listPipelines().then((list) => { setPipelines(list); if (list.length) setPipelineId((c) => c || list[0].id); }).catch(() => {});
  }, [refetchModels]);

  const loadPipeline = useCallback((id) => {
    if (!id) return;
    api.getPipeline(id).then((p) => { dataRef.current = p; bus.emit('load', p); }).catch(() => {});
  }, []);
  useEffect(() => { loadPipeline(pipelineId); setSelected(null); }, [pipelineId, loadPipeline]);
  useEffect(() => bus.on('scene:ready', () => { if (dataRef.current) bus.emit('load', dataRef.current); }), []);

  // ---- push build state to scene ----
  useEffect(() => bus.emit('build:mode', buildMode), [buildMode]);
  useEffect(() => bus.emit('build:brush', brush), [brush]);
  useEffect(() => bus.emit('build:lineMode', lineMode), [lineMode]);

  // ---- scene → persistence intents ----
  useEffect(() => {
    const fail = (e) => setError(e?.message || String(e));
    const offs = [
      bus.on('error', fail),
      bus.on('intent:placeDecor', async ({ kind, position_x, position_y }) => {
        try { const r = await api.addDecoration(pidRef.current, kind, position_x, position_y); dataRef.current?.decorations.push(r); bus.emit('decor:added', r); } catch (e) { fail(e); }
      }),
      bus.on('intent:placeLine', async ({ items }) => {
        try { const rows = await api.addDecorations(pidRef.current, items); rows.forEach((r) => dataRef.current?.decorations.push(r)); bus.emit('decor:addedMany', rows); } catch (e) { fail(e); }
      }),
      bus.on('intent:deleteDecor', (id) => {
        if (dataRef.current) dataRef.current.decorations = dataRef.current.decorations.filter((d) => d.id !== id);
        api.deleteDecoration(id).catch(fail);
      }),
      bus.on('intent:moveNode', ({ type, id, x, y }) => {
        if (type === 'decor') api.moveDecoration(id, x, y).catch(fail);
        else api.updateStation(id, { position_x: x, position_y: y }).catch(fail);
      }),
      bus.on('intent:connect', async ({ from, to }) => {
        try {
          const r = await api.addConnection(pidRef.current, from, to);
          dataRef.current?.connections.push(r);
          bus.emit('conn:added', r);
          setIoTick((t) => t + 1); // refresh Inspector I/O panel
        } catch (e) { fail(e); }
      }),
      bus.on('intent:deleteConn', (id) => {
        if (dataRef.current) dataRef.current.connections = dataRef.current.connections.filter((c) => c.id !== id);
        api.deleteConnection(id).catch(fail);
        setIoTick((t) => t + 1);
      }),
      bus.on('intent:deleteHouse', async (id) => {
        try {
          await api.deleteStation(id);
          if (dataRef.current) {
            dataRef.current.stations = dataRef.current.stations.filter((s) => s.id !== id);
            dataRef.current.connections = dataRef.current.connections.filter((c) => c.from_station_id !== id && c.to_station_id !== id);
          }
          bus.emit('house:removed', id);
          setSelected((cur) => (cur?.id === id ? null : cur));
          setIoTick((t) => t + 1);
        } catch (e) { fail(e); }
      }),
      bus.on('select:house', (id) => { const s = dataRef.current?.stations.find((st) => st.id === id); if (s) setSelected(s); }),
      bus.on('select:clear', () => setSelected(null)),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  // ---- run visualization over WebSocket ----
  useWebSocket(useCallback((msg) => {
    const { event, data } = msg;
    if (event === 'run_step_update') {
      if (data.status === 'completed' && data.artifact) outputsRef.current[data.station_id] = data.artifact.content;
      bus.emit('house:status', { station_id: data.station_id, status: data.status, tokens_used: data.tokens_used, cost_usd: data.cost_usd });
      setIoTick((t) => t + 1);
    } else if (event === 'run_update') {
      if (data.status === 'completed' || data.status === 'failed') {
        setRunning(false); bus.emit('run:active', false);
        if (data.status === 'failed') setError(data.error || 'run failed');
      }
    }
  }, []));

  async function runPipeline() {
    if (!pipelineId) return;
    setRunning(true);
    bus.emit('run:active', true);
    (dataRef.current?.stations || []).forEach((s) => bus.emit('house:status', { station_id: s.id, status: 'pending' }));
    try { await api.run(pipelineId, input); } catch { setRunning(false); bus.emit('run:active', false); }
  }

  // ---- HUD actions ----
  async function newPipeline() {
    const name = prompt('Name your new neighborhood:', 'Maple Lane');
    if (!name) return;
    try {
      const p = await api.createPipeline(name, '');
      setPipelines(await api.listPipelines());
      setPipelineId(p.id);
    } catch (e) { setError(e.message); }
  }

  async function addHouse() {
    if (!pipelineId) return;
    const count = dataRef.current?.stations.length || 0;
    try {
      const s = await api.addStation(pipelineId, {
        name: `House ${count + 1}`,
        system_prompt: 'You are a helpful agent. Process the input and produce output.',
        model: models.default,
        style: HOUSE_STYLES[count % HOUSE_STYLES.length],
        position_x: 80 + (count % 4) * 200,
        position_y: 80 + Math.floor(count / 4) * 200,
      });
      dataRef.current?.stations.push(s);
      bus.emit('load', dataRef.current);
      setSelected(s);
    } catch (e) { setError(e.message); }
  }

  async function saveHouse(patch) {
    try {
      const updated = await api.updateStation(selected.id, patch);
      dataRef.current.stations = dataRef.current.stations.map((s) => (s.id === updated.id ? updated : s));
      setSelected(updated);
      bus.emit('house:updated', updated);
    } catch (e) { setError(e.message); }
  }

  async function deleteHouse() {
    try {
      await api.deleteStation(selected.id);
      if (dataRef.current) {
        dataRef.current.stations = dataRef.current.stations.filter((s) => s.id !== selected.id);
        dataRef.current.connections = dataRef.current.connections.filter((c) => c.from_station_id !== selected.id && c.to_station_id !== selected.id);
      }
      bus.emit('house:removed', selected.id);
      setSelected(null);
    } catch (e) { setError(e.message); }
  }

  const node = selected && { data: { name: selected.name, model: selected.model, style: selected.style, system_prompt: selected.system_prompt, output: outputsRef.current[selected.id] } };

  // Upstream/downstream neighbors + the input/output text for the selected house,
  // mirroring how the orchestrator assembles each station's input.
  const io = useMemo(() => {
    if (!selected || !dataRef.current) return null;
    const { stations, connections } = dataRef.current;
    const nameOf = (id) => stations.find((s) => s.id === id)?.name || '?';
    const upstream = connections.filter((c) => c.to_station_id === selected.id).map((c) => c.from_station_id);
    const downstream = connections.filter((c) => c.from_station_id === selected.id).map((c) => c.to_station_id);
    const isRoot = upstream.length === 0;
    const inputText = isRoot
      ? input
      : upstream.map((uid) => `=== Output from "${nameOf(uid)}" ===\n${outputsRef.current[uid] || ''}`).join('\n\n');
    return { inputsFrom: upstream.map(nameOf), outputsTo: downstream.map(nameOf), isRoot, inputText, outputText: outputsRef.current[selected.id] || '' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, ioTick, input]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🌻 AGENT VALLEY</div>
        <select className="select" value={pipelineId || ''} onChange={(e) => setPipelineId(e.target.value)}>
          {pipelines.length === 0 && <option value="">— no neighborhoods —</option>}
          {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn" onClick={newPipeline}>+ NEIGHBORHOOD</button>
        <button className="btn" onClick={addHouse} disabled={!pipelineId}>+ HOUSE</button>
        <button className={`btn ${buildMode ? 'btn--on' : ''}`} onClick={() => { setBuildMode((b) => !b); setBrush(null); }} disabled={!pipelineId}>🔨 BUILD</button>
        <div className="spacer" />
        {error && <div className="error" onClick={() => setError(null)}>⚠ {error}</div>}
      </header>

      <div className="main">
        <div className="town-canvas-wrap">
          <TownCanvas />
          <div className="crt" />
          {buildMode && (
            <BuildPalette brush={brush} setBrush={setBrush} lineMode={lineMode} setLineMode={setLineMode}
              onClose={() => { setBuildMode(false); setBrush(null); }} />
          )}
        </div>
        {selected && (
          <Inspector key={selected.id} node={node} models={models} io={io}
            onSave={saveHouse} onDelete={deleteHouse} onModelsChanged={refetchModels}
            onClose={() => { setSelected(null); bus.emit('deselect'); }} />
        )}
      </div>

      <footer className="runbar">
        <textarea className="run-input" value={input} onChange={(e) => setInput(e.target.value)} rows={2}
          placeholder="What should the neighborhood work on today?" />
        <button className="btn btn--run" onClick={runPipeline} disabled={running || !pipelineId}>
          {running ? '● A BUSY DAY…' : '▶ START THE DAY'}
        </button>
      </footer>
    </div>
  );
}
