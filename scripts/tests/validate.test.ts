import './helpers/setup';
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {appendResponse} from '../../src/append';
import {EXAMPLES} from '../../src/llm/examples';
import type {ModelResponse} from '../../src/llm/parse';
import {validate} from '../../src/llm/validate';
import {newWorkspace} from './helpers/blockly';

type Json = Record<string, any>;
const num = (n: number): Json => ({block: {type: 'math_number', fields: {NUM: n}}});
const txt = (s: string): Json => ({block: {type: 'text', fields: {TEXT: s}}});
const get = (id: string): Json => ({block: {type: 'variables_get', fields: {VAR: {id}}}});
const say = (inner: Json): Json => ({type: 'add_text', inputs: {TEXT: {block: inner}}});
const set = (next?: Json): Json => ({type: 'variables_set', fields: {VAR: {id: 'v_x'}}, inputs: {VALUE: num(1)}, ...(next ? {next: {block: next}} : {})});
const resp = (blocks: unknown[], variables: Array<{name: string; id: string}> = [{name: 'x', id: 'v_x'}]) =>
  ({workspaceJson: {blocks: {languageVersion: 0, blocks}, variables}}) as unknown as ModelResponse;
const errorsFor = (r: ModelResponse, ws = newWorkspace()) => validate(JSON.parse(JSON.stringify(r)), ws);

describe('validation: structure, names and variables', () => {
  const cases: Array<[string, ModelResponse, string]> = [
    ['an unknown block type', resp([{type: 'made_up_block'}]), 'not in the allowed list'],
    ['an empty block list', resp([]), 'non-empty array'],
    ['a null entry (the validator used to crash on it)', resp([null]), 'must be a block object'],
    ['a function definition without a name', resp([{type: 'procedures_defreturn', inputs: {RETURN: num(1)}}]), 'has no function name'],
    ['the same function defined twice', resp([{type: 'procedures_defnoreturn', fields: {NAME: 'dup'}}, {type: 'procedures_defnoreturn', fields: {NAME: 'dup'}}]), 'defined more than once'],
    ['a call to a function nobody defines', resp([{type: 'procedures_callreturn', extraState: {name: 'missing', params: []}}]), 'never defined'],
    ['a variable id that is not listed', resp([say(get('nope').block)]), 'not listed in "variables"'],
  ];
  for (const [name, response, expected] of cases) {
    it(name, () => {
      const errors = errorsFor(response);
      assert.ok(errors.some((e) => e.includes(expected)), `"${expected}" not in ${JSON.stringify(errors)}`);
    });
  }

  it('rejects redefining a function that already exists in the workspace, and accepts calling it', () => {
    const ws = newWorkspace();
    appendResponse(ws, JSON.parse(JSON.stringify(EXAMPLES[0].response)));
    assert.ok(errorsFor(EXAMPLES[0].response as unknown as ModelResponse, ws).some((e) => e.includes('already exists')));
    const call = resp([say({type: 'procedures_callreturn', extraState: {name: 'isEven', params: ['n']}, inputs: {ARG0: num(3)}})], []);
    assert.deepEqual(errorsFor(call, ws), []);
  });

  it('accepts the worked examples', () => {
    for (const example of EXAMPLES) assert.deepEqual(errorsFor(example.response as unknown as ModelResponse), [], example.request);
  });
});

describe('validation: blocks plugged into the wrong kind of slot', () => {
  const cases: Array<[string, ModelResponse, string]> = [
    ['a number in the DO of a loop', resp([{type: 'controls_for', fields: {VAR: {id: 'v_x'}}, inputs: {FROM: num(1), TO: num(3), BY: num(1), DO: {block: {type: 'math_number', fields: {NUM: 1}}}}}]), 'needs a statement block'],
    ['an expression in a next chain', resp([set({type: 'math_arithmetic', fields: {OP: 'ADD'}, inputs: {A: num(1), B: num(2)}})]), 'needs a statement block'],
    ['a number at top level', resp([{type: 'math_number', fields: {NUM: 5}}]), 'must be plugged into an input'],
    ['a statement in a value input', resp([{type: 'variables_set', fields: {VAR: {id: 'v_x'}}, inputs: {VALUE: {block: set()}}}]), 'needs a value block'],
    ['a value block in an else-if branch (a mutator input)', resp([{type: 'controls_if', extraState: {elseIfCount: 1, hasElse: false}, inputs: {IF0: {block: {type: 'logic_boolean'}}, IF1: {block: {type: 'logic_boolean'}}, DO1: {block: {type: 'math_number', fields: {NUM: 1}}}}}]), 'needs a statement block'],
    ['a function definition nested in a loop', resp([{type: 'controls_repeat_ext', inputs: {TIMES: num(1), DO: {block: {type: 'procedures_defnoreturn', fields: {NAME: 'f'}}}}}]), 'top-level block'],
    ['a next after a function definition', resp([{type: 'procedures_defreturn', fields: {NAME: 'f'}, inputs: {RETURN: num(1)}, next: {block: say(txt('x').block)}}]), 'cannot have a "next"'],
    ['an input written without its "block" wrapper', resp([{type: 'add_text', inputs: {TEXT: {type: 'text', fields: {TEXT: 'x'}}}}]), 'must be written as'],
    ['a next written without its "block" wrapper', resp([{type: 'add_text', inputs: {TEXT: txt('x')}, next: say(txt('y').block)}]), 'must be written as'],
  ];
  for (const [name, response, expected] of cases) {
    it(name, () => {
      const errors = errorsFor(response);
      assert.ok(errors.some((e) => e.includes(expected)), `"${expected}" not in ${JSON.stringify(errors)}`);
    });
  }
});

describe('validation: value types and dropdowns', () => {
  it('a number plugged into add_text is explained, with the fix', () => {
    const errors = errorsFor(resp([say({type: 'math_arithmetic', fields: {OP: 'ADD'}, inputs: {A: num(1), B: num(2)}})]));
    assert.ok(errors[0].includes('accepts ["String"]') && errors[0].includes('text_join'), errors[0]);
  });
  it('the same number wrapped in text_join is fine', () => {
    const join = {type: 'text_join', extraState: {itemCount: 2}, inputs: {ADD0: txt('r = '), ADD1: {block: {type: 'math_arithmetic', fields: {OP: 'ADD'}, inputs: {A: num(1), B: num(2)}}}}};
    assert.deepEqual(errorsFor(resp([say(join)])), []);
  });
  it('a boolean plugged into a math input is rejected with the types named', () => {
    const join = {type: 'text_join', extraState: {itemCount: 2}, inputs: {ADD0: txt('r = '), ADD1: {block: {type: 'math_arithmetic', fields: {OP: 'ADD'}, inputs: {A: {block: {type: 'logic_boolean'}}, B: num(2)}}}}};
    const errors = errorsFor(resp([say(join)]));
    assert.ok(errors[0].includes('accepts ["Number"]') && errors[0].includes('["Boolean"]'), errors[0]);
  });
  it('an invalid dropdown value is an error, not a silent default', () => {
    const join = {type: 'text_join', extraState: {itemCount: 2}, inputs: {ADD0: txt('r = '), ADD1: {block: {type: 'math_arithmetic', fields: {OP: 'PLUS'}, inputs: {A: num(1), B: num(2)}}}}};
    assert.ok(errorsFor(resp([say(join)])).some((e) => e.includes('Blockly warning')));
  });
});
