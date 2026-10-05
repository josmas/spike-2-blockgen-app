import './helpers/setup';
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {checkRequiredInputs} from '../../src/llm/required';

type Json = Record<string, any>;
const num = (n: number): Json => ({block: {type: 'math_number', fields: {NUM: n}}});
const get = (id: string): Json => ({block: {type: 'variables_get', fields: {VAR: {id}}}});
const say = (inner?: Json): Json => ({type: 'add_text', ...(inner ? {inputs: {TEXT: {block: inner}}} : {})});
const text = (s: string): Json => ({type: 'text', fields: {TEXT: s}});

describe('required inputs: a block that needs a value input must have one', () => {
  const flagged: Array<[string, Json[]]> = [
    ['add_text with no TEXT', [say()]],
    ['lists_length with no VALUE', [say({type: 'lists_length'})]],
    ['a comparison missing B', [{type: 'controls_if', inputs: {IF0: {block: {type: 'logic_compare', fields: {OP: 'EQ'}, inputs: {A: num(1)}}}}}]],
    ['controls_if with no condition', [{type: 'controls_if'}]],
    ['else-if branch DO1 without IF1', [{type: 'controls_if', inputs: {IF0: {block: {type: 'logic_boolean'}}, DO1: {block: say(text('x'))}}}]],
    ['a function that returns a value but has no RETURN', [{type: 'procedures_defreturn', fields: {NAME: 'f'}}]],
    ['variables_set with no VALUE', [{type: 'variables_set', fields: {VAR: {id: 'v'}}}]],
    ['a call missing its second argument', [say({type: 'procedures_callreturn', extraState: {name: 'f', params: ['x', 'y']}, inputs: {ARG0: num(1)}})]],
    ['lists_getIndex FROM_START without AT', [say({type: 'lists_getIndex', fields: {MODE: 'GET', WHERE: 'FROM_START'}, inputs: {VALUE: get('l')}})]],
    ['lists_getIndex with the default WHERE and no AT', [say({type: 'lists_getIndex', inputs: {VALUE: get('l')}})]],
    ['DIVISIBLE_BY without DIVISOR', [say({type: 'math_number_property', fields: {PROPERTY: 'DIVISIBLE_BY'}, inputs: {NUMBER_TO_CHECK: num(6)}})]],
    ['an empty input deep inside a loop', [{type: 'controls_for', fields: {VAR: {id: 'i'}}, inputs: {FROM: num(1), TO: num(3), DO: {block: {type: 'variables_set', fields: {VAR: {id: 'v'}}}}}}]],
  ];
  for (const [name, tops] of flagged) {
    it(`flags: ${name}`, () => assert.equal(checkRequiredInputs(tops).length, 1, JSON.stringify(checkRequiredInputs(tops))));
  }

  const fine: Array<[string, Json[]]> = [
    ['a count-with loop without BY (defaults to 1)', [{type: 'controls_for', fields: {VAR: {id: 'i'}}, inputs: {FROM: num(1), TO: num(3)}}]],
    ['lists_getIndex with WHERE FIRST and no AT', [say({type: 'lists_getIndex', fields: {MODE: 'GET', WHERE: 'FIRST'}, inputs: {VALUE: get('l')}})]],
    ['lists_getIndex with WHERE LAST and no AT', [say({type: 'lists_getIndex', fields: {MODE: 'GET', WHERE: 'LAST'}, inputs: {VALUE: get('l')}})]],
    ['an EVEN number property without DIVISOR', [say({type: 'math_number_property', fields: {PROPERTY: 'EVEN'}, inputs: {NUMBER_TO_CHECK: num(6)}})]],
    ['a text_join with an empty item', [say({type: 'text_join', extraState: {itemCount: 3}, inputs: {ADD0: {block: text('a')}}})]],
    ['an empty list (itemCount 0)', [say({type: 'lists_create_with', extraState: {itemCount: 0}})]],
    ['a function with no STACK body that returns a value', [{type: 'procedures_defreturn', fields: {NAME: 'f'}, inputs: {RETURN: num(1)}}]],
    ['a function with no body and no return value', [{type: 'procedures_defnoreturn', fields: {NAME: 'f'}}]],
    ['a call with all its arguments', [say({type: 'procedures_callreturn', extraState: {name: 'f', params: ['x']}, inputs: {ARG0: num(1)}})]],
  ];
  for (const [name, tops] of fine) it(`accepts: ${name}`, () => assert.deepEqual(checkRequiredInputs(tops), []));

  it('names the block by id when the flat builder supplied one, and says where to put the block', () => {
    const [message] = checkRequiredInputs([{type: 'add_text', id: 'b7'}]);
    assert.match(message, /block "b7"/);
    assert.match(message, /parent is "b7" and whose slot is "TEXT"/);
  });
  it('without an id, says the input needs a block plugged in', () => {
    assert.match(checkRequiredInputs([say()])[0], /needs a block plugged in/);
  });
});
