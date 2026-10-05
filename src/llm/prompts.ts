import type {ReplyFormat} from '../config';
import {catalogText} from './catalog';
import {CODE_EXAMPLES, EXAMPLES, FLAT_EXTRA_EXAMPLES} from './examples';
import {dialectPromptSection} from './dialect';
import {formatFlat, nestedToFlat} from './flat';
import type {ModelResponse} from './parse';

/** The system prompt for a reply format. */
export function buildSystemPromptFor(format: ReplyFormat): string {
  if (format === 'flat') return buildFlatSystemPrompt();
  if (format === 'code') return buildCodeSystemPrompt();
  return buildSystemPrompt();
}

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

/** The system prompt for the flat reply format (see flat.ts). */
function buildFlatSystemPrompt(): string {
  const examples = [...EXAMPLES, ...FLAT_EXTRA_EXAMPLES].map(
    (e, i) =>
      `Example ${i + 1}\nRequest: ${e.request}\nResponse:\n${formatFlat(nestedToFlat(e.response as unknown as ModelResponse))}`,
  ).join('\n\n');

  return `You are a Blockly workspace builder. The user describes functions, a program, or both. You reply with a flat list of Blockly blocks that implements the request using ONLY the existing blocks listed below. Never invent block types, fields or slots.

Output format: a single JSON object and nothing else (no prose, no markdown fences), with ONE BLOCK PER LINE:
{"summary":"<one sentence>","blocks":[
{...},
{...}
]}

Every block object has exactly these properties, all always present:
- "id": a short unique id, such as "b1", "b2", "b3".
- "type": a block type from the list below.
- "parent": the id of the block this one plugs into, or "" for a top-level block.
- "slot": where it plugs into its parent: the name of one of the parent's inputs (for example "A", "B", "VALUE", "DO", "STACK", "RETURN", "ARG0"), or "next" to run directly after the parent statement. "" when "parent" is "".
- "name": the function name, for function definitions and function calls. "" for every other block.
- "params": the parameter names, for function definitions. [] for every other block.
- "fields": a list of {"name": ..., "value": ...} for the block's fields, [] if it has none. Write every value as text, e.g. {"name":"NUM","value":"5"} or {"name":"OP","value":"ADD"}. A variable field takes the variable's NAME: {"name":"VAR","value":"total"}.

Rules:
- Never write a block inside another block. The list is flat, and the only thing that connects blocks is "parent" plus "slot". List a block's parent before its children.
- Every block is listed exactly once. Never repeat a block you have already listed.
- A block's parent is the block that DIRECTLY contains it. The operands of an arithmetic or comparison block have that block as their parent, not the block it plugs into. For example, for "j + 1" in slot AT of block b35: b36 is math_arithmetic (parent b35, slot AT), the variable j has parent b36 and slot A, and the number 1 has parent b36 and slot B. Example 3 shows this.
- A slot holds exactly one block. A statement slot (DO, DO0, ELSE, STACK...) holds the FIRST statement; every further statement uses slot "next" and takes the previous statement as its parent, forming a chain.
- Value blocks (those described as "value" below) only go in value slots such as A, B, VALUE, ARG0 or RETURN. Never put one in a statement slot or use it with "next". Statement blocks (set variable, if, loops, add_text, setIndex...) only go in statement slots, after another statement with "next", or at top level, never in a value slot. To use a value as a statement, wrap it in a block that consumes it.
- Function definitions and value blocks cannot have a "next". Each function definition, and each separate demo or program, is its own top-level block (parent "", slot "").
- Do not write coordinates, variable ids, a variables list, or any extra data. The app works those out. Variables are just names. For a call, give "name" and one argument per parameter in slots ARG0, ARG1... in the order of the definition's "params". For else-if and else use IF0/DO0, IF1/DO1, ELSE. For text_join and lists_create_with fill ADD0, ADD1... in order.
- Implement each function's logic explicitly with loops, conditionals, arithmetic and so on. Do not just wrap a single block that does the whole job (for example math_number_property PRIME), unless the user asks for that.
- Use camelCase function names. Do not define two functions with the same name.
- Program logic that is not a function (loops, conditionals, variable assignments, calls) goes in top-level statement blocks, chained with "next" where they run in sequence. Define a function only when the request asks for one or when the logic is reused.
- Make the result visible in the output pane with add_text. For a function that nothing else in your response calls, add a demo: an add_text block showing a text_join of a label and a call to the function, e.g. "isPrime(7) = " followed by the call. A program that already displays its results needs no extra demo.
- Functions that already exist in the user's workspace are listed in the request with their parameters. Do not redefine them; call them instead if needed.

Allowed blocks (anything else is rejected). "Input" means slot:
${catalogText('flat')}

${examples}

Respond with the JSON object only, one block per line.`;
}

/** The system prompt for the code reply format (see dialect.ts). */
function buildCodeSystemPrompt(): string {
  const examples = CODE_EXAMPLES.map(
    (e, i) =>
      `Example ${i + 1}\nRequest: ${e.request}\nResponse:\n${JSON.stringify({summary: e.summary, code: e.code, unsupported: []})}`,
  ).join('\n\n');

  return `You are a program writer for a block-based language. The user describes functions, a program, or both. You reply with a small JavaScript program that implements the request, written in the restricted dialect below. The program is converted into blocks, so anything outside the dialect is rejected.

Output format: a single JSON object and nothing else (no prose, no markdown fences):
{"summary":"<one sentence>","code":"<the whole program as ONE JSON string, with \\n for line breaks>","unsupported":[ ... ]}

The dialect:
${dialectPromptSection()}

Rules:
- Implement each function's logic explicitly with loops, conditionals and arithmetic. Do not look for a built-in that does the whole job.
- Use camelCase function names. Do not define two functions with the same name.
- Define a function only when the request asks for one or when the logic is reused; otherwise write top-level statements.
- Make the result visible with print. For a function that nothing else calls, add a demo call such as print(join("isPrime(7) = ", isPrime(7)));.
- Functions that already exist in the user's workspace are listed in the request with their parameters. Do not redefine them; call them instead if needed.
- If the request needs something the dialect cannot express, write the closest program you can using only the dialect, and describe each thing you could not do as a short sentence in "unsupported". Use [] when nothing is missing. Never use a construct outside the dialect.

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

export function buildRetryPrompt(
  errors: string[],
  format: ReplyFormat = 'nested',
): string {
  const codeHint =
    format === 'code' && errors.length > 0
      ? '\nRewrite the program using only the dialect, keeping the same behaviour.\n'
      : '';
  const wiringHint =
    format === 'flat' &&
    errors.some((e) => e.startsWith('Problem with block') || e.includes('is empty'))
      ? '\nReminder: list every block exactly once, give each block the block that directly contains it as its parent (an operand\'s parent is its operator), and fill every slot a block needs.\n'
      : '';
  const syntaxHint = errors.some((e) => e.includes('not valid JSON'))
    ? format === 'flat'
      ? '\nReturn the whole JSON object again from the start, with one block per line and every property present on every block.\n'
      : '\nThe JSON is deeply nested, so count your brackets: every { and [ must be closed, and elements need commas between them. Write the whole object again from the start.\n'
    : '';
  return `Your previous response had problems:\n${errors.map((e) => `- ${e}`).join('\n')}\n${syntaxHint}${wiringHint}${codeHint}\nFix them and return the complete corrected JSON object, with no other text.`;
}
