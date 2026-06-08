import Anthropic from '@anthropic-ai/sdk';

// Resolves ANTHROPIC_API_KEY from the environment.
const client = new Anthropic();

export const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'claude-opus-4-8';

// Pricing in USD per 1M tokens (input, output). Used to estimate per-step cost.
const PRICING = {
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

export function estimateCost(model, usage) {
  const price = PRICING[model] || PRICING[DEFAULT_MODEL];
  const input = (usage?.input_tokens || 0) + (usage?.cache_read_input_tokens || 0) +
    (usage?.cache_creation_input_tokens || 0);
  const output = usage?.output_tokens || 0;
  return (input * price.input + output * price.output) / 1_000_000;
}

/**
 * Run one station's agent: a single LLM call streamed to completion.
 *
 * @param {object} opts
 * @param {string} opts.system  - the station's system prompt (its role)
 * @param {string} opts.input   - upstream artifact text bundled as the user turn
 * @param {string} [opts.model] - per-station model override
 * @param {(delta: string) => void} [opts.onText] - live token callback
 * @returns {{ text: string, usage: object, model: string, tokens: number, cost: number }}
 */
export async function runAgent({ system, input, model, onText }) {
  const chosenModel = model || DEFAULT_MODEL;

  // Offline mode: build and demo pipelines without an API key or token spend.
  // Streams a deterministic echo so the orchestrator/UI path is fully exercised.
  if (process.env.MOCK_LLM) {
    const text = `[mock:${chosenModel}] role="${(system || '').slice(0, 40)}" ` +
      `processed ${input ? input.length : 0} chars of input.`;
    if (onText) {
      for (const word of text.split(' ')) {
        onText(word + ' ');
        await new Promise((r) => setTimeout(r, 5));
      }
    }
    const usage = { input_tokens: (input || '').length, output_tokens: text.length };
    return { text, usage, model: chosenModel, tokens: usage.input_tokens + usage.output_tokens, cost: 0 };
  }

  const stream = client.messages.stream({
    model: chosenModel,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    ...(system ? { system } : {}),
    messages: [{ role: 'user', content: input || '(no upstream input)' }],
  });

  if (onText) stream.on('text', (delta) => onText(delta));

  const final = await stream.finalMessage();

  const text = final.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  const usage = final.usage || {};
  const tokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);

  return {
    text,
    usage,
    model: final.model || chosenModel,
    tokens,
    cost: estimateCost(final.model || chosenModel, usage),
  };
}
