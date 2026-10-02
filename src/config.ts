/** OpenRouter model slug used for all generation requests. */
export const MODEL = 'z-ai/glm-5.3-flash';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** How many times to ask the model before giving up. */
export const MAX_ATTEMPTS = 3;

/** Cap on the model's reply, so a large workspace is not cut off mid-JSON. */
export const MAX_TOKENS = 16000;

/**
 * Reasoning models can spend the whole token budget thinking and return no
 * answer. Keep their reasoning short so the budget is left for the JSON.
 */
export const REASONING_EFFORT = 'low';

/** Give up on a single request after this long, rather than hanging. */
export const REQUEST_TIMEOUT_MS = 120_000;
