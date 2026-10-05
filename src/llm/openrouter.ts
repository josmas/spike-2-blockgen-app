import {
  MAX_TOKENS,
  MODEL,
  OPENROUTER_URL,
  REASONING_EFFORT,
  REQUEST_TIMEOUT_MS,
  replyFormatFor,
  responseFormatFor,
} from '../config';
import type {ReplyFormat, ResponseFormat} from '../config';
import {log} from '../log';
import {
  CODE_RESPONSE_SCHEMA,
  FLAT_RESPONSE_SCHEMA,
  RESPONSE_SCHEMA,
} from './schema';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Characters received so far, split by what the model is doing. */
export interface Progress {
  reasoning: number;
  content: number;
}

/** Token counts and cost as reported by OpenRouter (null when not reported). */
export interface Usage {
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  /** Credits charged for the request, in USD. */
  cost: number | null;
}

/** What one request looked like from the outside. Also attached to errors. */
export interface ChatStats {
  /** Milliseconds until the first streamed chunk, or null if none arrived. */
  firstDataMs: number | null;
  totalMs: number;
  reasoningChars: number;
  contentChars: number;
  finishReason: string | null;
  usage: Usage | null;
  /** The provider OpenRouter routed the request to, as it reports it. */
  provider: string | null;
}

/** An error that still knows what the request cost and how long it took. */
export class ChatError extends Error {
  stats: ChatStats;
  constructor(message: string, stats: ChatStats) {
    super(message);
    this.name = 'ChatError';
    this.stats = stats;
  }
}

/** OpenRouter provider routing preferences. */
export interface ProviderPreferences {
  /** Only route to providers that support every field in the request. */
  require_parameters?: boolean;
  /** Allow OpenRouter to retry on another provider after an error. */
  allow_fallbacks?: boolean;
}

export interface ChatOptions {
  /** Defaults to the app's configured MODEL. */
  model?: string;
  /** Defaults to the format the app uses for that model. */
  responseFormat?: ResponseFormat;
  /** Which reply format the prompt asks for; picks the matching schema. */
  replyFormat?: ReplyFormat;
  temperature?: number;
  /** Omit to use OpenRouter's default routing, which is what the app does. */
  provider?: ProviderPreferences;
  onProgress?: (progress: Progress) => void;
}

/** The response_format request field for a mode. */
function responseFormatField(
  mode: ResponseFormat,
  reply: ReplyFormat,
): Record<string, unknown> {
  switch (mode) {
    case 'json_schema':
      return {
        response_format: {
          type: 'json_schema',
          json_schema: {
            name:
              reply === 'flat'
                ? 'blockly_flat_blocks'
                : reply === 'code'
                  ? 'blockly_code_program'
                  : 'blockly_workspace',
            schema:
              reply === 'flat'
                ? FLAT_RESPONSE_SCHEMA
                : reply === 'code'
                  ? CODE_RESPONSE_SCHEMA
                  : RESPONSE_SCHEMA,
          },
        },
      };
    case 'json_object':
      return {response_format: {type: 'json_object'}};
    default:
      return {};
  }
}

/**
 * Sends a streaming chat completion request straight from the browser and
 * returns the full reply text with request stats. `onProgress` fires as chunks
 * arrive, so callers can show that the model is working. The request is
 * aborted if no data arrives for REQUEST_TIMEOUT_MS.
 */
export async function chat(
  messages: ChatMessage[],
  apiKey: string,
  options: ChatOptions = {},
): Promise<{text: string; stats: ChatStats}> {
  const model = options.model ?? MODEL;
  const format = options.responseFormat ?? responseFormatFor(model);
  const reply = options.replyFormat ?? replyFormatFor(model);
  const temperature = options.temperature ?? 0.2;

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
  const elapsedMs = () => performance.now() - started;
  const sinceStart = () => `${(elapsedMs() / 1000).toFixed(1)}s`;
  const promptChars = messages.reduce((n, m) => n + m.content.length, 0);
  log(
    `request: model=${model}, ${messages.length} messages, ${promptChars} chars, temperature=${temperature}, format=${format}, reply=${reply}${options.provider ? `, provider=${JSON.stringify(options.provider)}` : ''}`,
  );

  const progress: Progress = {reasoning: 0, content: 0};
  let text = '';
  let finishReason: string | null = null;
  let firstDataMs: number | null = null;
  let usage: Usage | null = null;
  let provider: string | null = null;
  const stats = (): ChatStats => ({
    firstDataMs,
    totalMs: elapsedMs(),
    reasoningChars: progress.reasoning,
    contentChars: progress.content,
    finishReason,
    usage,
    provider,
  });

  resetIdle();
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: MAX_TOKENS,
        reasoning: {effort: REASONING_EFFORT},
        stream: true,
        // Asks for token counts and cost in the final stream chunk.
        usage: {include: true},
        ...responseFormatField(format, reply),
        ...(options.provider ? {provider: options.provider} : {}),
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
        if (typeof chunk.provider === 'string') provider = chunk.provider;
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens ?? null,
            completionTokens: chunk.usage.completion_tokens ?? null,
            reasoningTokens:
              chunk.usage.completion_tokens_details?.reasoning_tokens ?? null,
            cost: typeof chunk.usage.cost === 'number' ? chunk.usage.cost : null,
          };
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
        if (firstDataMs === null && choice) {
          firstDataMs = elapsedMs();
          log(`first data after ${sinceStart()}`);
        }
        options.onProgress?.({...progress});
      }
    }
  } catch (e) {
    const message = timedOut
      ? `No data from the model for ${REQUEST_TIMEOUT_MS / 1000}s; gave up. Try a smaller request.`
      : e instanceof Error
        ? e.message
        : String(e);
    throw new ChatError(message, stats());
  } finally {
    clearTimeout(idleTimer);
  }

  log(
    `done after ${sinceStart()}: finish_reason=${finishReason}, reasoning=${progress.reasoning} chars, content=${progress.content} chars`,
  );
  if (!text) {
    throw new ChatError(
      finishReason === 'length'
        ? `The model ran out of tokens (${MAX_TOKENS}) before writing an answer, most likely while reasoning. Try a smaller request.`
        : `OpenRouter returned no content (finish_reason: ${finishReason}).`,
      stats(),
    );
  }
  return {text, stats: stats()};
}
