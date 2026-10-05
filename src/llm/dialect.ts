/**
 * The code dialect: the small subset of JavaScript the model may write when it
 * is asked for code instead of blocks (reply format "code").
 *
 * This file is the single source of truth. The prompt's list of what is allowed
 * and what is not is generated from it, and the checker (codeCheck.ts) reads
 * the same sets, so what we tell the model matches what we accept.
 * codeToBlocks.ts translates what it accepts into blocks.
 *
 * Two deliberate departures from plain JavaScript, both matching Blockly:
 *  - lists are 1-based: list[1] is the first item (see toRunnable()),
 *  - text is built with join(a, b, ...), because blocks need to know whether
 *    "+" means adding numbers or joining text.
 */

/** Functions the dialect provides. Each corresponds to one existing block. */
export const DIALECT_FUNCTIONS = new Set(['print', 'join']);

/** Math.<name> functions that map to a Blockly math block. */
export const MATH_FUNCTIONS: Record<string, {args: number | 'many'}> = {
  abs: {args: 1},
  sqrt: {args: 1},
  pow: {args: 2},
  floor: {args: 1},
  ceil: {args: 1},
  round: {args: 1},
  sin: {args: 1},
  cos: {args: 1},
  tan: {args: 1},
  asin: {args: 1},
  acos: {args: 1},
  atan: {args: 1},
  log: {args: 1},
  exp: {args: 1},
  max: {args: 'many'},
  min: {args: 'many'},
};

export const MATH_CONSTANTS = new Set(['PI', 'E']);

/** Methods allowed on a value, with how many arguments they take. */
export const ALLOWED_METHODS: Record<string, {args: number; statement?: true}> = {
  push: {args: 1, statement: true},
  toUpperCase: {args: 0},
  toLowerCase: {args: 0},
  trim: {args: 0},
};

export const ALLOWED_BINARY = new Set([
  '+', '-', '*', '/', '%',
  '==', '!=', '===', '!==', '<', '<=', '>', '>=',
]);
export const ALLOWED_ASSIGN = new Set(['=', '+=', '-=', '*=', '/=']);
export const ALLOWED_LOGICAL = new Set(['&&', '||']);
export const ALLOWED_UNARY = new Set(['!', '-']);

/** What the model is told it can write. One bullet each. */
export const SUPPORTED: string[] = [
  'Functions: function name(a, b) { ... }, with plain parameter names. Functions are declared at the top level only (never inside another function).',
  'Variables: declare with var, e.g. var total = 0;. Do not use let or const. In blocks only function PARAMETERS are local; every other variable is shared by the whole program.',
  'Recursion: a function may call itself, but a function that calls itself (directly, or through other functions) must not declare any variable or loop counter with var. Use only its parameters, compute values inline, or call helper functions that take parameters. (A recursive call would overwrite such a variable.)',
  'Assignment: x = expr;, list[i] = expr;, and the compound forms +=, -=, *=, /=. Use i++ and i-- only as statements.',
  'Conditions: if (...) { ... } else if (...) { ... } else { ... }',
  'Counting loop: for (var i = 1; i <= n; i++) { ... }. One counter; the test compares that counter with <, <=, > or >=; the update is i++, i--, i += k or i -= k.',
  'while (...) { ... }, and for (var item of list) { ... } to visit every item of a list. break and continue work inside loops.',
  'return value; inside functions.',
  'Values: numbers, "text" in single or double quotes, true, false, null, and list literals such as [3, 1, 2].',
  'Operators: + - * / %  == != === !== < <= > >=  && || !  and unary minus; and the conditional c ? a : b.',
  'Positions start at 1, for lists AND for text. list[1] is the first item and list.length is the last position; text[1] is the first character and text.length is the last position. Never use position 0 or loops that start at 0. Read and write list items with list[i]; read a character with text[i]. Add an item at the end with list.push(x); (statement only).',
  'Text: text.length, text[i] (the i-th character, starting at 1), text.toUpperCase(), text.toLowerCase(), text.trim(). Build text with join(a, b, c); never with + or template strings.',
  'Math: Math.abs, Math.sqrt, Math.pow, Math.floor, Math.ceil, Math.round, Math.sin, Math.cos, Math.tan, Math.asin, Math.acos, Math.atan, Math.log, Math.exp, Math.max(a, b, ...), Math.min(a, b, ...), Math.PI, Math.E.',
  'Output: print(value); shows a value in the output pane. print(join("isPrime(7) = ", isPrime(7))); is the usual way to show a result.',
];

/**
 * What the model may not write, and what to do instead. Keyed by the same
 * construct keys the checker reports. The prompt lists the first group; every
 * key gives its message when the checker meets it.
 */
export const HINTS: Record<string, string> = {
  // Each hint finishes the sentence "<construct> is not available: <hint>."
  // statements and declarations
  'decl:let': 'declare variables with var',
  'decl:const': 'declare variables with var',
  'nested-function': 'declare functions at the top level, not inside other functions',
  ArrowFunctionExpression: 'use a named function declaration: function name(a) { ... }',
  FunctionExpression: 'use a named function declaration: function name(a) { ... }',
  ClassDeclaration: 'use functions and lists',
  ClassExpression: 'use functions and lists',
  ObjectExpression: 'use lists (for example two parallel lists instead of a dictionary)',
  ObjectPattern: 'use a temporary variable',
  ArrayPattern: 'use a temporary variable. To swap two items: var temp = list[i]; list[i] = list[j]; list[j] = temp;',
  AssignmentPattern: 'give parameters no default value; handle a missing value with an if',
  RestElement: 'declare the parameters you need explicitly',
  SpreadElement: 'use a loop and push',
  TemplateLiteral: 'use join(a, b, c)',
  TaggedTemplateExpression: 'use join(a, b, c)',
  TryStatement: 'check values with if instead',
  ThrowStatement: 'use return or print instead',
  SwitchStatement: 'use if / else if / else',
  DoWhileStatement: 'use a while loop',
  ForInStatement: 'use for (var item of list) or a counting loop',
  LabeledStatement: 'rewrite it without labels',
  WithStatement: 'rewrite it without with',
  NewExpression: 'call functions directly',
  ThisExpression: 'use plain functions',
  SequenceExpression: 'write separate statements',
  ChainExpression: 'check with an if first',
  AwaitExpression: 'write synchronous code',
  YieldExpression: 'write ordinary functions',
  ImportDeclaration: 'write everything in one script',
  ExportNamedDeclaration: 'write everything in one script',
  ExportDefaultDeclaration: 'write everything in one script',
  regex: 'use loops and comparisons',
  bigint: 'use ordinary numbers',
  'identifier:undefined': 'use null',
  'recursive-local': 'use only parameters here: compute values inline or pass them to helper functions. A variable meant to be shared by all calls belongs at the top of the program',
  'index-zero': 'positions start at 1: the first item or character is x[1]',
  'index-before-1': 'positions start at 1, so count from 1 and use [i], or shift the index so the first position is 1',
  'for:shape':
    'a for loop must be a counting loop: for (var i = start; i <= end; i++), with the test comparing the same counter with <, <=, > or >= and the update i++, i--, i += k or i -= k. Use while for anything else',
  'expression-statement': 'only assignments, i++ / i--, and calls can be statements',
  'update:member': 'i++ and i-- work on a plain variable only; write list[i] = list[i] + 1;',
  'update:in-expression': 'i++ and i-- can only be used as a statement',
  'assign:in-expression': 'an assignment can only be used as a statement',
  'assign:target': 'assign to a variable or a list item (x = ..., list[i] = ...)',
  'push:in-expression': 'push can only be used as a statement: list.push(x);',
  'print:in-expression': 'print can only be used as a statement: print(x);',
  'break-outside-loop': 'break and continue only work inside a loop',
  'return-outside-function': 'return only works inside a function',
  labeled: 'rewrite it without labels',
  'array-hole': 'give every list slot a value',
  'text+': 'build text with join(a, b, c); "+" is only for adding numbers',
  // operators
  'op:**': 'use Math.pow(a, b)',
  'op:&': 'use ordinary arithmetic',
  'op:|': 'use ordinary arithmetic',
  'op:^': 'use ordinary arithmetic',
  'op:<<': 'use multiplication',
  'op:>>': 'use division',
  'op:>>>': 'use division',
  'op:in': 'search with a loop',
  'op:instanceof': 'rewrite it without instanceof',
  'op:??': 'use an if or a conditional',
  'op:typeof': 'rewrite it without typeof',
  'op:void': 'rewrite it without void',
  'op:delete': 'rewrite it without delete',
  'op:~': 'use ordinary arithmetic',
  'op:+unary': 'write the value without a unary plus',
  'op:%=': 'write x = x % y;',
  'op:**=': 'write x = Math.pow(x, y);',
  // methods and calls
  'method:sort': 'implement the sorting yourself with loops',
  'method:map': 'use a loop',
  'method:filter': 'use a loop and push',
  'method:reduce': 'use a loop',
  'method:forEach': 'use for (var item of list) { ... }',
  'method:slice': 'build the new list with a loop and push',
  'method:splice': 'build the new list with a loop and push',
  'method:concat': 'build the new list with a loop and push',
  'method:indexOf': 'search with a loop',
  'method:includes': 'search with a loop',
  'method:join': 'use a loop and join(a, b, ...)',
  'method:pop': 'build a shorter list with a loop and push',
  'method:shift': 'build a shorter list with a loop and push',
  'method:unshift': 'build the list with a loop and push',
  'method:reverse': 'reverse it with a loop',
  'method:charAt': 'read a character with text[i] (positions start at 1)',
  'method:substring': 'build the piece with a loop over text[i] and join',
  'method:substr': 'build the piece with a loop over text[i] and join',
  'method:split': 'walk through the text with a loop over text[i]',
  'method:replace': 'build the new text with a loop over text[i] and join',
  'method:toString': 'use join(x)',
  'method:log': 'use print(x)',
  'call:parseInt': 'numbers and text are not converted',
  'call:parseFloat': 'numbers and text are not converted',
  'call:String': 'use join(x)',
  'call:Number': 'numbers and text are not converted',
  'call:Array': 'write a list literal like [1, 2, 3]',
  'call:expression': 'call named functions only',
  'math:random': 'randomness is not supported',
  'math:trunc': 'use Math.floor (or Math.ceil for negative numbers)',
  'math:sign': 'write the comparison yourself',
  'math:log10': 'use Math.log',
};

/** Fallback when a construct has no specific entry in HINTS. */
export const GENERIC_HINT = 'this is not available in the dialect';

/** The prompt's description of the dialect, generated from this file. */
export function dialectPromptSection(): string {
  const supported = SUPPORTED.map((s) => `- ${s}`).join('\n');
  const notAvailable = [
    'let and const; arrow functions and function expressions; classes; objects and dictionaries; destructuring; template strings; regular expressions',
    'switch, do...while, for...in, try/catch, labels, async code, modules',
    'bitwise operators, **, ??, typeof, ++ / -- inside expressions',
    'list and text methods other than the ones above: sort, map, filter, reduce, forEach, slice, splice, concat, indexOf, includes, pop, shift, join, split, charAt, substring, replace (use text[i] and loops instead)',
    'console.log, parseInt, parseFloat, String, Number, Math.random',
  ]
    .map((s) => `- ${s}`)
    .join('\n');
  return `Supported:\n${supported}\n\nNot available (the program is rejected if it uses any of these; write the equivalent with what is supported):\n${notAvailable}`;
}
