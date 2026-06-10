import { useState } from 'react';
import { api } from './api.js';

const PROVIDERS = [
  { value: 'anthropic',          label: 'Anthropic',          needsBaseUrl: false, idHint: 'claude-haiku-4-5-20251001' },
  { value: 'openai',             label: 'OpenAI',             needsBaseUrl: false, idHint: 'gpt-4o' },
  { value: 'google',             label: 'Google Gemini',      needsBaseUrl: false, idHint: 'gemini-1.5-pro' },
  { value: 'openai-compatible',  label: 'OpenAI-compatible',  needsBaseUrl: true,  idHint: 'llama3.1' },
];

// Overlay shown by the Inspector when the user clicks "＋" next to the model
// dropdown. Registers a model via POST /api/models, and doubles as a manager:
// the `custom` list below the form can be deleted via DELETE /api/models/:id.
// `onCreated(row)` and `onDeleted(id)` let the parent refetch + reconcile the
// selection.
export function AddModelDialog({ onCreated, onClose, custom = [], onDeleted }) {
  const [provider, setProvider] = useState('anthropic');
  const [label, setLabel] = useState('');
  const [modelId, setModelId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [inputPrice, setInputPrice] = useState('');
  const [outputPrice, setOutputPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const meta = PROVIDERS.find((p) => p.value === provider);

  async function save(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const row = await api.createModel({
        label: label.trim() || modelId.trim(),
        provider,
        model_id: modelId.trim(),
        base_url: meta.needsBaseUrl ? baseUrl.trim() : null,
        input_price_per_m: Number(inputPrice) || 0,
        output_price_per_m: Number(outputPrice) || 0,
      });
      onCreated(row);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(c) {
    // Deleting a model silently changes every station that uses it, so confirm.
    if (!window.confirm(`Delete model "${c.label}"? Houses using it fall back to the default model.`)) return;
    setError(null);
    try {
      await api.deleteModel(c.id);
      onDeleted?.(c.id);
    } catch (err) {
      setError(err.message || String(err));
    }
  }

  return (
    <div className="add-model-dialog__backdrop" onClick={onClose}>
      <form className="add-model-dialog" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="add-model-dialog__head">
          <h4>＋ ADD MODEL</h4>
          <button type="button" className="btn btn--icon" onClick={onClose}>✕</button>
        </div>

        <label className="field">
          <span>Provider</span>
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>

        <label className="field">
          <span>Label (shown in dropdown)</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={meta.idHint} />
        </label>

        <label className="field">
          <span>Model ID</span>
          <input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder={meta.idHint} required />
        </label>

        {meta.needsBaseUrl && (
          <label className="field">
            <span>Base URL</span>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434/v1" required />
          </label>
        )}

        <div className="add-model-dialog__prices">
          <label className="field">
            <span>Input $ / 1M tokens</span>
            <input type="number" step="0.01" min="0" value={inputPrice} onChange={(e) => setInputPrice(e.target.value)} placeholder="0" />
          </label>
          <label className="field">
            <span>Output $ / 1M tokens</span>
            <input type="number" step="0.01" min="0" value={outputPrice} onChange={(e) => setOutputPrice(e.target.value)} placeholder="0" />
          </label>
        </div>

        {error && <div className="add-model-dialog__error">⚠ {error}</div>}

        <div className="add-model-dialog__actions">
          <button type="submit" className="btn btn--run" disabled={busy || !modelId.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>

        {custom.length > 0 && (
          <div className="add-model-dialog__list">
            <span className="add-model-dialog__list-title">Your custom models</span>
            {custom.map((c) => (
              <div key={c.id} className="model-list-row">
                <span className="model-list-row__name">{c.label} · {c.provider}</span>
                <button type="button" className="model-delete" title="Delete model" onClick={() => remove(c)}>🗑</button>
              </div>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}
