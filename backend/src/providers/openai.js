import OpenAI from 'openai';

// Cache one client per (baseURL, apiKey) pair so adding several custom models
// from the same endpoint doesn't recreate the HTTPS agent on every call.
const clients = new Map();
function clientFor(baseUrl, apiKey) {
  const key = `${baseUrl || ''}::${apiKey || ''}`;
  if (clients.has(key)) return clients.get(key);
  const c = new OpenAI({
    apiKey: apiKey || 'sk-not-used', // openai-compatible local servers usually ignore this
    ...(baseUrl ? { baseURL: baseUrl } : {}),
  });
  clients.set(key, c);
  return c;
}

export async function run({ system, input, modelId, baseUrl, apiKey, maxTokens, onText }) {
  const client = clientFor(baseUrl, apiKey);
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: input || '(no upstream input)' });

  const stream = await client.chat.completions.create({
    model: modelId,
    max_tokens: maxTokens,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  });

  let text = '';
  let usage = {};
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content || '';
    if (delta) {
      text += delta;
      if (onText) onText(delta);
    }
    if (chunk.usage) usage = chunk.usage;
  }

  return {
    text,
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
    },
    model: modelId,
  };
}
