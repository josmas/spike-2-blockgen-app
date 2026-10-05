/**
 * Stage 2 of the "code" reply format: turns a program that passed the dialect
 * checker (codeCheck.ts) into the flat block list that buildFromFlat() turns
 * into Blockly's nested JSON. The mapping is documented in STAGE2_PLAN.md
 * (section 7) and each Blockly fact it relies on is a test in
 * scripts/tests/blocklyFacts.test.ts.
 *
 * The checker guarantees the constructs; this file throws a TranslateError
 * ("Line N: ...") for the few things that are legal in the dialect but that
 * blocks cannot express faithfully.
 */
import * as acorn from 'acorn';
import type {FlatBlock} from './flat';

type N = Record<string, any>;
type Type = 'text' | 'number' | 'boolean' | 'list' | 'unknown';

export interface FunctionInfo {
  params: string[];
  /** True for a function that returns a value (procedures_defreturn). */
  returns: boolean;
}

export interface Translation {
  blocks: FlatBlock[];
  /** Source line of every block id, to word validator errors about the model's code. */
  lineOf: Map<string, number>;
}

/** The program is inside the dialect, but a construct has no faithful block form. */
export class TranslateError extends Error {
  readonly line: number;
  constructor(line: number, message: string) {
    super(`Line ${line}: ${message}`);
    this.line = line;
  }
}

/**
 * @param existing  functions already in the workspace, which the program may call
 */
export function translateCode(
  code: string,
  existing: Map<string, FunctionInfo> = new Map(),
): Translation {
  let program: N;
  try {
    program = acorn.parse(code, {ecmaVersion: 'latest', sourceType: 'script', locations: true}) as N;
  } catch (e) {
    throw new TranslateError(0, `syntax error: ${(e as Error).message}`);
  }
  renameClashingLocals(program);
  return new Translator(program, existing).run();
}

/**
 * Rewrites the block ids that validator and builder messages mention
 * ("Problem with block "b12": ...") into source lines, because the model wrote
 * code and cannot map a block id back to it.
 */
export function messagesAboutCode(messages: string[], lineOf: Map<string, number>): string[] {
  const line = (id: string) => lineOf.get(id);
  return messages.map((m) =>
    m
      .replace(/Problem with block "([^"]+)":/g, (all, id) => (line(id) ? `Line ${line(id)}:` : all))
      .replace(/block "([^"]+)"/g, (all, id) => (line(id) ? `the code on line ${line(id)}` : all))
      .replace(/"(b\d+)"/g, (all, id) => (line(id) ? `the code on line ${line(id)}` : all)),
  );
}

// ---- helpers on the syntax tree --------------------------------------------

const lineOfNode = (n: N): number => n.loc?.start.line ?? 0;

/** Calls fn for every node below (and including) `node`, not entering functions. */
function walk(node: unknown, fn: (n: N) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((c) => walk(c, fn));
  const n = node as N;
  if (typeof n.type === 'string') fn(n);
  for (const [k, v] of Object.entries(n)) {
    if (k === 'loc') continue;
    walk(v, fn);
  }
}

/** A number written in the code: 3 or -3. */
function literalNumber(n: N): number | null {
  if (n.type === 'Literal' && typeof n.value === 'number') return n.value;
  if (n.type === 'UnaryExpression' && n.operator === '-') {
    const inner = literalNumber(n.argument);
    return inner === null ? null : -inner;
  }
  return null;
}

/** The variable at the root of `a`, `a[i]`, `a[i][j]`. */
function rootName(n: N): string | null {
  let cur = n;
  while (cur.type === 'MemberExpression') cur = cur.object;
  return cur.type === 'Identifier' ? cur.name : null;
}

function hasValueReturn(fn: N): boolean {
  let found = false;
  walk(fn.body, (n) => {
    if (n.type === 'ReturnStatement' && n.argument) found = true;
  });
  return found;
}

// ---- scoping: only function parameters are local in blocks ------------------

/**
 * In blocks, only a function's parameters are local; every other variable is
 * global. Two functions that each declare `i` would share it, so the locals
 * that clash are renamed to `<function>__<name>`. A local clashes when two or
 * more functions declare it, or when the top-level code uses the same name.
 * (Recursive functions cannot declare locals at all; the checker rejects them.)
 */
function renameClashingLocals(program: N): void {
  const functions = (program.body as N[]).filter((n) => n.type === 'FunctionDeclaration');
  const locals = new Map<N, Set<string>>();
  const declaredIn = new Map<string, number>();
  for (const f of functions) {
    const params = new Set<string>((f.params as N[]).map((p) => p.name));
    const mine = new Set<string>();
    walk(f.body, (n) => {
      if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && !params.has(n.id.name)) {
        mine.add(n.id.name);
      }
    });
    locals.set(f, mine);
    for (const name of mine) declaredIn.set(name, (declaredIn.get(name) ?? 0) + 1);
  }
  const topLevel = new Set<string>();
  for (const s of program.body as N[]) {
    if (s.type !== 'FunctionDeclaration') walk(s, (n) => n.type === 'Identifier' && topLevel.add(n.name));
  }
  for (const f of functions) {
    const rename = new Set([...locals.get(f)!].filter((name) => (declaredIn.get(name) ?? 0) > 1 || topLevel.has(name)));
    if (rename.size === 0) continue;
    const visit = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(visit);
      const n = node as N;
      if (n.type === 'Identifier' && rename.has(n.name)) n.name = `${f.id.name}__${n.name}`;
      if (n.type === 'MemberExpression' && !n.computed) return visit(n.object);
      for (const [k, v] of Object.entries(n)) if (k !== 'loc') visit(v);
    };
    visit(f.body);
  }
}

// ---- the translator ---------------------------------------------------------

interface Ctx {
  /** Parameters of the function being translated (they are local, and untyped). */
  params: Set<string>;
  /** True when the function returns a value (procedures_defreturn). */
  returns: boolean;
}

const ARITHMETIC: Record<string, string> = {'+': 'ADD', '-': 'MINUS', '*': 'MULTIPLY', '/': 'DIVIDE'};
const COMPARE: Record<string, string> = {
  '==': 'EQ', '===': 'EQ', '!=': 'NEQ', '!==': 'NEQ', '<': 'LT', '<=': 'LTE', '>': 'GT', '>=': 'GTE',
};
const MATH_SINGLE: Record<string, string> = {abs: 'ABS', sqrt: 'ROOT', log: 'LN', exp: 'EXP'};
const MATH_ROUND: Record<string, string> = {floor: 'ROUNDDOWN', ceil: 'ROUNDUP', round: 'ROUND'};
const MATH_TRIG: Record<string, string> = {sin: 'SIN', cos: 'COS', tan: 'TAN', asin: 'ASIN', acos: 'ACOS', atan: 'ATAN'};

/** Name of the throwaway variable that receives a result the program ignores. */
const IGNORED = 'ignored';

class Translator {
  private blocks: FlatBlock[] = [];
  private lineOf = new Map<string, number>();
  private line = 0;
  private tempCount = 0;
  private functions = new Map<string, FunctionInfo>();
  private globalTypes = new Map<string, Type>();

  private program: N;

  constructor(program: N, existing: Map<string, FunctionInfo>) {
    this.program = program;
    for (const [name, info] of existing) this.functions.set(name, info);
    for (const s of program.body as N[]) {
      if (s.type === 'FunctionDeclaration') {
        this.functions.set(s.id.name, {
          params: (s.params as N[]).map((p) => p.name),
          returns: hasValueReturn(s),
        });
      }
    }
    this.inferGlobalTypes();
  }

  run(): Translation {
    const body = this.program.body as N[];
    for (const s of body) if (s.type === 'FunctionDeclaration') this.functionDeclaration(s);
    const main = body.filter((s) => s.type !== 'FunctionDeclaration');
    this.statements(main, '', '', {params: new Set(), returns: false});
    return {blocks: this.blocks, lineOf: this.lineOf};
  }

  // ---- emitting blocks ------------------------------------------------------

  private add(
    type: string,
    parent: string,
    slot: string,
    node: N | null,
    fields: Record<string, string> = {},
    extra: Partial<FlatBlock> = {},
  ): string {
    if (node) this.line = lineOfNode(node);
    const id = `b${this.blocks.length + 1}`;
    this.blocks.push({
      id, type, parent, slot, name: '', params: [],
      fields: Object.entries(fields).map(([name, value]) => ({name, value})),
      ...extra,
    });
    this.lineOf.set(id, this.line);
    return id;
  }

  private fail(node: N, message: string): never {
    throw new TranslateError(lineOfNode(node), message);
  }

  private number(value: number, parent: string, slot: string, node: N | null = null): string {
    return this.add('math_number', parent, slot, node, {NUM: String(value)});
  }

  private get(name: string, parent: string, slot: string, node: N | null = null): string {
    return this.add('variables_get', parent, slot, node, {VAR: name});
  }

  // ---- types ----------------------------------------------------------------

  /**
   * Walks the whole program once per round and records what each global
   * variable is assigned; a variable has a type when every assignment agrees.
   */
  private inferGlobalTypes(): void {
    for (let round = 0; round < 3; round++) {
      const evidence = new Map<string, Set<Type>>();
      const note = (name: string, t: Type) => {
        if (!evidence.has(name)) evidence.set(name, new Set());
        evidence.get(name)!.add(t);
      };
      const scan = (body: unknown, params: Set<string>) => {
        const ctx: Ctx = {params, returns: false};
        walk(body, (n) => {
          if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && !params.has(n.id.name)) {
            if (n.init) note(n.id.name, this.typeOf(n.init, ctx));
          } else if (n.type === 'AssignmentExpression') {
            if (n.left.type === 'Identifier' && !params.has(n.left.name)) {
              note(n.left.name, n.operator === '=' ? this.typeOf(n.right, ctx) : 'number');
            } else if (n.left.type === 'MemberExpression') {
              const root = rootName(n.left);
              if (root && !params.has(root) && n.left.object.type === 'Identifier') note(root, 'list');
            }
          } else if (n.type === 'UpdateExpression' && n.argument.type === 'Identifier') {
            if (!params.has(n.argument.name)) note(n.argument.name, 'number');
          } else if (n.type === 'ForOfStatement') {
            const d = n.left.type === 'VariableDeclaration' ? n.left.declarations[0].id : n.left;
            if (d.type === 'Identifier' && !params.has(d.name)) note(d.name, 'unknown');
          } else if (
            n.type === 'CallExpression' && n.callee.type === 'MemberExpression' &&
            n.callee.property.name === 'push' && n.callee.object.type === 'Identifier' &&
            !params.has(n.callee.object.name)
          ) {
            note(n.callee.object.name, 'list');
          }
        });
      };
      for (const s of this.program.body as N[]) {
        if (s.type === 'FunctionDeclaration') {
          scan(s.body, new Set((s.params as N[]).map((p) => p.name)));
        } else {
          scan(s, new Set());
        }
      }
      for (const [name, types] of evidence) {
        this.globalTypes.set(name, types.size === 1 ? [...types][0] : 'unknown');
      }
    }
  }

  /** What an expression evidently is. Deliberately shallow; 'unknown' is a safe answer. */
  private typeOf(n: N, ctx: Ctx): Type {
    switch (n.type) {
      case 'Literal':
        if (typeof n.value === 'string') return 'text';
        if (typeof n.value === 'number') return 'number';
        if (typeof n.value === 'boolean') return 'boolean';
        return 'unknown';
      case 'ArrayExpression':
        return 'list';
      case 'Identifier':
        return ctx.params.has(n.name) ? 'unknown' : (this.globalTypes.get(n.name) ?? 'unknown');
      case 'BinaryExpression':
        return n.operator in COMPARE ? 'boolean' : 'number';
      case 'LogicalExpression':
        return 'boolean';
      case 'UnaryExpression':
        return n.operator === '!' ? 'boolean' : 'number';
      case 'ConditionalExpression': {
        const a = this.typeOf(n.consequent, ctx);
        return a === this.typeOf(n.alternate, ctx) ? a : 'unknown';
      }
      case 'MemberExpression':
        if (n.computed) return this.typeOf(n.object, ctx) === 'text' ? 'text' : 'unknown';
        return 'number'; // .length, Math.PI, Math.E
      case 'CallExpression': {
        const c = n.callee;
        if (c.type === 'Identifier') return c.name === 'join' ? 'text' : 'unknown';
        if (c.object.name === 'Math') return 'number';
        return ['toUpperCase', 'toLowerCase', 'trim'].includes(c.property.name) ? 'text' : 'unknown';
      }
      default:
        return 'unknown';
    }
  }

  // ---- functions --------------------------------------------------------------

  private functionDeclaration(fn: N): void {
    const name = fn.id.name as string;
    const info = this.functions.get(name)!;
    const ctx: Ctx = {params: new Set(info.params), returns: info.returns};
    const def = this.add(
      info.returns ? 'procedures_defreturn' : 'procedures_defnoreturn', '', '', fn, {},
      {name, params: info.params},
    );
    let body = fn.body.body as N[];
    const tail = body[body.length - 1];
    if (tail?.type === 'ReturnStatement') {
      // Blockly allows one returned value, at the end of the definition.
      body = body.slice(0, -1);
      if (info.returns) {
        if (tail.argument) this.expr(tail.argument, def, 'RETURN', ctx);
        else this.add('logic_null', def, 'RETURN', tail);
      }
    } else if (info.returns) {
      this.add('logic_null', def, 'RETURN', fn); // a definition that returns a value must have one
    }
    this.statements(body, def, 'STACK', ctx);
  }

  // ---- statements -------------------------------------------------------------

  private bodyOf(n: N): N[] {
    return n.type === 'BlockStatement' ? n.body : [n];
  }

  /** Emits statements as a chain; returns the last block, or null if nothing was emitted. */
  private statements(list: N[], parent: string, slot: string, ctx: Ctx): string | null {
    let at = parent;
    let where = slot;
    let last: string | null = null;
    for (const s of list) {
      const id = this.statement(s, at, where, ctx);
      if (id) {
        at = id;
        where = 'next';
        last = id;
      }
    }
    return last;
  }

  /** Emits one statement after (parent, slot); returns the last block it made, or null. */
  private statement(n: N, parent: string, slot: string, ctx: Ctx): string | null {
    switch (n.type) {
      case 'VariableDeclaration': {
        let at = parent;
        let where = slot;
        let last: string | null = null;
        for (const d of n.declarations as N[]) {
          if (!d.init) continue; // `var x;` makes no block
          last = this.add('variables_set', at, where, d, {VAR: d.id.name});
          this.expr(d.init, last, 'VALUE', ctx);
          at = last;
          where = 'next';
        }
        return last;
      }
      case 'ExpressionStatement':
        if (n.directive) return null;
        return this.expressionStatement(n.expression, parent, slot, ctx);
      case 'IfStatement':
        return this.ifStatement(n, parent, slot, ctx);
      case 'ForStatement':
        return this.forStatement(n, parent, slot, ctx);
      case 'ForOfStatement': {
        const v = n.left.type === 'VariableDeclaration' ? n.left.declarations[0].id : n.left;
        const id = this.add('controls_forEach', parent, slot, n, {VAR: v.name});
        this.expr(n.right, id, 'LIST', ctx);
        this.statements(this.bodyOf(n.body), id, 'DO', ctx);
        return id;
      }
      case 'WhileStatement': {
        const id = this.add('controls_whileUntil', parent, slot, n, {MODE: 'WHILE'});
        this.condition(n.test, id, 'BOOL', ctx);
        this.statements(this.bodyOf(n.body), id, 'DO', ctx);
        return id;
      }
      case 'BreakStatement':
      case 'ContinueStatement':
        return this.add('controls_flow_statements', parent, slot, n, {FLOW: n.type === 'BreakStatement' ? 'BREAK' : 'CONTINUE'});
      case 'ReturnStatement':
        return this.returnStatement(n, null, parent, slot, ctx);
      case 'BlockStatement':
        return this.statements(n.body, parent, slot, ctx);
      case 'EmptyStatement':
        return null;
      default:
        return this.fail(n, `${n.type} cannot be turned into blocks`);
    }
  }

  /** A return that is not the last statement of the function: procedures_ifreturn. */
  private returnStatement(n: N, test: N | null, parent: string, slot: string, ctx: Ctx): string {
    const id = this.add('procedures_ifreturn', parent, slot, n);
    if (test) this.condition(test, id, 'CONDITION', ctx);
    else this.add('logic_boolean', id, 'CONDITION', n, {BOOL: 'TRUE'});
    if (ctx.returns) {
      if (n.argument) this.expr(n.argument, id, 'VALUE', ctx);
      else this.add('logic_null', id, 'VALUE', n);
    } else if (n.argument) {
      this.fail(n, 'this function returns a value in one place but this definition has none; this should not happen');
    }
    return id;
  }

  private ifStatement(n: N, parent: string, slot: string, ctx: Ctx): string {
    // `if (c) { return e; }` with no else is exactly procedures_ifreturn.
    const only = this.bodyOf(n.consequent);
    if (!n.alternate && only.length === 1 && only[0].type === 'ReturnStatement') {
      return this.returnStatement(only[0], n.test, parent, slot, ctx);
    }
    const branches: Array<{test: N; body: N[]}> = [];
    let elseBody: N[] | null = null;
    for (let cur: N | null = n; cur; ) {
      branches.push({test: cur.test, body: this.bodyOf(cur.consequent)});
      if (cur.alternate?.type === 'IfStatement') {
        cur = cur.alternate;
      } else {
        if (cur.alternate) elseBody = this.bodyOf(cur.alternate);
        cur = null;
      }
    }
    const id = this.add('controls_if', parent, slot, n);
    branches.forEach((b, i) => {
      this.condition(b.test, id, `IF${i}`, ctx);
      this.statements(b.body, id, `DO${i}`, ctx);
    });
    if (elseBody) this.statements(elseBody, id, 'ELSE', ctx);
    return id;
  }

  private expressionStatement(e: N, parent: string, slot: string, ctx: Ctx): string | null {
    switch (e.type) {
      case 'AssignmentExpression':
        return this.assignment(e, parent, slot, ctx);
      case 'UpdateExpression': {
        const id = this.add('math_change', parent, slot, e, {VAR: e.argument.name});
        this.number(e.operator === '++' ? 1 : -1, id, 'DELTA', e);
        return id;
      }
      case 'CallExpression':
        return this.callStatement(e, parent, slot, ctx);
      default:
        return this.fail(e, `${e.type} cannot be a statement`);
    }
  }

  private assignment(e: N, parent: string, slot: string, ctx: Ctx): string {
    const op = e.operator as string;
    const arithmetic = op === '=' ? null : ARITHMETIC[op[0]];
    if (e.left.type === 'Identifier') {
      const name = e.left.name as string;
      if (op === '+=' && (this.typeOf(e.left, ctx) === 'text' || this.typeOf(e.right, ctx) === 'text')) {
        this.fail(e, `"+=" adds numbers; to add to text, write ${name} = join(${name}, ...)`);
      }
      if (op === '+=') {
        const id = this.add('math_change', parent, slot, e, {VAR: name});
        this.expr(e.right, id, 'DELTA', ctx);
        return id;
      }
      const id = this.add('variables_set', parent, slot, e, {VAR: name});
      if (arithmetic) {
        const calc = this.add('math_arithmetic', id, 'VALUE', e, {OP: arithmetic});
        this.get(name, calc, 'A', e);
        this.expr(e.right, calc, 'B', ctx);
      } else {
        this.expr(e.right, id, 'VALUE', ctx);
      }
      return id;
    }
    // list[i] = e  (and list[i] += e ...)
    const target = e.left;
    const id = this.add('lists_setIndex', parent, slot, e, {MODE: 'SET', WHERE: 'FROM_START'});
    this.expr(target.object, id, 'LIST', ctx);
    this.expr(target.property, id, 'AT', ctx);
    if (arithmetic) {
      const calc = this.add('math_arithmetic', id, 'TO', e, {OP: arithmetic});
      this.indexRead(target, calc, 'A', ctx);
      this.expr(e.right, calc, 'B', ctx);
    } else {
      this.expr(e.right, id, 'TO', ctx);
    }
    return id;
  }

  private callStatement(e: N, parent: string, slot: string, ctx: Ctx): string {
    const c = e.callee as N;
    if (c.type === 'Identifier' && c.name === 'print') {
      const id = this.add('add_text', parent, slot, e);
      const arg = e.arguments[0] as N;
      // add_text takes text only. Variables, calls and list items have no
      // fixed type, so they plug in as they are; anything else is wrapped.
      const plugsIntoText =
        this.typeOf(arg, ctx) === 'text' ||
        arg.type === 'Identifier' ||
        (arg.type === 'MemberExpression' && arg.computed) ||
        (arg.type === 'CallExpression' && arg.callee.type === 'Identifier' && arg.callee.name !== 'join');
      if (plugsIntoText) {
        this.expr(arg, id, 'TEXT', ctx);
      } else {
        const joined = this.add('text_join', id, 'TEXT', arg);
        this.expr(arg, joined, 'ADD0', ctx);
      }
      return id;
    }
    if (c.type === 'MemberExpression' && c.property.name === 'push') {
      const id = this.add('lists_setIndex', parent, slot, e, {MODE: 'INSERT', WHERE: 'LAST'});
      this.expr(c.object, id, 'LIST', ctx);
      this.expr(e.arguments[0], id, 'TO', ctx);
      return id;
    }
    if (c.type === 'Identifier' && this.functions.get(c.name)?.returns === false) {
      return this.userCall(e, 'procedures_callnoreturn', parent, slot, ctx);
    }
    // A value block cannot stand alone: keep the result in a throwaway variable.
    const id = this.add('variables_set', parent, slot, e, {VAR: IGNORED});
    this.expr(e, id, 'VALUE', ctx);
    return id;
  }

  // ---- loops ------------------------------------------------------------------

  private forStatement(n: N, parent: string, slot: string, ctx: Ctx): string {
    const loop = this.parseFor(n);
    // What the body can change under the bound: assigning a variable or
    // pushing onto a list changes it; writing list[i] changes the items but
    // not the list's length.
    const written = new Set<string>();
    const itemsWritten = new Set<string>();
    walk(n.body, (m) => {
      if (m.type === 'AssignmentExpression') {
        const r = rootName(m.left);
        if (r) (m.left.type === 'Identifier' ? written : itemsWritten).add(r);
      } else if (m.type === 'UpdateExpression') {
        const r = rootName(m.argument);
        if (r) written.add(r);
      } else if (m.type === 'CallExpression' && m.callee.type === 'MemberExpression' && m.callee.property.name === 'push') {
        const r = rootName(m.callee.object);
        if (r) written.add(r);
      }
    });
    const onlyLength = new Set<N>();
    walk(loop.bound, (m) => {
      if (m.type === 'MemberExpression' && !m.computed && m.property.name === 'length' && m.object.type === 'Identifier') {
        onlyLength.add(m.object);
      }
    });
    let boundChanges = false;
    walk(loop.bound, (m) => {
      if (m.type !== 'Identifier') return;
      if (written.has(m.name) || (!onlyLength.has(m) && itemsWritten.has(m.name))) boundChanges = true;
    });
    return boundChanges ? this.whileLoop(n, loop, parent, slot, ctx) : this.countLoop(n, loop, parent, slot, ctx);
  }

  private parseFor(n: N) {
    const bad = (): never =>
      this.fail(n, 'this for loop is not a plain counting loop, e.g. for (var i = 1; i <= n; i++)');
    let counter: string | undefined;
    let start: N | undefined;
    if (n.init?.type === 'VariableDeclaration' && n.init.declarations.length === 1) {
      counter = n.init.declarations[0].id.name;
      start = n.init.declarations[0].init ?? undefined;
    } else if (n.init?.type === 'AssignmentExpression' && n.init.operator === '=') {
      counter = n.init.left.name;
      start = n.init.right;
    }
    const t = n.test;
    const u = n.update;
    if (!counter || !start || t?.type !== 'BinaryExpression' || t.left.name !== counter || !(t.operator in COMPARE)) return bad();
    let up: boolean;
    let step: N | null = null;
    if (u?.type === 'UpdateExpression' && u.argument.name === counter) {
      up = u.operator === '++';
    } else if (u?.type === 'AssignmentExpression' && (u.operator === '+=' || u.operator === '-=') && u.left.name === counter) {
      up = u.operator === '+=';
      step = u.right;
    } else {
      return bad();
    }
    const op = t.operator as string;
    if (up !== (op === '<' || op === '<=')) {
      this.fail(n, `this loop counts ${up ? 'up' : 'down'} but its test "${counter} ${op} ..." runs the other way`);
    }
    return {counter, start, op, bound: t.right as N, up, step};
  }

  /** `for` as Blockly's "count with", inside an if so an empty range does nothing, as in JavaScript. */
  private countLoop(n: N, loop: ReturnType<Translator['parseFor']>, parent: string, slot: string, ctx: Ctx): string {
    let at = parent;
    let where = slot;
    const hasCall = (e: N) => {
      let found = false;
      walk(e, (m) => {
        if (m.type === 'CallExpression' && m.callee.type === 'Identifier' && this.functions.has(m.callee.name)) found = true;
      });
      return found;
    };
    // The guard reads each bound too; a call in a bound is evaluated once, into a temporary.
    const bounds: Array<N | string> = [loop.start, loop.bound].map((e, i) => {
      if (!hasCall(e)) return e;
      const name = `loop${i ? 'End' : 'Start'}${++this.tempCount}`;
      const tmp = this.add('variables_set', at, where, e, {VAR: name});
      this.expr(e, tmp, 'VALUE', ctx);
      at = tmp;
      where = 'next';
      return name;
    });
    const emitBound = (b: N | string, p: string, s: string) =>
      typeof b === 'string' ? this.get(b, p, s, n) : this.expr(b, p, s, ctx);

    const [from, to] = bounds;
    const fromNumber = typeof from === 'string' ? null : literalNumber(from);
    const toNumber = typeof to === 'string' ? null : literalNumber(to);
    const strict = loop.op === '<' || loop.op === '>';
    const alwaysRuns =
      fromNumber !== null && toNumber !== null &&
      (loop.up ? (strict ? fromNumber < toNumber : fromNumber <= toNumber) : (strict ? fromNumber > toNumber : fromNumber >= toNumber));

    let outer: string | null = null;
    if (!alwaysRuns) {
      outer = this.add('controls_if', at, where, n);
      const cmp = this.add('logic_compare', outer, 'IF0', n, {OP: COMPARE[loop.op]});
      emitBound(from, cmp, 'A');
      emitBound(to, cmp, 'B');
      at = outer;
      where = 'DO0';
    }
    const id = this.add('controls_for', at, where, n, {VAR: loop.counter});
    emitBound(from, id, 'FROM');
    // Blockly's loop includes its end; `<` and `>` do not.
    if (strict && toNumber !== null) {
      this.number(loop.up ? toNumber - 1 : toNumber + 1, id, 'TO', n);
    } else if (strict) {
      const adjust = this.add('math_arithmetic', id, 'TO', n, {OP: loop.up ? 'MINUS' : 'ADD'});
      emitBound(to, adjust, 'A');
      this.number(1, adjust, 'B', n);
    } else {
      emitBound(to, id, 'TO');
    }
    if (loop.step) this.expr(loop.step, id, 'BY', ctx);
    else this.number(1, id, 'BY', n);
    this.statements(this.bodyOf(n.body), id, 'DO', ctx);
    return outer ?? id;
  }

  /**
   * `for` as a while loop, for a bound that the body changes: Blockly reads the
   * bound once, JavaScript on every pass.
   */
  private whileLoop(n: N, loop: ReturnType<Translator['parseFor']>, parent: string, slot: string, ctx: Ctx): string {
    let hasContinue = false;
    const visit = (node: unknown, nested: boolean): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach((c) => visit(c, nested));
      const m = node as N;
      if (m.type === 'ContinueStatement' && !nested) hasContinue = true;
      const inner = nested || m.type === 'ForStatement' || m.type === 'WhileStatement' || m.type === 'ForOfStatement';
      for (const [k, v] of Object.entries(m)) if (k !== 'loc') visit(v, inner);
    };
    visit(n.body, false);
    if (hasContinue) {
      this.fail(n, 'this loop changes what its end depends on inside the body and also uses continue; work the end out before the loop, e.g. var end = ...; for (var i = 1; i <= end; i++)');
    }
    const init = this.add('variables_set', parent, slot, n, {VAR: loop.counter});
    this.expr(loop.start, init, 'VALUE', ctx);
    const id = this.add('controls_whileUntil', init, 'next', n, {MODE: 'WHILE'});
    const cmp = this.add('logic_compare', id, 'BOOL', n, {OP: COMPARE[loop.op]});
    this.get(loop.counter, cmp, 'A', n);
    this.expr(loop.bound, cmp, 'B', ctx);
    const last = this.statements(this.bodyOf(n.body), id, 'DO', ctx);
    const bump = this.add('math_change', last ?? id, last ? 'next' : 'DO', n, {VAR: loop.counter});
    if (loop.up) {
      if (loop.step) this.expr(loop.step, bump, 'DELTA', ctx);
      else this.number(1, bump, 'DELTA', n);
    } else {
      const k = loop.step ? literalNumber(loop.step) : 1;
      if (k !== null) this.number(-k, bump, 'DELTA', n);
      else {
        const neg = this.add('math_single', bump, 'DELTA', n, {OP: 'NEG'});
        this.expr(loop.step!, neg, 'NUM', ctx);
      }
    }
    return id;
  }

  // ---- expressions ------------------------------------------------------------

  /** A boolean input: a number (such as `n % 2`) is compared with 0, as JavaScript treats it. */
  private condition(n: N, parent: string, slot: string, ctx: Ctx): string {
    if (this.typeOf(n, ctx) === 'number') {
      const cmp = this.add('logic_compare', parent, slot, n, {OP: 'NEQ'});
      this.expr(n, cmp, 'A', ctx);
      this.number(0, cmp, 'B', n);
      return cmp;
    }
    return this.expr(n, parent, slot, ctx);
  }

  private expr(n: N, parent: string, slot: string, ctx: Ctx): string {
    switch (n.type) {
      case 'Literal':
        if (typeof n.value === 'number') return this.number(n.value, parent, slot, n);
        if (typeof n.value === 'string') return this.add('text', parent, slot, n, {TEXT: n.value});
        if (typeof n.value === 'boolean') return this.add('logic_boolean', parent, slot, n, {BOOL: n.value ? 'TRUE' : 'FALSE'});
        if (n.value === null) return this.add('logic_null', parent, slot, n);
        return this.fail(n, 'this value cannot be turned into a block');
      case 'Identifier':
        return this.get(n.name, parent, slot, n);
      case 'UnaryExpression': {
        if (n.operator === '-') {
          const k = literalNumber(n);
          if (k !== null) return this.number(k, parent, slot, n);
          const id = this.add('math_single', parent, slot, n, {OP: 'NEG'});
          this.expr(n.argument, id, 'NUM', ctx);
          return id;
        }
        const id = this.add('logic_negate', parent, slot, n);
        this.condition(n.argument, id, 'BOOL', ctx);
        return id;
      }
      case 'BinaryExpression': {
        if (n.operator === '%') {
          const id = this.add('math_modulo', parent, slot, n);
          this.expr(n.left, id, 'DIVIDEND', ctx);
          this.expr(n.right, id, 'DIVISOR', ctx);
          return id;
        }
        const compare = COMPARE[n.operator];
        const id = compare
          ? this.add('logic_compare', parent, slot, n, {OP: compare})
          : this.add('math_arithmetic', parent, slot, n, {OP: ARITHMETIC[n.operator]});
        this.expr(n.left, id, 'A', ctx);
        this.expr(n.right, id, 'B', ctx);
        return id;
      }
      case 'LogicalExpression': {
        const id = this.add('logic_operation', parent, slot, n, {OP: n.operator === '&&' ? 'AND' : 'OR'});
        this.condition(n.left, id, 'A', ctx);
        this.condition(n.right, id, 'B', ctx);
        return id;
      }
      case 'ConditionalExpression': {
        const id = this.add('logic_ternary', parent, slot, n);
        this.condition(n.test, id, 'IF', ctx);
        this.expr(n.consequent, id, 'THEN', ctx);
        this.expr(n.alternate, id, 'ELSE', ctx);
        return id;
      }
      case 'ArrayExpression': {
        const id = this.add('lists_create_with', parent, slot, n);
        (n.elements as N[]).forEach((e, i) => this.expr(e, id, `ADD${i}`, ctx));
        return id;
      }
      case 'MemberExpression': {
        if (n.computed) return this.indexRead(n, parent, slot, ctx);
        if (n.object.name === 'Math') return this.add('math_constant', parent, slot, n, {CONSTANT: n.property.name});
        const isText = this.typeOf(n.object, ctx) === 'text';
        const id = this.add(isText ? 'text_length' : 'lists_length', parent, slot, n);
        this.expr(n.object, id, 'VALUE', ctx);
        return id;
      }
      case 'CallExpression':
        return this.callExpression(n, parent, slot, ctx);
      default:
        return this.fail(n, `${n.type} cannot be turned into blocks`);
    }
  }

  /** list[i] and text[i]; both are 1-based, like the dialect. */
  private indexRead(n: N, parent: string, slot: string, ctx: Ctx): string {
    const isText = this.typeOf(n.object, ctx) === 'text';
    const id = isText
      ? this.add('text_charAt', parent, slot, n, {WHERE: 'FROM_START'})
      : this.add('lists_getIndex', parent, slot, n, {MODE: 'GET', WHERE: 'FROM_START'});
    this.expr(n.object, id, 'VALUE', ctx);
    this.expr(n.property, id, 'AT', ctx);
    return id;
  }

  private userCall(n: N, type: string, parent: string, slot: string, ctx: Ctx): string {
    const name = n.callee.name as string;
    const info = this.functions.get(name)!;
    if (n.arguments.length !== info.params.length) {
      this.fail(n, `"${name}" takes ${info.params.length} value${info.params.length === 1 ? '' : 's'} (${info.params.join(', ')}), but this call gives ${n.arguments.length}.`);
    }
    const id = this.add(type, parent, slot, n, {}, {name});
    (n.arguments as N[]).forEach((a, i) => this.expr(a, id, `ARG${i}`, ctx));
    return id;
  }

  private callExpression(n: N, parent: string, slot: string, ctx: Ctx): string {
    const c = n.callee as N;
    const args = n.arguments as N[];
    if (c.type === 'Identifier') {
      if (c.name === 'join') {
        const id = this.add('text_join', parent, slot, n);
        args.forEach((a, i) => this.expr(a, id, `ADD${i}`, ctx));
        return id;
      }
      const info = this.functions.get(c.name);
      if (info && !info.returns) {
        this.fail(n, `"${c.name}" does not return a value, so its result cannot be used here; add return <value>; to it, or call it as a statement`);
      }
      return this.userCall(n, 'procedures_callreturn', parent, slot, ctx);
    }
    const name = c.property.name as string;
    if (c.object.name === 'Math') return this.mathCall(name, n, parent, slot, ctx);
    const text: Record<string, [string, Record<string, string>]> = {
      toUpperCase: ['text_changeCase', {CASE: 'UPPERCASE'}],
      toLowerCase: ['text_changeCase', {CASE: 'LOWERCASE'}],
      trim: ['text_trim', {MODE: 'BOTH'}],
    };
    const [type, fields] = text[name];
    const id = this.add(type, parent, slot, n, fields);
    this.expr(c.object, id, 'TEXT', ctx);
    return id;
  }

  private mathCall(name: string, n: N, parent: string, slot: string, ctx: Ctx): string {
    const args = n.arguments as N[];
    if (name in MATH_SINGLE) {
      const id = this.add('math_single', parent, slot, n, {OP: MATH_SINGLE[name]});
      this.expr(args[0], id, 'NUM', ctx);
      return id;
    }
    if (name in MATH_ROUND) {
      const id = this.add('math_round', parent, slot, n, {OP: MATH_ROUND[name]});
      this.expr(args[0], id, 'NUM', ctx);
      return id;
    }
    if (name === 'pow') {
      const id = this.add('math_arithmetic', parent, slot, n, {OP: 'POWER'});
      this.expr(args[0], id, 'A', ctx);
      this.expr(args[1], id, 'B', ctx);
      return id;
    }
    if (name === 'max' || name === 'min') {
      const id = this.add('math_on_list', parent, slot, n, {OP: name === 'max' ? 'MAX' : 'MIN'});
      const items = this.add('lists_create_with', id, 'LIST', n);
      args.forEach((a, i) => this.expr(a, items, `ADD${i}`, ctx));
      return id;
    }
    // Blockly's trigonometry works in degrees; the dialect's Math.sin etc. in radians.
    if (name === 'sin' || name === 'cos' || name === 'tan') {
      const id = this.add('math_trig', parent, slot, n, {OP: MATH_TRIG[name]});
      const div = this.add('math_arithmetic', id, 'NUM', n, {OP: 'DIVIDE'});
      const times = this.add('math_arithmetic', div, 'A', n, {OP: 'MULTIPLY'});
      this.expr(args[0], times, 'A', ctx);
      this.number(180, times, 'B', n);
      this.add('math_constant', div, 'B', n, {CONSTANT: 'PI'});
      return id;
    }
    const div = this.add('math_arithmetic', parent, slot, n, {OP: 'DIVIDE'});
    const times = this.add('math_arithmetic', div, 'A', n, {OP: 'MULTIPLY'});
    const trig = this.add('math_trig', times, 'A', n, {OP: MATH_TRIG[name]});
    this.expr(args[0], trig, 'NUM', ctx);
    this.add('math_constant', times, 'B', n, {CONSTANT: 'PI'});
    this.number(180, div, 'B', n);
    return div;
  }
}
