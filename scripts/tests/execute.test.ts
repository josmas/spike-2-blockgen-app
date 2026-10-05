import './helpers/setup';
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {execute} from '../execute';

describe('execute(): Blockly code runs in a function scope', () => {
  const code = `var count, total;

function addText(text) {
  const textEl = document.createElement('p');
  textEl.innerText = text;
  document.getElementById('output').appendChild(textEl);
}

function sumTo(n) {
  total = 0;
  count = 1;
  while (count <= n) {
    total = total + count;
    count = count + 1;
  }
  return total;
}

addText(sumTo(4));
`;
  it('still prints, and the user-defined functions can be called afterwards by name', () => {
    const exec = execute(code);
    assert.equal(exec.runtimeError, null);
    assert.deepEqual(exec.output, ['10']);
    assert.equal((exec.context as {sumTo: (n: number) => number}).sumTo(100), 5050);
  });
  it('does not pay the vm global-variable penalty: a hot loop on top-level vars is fast', () => {
    const started = Date.now();
    const exec = execute(`var i, s;\nfunction spin() { s = 0; i = 0; while (i < 3000000) { s = s + i; i = i + 1; } return s; }\n`, 3000);
    assert.equal(exec.runtimeError, null);
    assert.equal((exec.context as {spin: () => number}).spin(), 4499998500000);
    assert.ok(Date.now() - started < 2000, 'took ' + (Date.now() - started) + ' ms');
  });
  it('the helpers are not exposed, and a syntax error is still reported', () => {
    assert.equal((execute(code).context as Record<string, unknown>).addText, undefined);
    assert.match(execute('var x = ;').runtimeError ?? '', /Unexpected token/);
  });
  it('the dialect mode is unchanged: the model\'s program runs as written', () => {
    const exec = execute('var a = 2;\nprint(a * 3);', 3000, {dialect: true});
    assert.deepEqual(exec.output, ['6']);
  });
});
