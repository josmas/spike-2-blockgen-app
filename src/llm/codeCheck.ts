/**
 * Checks a model's code against the dialect (dialect.ts).
 *
 * The first step of the "code" reply format (codeToBlocks.ts translates what
 * passes). Every problem is reported with its line, and every construct
 * (supported or not) is counted, so a benchmark can show which missing idioms
 * are worth supporting.
 */
import * as acorn from 'acorn';
import {
  ALLOWED_ASSIGN,
  ALLOWED_BINARY,
  ALLOWED_LOGICAL,
  ALLOWED_METHODS,
  ALLOWED_UNARY,
  DIALECT_FUNCTIONS,
  GENERIC_HINT,
  HINTS,
  MATH_CONSTANTS,
  MATH_FUNCTIONS,
} from './dialect';

type N = Record<string, any>;

export interface CodeViolation {
  /** Stable construct key, e.g. "ArrowFunctionExpression", "op:**", "method:sort". */
  key: string;
  line: number;
  column: number;
  /** A message for the model, starting with the line number. */
  message: string;
}

export interface CodeCheckResult {
  ok: boolean;
  violations: CodeViolation[];
  /**
   * How often each construct appeared. Unsupported ones use their violation
   * key; supported ones are prefixed "ok:" (e.g. "ok:for", "ok:math:max").
   */
  constructs: Record<string, number>;
}

interface Ctx {
  inFunction: boolean;
  loopDepth: number;
  /** Set inside a function that calls itself: its name and its parameters. */
  recursive?: {name: string; params: Set<string>; found: Map<string, N>};
}

/** Messages shown to the model are capped; every violation is still counted. */
const MAX_MESSAGES = 10;

export function checkCode(
  code: string,
  knownFunctions: Iterable<string> = [],
): CodeCheckResult {
  const violations: CodeViolation[] = [];
  const constructs: Record<string, number> = {};
  const count = (key: string) => {
    constructs[key] = (constructs[key] ?? 0) + 1;
  };

  // Inside a rejected class everything gets rewritten, so its contents are
  // not reported (they would only inflate the counts).
  let quiet = 0;

  const report = (node: N, key: string, text: string) => {
    if (quiet > 0) return;
    const line = node.loc?.start.line ?? 0;
    violations.push({
      key,
      line,
      column: (node.loc?.start.column ?? 0) + 1,
      message: `Line ${line}: ${text}`,
    });
    count(key);
  };
  /** "<what> is not available: <hint>." */
  const bad = (node: N, key: string, what: string, hint?: string) => {
    const h =
      hint ??
      HINTS[key] ??
      (key.startsWith('prop:')
        ? 'only .length is available as a property; read list items with list[i]'
        : GENERIC_HINT);
    report(node, key, `${what} is not available: ${h}.`);
  };

  let program: N;
  try {
    program = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
    }) as N;
  } catch (e) {
    const err = e as {loc?: {line: number; column: number}; message: string};
    const line = err.loc?.line ?? 0;
    violations.push({
      key: 'syntax-error',
      line,
      column: (err.loc?.column ?? 0) + 1,
      message: `Line ${line}: syntax error: ${err.message.replace(/ \(\d+:\d+\)$/, '')}.`,
    });
    count('syntax-error');
    return {ok: false, violations, constructs};
  }

  const known = new Set<string>(knownFunctions);
  const declared = new Map<string, N>();
  for (const n of program.body as N[]) {
    if (n.type === 'FunctionDeclaration' && n.id) {
      known.add(n.id.name);
      declared.set(n.id.name, n);
    }
  }
  const recursiveFunctions = findRecursive(declared);

  // ---- helpers -----------------------------------------------------------

  /** A text literal. "+" with one cannot be told apart from joining text. */
  const isText = (n: N): boolean =>
    n.type === 'Literal' && typeof n.value === 'string';

  /** Visits the children of a construct we reject, so nested problems show too. */
  const descend = (rawCtx: Ctx, n: N) => {
    // We are inside something already rejected: a `return` in an arrow function
    // body is not "outside a function", and a `break` is not "outside a loop".
    const ctx: Ctx = {inFunction: true, loopDepth: rawCtx.loopDepth + 1};
    const isClass = n.type === 'ClassDeclaration' || n.type === 'ClassExpression';
    if (isClass) quiet++;
    for (const [k, v] of Object.entries(n)) {
      if (k === 'loc' || k === 'type') continue;
      for (const c of Array.isArray(v) ? v : [v]) {
        if (!c || typeof c !== 'object' || typeof c.type !== 'string') continue;
        if (/(Statement|Declaration)$/.test(c.type)) stmt(c, ctx);
        else expr(c, ctx, false);
      }
    }
    if (isClass) quiet--;
  };

  const varDecl = (n: N, ctx: Ctx, allowInit = true) => {
    if (n.kind !== 'var') bad(n, `decl:${n.kind}`, `"${n.kind}"`);
    else count('ok:var');
    for (const d of n.declarations as N[]) {
      if (d.id.type !== 'Identifier') {
        bad(d.id, d.id.type, 'destructuring');
      } else if (ctx.recursive && !ctx.recursive.params.has(d.id.name)) {
        // Blocks have no local variables: only parameters are local. A
        // recursive call would overwrite this variable. Reported once per
        // function, when the function ends (see fn()).
        if (!ctx.recursive.found.has(d.id.name)) ctx.recursive.found.set(d.id.name, d);
      } else if (
        d.init?.type === 'ArrowFunctionExpression' ||
        d.init?.type === 'FunctionExpression'
      ) {
        // Already reported as a function expression; do not also report every
        // later call to it as an undefined function.
        known.add(d.id.name);
      }
      if (d.init && allowInit) expr(d.init, ctx, false);
    }
  };

  const fn = (n: N, ctx: Ctx) => {
    if (ctx.inFunction) {
      bad(n, 'nested-function', 'a function declared inside another function');
      if (n.id) known.add(n.id.name);
    }
    if (n.async) bad(n, 'AwaitExpression', 'an async function');
    if (n.generator) bad(n, 'YieldExpression', 'a generator function');
    count('ok:function');
    for (const p of n.params as N[]) {
      if (p.type === 'AssignmentPattern') bad(p, 'AssignmentPattern', 'a default parameter value');
      else if (p.type === 'RestElement') bad(p, 'RestElement', 'a rest parameter');
      else if (p.type !== 'Identifier') bad(p, p.type, 'destructuring in parameters');
    }
    const name = n.id?.name as string | undefined;
    const params = new Set<string>(
      (n.params as N[]).filter((p) => p.type === 'Identifier').map((p) => p.name),
    );
    const recursive =
      name && recursiveFunctions.has(name)
        ? {name, params, found: new Map<string, N>()}
        : undefined;
    stmt(n.body, {inFunction: true, loopDepth: 0, recursive});
    if (recursive && recursive.found.size > 0) {
      const names = [...recursive.found.keys()];
      const advice = HINTS['recursive-local'].charAt(0).toUpperCase() + HINTS['recursive-local'].slice(1);
      const shown = names.slice(0, 6).join(', ') + (names.length > 6 ? `, and ${names.length - 6} more` : '');
      report(
        [...recursive.found.values()][0],
        'recursive-local',
        `"${recursive.name}" calls itself (directly or through other functions), so it cannot declare its own variables or loop counters with var: in blocks only parameters are local, and a recursive call would overwrite them. It declares: ${shown}. ${advice}.`,
      );
    }
  };

  /** A number written in the code: 3, or -3. Null for anything else. */
  const literalNumber = (n: N): number | null => {
    if (n.type === 'Literal' && typeof n.value === 'number') return n.value;
    if (
      n.type === 'UnaryExpression' &&
      n.operator === '-' &&
      n.argument.type === 'Literal' &&
      typeof n.argument.value === 'number'
    ) {
      return -n.argument.value;
    }
    return null;
  };

  /** Flags x[0], x[-1]: positions start at 1. Used for reads and for writes. */
  const checkLiteralPosition = (member: N) => {
    const position = literalNumber(member.property);
    if (position !== null && position < 1) {
      report(
        member,
        'index-zero',
        `"${code.slice(member.start, member.end)}" reads position ${position}, but positions start at 1 (the first item or character is [1]).`,
      );
    }
  };

  /**
   * A for loop must be a plain counting loop (Blockly's "count with" block).
   * Returns its counter, its literal start (if it is one) and its direction,
   * or null when the loop is not of that shape.
   */
  const forInfo = (
    n: N,
  ): {counter: string; start: number | null; up: boolean} | null => {
    let counter: string | null = null;
    let startNode: N | null = null;
    const init = n.init;
    if (
      init?.type === 'VariableDeclaration' &&
      init.declarations.length === 1 &&
      init.declarations[0].id.type === 'Identifier' &&
      init.declarations[0].init
    ) {
      counter = init.declarations[0].id.name;
      startNode = init.declarations[0].init;
    } else if (
      init?.type === 'AssignmentExpression' &&
      init.operator === '=' &&
      init.left.type === 'Identifier'
    ) {
      counter = init.left.name;
      startNode = init.right;
    }
    if (!counter || !startNode) return null;
    const t = n.test;
    if (
      !(
        t?.type === 'BinaryExpression' &&
        ['<', '<=', '>', '>='].includes(t.operator) &&
        t.left.type === 'Identifier' &&
        t.left.name === counter
      )
    ) {
      return null;
    }
    const u = n.update;
    let up: boolean | null = null;
    if (u?.type === 'UpdateExpression' && u.argument.type === 'Identifier' && u.argument.name === counter) {
      up = u.operator === '++';
    } else if (
      u?.type === 'AssignmentExpression' &&
      (u.operator === '+=' || u.operator === '-=') &&
      u.left.type === 'Identifier' &&
      u.left.name === counter
    ) {
      up = u.operator === '+=';
    }
    return up === null ? null : {counter, start: literalNumber(startNode), up};
  };

  /**
   * In a loop that counts up from a literal, flags the first index whose first
   * position is below 1 (e.g. `for (var i = 0; ...)` reading x[i], or counting
   * from 1 but reading x[i - 1]). Positions start at 1, so that is a bug. One
   * report per loop.
   */
  const checkLoopIndexes = (loop: N, counter: string, start: number) => {
    const offsetOf = (p: N): number | null => {
      if (p.type === 'Identifier' && p.name === counter) return 0;
      if (p.type === 'BinaryExpression' && (p.operator === '+' || p.operator === '-')) {
        if (p.left.type === 'Identifier' && p.left.name === counter) {
          const k = literalNumber(p.right);
          if (k !== null) return p.operator === '+' ? k : -k;
        }
        if (p.operator === '+' && p.right.type === 'Identifier' && p.right.name === counter) {
          return literalNumber(p.left);
        }
      }
      return null;
    };
    let reported = false;
    const visit = (node: unknown): void => {
      if (reported || !node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(visit);
      const m = node as N;
      if (m.type === 'MemberExpression' && m.computed) {
        const offset = offsetOf(m.property);
        if (offset !== null && start + offset < 1) {
          reported = true;
          report(
            m,
            'index-before-1',
            `the loop counter "${counter}" starts at ${start}, so "${code.slice(m.start, m.end)}" reads position ${start + offset} on the first pass, but positions start at 1. ${capitalize(HINTS['index-before-1'])}.`,
          );
          return;
        }
      }
      for (const v of Object.values(m)) visit(v);
    };
    visit(loop.body);
  };

  // ---- statements --------------------------------------------------------

  const stmt = (n: N, ctx: Ctx): void => {
    switch (n.type) {
      case 'FunctionDeclaration':
        return fn(n, ctx);
      case 'VariableDeclaration':
        return varDecl(n, ctx);
      case 'ExpressionStatement': {
        if (n.directive) return; // "use strict"
        const e = n.expression;
        if (
          e.type === 'AssignmentExpression' ||
          e.type === 'UpdateExpression' ||
          e.type === 'CallExpression'
        ) {
          expr(e, ctx, true);
        } else {
          bad(n, 'expression-statement', 'this statement');
          expr(e, ctx, false);
        }
        return;
      }
      case 'IfStatement':
        count('ok:if');
        expr(n.test, ctx, false);
        stmt(n.consequent, ctx);
        if (n.alternate) stmt(n.alternate, ctx);
        return;
      case 'ForStatement': {
        count('ok:for');
        const info = forInfo(n);
        if (!info) bad(n, 'for:shape', 'this kind of for loop');
        else if (info.up && info.start !== null) checkLoopIndexes(n, info.counter, info.start);
        if (n.init) {
          if (n.init.type === 'VariableDeclaration') varDecl(n.init, ctx);
          else expr(n.init, ctx, true);
        }
        if (n.test) expr(n.test, ctx, false);
        if (n.update) expr(n.update, ctx, true);
        return stmt(n.body, {...ctx, loopDepth: ctx.loopDepth + 1});
      }
      case 'ForOfStatement': {
        count('ok:for-of');
        if (n.await) bad(n, 'AwaitExpression', 'for await');
        if (n.left.type === 'VariableDeclaration') varDecl(n.left, ctx, false);
        else bad(n.left, 'ArrayPattern', 'this loop variable');
        expr(n.right, ctx, false);
        return stmt(n.body, {...ctx, loopDepth: ctx.loopDepth + 1});
      }
      case 'WhileStatement':
        count('ok:while');
        expr(n.test, ctx, false);
        return stmt(n.body, {...ctx, loopDepth: ctx.loopDepth + 1});
      case 'BreakStatement':
      case 'ContinueStatement':
        if (n.label) bad(n, 'labeled', 'a label');
        else if (ctx.loopDepth === 0) bad(n, 'break-outside-loop', n.type === 'BreakStatement' ? 'break' : 'continue');
        else count(n.type === 'BreakStatement' ? 'ok:break' : 'ok:continue');
        return;
      case 'ReturnStatement':
        if (!ctx.inFunction) bad(n, 'return-outside-function', 'return');
        else count('ok:return');
        if (n.argument) expr(n.argument, ctx, false);
        return;
      case 'BlockStatement':
        for (const s of n.body as N[]) stmt(s, ctx);
        return;
      case 'EmptyStatement':
        return;
      default:
        bad(n, n.type, STATEMENT_NAMES[n.type] ?? n.type);
        descend(ctx, n);
    }
  };

  // ---- expressions -------------------------------------------------------

  const expr = (n: N, ctx: Ctx, asStatement: boolean): void => {
    switch (n.type) {
      case 'Literal':
        if (n.regex) bad(n, 'regex', 'a regular expression');
        else if (n.bigint) bad(n, 'bigint', 'a BigInt');
        return;
      case 'Identifier':
        if (n.name === 'undefined') bad(n, 'identifier:undefined', '"undefined"');
        return;
      case 'BinaryExpression':
        if (!ALLOWED_BINARY.has(n.operator)) {
          bad(n, `op:${n.operator}`, `the operator "${n.operator}"`);
        } else if (n.operator === '+' && (isText(n.left) || isText(n.right))) {
          bad(n, 'text+', '"+" with text');
        } else {
          count(`ok:op:${n.operator}`);
        }
        expr(n.left, ctx, false);
        expr(n.right, ctx, false);
        return;
      case 'LogicalExpression':
        if (ALLOWED_LOGICAL.has(n.operator)) count(`ok:op:${n.operator}`);
        else bad(n, `op:${n.operator}`, `the operator "${n.operator}"`);
        expr(n.left, ctx, false);
        expr(n.right, ctx, false);
        return;
      case 'UnaryExpression':
        if (ALLOWED_UNARY.has(n.operator)) count(`ok:op:unary${n.operator}`);
        else bad(n, n.operator === '+' ? 'op:+unary' : `op:${n.operator}`, `the operator "${n.operator}"`);
        expr(n.argument, ctx, false);
        return;
      case 'UpdateExpression':
        if (!asStatement) bad(n, 'update:in-expression', `"${n.operator}" inside an expression`);
        else if (n.argument.type !== 'Identifier') bad(n, 'update:member', `"${n.operator}" on a list item`);
        else count('ok:update');
        expr(n.argument, ctx, false);
        return;
      case 'AssignmentExpression':
        if (!asStatement) bad(n, 'assign:in-expression', 'an assignment inside an expression');
        if (!ALLOWED_ASSIGN.has(n.operator)) {
          bad(n, `op:${n.operator}`, `the operator "${n.operator}"`);
        } else if (n.operator === '+=' && isText(n.right)) {
          bad(n, 'text+', '"+=" with text');
        } else {
          count('ok:assign');
        }
        if (n.left.type === 'Identifier') {
          // fine
        } else if (n.left.type === 'MemberExpression' && n.left.computed) {
          checkLiteralPosition(n.left);
          expr(n.left.object, ctx, false);
          expr(n.left.property, ctx, false);
        } else if (n.left.type === 'ObjectPattern' || n.left.type === 'ArrayPattern') {
          bad(n.left, n.left.type, 'destructuring');
        } else {
          bad(n.left, 'assign:target', 'this assignment target');
        }
        expr(n.right, ctx, false);
        return;
      case 'ConditionalExpression':
        count('ok:ternary');
        expr(n.test, ctx, false);
        expr(n.consequent, ctx, false);
        expr(n.alternate, ctx, false);
        return;
      case 'ArrayExpression':
        count('ok:list-literal');
        for (const e of n.elements as Array<N | null>) {
          if (!e) bad(n, 'array-hole', 'an empty list slot');
          else if (e.type === 'SpreadElement') bad(e, 'SpreadElement', 'spread');
          else expr(e, ctx, false);
        }
        return;
      case 'MemberExpression': {
        if (n.computed) {
          count('ok:index');
          checkLiteralPosition(n);
          expr(n.object, ctx, false);
          expr(n.property, ctx, false);
          return;
        }
        const name = n.property.name;
        if (name === 'length') {
          count('ok:length');
        } else if (n.object.type === 'Identifier' && n.object.name === 'Math' && MATH_CONSTANTS.has(name)) {
          count(`ok:math:${name}`);
          return;
        } else {
          bad(n, `prop:${name}`, `".${name}"`);
        }
        expr(n.object, ctx, false);
        return;
      }
      case 'CallExpression':
        return call(n, ctx, asStatement);
      // Pieces of constructs that are reported as a whole elsewhere.
      case 'TemplateElement':
        return;
      case 'Property':
      case 'SwitchCase':
      case 'CatchClause':
      case 'MethodDefinition':
      case 'PropertyDefinition':
      case 'ClassBody':
      case 'StaticBlock':
        return descend(ctx, n);
      default:
        bad(n, n.type, EXPRESSION_NAMES[n.type] ?? n.type);
        descend(ctx, n);
    }
  };

  const call = (n: N, ctx: Ctx, asStatement: boolean): void => {
    const args = n.arguments as N[];
    const walkArgs = () => {
      for (const a of args) {
        if (a.type === 'SpreadElement') bad(a, 'SpreadElement', 'spread');
        else expr(a, ctx, false);
      }
    };
    if (n.optional) bad(n, 'ChainExpression', 'optional chaining');
    const c = n.callee as N;

    if (c.type === 'Identifier') {
      if (DIALECT_FUNCTIONS.has(c.name)) {
        if (c.name === 'print') {
          if (!asStatement) bad(n, 'print:in-expression', 'print used as a value');
          else if (args.length !== 1) report(n, 'print:args', `print takes exactly one value, but this call has ${args.length}. Use print(join(a, b)) to show several.`);
          else count('ok:print');
        } else if (args.length === 0) {
          report(n, 'join:args', 'join needs at least one value, e.g. join("total = ", total).');
        } else {
          count('ok:join');
        }
        return walkArgs();
      }
      if (known.has(c.name)) {
        count('ok:call');
        return walkArgs();
      }
      bad(
        n,
        `call:${c.name}`,
        `the function "${c.name}"`,
        HINTS[`call:${c.name}`] ??
          `it is not defined; declare it yourself with function ${c.name}(...) { ... } first, or use only print, join, and the Math functions listed`,
      );
      return walkArgs();
    }

    if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') {
      const name = c.property.name as string;
      if (c.object.type === 'Identifier' && c.object.name === 'Math') {
        const spec = MATH_FUNCTIONS[name];
        if (!spec) {
          bad(n, `math:${name}`, `Math.${name}`);
        } else if (spec.args === 'many' ? args.length < 2 : args.length !== spec.args) {
          report(n, 'math:args', `Math.${name} takes ${spec.args === 'many' ? 'two or more values' : `${spec.args} value${spec.args === 1 ? '' : 's'}`}, but this call has ${args.length}.`);
        } else {
          count(`ok:math:${name}`);
        }
        return walkArgs();
      }
      if (c.object.type === 'Identifier' && c.object.name === 'console') {
        bad(n, 'method:log', `console.${name}`);
        return walkArgs();
      }
      const method = ALLOWED_METHODS[name];
      if (method) {
        if (method.statement && !asStatement) {
          bad(n, 'push:in-expression', `${name} used as a value`);
        } else if (args.length !== method.args) {
          report(n, 'method-args', `${name} takes ${method.args} value${method.args === 1 ? '' : 's'}, but this call has ${args.length}.`);
        } else {
          count(`ok:method:${name}`);
        }
        expr(c.object, ctx, false);
        return walkArgs();
      }
      bad(n, `method:${name}`, `".${name}(...)"`);
      expr(c.object, ctx, false);
      return walkArgs();
    }

    bad(n, 'call:expression', 'this call');
    descend(ctx, n);
  };

  for (const s of program.body as N[]) stmt(s, {inFunction: false, loopDepth: 0});

  return {ok: violations.length === 0, violations, constructs};
}

/**
 * Names of the declared functions that can reach themselves through calls
 * (self-recursion or mutual recursion).
 */
function findRecursive(declared: Map<string, N>): Set<string> {
  const callsOf = new Map<string, Set<string>>();
  const collect = (node: unknown, out: Set<string>): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((c) => collect(c, out));
    const n = node as N;
    if (
      n.type === 'CallExpression' &&
      n.callee?.type === 'Identifier' &&
      declared.has(n.callee.name)
    ) {
      out.add(n.callee.name);
    }
    for (const v of Object.values(n)) collect(v, out);
  };
  for (const [name, fn] of declared) {
    const out = new Set<string>();
    collect(fn.body, out);
    callsOf.set(name, out);
  }
  const recursive = new Set<string>();
  for (const start of declared.keys()) {
    // Can we get back to `start` by following at least one call?
    const seen = new Set<string>();
    const stack = [...(callsOf.get(start) ?? [])];
    while (stack.length) {
      const name = stack.pop()!;
      if (name === start) {
        recursive.add(start);
        break;
      }
      if (seen.has(name)) continue;
      seen.add(name);
      stack.push(...(callsOf.get(name) ?? []));
    }
  }
  return recursive;
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The messages to send the model: the first few violations, then a count. */
export function violationMessages(result: CodeCheckResult): string[] {
  const shown = result.violations.slice(0, MAX_MESSAGES).map((v) => v.message);
  const more = result.violations.length - shown.length;
  if (more > 0) shown.push(`...and ${more} more problem${more === 1 ? '' : 's'} of the same kinds.`);
  return shown;
}

const STATEMENT_NAMES: Record<string, string> = {
  ClassDeclaration: 'a class',
  TryStatement: 'try/catch',
  ThrowStatement: 'throw',
  SwitchStatement: 'switch',
  DoWhileStatement: 'do...while',
  ForInStatement: 'for...in',
  LabeledStatement: 'a label',
  WithStatement: 'with',
  ImportDeclaration: 'import',
  ExportNamedDeclaration: 'export',
  ExportDefaultDeclaration: 'export',
};

const EXPRESSION_NAMES: Record<string, string> = {
  ArrowFunctionExpression: 'an arrow function',
  FunctionExpression: 'a function expression',
  ClassExpression: 'a class',
  ObjectExpression: 'an object literal',
  TemplateLiteral: 'a template string',
  TaggedTemplateExpression: 'a tagged template',
  NewExpression: '"new"',
  ThisExpression: '"this"',
  SequenceExpression: 'the comma operator',
  ChainExpression: 'optional chaining',
  AwaitExpression: '"await"',
  YieldExpression: '"yield"',
  SpreadElement: 'spread',
};

// ---- running the model's code in the benchmark sandbox ---------------------

/**
 * Rewrites the dialect's 1-based list indexing into plain 0-based JavaScript,
 * by turning every `a[expr]` into `a[(expr)-1]`. Insertions only, positions
 * taken from the original source, so nested indexes are handled correctly.
 * Used so the benchmark can execute the model's own code and check it.
 */
export function toRunnable(code: string): string {
  const program = acorn.parse(code, {ecmaVersion: 'latest', sourceType: 'script'}) as N;
  const inserts: Array<{pos: number; text: string}> = [];
  const visit = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(visit);
    const node = n as N;
    if (node.type === 'MemberExpression' && node.computed) {
      inserts.push({pos: node.property.start, text: '('});
      inserts.push({pos: node.property.end, text: ')-1'});
    }
    for (const v of Object.values(node)) visit(v);
  };
  visit(program);
  // Apply from the end so earlier positions stay valid; openers before
  // closers at the same position.
  inserts.sort((a, b) => b.pos - a.pos || (a.text === '(' ? 1 : -1));
  let out = code;
  for (const {pos, text} of inserts) out = out.slice(0, pos) + text + out.slice(pos);
  return out;
}
