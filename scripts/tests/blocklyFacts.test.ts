import './helpers/setup';
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {buildFromFlat} from '../../src/llm/flat';
import type {FlatBlock} from '../../src/llm/flat';
import {validate} from '../../src/llm/validate';
import {generateJs, newWorkspace} from './helpers/blockly';
import {runGenerated} from './helpers/sandbox';

/**
 * Facts about Blockly that the code-to-blocks translator relies on, each
 * verified headlessly. If one of these fails after a Blockly upgrade, the
 * translator's mapping (STAGE2_PLAN.md section 7) needs a second look.
 */

/** A small tree notation, flattened into the flat format the translator will emit. */
interface N {
  t: string;
  f?: Record<string, string>;
  s?: Record<string, N>;
  name?: string;
  params?: string[];
}
const n = (t: string, f: N['f'] = {}, s: N['s'] = {}, extra: Partial<N> = {}): N => ({t, f, s, ...extra});
const num = (v: number) => n('math_number', {NUM: String(v)});
const v = (name: string) => n('variables_get', {VAR: name});
const text = (s: string) => n('text', {TEXT: s});
const chain = (...stmts: N[]): N => {
  for (let i = stmts.length - 2; i >= 0; i--) stmts[i] = {...stmts[i], s: {...stmts[i].s, next: stmts[i + 1]}};
  return stmts[0];
};
/** print(expr): add_text of a text_join, so any value type is accepted. */
const print = (expr: N) => n('add_text', {}, {TEXT: n('text_join', {}, {ADD0: expr})});
const set = (name: string, value: N) => n('variables_set', {VAR: name}, {VALUE: value});
const list = (...items: N[]) => n('lists_create_with', {}, Object.fromEntries(items.map((x, i) => [`ADD${i}`, x])));

function flatten(roots: N[]): FlatBlock[] {
  const out: FlatBlock[] = [];
  let next = 1;
  const visit = (node: N, parent: string, slot: string) => {
    const id = `b${next++}`;
    out.push({
      id, type: node.t, parent, slot, name: node.name ?? '', params: node.params ?? [],
      fields: Object.entries(node.f ?? {}).map(([name, value]) => ({name, value})),
    });
    for (const [s, child] of Object.entries(node.s ?? {})) visit(child, id, s);
  };
  roots.forEach((r) => visit(r, '', ''));
  return out;
}

interface Outcome {
  buildErrors: string[];
  validationErrors: string[];
  js: string;
  output: string[];
  runtimeError: string | null;
}
function run(...roots: N[]): Outcome {
  const built = buildFromFlat({summary: 's', blocks: flatten(roots)});
  if (!built.response) return {buildErrors: built.errors, validationErrors: [], js: '', output: [], runtimeError: null};
  const validationErrors = validate(built.response, newWorkspace());
  if (validationErrors.length) return {buildErrors: [], validationErrors, js: '', output: [], runtimeError: null};
  const js = generateJs(built.response);
  const exec = runGenerated(js);
  return {buildErrors: [], validationErrors: [], js, output: exec.output, runtimeError: exec.error};
}
/** Asserts the blocks build, validate and run, and returns the printed lines. */
function ok(...roots: N[]): string[] {
  const r = run(...roots);
  assert.deepEqual([r.buildErrors, r.validationErrors, r.runtimeError], [[], [], null], r.js);
  return r.output;
}
const fn = (name: string, params: string[], body: N | null, ret: N | null): N =>
  n(ret ? 'procedures_defreturn' : 'procedures_defnoreturn', {}, {...(body ? {STACK: body} : {}), ...(ret ? {RETURN: ret} : {})}, {name, params});
const callReturn = (name: string, ...args: N[]) =>
  n('procedures_callreturn', {}, Object.fromEntries(args.map((a, i) => [`ARG${i}`, a])), {name});
const callNoReturn = (name: string, ...args: N[]) =>
  n('procedures_callnoreturn', {}, Object.fromEntries(args.map((a, i) => [`ARG${i}`, a])), {name});

describe('(a) lists_getIndex and text blocks', () => {
  const getIndex = (value: N, at: number) =>
    n('lists_getIndex', {MODE: 'GET', WHERE: 'FROM_START'}, {VALUE: value, AT: num(at)});
  it('accepts a variable holding text, and generates x[i - 1]', () => {
    const out = ok(chain(set('s', text('abc')), print(getIndex(v('s'), 2))));
    assert.deepEqual(out, ['b']);
  });
  it('a text literal or text_join plugged straight into VALUE is rejected or accepted (recorded here)', () => {
    const literal = run(print(getIndex(text('abc'), 2)));
    const joined = run(print(getIndex(n('text_join', {}, {ADD0: text('ab'), ADD1: text('c')}), 3)));
    // Whatever Blockly does, the translator must know. These assertions pin it down.
    assert.equal(literal.buildErrors.length + literal.validationErrors.length > 0, LITERAL_REJECTED, JSON.stringify(literal));
    assert.equal(joined.buildErrors.length + joined.validationErrors.length > 0, LITERAL_REJECTED, JSON.stringify(joined));
  });
});
const LITERAL_REJECTED = true;

describe('(b) procedures_ifreturn', () => {
  const ifReturn = (cond: N, value?: N) => n('procedures_ifreturn', {}, {CONDITION: cond, ...(value ? {VALUE: value} : {})});
  const yes = n('logic_boolean', {BOOL: 'TRUE'});
  it('inside a defreturn, a mid-body ifreturn generates return', () => {
    const f = fn('f', ['x'], ifReturn(n('logic_compare', {OP: 'LT'}, {A: v('x'), B: num(0)}), num(-1)), num(1));
    const r = run(f, print(callReturn('f', num(-5))), print(callReturn('f', num(5))));
    assert.deepEqual([r.buildErrors, r.validationErrors, r.runtimeError], [[], [], null], r.js);
    assert.deepEqual(r.output, ['-1', '1']);
    assert.match(r.js, /if \(x < 0\) \{\s*return -1;/);
  });
  it('inside a defnoreturn, an ifreturn without VALUE generates a return (null) and skips the rest', () => {
    const f = fn('g', ['x'], chain(ifReturn(yes), print(text('after'))), null);
    const r = run(f, callNoReturn('g', num(1)));
    assert.deepEqual([r.buildErrors, r.validationErrors, r.runtimeError], [[], [], null], r.js);
    assert.deepEqual(r.output, []);
    // Blockly writes "return null;" here, not a bare "return;": harmless, the caller ignores it.
    assert.match(r.js, /return null;/);
  });
  it('a defreturn with no RETURN block is rejected, so the translator fills a logic_null', () => {
    const f = n('procedures_defreturn', {}, {STACK: print(text('x'))}, {name: 'h', params: []});
    const r = run(f);
    assert.ok(r.buildErrors.length + r.validationErrors.length > 0);
    assert.deepEqual(ok(fn('h', [], print(text('x')), n('logic_null')), set('ignored', callReturn('h'))), ['x']);
  });
});

describe('(c) math_on_list with lists_create_with', () => {
  it('MAX and MIN of a literal list', () => {
    const op = (o: string, ...items: N[]) => n('math_on_list', {OP: o}, {LIST: list(...items)});
    assert.deepEqual(ok(print(op('MAX', num(3), num(9), num(4)))), ['9']);
    assert.deepEqual(ok(print(op('MIN', num(3), num(9), num(4)))), ['3']);
    assert.deepEqual(ok(print(op('MAX', num(-1), num(-7)))), ['-1']);
  });
});

describe('(d) controls_for', () => {
  const forLoop = (from: N, to: N, by: N, body: N) => n('controls_for', {VAR: 'i'}, {FROM: from, TO: to, BY: by, DO: body});
  const collect = (from: number, to: number, by: number) =>
    ok(chain(set('acc', text('')), forLoop(num(from), num(to), num(by), set('acc', n('text_join', {}, {ADD0: v('acc'), ADD1: v('i'), ADD2: text(' ')}))), print(v('acc'))))[0];
  it('counts up and down by a positive step (Blockly flips the direction itself)', () => {
    assert.equal(collect(1, 5, 1), '1 2 3 4 5 ');
    assert.equal(collect(1, 10, 3), '1 4 7 10 ');
    assert.equal(collect(5, 1, 1), '5 4 3 2 1 ');
    assert.equal(collect(10, 1, 3), '10 7 4 1 ');
  });
  it('QUIRK: an empty range runs backwards, so "from 1 to 0" executes twice', () => {
    assert.equal(collect(1, 0, 1), '1 0 ');
  });
  it('the guard shape fixes it: if (from <= to) { for ... } runs zero times', () => {
    const guarded = (from: number, to: number) =>
      ok(chain(
        set('acc', text('')),
        n('controls_if', {}, {
          IF0: n('logic_compare', {OP: 'LTE'}, {A: num(from), B: num(to)}),
          DO0: forLoop(num(from), num(to), num(1), set('acc', n('text_join', {}, {ADD0: v('acc'), ADD1: v('i'), ADD2: text(' ')}))),
        }),
        print(v('acc')),
      ))[0];
    assert.equal(guarded(1, 0), '');
    assert.equal(guarded(1, 3), '1 2 3 ');
    assert.equal(guarded(2, 2), '2 ');
  });
  it('the counter ends one past the last value, like JavaScript (up, down, and with non-literal bounds)', () => {
    // STAGE2_PLAN.md section 8 assumed "i = end"; the generated for loop leaves end + 1 (end - 1 downward).
    const after = (from: N, to: N, by: number) =>
      ok(chain(forLoop(from, to, num(by), n('math_change', {VAR: 'acc'}, {DELTA: num(0)})), print(v('i'))))[0];
    assert.equal(after(num(1), num(3), 1), '4');
    assert.equal(after(num(3), num(1), 1), '0');
    assert.equal(after(num(1), n('math_arithmetic', {OP: 'ADD'}, {A: num(1), B: num(2)}), 1), '4');
    assert.equal(after(n('math_arithmetic', {OP: 'ADD'}, {A: num(3), B: num(0)}), num(1), 1), '0');
  });
  it('the bound is evaluated once, not on every pass (JavaScript re-evaluates it)', () => {
    // for i = 1 to length(xs), pushing onto xs inside the body: JS would never finish, Blockly runs 2 times.
    const push = n('lists_setIndex', {MODE: 'INSERT', WHERE: 'LAST'}, {LIST: v('xs'), TO: num(0)});
    const out = ok(chain(set('xs', list(num(1), num(2))), forLoop(num(1), n('lists_length', {}, {VALUE: v('xs')}), num(1), push), print(n('lists_length', {}, {VALUE: v('xs')}))));
    assert.deepEqual(out, ['4']);
  });
});

describe('(e) text_charAt', () => {
  it('FROM_START is 1-based', () => {
    const at = (i: number) => n('text_charAt', {WHERE: 'FROM_START'}, {VALUE: text('hello'), AT: num(i)});
    assert.deepEqual(ok(print(at(1)), print(at(5))), ['h', 'o']);
  });
});

describe('(f) lists_setIndex', () => {
  it('INSERT at LAST needs no AT, and SET FROM_START is 1-based', () => {
    const out = ok(chain(
      set('xs', list(num(1), num(2))),
      n('lists_setIndex', {MODE: 'INSERT', WHERE: 'LAST'}, {LIST: v('xs'), TO: num(3)}),
      n('lists_setIndex', {MODE: 'SET', WHERE: 'FROM_START'}, {LIST: v('xs'), AT: num(1), TO: num(9)}),
      print(n('lists_getIndex', {MODE: 'GET', WHERE: 'FROM_START'}, {VALUE: v('xs'), AT: num(1)})),
      print(n('lists_length', {}, {VALUE: v('xs')})),
    ));
    assert.deepEqual(out, ['9', '3']);
  });
});

describe('(g) a call to a value-returning function used as a statement', () => {
  it('a procedures_callreturn cannot stand alone as a statement', () => {
    const r = run(fn('f', [], null, num(1)), callReturn('f'));
    assert.ok(r.buildErrors.length + r.validationErrors.length > 0, 'expected a rejection');
  });
  it('assigning the result to a throwaway variable works', () => {
    assert.deepEqual(ok(fn('f', [], print(text('ran')), num(1)), set('ignored', callReturn('f'))), ['ran']);
  });
  it('a procedures_callnoreturn to a defreturn is not an option: the validator or Blockly says so (recorded)', () => {
    const r = run(fn('f', [], null, num(1)), callNoReturn('f'));
    assert.equal(r.buildErrors.length + r.validationErrors.length > 0 || r.runtimeError !== null, false, JSON.stringify(r));
  });
});
