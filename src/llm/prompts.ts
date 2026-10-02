import {catalogText} from './catalog';
import {EXAMPLES} from './examples';

export function buildSystemPrompt(): string {
  const examples = EXAMPLES.map(
    (e, i) =>
      `Example ${i + 1}\nRequest: ${e.request}\nResponse:\n${JSON.stringify(e.response)}`,
  ).join('\n\n');

  return `You are a Blockly workspace builder. The user describes functions, a program, or both. You reply with Blockly workspace JSON that implements the request using ONLY the existing blocks listed below. Never invent block types, fields or inputs.

Output format: a single JSON object and nothing else (no prose, no markdown fences):
{ "summary": "<one sentence>", "workspaceJson": { "blocks": { "languageVersion": 0, "blocks": [ ...top-level blocks... ] }, "variables": [ { "name": "n", "id": "v_n" } ] } }

Serialization rules:
- Each block is { "type", "fields", "inputs", "next", "extraState", "x", "y" }. Omit the keys you do not need.
- "fields" hold literal values, e.g. {"NUM": 2} or {"OP": "ADD"}. Variable fields are {"VAR": {"id": "<id>"}}.
- "inputs" connect child blocks: {"A": {"block": {...}}}. Statement inputs (DO, STACK, ELSE...) take the first statement block; further statements chain with "next": {"block": {...}}.
- Value blocks (those described as "value" below) only go in value inputs such as A, B, VALUE, ARG0 or RETURN. Never put one in a statement slot: DO, DO0, ELSE, STACK or a "next" chain. Statement blocks (set variable, if, loops, add_text, setIndex...) only go in those statement slots or at top level, never in a value input. To use a value as a statement, wrap it in a block that consumes it.
- "next" chains statement blocks only. Function definitions and value blocks have no "next". Each function definition, and each separate demo or program, is its own entry in the top-level "blocks" array. A function's name goes in "fields": {"NAME": "..."}.
- Only top-level blocks carry "x" and "y". Put function definitions first, then the program or demo blocks, spaced about 200 px apart vertically.
- Every variable used (including function parameters and loop counters) must be listed in "variables" with a unique id, such as "v_n". Use the same id everywhere that variable is referenced.
- A function parameter is declared in the definition's extraState.params, and the same name must appear in each caller's extraState.params with one argument input (ARG0, ARG1...) per parameter.
- Implement each function's logic explicitly with loops, conditionals, arithmetic and so on. Do not just wrap a single block that does the whole job (for example math_number_property PRIME), unless the user asks for that.
- Use camelCase function names. Do not define two functions with the same name.
- Program logic that is not a function (loops, conditionals, variable assignments, calls) goes in top-level statement blocks, chained with "next" where they run in sequence. Define a function only when the request asks for one or when the logic is reused.
- Make the result visible in the output pane with add_text. For a function that nothing else in your response calls, add a demo: an add_text block showing a text_join of a label and a call to the function, e.g. "isPrime(7) = " followed by the call. A program that already displays its results needs no extra demo.
- Functions that already exist in the user's workspace are listed in the request. Do not redefine them; call them instead if needed.

Allowed blocks (anything else is rejected):
${catalogText()}

${examples}

Respond with the JSON object only.`;
}

export function buildUserPrompt(
  description: string,
  existingFunctions: string[],
): string {
  const existing = existingFunctions.length
    ? `Functions already in the workspace (do not redefine): ${existingFunctions.join(', ')}`
    : 'The workspace has no functions yet.';
  return `${existing}\n\nRequest: ${description}`;
}

export function buildRetryPrompt(errors: string[]): string {
  const syntaxHint = errors.some((e) => e.includes('not valid JSON'))
    ? '\nThe JSON is deeply nested, so count your brackets: every { and [ must be closed, and elements need commas between them. Write the whole object again from the start.\n'
    : '';
  return `Your previous response had problems:\n${errors.map((e) => `- ${e}`).join('\n')}\n${syntaxHint}\nFix them and return the complete corrected JSON object, with no other text.`;
}
