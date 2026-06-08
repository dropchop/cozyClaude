import Anthropic from '@anthropic-ai/sdk';

// Resolves ANTHROPIC_API_KEY from the environment.
const client = new Anthropic();

// Built-in Anthropic models. Pricing in USD per 1M tokens.
// `thinking: true` means the model supports adaptive thinking (haiku does not —
// sending a `thinking` block returns a 400). `maxTokens` is the default output
// cap; per-call callers can pass a lower value (e.g. budget-derived).
export const BUILTIN_MODELS = {
  'claude-opus-4-8':   { input: 5, output: 25, thinking: true,  maxTokens: 16000 },
  'claude-opus-4-7':   { input: 5, output: 25, thinking: true,  maxTokens: 16000 },
  'claude-opus-4-6':   { input: 5, output: 25, thinking: true,  maxTokens: 16000 },
  'claude-sonnet-4-6': { input: 3, output: 15, thinking: true,  maxTokens: 12000 },
  'claude-haiku-4-5':  { input: 1, output: 5,  thinking: false, maxTokens: 6000  },
};

export async function run({ system, input, modelId, maxTokens, supportsThinking, onText }) {
  const stream = client.messages.stream({
    model: modelId,
    max_tokens: maxTokens,
    ...(supportsThinking ? { thinking: { type: 'adaptive' } } : {}),
    ...(system ? { system } : {}),
    messages: [{ role: 'user', content: input || '(no upstream input)' }],
  });

  if (onText) stream.on('text', (delta) => onText(delta));
  const final = await stream.finalMessage();
  const text = final.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return { text, usage: final.usage || {}, model: final.model || modelId };
}
