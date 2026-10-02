import {MODEL, OPENROUTER_URL} from '../config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Sends a chat completion request straight from the browser; returns the reply text. */
export async function chat(
  messages: ChatMessage[],
  apiKey: string,
): Promise<string> {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({model: MODEL, messages, temperature: 0.2}),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenRouter ${response.status}: ${body.slice(0, 300)}`);
  }
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text) {
    throw new Error(
      `OpenRouter returned no content: ${JSON.stringify(data).slice(0, 300)}`,
    );
  }
  return text;
}
