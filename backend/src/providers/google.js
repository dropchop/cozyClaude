import { GoogleGenerativeAI } from '@google/generative-ai';

let cachedKey = null;
let cachedAi = null;
function aiFor(apiKey) {
  if (cachedKey === apiKey && cachedAi) return cachedAi;
  cachedAi = new GoogleGenerativeAI(apiKey || '');
  cachedKey = apiKey;
  return cachedAi;
}

export async function run({ system, input, modelId, apiKey, maxTokens, onText }) {
  const ai = aiFor(apiKey);
  const model = ai.getGenerativeModel({
    model: modelId,
    ...(system ? { systemInstruction: system } : {}),
    generationConfig: { maxOutputTokens: maxTokens },
  });

  const result = await model.generateContentStream({
    contents: [{ role: 'user', parts: [{ text: input || '(no upstream input)' }] }],
  });

  let text = '';
  for await (const chunk of result.stream) {
    const t = chunk.text();
    if (t) {
      text += t;
      if (onText) onText(t);
    }
  }
  const final = await result.response;
  const usage = final.usageMetadata || {};

  return {
    text,
    usage: {
      input_tokens: usage.promptTokenCount || 0,
      output_tokens: usage.candidatesTokenCount || 0,
    },
    model: modelId,
  };
}
