import * as Blockly from 'blockly/core';
import {appendResponse, functionNames} from './append';
import {MAX_ATTEMPTS} from './config';
import {log} from './log';
import {chat, ChatMessage, Progress} from './llm/openrouter';
import {parseResponse} from './llm/parse';
import {
  buildRetryPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from './llm/prompts';
import {validate} from './llm/validate';

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
): Promise<string> {
  const messages: ChatMessage[] = [
    {role: 'system', content: buildSystemPrompt()},
    {role: 'user', content: buildUserPrompt(description, functionNames(ws))},
  ];

  let lastErrors: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const label =
      attempt === 1
        ? 'Asking the model'
        : `Retrying (${attempt}/${MAX_ATTEMPTS})`;
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
    try {
      reply = await chat(messages, apiKey, (p) => (progress = p));
    } finally {
      clearInterval(timer);
    }

    let errors: string[];
    try {
      const response = parseResponse(reply);
      errors = validate(response, ws);
      if (errors.length === 0) {
        appendResponse(ws, response);
        log('validated and appended to the workspace');
        return response.summary ?? 'Done.';
      }
    } catch (e) {
      errors = [
        `The reply was not valid JSON (${e instanceof Error ? e.message : e}).`,
      ];
    }

    lastErrors = errors;
    log(`attempt ${attempt} rejected: ${errors.join(' | ')}`);
    console.warn(`Attempt ${attempt} failed:`, errors, reply);
    messages.push(
      {role: 'assistant', content: reply},
      {role: 'user', content: buildRetryPrompt(errors)},
    );
  }
  throw new Error(
    `Gave up after ${MAX_ATTEMPTS} attempts. Last problems: ${lastErrors.join(' ')}`,
  );
}
