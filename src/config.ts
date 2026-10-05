/** OpenRouter model slug used for all generation requests. */
export const MODEL = "z-ai/glm-5.3-flash";
// export const MODEL = "anthropic/claude-haiku-4.5";
//export const MODEL = "anthropic/claude-sonnet-5.5";
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** How many times to ask the model before giving up. */
export const MAX_ATTEMPTS = 3;

/** Cap on the model's reply, so a large workspace is not cut off mid-JSON. */
export const MAX_TOKENS = 16000;

/**
 * Reasoning models can spend the whole token budget thinking and return no
 * answer. Keep their reasoning short so the budget is left for the JSON.
 */
export const REASONING_EFFORT = "low";

/** Give up on a single request after this long, rather than hanging. */
export const REQUEST_TIMEOUT_MS = 120_000;

/** First attempt is near-deterministic; retries are warmer so they do not repeat the same mistake. */
export const FIRST_TEMPERATURE = 0.2;
export const RETRY_TEMPERATURE = 0.7;

/**
 * How to ask the provider for well-formed JSON:
 *   'json_schema' - structured output with RESPONSE_SCHEMA (best, if supported)
 *   'json_object' - "reply with some JSON object" (widely supported)
 *   'none'        - no constraint; rely on the prompt and the parser
 * If requests fail with an error about response_format, try a weaker mode.
 *
 * Anthropic's structured output rejects recursive schemas ("Circular
 * reference detected ... block -> block"), and RESPONSE_SCHEMA is recursive
 * because blocks nest. So Anthropic models get no constraint here.
 */
export type ResponseFormat = "json_schema" | "json_object" | "none";

export function responseFormatFor(model: string): ResponseFormat {
  return model.startsWith("anthropic/") ? "none" : "json_schema";
}

export const RESPONSE_FORMAT: ResponseFormat = responseFormatFor(MODEL);

/**
 * How the model describes the workspace it wants:
 *   'nested' - Blockly's own JSON, with blocks written inside their parents.
 *              Needs the model to close long runs of braces correctly.
 *   'flat'   - a flat list of blocks that say which block they plug into; the
 *              app builds the nesting and derives variable ids and mutation
 *              data. Much easier for smaller models (see src/llm/flat.ts).
 *   'code'   - a program in a small JavaScript dialect (src/llm/dialect.ts).
 *              It is checked, translated into blocks (src/llm/codeToBlocks.ts)
 *              and validated like the others. About 5x faster and 6 to 10x
 *              cheaper than flat or nested on the models that fail the
 *              block formats, but it can only express what the dialect covers.
 * Anthropic models cope with nested (code is only ~1.7x faster for them, and
 * nested can use any block), so they keep it; everything else gets code.
 * Flat remains available (--reply-format flat, or the replyFormat option).
 */
export type ReplyFormat = "nested" | "flat" | "code";

export function replyFormatFor(model: string): ReplyFormat {
  return model.startsWith("anthropic/") ? "nested" : "code";
}

export const REPLY_FORMAT: ReplyFormat = replyFormatFor(MODEL);
