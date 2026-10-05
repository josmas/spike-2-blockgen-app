import './helpers/setup';
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {appendResponse} from '../../src/append';
import {EXAMPLES, FLAT_EXTRA_EXAMPLES} from '../../src/llm/examples';
import {buildFromFlat, formatFlat, nestedToFlat} from '../../src/llm/flat';
import type {FlatBlock} from '../../src/llm/flat';
import type {ModelResponse} from '../../src/llm/parse';
import {validate} from '../../src/llm/validate';
import {generateJs, newWorkspace} from './helpers/blockly';
import {runGenerated} from './helpers/sandbox';

const B = (id: string, type: string, parent = '', slot = '', fields: FlatBlock['fields'] = [], extra: Partial<FlatBlock> = {}): FlatBlock => ({
  id, type, parent, slot, name: '', params: [], fields, ...extra,
});
const F = (name: string, value: string) => ({name, value});
const asResponse = (r: unknown) => r as ModelResponse;

/** Finds the first nested block of a type. */
function find(node: unknown, type: string): Record<string, any> | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const c of node) { const r = find(c, type); if (r) return r; }
    return null;
  }
  const n = node as Record<string, any>;
  if (n.type === type) return n;
  for (const v of Object.values(n)) { const r = find(v, type); if (r) return r; }
  return null;
}

describe('flat format: every worked example survives nested -> flat -> nested', () => {
  const expected = ['isEven(4) = true', 'isPrime(7) = true', 'swapNeighbors([3, 1, 2], 1) = 1,3,2'];
  [...EXAMPLES, ...FLAT_EXTRA_EXAMPLES].forEach((example, i) => {
    it(example.request, () => {
      const original = asResponse(example.response);
      const text = formatFlat(nestedToFlat(original));
      const built = buildFromFlat(JSON.parse(text));
      assert.deepEqual(built.errors, []);
      assert.ok(built.response);
      assert.deepEqual(validate(built.response!, newWorkspace()), []);
      const js = generateJs(built.response!);
      assert.equal(js, generateJs(original), 'same generated JavaScript');
      assert.equal(runGenerated(js).output[0], expected[i]);
    });
  });
  it('writes one block per line, so there are no long runs of closing braces to count', () => {
    const text = formatFlat(nestedToFlat(asResponse(EXAMPLES[1].response)));
    assert.ok(text.split('\n').length > 10);
    assert.ok(!/\}{4}/.test(text));
  });
});

describe('flat format: the builder derives what the model should not write', () => {
  const program: FlatBlock[] = [
    B('b1', 'variables_set', '', '', [F('VAR', 's')]), B('b2', 'math_number', 'b1', 'VALUE', [F('NUM', '0')]),
    B('b3', 'controls_for', 'b1', 'next', [F('VAR', 'i')]), B('b4', 'math_number', 'b3', 'FROM', [F('NUM', '1')]), B('b5', 'math_number', 'b3', 'TO', [F('NUM', '5')]), B('b6', 'math_number', 'b3', 'BY', [F('NUM', '1')]),
    B('b7', 'controls_if', 'b3', 'DO'),
    B('b8', 'logic_compare', 'b7', 'IF0', [F('OP', 'EQ')]), B('b9', 'math_modulo', 'b8', 'A'), B('b10', 'variables_get', 'b9', 'DIVIDEND', [F('VAR', 'i')]), B('b11', 'math_number', 'b9', 'DIVISOR', [F('NUM', '2')]), B('b12', 'math_number', 'b8', 'B', [F('NUM', '0')]),
    B('b13', 'math_change', 'b7', 'DO0', [F('VAR', 's')]), B('b14', 'variables_get', 'b13', 'DELTA', [F('VAR', 'i')]),
    B('b15', 'math_change', 'b7', 'ELSE', [F('VAR', 's')]), B('b16', 'math_number', 'b15', 'DELTA', [F('NUM', '100')]),
    B('b17', 'add_text', 'b3', 'next'), B('b18', 'text_join', 'b17', 'TEXT'), B('b19', 'text', 'b18', 'ADD0', [F('TEXT', 's = ')]), B('b20', 'variables_get', 'b18', 'ADD1', [F('VAR', 's')]),
  ];
  it('builds a function-free program with if/else and chained statements, and it runs', () => {
    const built = buildFromFlat({blocks: program});
    assert.deepEqual(built.errors, []);
    assert.deepEqual(validate(built.response!, newWorkspace()), []);
    assert.deepEqual(runGenerated(generateJs(built.response!)).output, ['s = 306']);
  });
  it('derives else, item counts, variable ids and the variables list', () => {
    const response = buildFromFlat({blocks: program}).response!;
    const blocks = response.workspaceJson.blocks.blocks;
    assert.deepEqual(find(blocks, 'controls_if')!.extraState, {elseIfCount: 0, hasElse: true});
    assert.deepEqual(find(blocks, 'text_join')!.extraState, {itemCount: 2});
    assert.deepEqual(response.workspaceJson.variables, [{name: 's', id: 'v1'}, {name: 'i', id: 'v2'}]);
  });
  it('derives call parameters from the definition, and from the workspace for existing functions', () => {
    const ws = newWorkspace();
    appendResponse(ws, JSON.parse(JSON.stringify(EXAMPLES[0].response)));
    const call: FlatBlock[] = [
      B('c1', 'add_text'), B('c2', 'text_join', 'c1', 'TEXT'), B('c3', 'text', 'c2', 'ADD0', [F('TEXT', 'isEven(10) = ')]),
      B('c4', 'procedures_callreturn', 'c2', 'ADD1', [], {name: 'isEven'}), B('c5', 'math_number', 'c4', 'ARG0', [F('NUM', '10')]),
    ];
    const built = buildFromFlat({blocks: call}, new Map([['isEven', ['n']]]));
    assert.deepEqual(built.errors, []);
    assert.deepEqual(find(built.response!.workspaceJson.blocks.blocks, 'procedures_callreturn')!.extraState, {name: 'isEven', params: ['n']});
    assert.deepEqual(validate(built.response!, ws), []);
  });
  it('tolerates a model that writes null properties and object-style fields', () => {
    const loose = {blocks: [{id: 'x1', type: 'add_text', parent: null, slot: null, fields: null}, {id: 'x2', type: 'text', parent: 'x1', slot: 'TEXT', fields: {TEXT: 'hi'}}]};
    const built = buildFromFlat(loose);
    assert.deepEqual(built.errors, []);
    assert.deepEqual(validate(built.response!, newWorkspace()), []);
  });
});

describe('flat format: wiring mistakes get a message that names the block and says what to do', () => {
  const sigs = new Map([['isEven', ['n']]]);
  const cases: Array<[string, FlatBlock[], string]> = [
    ['unknown parent', [B('a', 'add_text'), B('b', 'text', 'zzz', 'TEXT')], 'its parent "zzz" does not exist'],
    ['parent without a slot', [B('a', 'add_text'), B('b', 'text', 'a', '')], 'a parent but no slot'],
    ['slot without a parent', [B('a', 'add_text', '', 'TEXT')], 'but no parent'],
    ['duplicate id', [B('a', 'add_text'), B('a', 'text')], 'used more than once'],
    ['parents that loop', [B('a', 'add_text', 'b', 'next'), B('b', 'add_text', 'a', 'next')], 'form a loop'],
    ['definition without a name', [B('a', 'procedures_defreturn')], 'needs a "name"'],
    ['call to an unknown function', [B('a', 'add_text'), B('b', 'procedures_callreturn', 'a', 'TEXT', [], {name: 'nope'})], 'neither defined in your reply nor in the workspace'],
    ['too many arguments', [B('a', 'add_text'), B('b', 'procedures_callreturn', 'a', 'TEXT', [], {name: 'isEven'}), B('c', 'math_number', 'b', 'ARG1', [F('NUM', '1')])], 'does not exist on the call to "isEven"'],
    ['a number that is not a number', [B('a', 'add_text'), B('n', 'math_number', 'a', 'TEXT', [F('NUM', 'abc')])], 'needs a numeric field NUM'],
    ['a variable without a name', [B('a', 'add_text'), B('v', 'variables_get', 'a', 'TEXT')], 'needs the field VAR'],
    ['a value block at top level', [B('a', 'math_number', '', '', [F('NUM', '1')])], 'cannot be top-level'],
    ['next after a value block', [B('a', 'add_text'), B('t', 'text', 'a', 'TEXT', [F('TEXT', 'x')]), B('n', 'text', 't', 'next')], 'only follows a statement'],
    ['a value block in a DO slot', [B('f', 'controls_for', '', '', [F('VAR', 'i')]), B('v', 'math_number', 'f', 'DO', [F('NUM', '1')])], 'holds statements'],
    ['a statement block in a value slot', [B('a', 'add_text'), B('s', 'add_text', 'a', 'TEXT')], 'holds a value'],
    ['a function definition nested in a block', [B('a', 'controls_repeat_ext'), B('d', 'procedures_defnoreturn', 'a', 'DO', [], {name: 'f'})], 'must be top-level'],
    ['next after a function definition', [B('d', 'procedures_defreturn', '', '', [], {name: 'f'}), B('a', 'add_text', 'd', 'next')], 'separate top-level block'],
    ['two blocks in one slot: a duplicate', [B('a', 'add_text'), B('b', 'text', 'a', 'TEXT', [F('TEXT', 'x')]), B('c', 'text', 'a', 'TEXT', [F('TEXT', 'x')])], 'second copy of "b"'],
    ['an operand given the wrong parent', [B('a', 'add_text'), B('j', 'math_arithmetic', 'a', 'TEXT', [F('OP', 'ADD')]), B('x', 'math_number', 'a', 'TEXT', [F('NUM', '1')])], 'operand of "j"'],
    ['a second statement in a DO slot', [B('r', 'controls_repeat_ext'), B('t', 'math_number', 'r', 'TIMES', [F('NUM', '2')]), B('s1', 'add_text', 'r', 'DO'), B('s2', 'add_text', 'r', 'DO')], 'chain each further one'],
    ['a clash with no obvious cause gets the fallback hint', [B('a', 'add_text'), B('b', 'text', 'a', 'TEXT', [F('TEXT', 'x')]), B('c', 'text_join', 'a', 'TEXT')], 'repeats a block you already listed'],
  ];
  for (const [name, blocks, expected] of cases) {
    it(name, () => {
      const errors = buildFromFlat({blocks}, sigs).errors;
      assert.ok(errors.length > 0, 'expected an error');
      assert.ok(errors[0].includes(expected), `"${expected}" not in: ${errors[0]}`);
    });
  }
  it('does not call two ordinary statements "copies"', () => {
    const errors = buildFromFlat({blocks: cases[18][1]}, sigs).errors;
    assert.ok(!errors[0].includes('second copy'));
  });
  it('suggests the empty slots of an operator ("A, B") when a block is chained after a value', () => {
    const errors = buildFromFlat({blocks: [B('a', 'add_text'), B('s', 'math_arithmetic', 'a', 'TEXT', [F('OP', 'ADD')]), B('x', 'math_number', 's', 'next', [F('NUM', '1')])]}).errors;
    assert.ok(errors[0].includes('empty slots instead (A, B)'));
  });
});
