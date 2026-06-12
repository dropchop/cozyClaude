import { useState, useEffect } from 'react';
import { HOUSE_STYLES } from './phaser/textures.js';
import { AddModelDialog } from './AddModelDialog.jsx';
import { api } from './api.js';

// House inspector, shared by the React Flow app and the Phaser app. `node.data`
// carries { name, model, style, system_prompt, output }. The optional `io` prop
// (Phaser app only) adds connection + input/output sections. `onModelsChanged`
// (also Phaser-only) is a refetch callback fired after a custom model is added
// or deleted via the "＋" dialog; its presence also gates the add/manage UI.
export function Inspector({ node, models, onSave, onDelete, onClose, io, onModelsChanged,
  stationId, localStations, currentPipelineId }) {
  const [name, setName] = useState(node.data.name);
  const [model, setModel] = useState(node.data.model || '');
  const [style, setStyle] = useState(node.data.style || 'cottage');
  const [prompt, setPrompt] = useState(node.data.system_prompt || '');
  const [saved, setSaved] = useState(false);
  const [showIn, setShowIn] = useState(false);
  const [showOut, setShowOut] = useState(false);
  const [showAddModel, setShowAddModel] = useState(false);

  // Post-office support is Phaser-app only — it's gated on the host passing the
  // local-stations list (the React Flow app omits it, hiding all of this).
  const postOfficeCapable = Array.isArray(localStations);
  const [type, setType] = useState(node.data.type || 'agent');
  const [sendTo, setSendTo] = useState(node.data.send_to_post_office_id || '');
  const [postOffices, setPostOffices] = useState([]); // {id,name,pipeline_id,pipeline_name}
  const [dist, setDist] = useState([]);               // target station ids
  const isPostOffice = type === 'post_office';

  // Load the cross-town post-office picker and this hub's current fan-out targets
  // whenever the building is (or becomes) a post office.
  useEffect(() => {
    if (!postOfficeCapable || !isPostOffice || !stationId) return;
    let cancelled = false;
    api.listPostOffices().then((rows) => { if (!cancelled) setPostOffices(rows); }).catch(() => {});
    api.getDistributions(stationId).then((ids) => { if (!cancelled) setDist(ids); }).catch(() => {});
    return () => { cancelled = true; };
  }, [postOfficeCapable, isPostOffice, stationId]);

  const builtin = models.builtin || []; // [{ id, input, output }]
  const custom = models.custom || [];

  // Headline per-1M price shown next to each option so the cost trade-off is
  // visible at the point of choice. 0/0 (e.g. local models) shows "free".
  const priceTag = (i, o) => (!i && !o ? 'free' : `$${i}/$${o} per 1M`);

  async function save() {
    await onSave({ name, model: model || null, style, system_prompt: prompt });
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }

  async function pickStyle(next) {
    setStyle(next);
    await onSave({ style: next });
  }

  // Selecting a model persists immediately, mirroring the style picker — so a
  // freshly-registered model (which just sets the selection) needs no extra Save.
  async function pickModel(next) {
    setModel(next);
    await onSave({ model: next || null });
  }

  async function handleModelDeleted(id) {
    if (id === model) await pickModel(''); // this house used it → fall back to default
    onModelsChanged?.();
  }

  // Building type, destination, and fan-out all persist immediately (like style).
  async function pickType(next) {
    setType(next);
    await onSave({ type: next });
  }
  async function pickSendTo(next) {
    setSendTo(next);
    await onSave({ send_to_post_office_id: next || null });
  }
  async function toggleDist(id) {
    const next = dist.includes(id) ? dist.filter((x) => x !== id) : [...dist, id];
    setDist(next);
    if (stationId) await api.setDistributions(stationId, next);
  }

  return (
    <aside className="inspector">
      <div className="inspector__head">
        <h3>{isPostOffice ? '📮 POST OFFICE' : '🏡 HOUSE'}</h3>
        <button className="btn btn--icon" onClick={onClose}>✕</button>
      </div>

      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      {postOfficeCapable && (
        <div className="field">
          <span>Building type</span>
          <div className="style-grid">
            <button type="button" className={`style-chip ${!isPostOffice ? 'style-chip--on' : ''}`}
              onClick={() => pickType('agent')}>🏡 agent</button>
            <button type="button" className={`style-chip ${isPostOffice ? 'style-chip--on' : ''}`}
              onClick={() => pickType('post_office')}>📮 post office</button>
          </div>
        </div>
      )}

      {isPostOffice && (
        <>
          <div className="field">
            <span>Sends mail to</span>
            <select value={sendTo} onChange={(e) => pickSendTo(e.target.value)}>
              <option value="">— pick a destination post office —</option>
              {postOffices
                .filter((po) => po.id !== stationId && po.pipeline_id !== currentPipelineId)
                .map((po) => (
                  <option key={po.id} value={po.id}>{po.pipeline_name} · {po.name}</option>
                ))}
            </select>
          </div>
          <div className="field">
            <span>Distributes arrivals to</span>
            <div className="po-dist">
              {(localStations || []).filter((s) => s.id !== stationId).length === 0 && (
                <div className="io__names">— no other buildings in this town —</div>
              )}
              {(localStations || []).filter((s) => s.id !== stationId).map((s) => (
                <label key={s.id} className="po-dist__row">
                  <input type="checkbox" checked={dist.includes(s.id)} onChange={() => toggleDist(s.id)} />
                  <span>{s.type === 'post_office' ? '📮 ' : ''}{s.name}</span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}

      {!isPostOffice && (
      <div className="field">
        <span>Model</span>
        <div className="model-row">
          <select value={model} onChange={(e) => pickModel(e.target.value)}>
            <option value="">default ({models.default})</option>
            {builtin.length > 0 && (
              <optgroup label="Built-in (Anthropic)">
                {builtin.map((b) => (
                  <option key={b.id} value={b.id}>{b.id} · {priceTag(b.input, b.output)}</option>
                ))}
              </optgroup>
            )}
            {custom.length > 0 && (
              <optgroup label="Custom">
                {custom.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} · {c.provider} · {priceTag(Number(c.input_price_per_m), Number(c.output_price_per_m))}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {onModelsChanged && (
            <button
              type="button"
              className="add-model-btn"
              title="Add or manage models"
              onClick={() => setShowAddModel(true)}
            >＋</button>
          )}
        </div>
      </div>
      )}

      {showAddModel && (
        <AddModelDialog
          custom={custom}
          onCreated={(row) => {
            setShowAddModel(false);
            onModelsChanged?.();
            pickModel(row.id);
          }}
          onDeleted={handleModelDeleted}
          onClose={() => setShowAddModel(false)}
        />
      )}

      <div className="field">
        <span>Building style</span>
        <div className="style-grid">
          {HOUSE_STYLES.map((s) => (
            <button
              key={s}
              type="button"
              className={`style-chip ${style === s ? 'style-chip--on' : ''}`}
              onClick={() => pickStyle(s)}
            >{s}</button>
          ))}
        </div>
      </div>

      {!isPostOffice && (
        <label className="field field--grow">
          <span>System prompt (the agent's role)</span>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </label>
      )}

      {io && (
        <div className="field io">
          <span>📥 Receives input from</span>
          <div className="io__names">{io.inputsFrom.length ? io.inputsFrom.join(', ') : (io.isRoot ? 'the day’s task (kickoff input)' : '— nothing connected —')}</div>
          <button type="button" className="io__toggle" onClick={() => setShowIn((v) => !v)}>
            {showIn ? '▾ Hide input' : '▸ View input'}
          </button>
          {showIn && <pre className="inspector__output">{io.inputText || 'Run the day to see the input this house receives.'}</pre>}
        </div>
      )}

      {io && (
        <div className="field io">
          <span>📤 Sends output to</span>
          <div className="io__names">{io.outputsTo.length ? io.outputsTo.join(', ') : '— nothing connected —'}</div>
          <button type="button" className="io__toggle" onClick={() => setShowOut((v) => !v)}>
            {showOut ? '▾ Hide output' : '▸ View output'}
          </button>
          {showOut && <pre className="inspector__output">{io.outputText || 'Run the day to see this house’s output.'}</pre>}
        </div>
      )}

      {!io && node.data.output && (
        <label className="field field--grow">
          <span>Last output</span>
          <pre className="inspector__output">{node.data.output}</pre>
        </label>
      )}

      <div className="inspector__actions">
        <button className="btn btn--run" onClick={save}>{saved ? '✓ Saved' : 'Save'}</button>
        <button className="btn btn--danger" onClick={onDelete}>Delete</button>
      </div>
    </aside>
  );
}
