import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api } from './api.js';
import { StationNode } from './StationNode.jsx';
import { DecorNode } from './DecorNode.jsx';
import { TownLayer } from './TownLayer.jsx';
import { BuildPreview } from './BuildPreview.jsx';
import { PneumaticTube } from './PneumaticTube.jsx';
import { GROUND } from './Sprites.jsx';
import { BuildPalette, BULLDOZE } from './BuildPalette.jsx';
import { Inspector } from './Inspector.jsx';
import { buildWalkmap, LINE_KINDS, lineCells, worldToTile, tileTopLeft } from './world.js';
import { useWebSocket } from './useWebSocket.js';

const nodeTypes = { station: StationNode, decor: DecorNode };
const edgeTypes = { pneumatic: PneumaticTube };

export const HOUSE_STYLES = ['cottage', 'shop', 'tower', 'barn', 'bakery', 'cabin'];
const DEFAULT_STYLE = 'cottage';

const stationToNode = (s) => ({
  id: s.id,
  type: 'station',
  position: { x: s.position_x, y: s.position_y },
  zIndex: 10,
  data: {
    name: s.name,
    model: s.model,
    style: s.style || DEFAULT_STYLE,
    system_prompt: s.system_prompt,
    status: 'idle',
    output: '',
    tokens: null,
    cost: null,
  },
});

const decorToNode = (d) => ({
  id: d.id,
  type: 'decor',
  position: { x: d.position_x, y: d.position_y },
  zIndex: GROUND.has(d.kind) ? 0 : 2,
  connectable: false,
  data: { kind: d.kind },
});

const connToEdge = (c) => ({
  id: c.id,
  source: c.from_station_id,
  target: c.to_station_id,
  type: 'pneumatic',
  data: { active: false },
});

// Snap a placement to the grid: ground tiles to 32px cells, objects to 16px.
const snap = (v, g) => Math.round(v / g) * g;

export default function App() {
  const [pipelines, setPipelines] = useState([]);
  const [pipelineId, setPipelineId] = useState(null);
  const [models, setModels] = useState({ default: '', models: [] });

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedId, setSelectedId] = useState(null);

  const [input, setInput] = useState('Write a two-line poem about autumn.');
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState(null);
  const [error, setError] = useState(null);
  const flowWrapper = useRef(null);

  const [buildMode, setBuildMode] = useState(false);
  const [brush, setBrush] = useState(null); // decoration kind | 'bulldoze' | null (move/select)
  const [lineMode, setLineMode] = useState('L'); // road/path drag shape: 'L' | 'straight'
  const [preview, setPreview] = useState(null);  // { kind, cells } ghost line while dragging
  const [rf, setRf] = useState(null);       // React Flow instance (for screenToFlowPosition)

  // ---- initial load ----
  useEffect(() => {
    api.models().then(setModels).catch(() => {});
    refreshPipelines();
  }, []);

  async function refreshPipelines() {
    const list = await api.listPipelines();
    setPipelines(list);
    if (list.length && !pipelineId) selectPipeline(list[0].id);
  }

  async function selectPipeline(id) {
    setPipelineId(id);
    setSelectedId(null);
    setRunId(null);
    const p = await api.getPipeline(id);
    setNodes([
      ...(p.decorations || []).map(decorToNode),
      ...p.stations.map(stationToNode),
    ]);
    setEdges(p.connections.map(connToEdge));
  }

  async function newPipeline() {
    const name = prompt('Name your new neighborhood:', 'Maple Lane');
    if (!name) return;
    const p = await api.createPipeline(name, '');
    await refreshPipelines();
    selectPipeline(p.id);
  }

  // ---- live updates over WebSocket ----
  const patchNode = useCallback((stationId, patch) => {
    setNodes((nds) => nds.map((n) => (n.id === stationId
      ? { ...n, data: typeof patch === 'function' ? patch(n.data) : { ...n.data, ...patch } }
      : n)));
  }, [setNodes]);

  useWebSocket(useCallback((msg) => {
    const { event, data } = msg;
    if (event === 'run_step_update') {
      if (data.status === 'completed' && data.artifact) {
        patchNode(data.station_id, {
          status: 'completed', output: data.artifact.content,
          tokens: data.tokens_used, cost: data.cost_usd,
        });
      } else {
        patchNode(data.station_id, { status: data.status, ...(data.status === 'running' ? { output: '' } : {}) });
      }
    } else if (event === 'run_step_token') {
      patchNode(data.station_id, (d) => ({ ...d, output: (d.output || '') + data.delta }));
    } else if (event === 'run_update') {
      if (data.status === 'completed' || data.status === 'failed') {
        setRunning(false);
        setEdges((eds) => eds.map((e) => ({ ...e, data: { ...e.data, active: false } })));
        if (data.status === 'failed') setError(data.error || 'run failed');
      }
    }
  }, [patchNode]));

  // ---- graph editing ----
  const onConnect = useCallback(async (params) => {
    if (params.source === params.target) return;
    try {
      const c = await api.addConnection(pipelineId, params.source, params.target);
      setEdges((eds) => addEdge({ ...params, id: c.id, type: 'pneumatic', data: { active: false } }, eds));
    } catch (e) { setError(e.message); }
  }, [pipelineId, setEdges]);

  const onNodeDragStop = useCallback((_e, node) => {
    const body = { position_x: node.position.x, position_y: node.position.y };
    if (node.type === 'decor') api.moveDecoration(node.id, body.position_x, body.position_y).catch(() => {});
    else api.updateStation(node.id, body).catch(() => {});
  }, []);

  const onEdgesDelete = useCallback((deleted) => {
    deleted.forEach((e) => api.deleteConnection(e.id).catch(() => {}));
  }, []);

  const onNodesDelete = useCallback((deleted) => {
    deleted.forEach((n) => {
      if (n.type === 'decor') api.deleteDecoration(n.id).catch(() => {});
      else api.deleteStation(n.id).catch(() => {});
    });
    if (deleted.some((n) => n.id === selectedId)) setSelectedId(null);
  }, [selectedId]);

  async function addStation() {
    if (!pipelineId) return;
    const count = nodes.filter((n) => n.type === 'station').length;
    const station = {
      name: `House ${count + 1}`,
      system_prompt: 'You are a helpful agent. Process the input and produce output.',
      model: models.default,
      style: HOUSE_STYLES[count % HOUSE_STYLES.length],
      position_x: 80 + (count % 4) * 260,
      position_y: 80 + Math.floor(count / 4) * 220,
    };
    const s = await api.addStation(pipelineId, station);
    setNodes((nds) => [...nds, stationToNode(s)]);
    setSelectedId(s.id);
  }

  // ---- build mode: paint decorations by click + drag ----
  // Hold Space to pan instead of paint (React Flow's panActivationKeyCode).
  const strokeRef = useRef(null); // Set of cell keys placed during the current drag
  const spaceRef = useRef(false);
  useEffect(() => {
    const down = (e) => { if (e.code === 'Space') spaceRef.current = true; };
    const up = (e) => { if (e.code === 'Space') spaceRef.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const lineStartRef = useRef(null); // tile where a road/path drag began
  const previewRef = useRef(null);   // mirror of `preview` for commit-on-release

  // Scatter-paint a point decoration (tree, fountain, …) at the cursor.
  const paintAt = useCallback((kind, sx, sy) => {
    if (!pipelineId || !rf) return;
    const p = rf.screenToFlowPosition({ x: sx, y: sy });
    const g = GROUND.has(kind) ? 32 : 16;
    const x = snap(p.x, g) - g / 2;
    const y = snap(p.y, g) - g / 2;
    const key = `${kind}:${x},${y}`;
    if (!strokeRef.current || strokeRef.current.has(key)) return; // dedupe per grid cell
    strokeRef.current.add(key);
    api.addDecoration(pipelineId, kind, x, y)
      .then((d) => setNodes((nds) => [...nds, decorToNode(d)]))
      .catch((e) => setError(e.message));
  }, [pipelineId, rf, setNodes]);

  const screenToTile = useCallback((sx, sy) => {
    if (!rf) return null;
    const p = rf.screenToFlowPosition({ x: sx, y: sy });
    return worldToTile(p.x, p.y);
  }, [rf]);

  // Remove every decoration whose bounds contain the cursor (drag to clear a swath).
  const bulldozeAt = useCallback((sx, sy) => {
    if (!rf) return;
    const p = rf.screenToFlowPosition({ x: sx, y: sy });
    setNodes((nds) => {
      const remove = [];
      for (const n of nds) {
        if (n.type !== 'decor' || strokeRef.current?.has(n.id)) continue;
        const w = n.measured?.width ?? 32;
        const h = n.measured?.height ?? 32;
        if (p.x >= n.position.x && p.x <= n.position.x + w && p.y >= n.position.y && p.y <= n.position.y + h) {
          remove.push(n.id);
        }
      }
      if (!remove.length) return nds;
      remove.forEach((id) => { strokeRef.current?.add(id); api.deleteDecoration(id).catch(() => {}); });
      return nds.filter((n) => !remove.includes(n.id));
    });
  }, [rf, setNodes]);

  // Commit a previewed road/path line as one bulk insert.
  const commitLine = useCallback(async (kind, cells) => {
    if (!pipelineId || !cells.length) return;
    const items = cells.map(({ tx, ty }) => {
      const tl = tileTopLeft(tx, ty);
      return { kind, position_x: tl.x, position_y: tl.y };
    });
    try {
      const rows = await api.addDecorations(pipelineId, items);
      setNodes((nds) => [...nds, ...rows.map(decorToNode)]);
    } catch (e) { setError(e.message); }
  }, [pipelineId, setNodes]);

  const onCanvasPointerDown = useCallback((e) => {
    if (!buildMode || !brush || spaceRef.current) return;     // not building -> let RF pan/select
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Act only on the empty meadow — never on a node, control, minimap, or panel.
    if (e.target.closest?.('.react-flow__node, .react-flow__controls, .react-flow__minimap, .palette, .inspector')) return;

    if (brush === BULLDOZE) { strokeRef.current = new Set(); bulldozeAt(e.clientX, e.clientY); return; }

    if (LINE_KINDS.has(brush)) {
      const t = screenToTile(e.clientX, e.clientY);
      if (!t) return;
      lineStartRef.current = t;
      previewRef.current = { kind: brush, cells: [t] };
      setPreview(previewRef.current);
      return;
    }

    strokeRef.current = new Set();
    paintAt(brush, e.clientX, e.clientY);
  }, [buildMode, brush, paintAt, bulldozeAt, screenToTile]);

  const onCanvasPointerMove = useCallback((e) => {
    if (!buildMode || !brush) return;
    if (brush === BULLDOZE) { if (strokeRef.current) bulldozeAt(e.clientX, e.clientY); return; }
    if (LINE_KINDS.has(brush)) {
      if (!lineStartRef.current) return;
      const t = screenToTile(e.clientX, e.clientY);
      if (!t) return;
      previewRef.current = { kind: brush, cells: lineCells(lineStartRef.current, t, lineMode) };
      setPreview(previewRef.current);
      return;
    }
    if (strokeRef.current) paintAt(brush, e.clientX, e.clientY);
  }, [buildMode, brush, lineMode, paintAt, bulldozeAt, screenToTile]);

  const endStroke = useCallback(() => {
    strokeRef.current = null;
    lineStartRef.current = null;
    if (previewRef.current) {
      commitLine(previewRef.current.kind, previewRef.current.cells);
      previewRef.current = null;
      setPreview(null);
    }
  }, [commitLine]);

  const onPaneClick = useCallback(() => setSelectedId(null), []);

  // Walkmap for the NPCs — recompute only when a placement actually changes.
  const nodeSig = nodes.map((n) => `${n.id}:${Math.round(n.position.x)},${Math.round(n.position.y)}`).join('|');
  const walkmap = useMemo(() => buildWalkmap(nodes), [nodeSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- run ----
  async function runPipeline() {
    if (!pipelineId) return;
    setError(null);
    setRunning(true);
    setNodes((nds) => nds.map((n) => (n.type === 'station'
      ? { ...n, data: { ...n.data, status: 'pending', output: '', tokens: null, cost: null } }
      : n)));
    setEdges((eds) => eds.map((e) => ({ ...e, data: { ...e.data, active: true } })));
    try {
      const run = await api.run(pipelineId, input);
      setRunId(run.id);
    } catch (e) {
      setError(e.message);
      setRunning(false);
    }
  }

  const selectedNode = nodes.find((n) => n.id === selectedId && n.type === 'station');

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🌻 AGENT VALLEY</div>
        <select className="select" value={pipelineId || ''} onChange={(e) => selectPipeline(e.target.value)}>
          {pipelines.length === 0 && <option value="">— no neighborhoods —</option>}
          {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn" onClick={newPipeline}>+ NEIGHBORHOOD</button>
        <button className="btn" onClick={addStation} disabled={!pipelineId}>+ HOUSE</button>
        <button
          className={`btn ${buildMode ? 'btn--on' : ''}`}
          onClick={() => { setBuildMode((b) => !b); setBrush(null); }}
          disabled={!pipelineId}
        >🔨 BUILD</button>
        <div className="spacer" />
        {error && <div className="error" onClick={() => setError(null)}>⚠ {error}</div>}
      </header>

      <div className="main">
        <div
          className={`canvas ${buildMode ? 'canvas--build' : ''}`
            + `${buildMode && brush && brush !== BULLDOZE ? ' canvas--paint' : ''}`
            + `${buildMode && brush === BULLDOZE ? ' canvas--bulldoze' : ''}`}
          ref={flowWrapper}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={endStroke}
          onPointerLeave={endStroke}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={setRf}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={onNodeDragStop}
            onEdgesDelete={onEdgesDelete}
            onNodesDelete={onNodesDelete}
            onNodeClick={(_e, n) => setSelectedId(n.id)}
            onPaneClick={onPaneClick}
            panOnDrag={!(buildMode && !!brush)}
            panActivationKeyCode="Space"
            snapToGrid={buildMode}
            snapGrid={[16, 16]}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            {buildMode && <Background variant="lines" color="rgba(58,40,14,0.4)" gap={32} />}
            <TownLayer nodes={nodes} walkmap={walkmap} />
            {preview && <BuildPreview kind={preview.kind} cells={preview.cells} />}
            <MiniMap pannable zoomable nodeColor="#caa44a" maskColor="rgba(20,40,18,0.55)" />
            <Controls />
          </ReactFlow>

          <div className="crt" />

          {buildMode && (
            <BuildPalette
              brush={brush}
              setBrush={setBrush}
              lineMode={lineMode}
              setLineMode={setLineMode}
              onClose={() => { setBuildMode(false); setBrush(null); }}
            />
          )}

          {nodes.length === 0 && pipelineId && !buildMode && (
            <div className="empty-hint">Press <b>+ HOUSE</b> to build your first house!</div>
          )}
          {!pipelineId && (
            <div className="empty-hint">Press <b>+ NEIGHBORHOOD</b> to establish a new neighborhood.</div>
          )}
        </div>

        {selectedNode && (
          <Inspector
            key={selectedNode.id}
            node={selectedNode}
            models={models}
            onSave={async (patch) => {
              await api.updateStation(selectedNode.id, patch);
              patchNode(selectedNode.id, patch);
            }}
            onDelete={async () => {
              await api.deleteStation(selectedNode.id);
              setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
              setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
              setSelectedId(null);
            }}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>

      <footer className="runbar">
        <textarea
          className="run-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What should the neighborhood work on today? (sent into the first houses)"
          rows={2}
        />
        <button className="btn btn--run" onClick={runPipeline} disabled={running || !pipelineId || nodes.length === 0}>
          {running ? '● A BUSY DAY…' : '▶ START THE DAY'}
        </button>
      </footer>
    </div>
  );
}
