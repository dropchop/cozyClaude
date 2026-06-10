import { one } from '../db.js';
import { BUILTIN_MODELS } from './anthropic.js';

// Default per-station model. Stations whose `model` column is NULL use this.
export const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'claude-sonnet-4-6';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function builtinModelIds() {
  return Object.keys(BUILTIN_MODELS);
}

// Resolve a stations.model value (built-in name | custom_models.id UUID | null)
// into a uniform record. Returns null when the value referred to a custom
// model that has been deleted; callers decide how to fall back.
export async function resolveModel(modelField) {
  const name = modelField || DEFAULT_MODEL;

  if (BUILTIN_MODELS[name]) {
    const m = BUILTIN_MODELS[name];
    return {
      provider: 'anthropic',
      modelId: name,
      label: name,
      inputPrice: m.input,
      outputPrice: m.output,
      supportsThinking: m.thinking,
      defaultMaxTokens: m.maxTokens,
      baseUrl: null,
    };
  }

  if (UUID_RE.test(name)) {
    const row = await one('SELECT * FROM custom_models WHERE id = $1', [name]);
    if (!row) return null;
    return {
      provider: row.provider,
      modelId: row.model_id,
      label: row.label,
      inputPrice: Number(row.input_price_per_m) || 0,
      outputPrice: Number(row.output_price_per_m) || 0,
      supportsThinking: false,
      defaultMaxTokens: 4000,
      baseUrl: row.base_url,
    };
  }

  // Unknown bare name — fall back to the default rather than crashing the run.
  if (name !== DEFAULT_MODEL) return resolveModel(DEFAULT_MODEL);
  throw new Error(`unknown model "${name}"`);
}

export function estimateCost(modelRecord, usage) {
  const input = (usage?.input_tokens || 0)
    + (usage?.cache_read_input_tokens || 0)
    + (usage?.cache_creation_input_tokens || 0);
  const output = usage?.output_tokens || 0;
  return (input * modelRecord.inputPrice + output * modelRecord.outputPrice) / 1_000_000;
}

// How many output tokens we can afford at this model's price, given a running
// budget and the cost of the input we're about to send. Returns 0 when even
// the input alone would push us over the ceiling.
export function maxOutputTokensForBudget(modelRecord, remainingUsd, inputTokens) {
  const inputCost = (inputTokens * modelRecord.inputPrice) / 1_000_000;
  const left = remainingUsd - inputCost;
  if (left <= 0) return 0;
  if (!modelRecord.outputPrice) return Number.MAX_SAFE_INTEGER;
  return Math.floor((left * 1_000_000) / modelRecord.outputPrice);
}

function apiKeyFor(provider) {
  if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY;
  if (provider === 'openai' || provider === 'openai-compatible') return process.env.OPENAI_API_KEY;
  if (provider === 'google') return process.env.GOOGLE_API_KEY;
  return null;
}

// Lazy-load provider modules so the openai / google SDKs are only required
// when a custom model actually uses them. Anthropic stays the default and
// is always available because `@anthropic-ai/sdk` is a direct dependency.
const providerCache = new Map();
async function loadProvider(name) {
  if (providerCache.has(name)) return providerCache.get(name);
  let mod;
  if (name === 'anthropic') mod = await import('./anthropic.js');
  else if (name === 'openai' || name === 'openai-compatible') mod = await import('./openai.js');
  else if (name === 'google') mod = await import('./google.js');
  else throw new Error(`unsupported provider: ${name}`);
  providerCache.set(name, mod);
  return mod;
}

/**
 * Run one station's agent: a single LLM call streamed to completion.
 *
 * @param {object} opts
 * @param {string} opts.system     - the station's system prompt (its role)
 * @param {string} opts.input      - upstream artifact text bundled as the user turn
 * @param {string} [opts.model]    - per-station model field (built-in name or custom UUID)
 * @param {number} [opts.maxTokens] - override output cap (e.g. budget-derived)
 * @param {(delta: string) => void} [opts.onText] - live token callback
 */
export async function runAgent({ system, input, model, maxTokens, onText }) {
  const record = (await resolveModel(model)) || (await resolveModel(DEFAULT_MODEL));

  // Offline mode: zero-cost echo so the orchestrator + UI path can be tested
  // without API keys or token spend.
  if (process.env.MOCK_LLM) {
    const text = `[mock:${record.modelId}] role="${(system || '').slice(0, 40)}" ` +
      `processed ${input ? input.length : 0} chars of input.`;
    if (onText) {
      for (const word of text.split(' ')) {
        onText(word + ' ');
        await new Promise((r) => setTimeout(r, 5));
      }
    }
    const usage = { input_tokens: (input || '').length, output_tokens: text.length };
    return { text, usage, model: record.modelId, tokens: usage.input_tokens + usage.output_tokens, cost: 0 };
  }

  const provider = await loadProvider(record.provider);
  const effectiveMaxTokens = maxTokens ?? record.defaultMaxTokens;
  const apiKey = apiKeyFor(record.provider);

  const result = await provider.run({
    system,
    input,
    modelId: record.modelId,
    baseUrl: record.baseUrl,
    apiKey,
    maxTokens: effectiveMaxTokens,
    supportsThinking: record.supportsThinking,
    onText,
  });

  const usage = result.usage || {};
  const tokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
  return {
    text: result.text,
    usage,
    model: result.model || record.modelId,
    tokens,
    cost: estimateCost(record, usage),
  };
}
