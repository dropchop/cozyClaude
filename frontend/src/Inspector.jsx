import { useState } from 'react';
import { HOUSE_STYLES } from './phaser/textures.js';
import { AddModelDialog } from './AddModelDialog.jsx';

// House inspector, shared by the React Flow app and the Phaser app. `node.data`
// carries { name, model, style, system_prompt, output }. The optional `io` prop
// (Phaser app only) adds connection + input/output sections. `onModelCreated`
// (also Phaser-only) is called after the user registers a custom model via
// the "+" dialog so the parent can refetch the model list.
export function Inspector({ node, models, onSave, onDelete, onClose, io, onModelCreated }) {
  const [name, setName] = useState(node.data.name);
  const [model, setModel] = useState(node.data.model || '');
  const [style, setStyle] = useState(node.data.style || 'cottage');
  const [prompt, setPrompt] = useState(node.data.system_prompt || '');
  const [saved, setSaved] = useState(false);
  const [showIn, setShowIn] = useState(false);
  const [showOut, setShowOut] = useState(false);
  const [showAddModel, setShowAddModel] = useState(false);

  const builtin = models.builtin || models.models || [];
  const custom = models.custom || [];

  async function save() {
    await onSave({ name, model: model || null, style, system_prompt: prompt });
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }

  async function pickStyle(next) {
    setStyle(next);
    await onSave({ style: next });
  }

  return (
    <aside className="inspector">
      <div className="inspector__head">
        <h3>🏡 HOUSE</h3>
        <button className="btn btn--icon" onClick={onClose}>✕</button>
      </div>

      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="field">
        <span>Model</span>
        <div className="model-row">
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">default ({models.default})</option>
            {builtin.length > 0 && (
              <optgroup label="Built-in (Anthropic)">
                {builtin.map((m) => <option key={m} value={m}>{m}</option>)}
              </optgroup>
            )}
            {custom.length > 0 && (
              <optgroup label="Custom">
                {custom.map((c) => (
                  <option key={c.id} value={c.id}>{c.label} · {c.provider}</option>
                ))}
              </optgroup>
            )}
          </select>
          {onModelCreated && (
            <button
              type="button"
              className="add-model-btn"
              title="Register a new model"
              onClick={() => setShowAddModel(true)}
            >＋</button>
          )}
        </div>
      </div>

      {showAddModel && (
        <AddModelDialog
          onCreated={(row) => {
            setShowAddModel(false);
            setModel(row.id);
            onModelCreated?.(row);
          }}
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

      <label className="field field--grow">
        <span>System prompt (the agent's role)</span>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>

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
