import * as Blockly from 'blockly/core';
import {
  appendResponse,
  functionInfos,
  functionNames,
  functionSignatures,
} from './append';
import {
  FIRST_TEMPERATURE,
  MAX_ATTEMPTS,
  MODEL,
  replyFormatFor,
  RETRY_TEMPERATURE,
} from './config';
import type {ReplyFormat, ResponseFormat} from './config';
import {log} from './log';
import {chat, ChatError} from './llm/openrouter';
import type {
  ChatMessage,
  ChatStats,
  Progress,
  ProviderPreferences,
} from './llm/openrouter';
import {checkCodeReply} from './llm/codeReply';
import type {CodeAttemptInfo} from './llm/codeReply';
import {messagesAboutCode, translateCode, TranslateError} from './llm/codeToBlocks';
import {buildFromFlat} from './llm/flat';
import {parseJsonLoose} from './llm/parse';
import type {ModelResponse} from './llm/parse';
import {
  buildRetryPrompt,
  buildSystemPromptFor,
  buildUserPrompt,
} from './llm/prompts';
import {validate} from './llm/validate';

/** What happened in one attempt, for callers that want to inspect the run. */
export interface AttemptTrace {
  attempt: number;
  temperature: number;
  /**
   * accepted: validated and appended to the workspace.
   * rejected: the model replied but the reply failed parsing or validation.
   * request-error: no usable reply (HTTP error, timeout, out of tokens...).
   */
  outcome: 'accepted' | 'rejected' | 'request-error';
  errors: string[];
  /** The model's raw reply; null for request errors. */
  reply: string | null;
  stats: ChatStats | null;
  /** The parsed reply, for accepted attempts (nested and flat formats). */
  response?: ModelResponse;
  /** The program and construct counts (code format only). */
  code?: CodeAttemptInfo;
}

export interface GenerateOptions {
  /** Overrides the configured model. */
  model?: string;
  /** Overrides the response format normally chosen for the model. */
  responseFormat?: ResponseFormat;
  /** Overrides the reply format (nested or flat) normally chosen for the model. */
  replyFormat?: ReplyFormat;
  /** OpenRouter provider routing preferences; omit for the app's default. */
  provider?: ProviderPreferences;
  /**
   * Called after every attempt. If it throws, generation stops with that
   * error (the benchmark uses this to enforce its spending cap).
   */
  onAttempt?: (trace: AttemptTrace) => void;
}

/**
 * Asks the model for blocks implementing `description` and appends them to the
 * workspace. Retries with the validation errors on failure; the workspace is
 * only touched once a response has passed validation. Returns the model's
 * one-sentence summary.
 */
export async function generate(
  description: string,
  apiKey: string,
  ws: Blockly.Workspace,
  onStatus: (message: string) => void,
  options: GenerateOptions = {},
): Promise<string> {
  const replyFormat =
    options.replyFormat ?? replyFormatFor(options.model ?? MODEL);
  // Flat and code replies need the existing functions' parameters to call them.
  const existing =
    replyFormat !== 'nested'
      ? [...functionSignatures(ws)].map(
          ([name, params]) => `${name}(${params.join(', ')})`,
        )
      : functionNames(ws);
  const messages: ChatMessage[] = [
    {role: 'system', content: buildSystemPromptFor(replyFormat)},
    {role: 'user', content: buildUserPrompt(description, existing)},
  ];

  let lastErrors: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const label =
      attempt === 1
        ? 'Asking the model'
        : `Retrying (${attempt}/${MAX_ATTEMPTS})`;
    const temperature = attempt === 1 ? FIRST_TEMPERATURE : RETRY_TEMPERATURE;
    // Show elapsed time so a slow request is visibly still running.
    const started = Date.now();
    let progress: Progress = {reasoning: 0, content: 0};
    const tick = () => {
      const seconds = Math.round((Date.now() - started) / 1000);
      const phase = progress.content
        ? `writing, ${progress.content} chars`
        : progress.reasoning
          ? `thinking, ${progress.reasoning} chars`
          : 'waiting for first data';
      onStatus(`${label}... ${seconds}s (${phase})`);
    };
    log(`${label} (attempt ${attempt}/${MAX_ATTEMPTS})`);
    tick();
    const timer = setInterval(tick, 1000);
    let reply: string;
    let stats: ChatStats;
    try {
      ({text: reply, stats} = await chat(messages, apiKey, {
        model: options.model,
        responseFormat: options.responseFormat,
        replyFormat,
        provider: options.provider,
        temperature,
        onProgress: (p) => (progress = p),
      }));
    } catch (e) {
      options.onAttempt?.({
        attempt,
        temperature,
        outcome: 'request-error',
        errors: [e instanceof Error ? e.message : String(e)],
        reply: null,
        stats: e instanceof ChatError ? e.stats : null,
      });
      throw e;
    } finally {
      clearInterval(timer);
    }

    let errors: string[];
    let response: ModelResponse | undefined;
    let codeInfo: CodeAttemptInfo | undefined;
    try {
      const parsed = parseJsonLoose(reply);
      if (replyFormat === 'code') {
        const checked = checkCodeReply(parsed, functionNames(ws));
        codeInfo = checked.info ?? undefined;
        errors = checked.errors;
        if (codeInfo && errors.length === 0) {
          // The program is inside the dialect: turn it into blocks.
          ({response, errors} = blocksFromCode(codeInfo.code, checked.summary, ws));
        }
      } else if (replyFormat === 'flat') {
        // Build the nested form first; its problems are reported by block id.
        const built = buildFromFlat(parsed, functionSignatures(ws));
        response = built.response ?? undefined;
        errors = response ? validate(response, ws) : built.errors;
      } else {
        response = parsed as ModelResponse;
        errors = validate(response, ws);
      }
    } catch (e) {
      response = undefined;
      errors = [
        `The reply was not valid JSON (${e instanceof Error ? e.message : e}).`,
      ];
    }

    if (response && errors.length === 0) {
      try {
        appendResponse(ws, response);
      } catch (e) {
        errors = [
          `Could not add the blocks to the workspace: ${e instanceof Error ? e.message : e}`,
        ];
      }
    }
    if (response && errors.length === 0) {
      log('validated and appended to the workspace');
      options.onAttempt?.({
        attempt,
        temperature,
        outcome: 'accepted',
        errors: [],
        reply,
        stats,
        response,
        code: codeInfo,
      });
      return response.summary ?? 'Done.';
    }

    lastErrors = errors;
    log(`attempt ${attempt} rejected: ${errors.join(' | ')}`);
    console.warn(`Attempt ${attempt} failed:`, errors, reply);
    options.onAttempt?.({
      attempt,
      temperature,
      outcome: 'rejected',
      errors,
      reply,
      stats,
      code: codeInfo,
    });
    messages.push(
      {role: 'assistant', content: reply},
      {role: 'user', content: buildRetryPrompt(errors, replyFormat)},
    );
  }
  throw new Error(
    `Gave up after ${MAX_ATTEMPTS} attempts. Last problems: ${lastErrors.join(' ')}`,
  );
}

/**
 * Code format: translates a program that passed the dialect check into blocks
 * and validates them. Problems are worded about the model's code (by line),
 * because the model wrote code and has never seen the blocks.
 */
function blocksFromCode(
  code: string,
  summary: string | undefined,
  ws: Blockly.Workspace,
): {response?: ModelResponse; errors: string[]} {
  try {
    const {blocks, lineOf} = translateCode(code, functionInfos(ws));
    const built = buildFromFlat({summary, blocks}, functionSignatures(ws));
    if (!built.response) {
      return {errors: messagesAboutCode(built.errors, lineOf)};
    }
    const errors = messagesAboutCode(validate(built.response, ws), lineOf);
    return {response: errors.length ? undefined : built.response, errors};
  } catch (e) {
    if (e instanceof TranslateError) return {errors: [e.message]};
    throw e;
  }
}
