import {
  MAX_TOKENS,
  MODEL,
  OPENROUTER_URL,
  REASONING_EFFORT,
  REQUEST_TIMEOUT_MS,
} from '../config';
import {log} from '../log';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Characters received so far, split by what the model is doing. */
export interface Progress {
  reasoning: number;
  content: number;
}

/**
 * Sends a streaming chat completion request straight from the browser and
 * returns the full reply text. `onProgress` fires as chunks arrive, so callers
 * can show that the model is working. The request is aborted if no data
 * arrives for REQUEST_TIMEOUT_MS.
 */
export async function chat(
  messages: ChatMessage[],
  apiKey: string,
  onProgress?: (progress: Progress) => void,
): Promise<string> {
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
  };

  const started = performance.now();
  const sinceStart = () =>
    `${((performance.now() - started) / 1000).toFixed(1)}s`;
  const promptChars = messages.reduce((n, m) => n + m.content.length, 0);
  log(
    `request: model=${MODEL}, ${messages.length} messages, ${promptChars} chars`,
  );

  const progress: Progress = {reasoning: 0, content: 0};
  let text = '';
  let finishReason: string | null = null;
  let firstChunk = true;

  resetIdle();
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.2,
        max_tokens: MAX_TOKENS,
        reasoning: {effort: REASONING_EFFORT},
        stream: true,
      }),
      signal: controller.signal,
    });
    log(`response headers after ${sinceStart()}: HTTP ${response.status}`);
    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenRouter ${response.status}: ${body.slice(0, 300)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      resetIdle();
      buffer += decoder.decode(value, {stream: true});

      // Server-sent events: one "data: {json}" line per chunk. Lines that
      // start with ":" are keep-alive comments and only reset the idle timer.
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        const chunk = JSON.parse(payload);
        if (chunk.error) {
          throw new Error(
            `OpenRouter error: ${JSON.stringify(chunk.error).slice(0, 300)}`,
          );
        }
        const choice = chunk.choices?.[0];
        const delta = choice?.delta ?? {};
        const reasoning = delta.reasoning ?? delta.reasoning_content ?? '';
        if (typeof reasoning === 'string') {
          progress.reasoning += reasoning.length;
        }
        if (typeof delta.content === 'string') {
          text += delta.content;
          progress.content += delta.content.length;
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (firstChunk) {
          firstChunk = false;
          log(`first data after ${sinceStart()}`);
        }
        onProgress?.({...progress});
      }
    }
  } catch (e) {
    if (timedOut) {
      throw new Error(
        `No data from the model for ${REQUEST_TIMEOUT_MS / 1000}s; gave up. Try a smaller request.`,
      );
    }
    throw e;
  } finally {
    clearTimeout(idleTimer);
  }

  log(
    `done after ${sinceStart()}: finish_reason=${finishReason}, reasoning=${progress.reasoning} chars, content=${progress.content} chars`,
  );
  if (!text) {
    if (finishReason === 'length') {
      throw new Error(
        `The model ran out of tokens (${MAX_TOKENS}) before writing an answer, most likely while reasoning. Try a smaller request.`,
      );
    }
    throw new Error(
      `OpenRouter returned no content (finish_reason: ${finishReason}).`,
    );
  }
  return text;
}
