import './helpers/setup';
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {checkCode, violationMessages} from '../../src/llm/codeCheck';
import {
  MERGE_SORT_FITS_RULE,
  MERGE_SORT_ITERATIVE_SHARED_NAMES,
  MERGE_SORT_RECURSIVE_LOCALS,
  QUICKSORT_WITH_LOCALS,
} from './helpers/fixtures';

const flagged = (code: string, key: string) => checkCode(code).violations.filter((v) => v.key === key);
const passes = (code: string) => {
  const r = checkCode(code);
  assert.equal(r.ok, true, violationMessages(r).join('\n'));
};

describe('recursion rule: a function that calls itself may not declare locals', () => {
  const flaggedCases: Array<[string, string]> = [
    ['direct recursion with a local var', 'function f(n) { var x = n - 1; if (n <= 0) { return 0; } return f(x); }'],
    ['mutual recursion, local in one of them', 'function a(n) { if (n <= 0) { return 0; } return b(n - 1); }\nfunction b(n) { var t = n; return a(t); }'],
    ['loop counter in a recursive function', 'function walk(n) { for (var i = 1; i <= n; i++) { walk(i - 1); } return 0; }'],
    ['for-of variable in a recursive function', 'function total(list, depth) { var s = 0; for (var item of list) { s += item; } if (depth > 0) { return total(list, depth - 1); } return s; }'],
    ['recursive merge sort keeping left/right/mid', MERGE_SORT_RECURSIVE_LOCALS],
    ['in-place quicksort (safe by luck, rejected on purpose)', QUICKSORT_WITH_LOCALS],
  ];
  for (const [name, code] of flaggedCases) {
    it(`rejects: ${name}`, () => assert.ok(flagged(code, 'recursive-local').length > 0));
  }

  const passCases: Array<[string, string]> = [
    ['factorial, parameters only', 'function fact(n) { if (n <= 1) { return 1; } return n * fact(n - 1); }'],
    ['fibonacci, parameters only', 'function fib(n) { if (n < 2) { return n; } return fib(n - 1) + fib(n - 2); }'],
    ['mutual recursion with no locals', 'function isEven(n) { if (n == 0) { return true; } return isOdd(n - 1); }\nfunction isOdd(n) { if (n == 0) { return false; } return isEven(n - 1); }'],
    ['recursive function assigning its own parameter', 'function sumTo(n, acc) { if (n == 0) { return acc; } acc = acc + n; n = n - 1; return sumTo(n, acc); }'],
    ['recursive function using a shared top-level variable', 'var calls = 0;\nfunction visit(n) { calls += 1; if (n > 0) { visit(n - 1); } }\nvisit(3);'],
    ['non-recursive function with locals', 'function sumList(list) { var total = 0; for (var i = 1; i <= list.length; i++) { total += list[i]; } return total; }'],
    ['merge sort rewritten to fit the rule', MERGE_SORT_FITS_RULE],
    ['iterative merge sort (not recursive, locals allowed)', MERGE_SORT_ITERATIVE_SHARED_NAMES],
  ];
  for (const [name, code] of passCases) it(`accepts: ${name}`, () => passes(code));

  it('reports one message per recursive function, listing its variables and the advice', () => {
    const found = flagged(MERGE_SORT_RECURSIVE_LOCALS, 'recursive-local');
    assert.equal(found.length, 1);
    const message = found[0].message;
    assert.match(message, /"mergeSort" calls itself/);
    for (const name of ['mid', 'left', 'right']) assert.ok(message.includes(name), name);
    assert.match(message, /Use only parameters here/);
  });
});

describe('position rules: positions start at 1', () => {
  const flaggedCases: Array<[string, string, string]> = [
    ['literal position 0', 'var a = [1, 2]; var b = a[0];', 'index-zero'],
    ['negative literal position', 'var a = [1, 2]; var b = a[-1];', 'index-zero'],
    ['write to position 0', 'var a = [1, 2]; a[0] = 5;', 'index-zero'],
    ['loop from 0 reading x[i]', 'var a = [1,2,3]; for (var i = 0; i < 3; i++) { print(a[i]); }', 'index-before-1'],
    ['loop from 1 reading x[i - 1]', 'var a = [1,2,3]; for (var i = 1; i <= 3; i++) { print(a[i - 1]); }', 'index-before-1'],
    ['loop from 0 with += step', 'var a = [1,2,3]; for (var i = 0; i < 3; i += 1) { print(a[i]); }', 'index-before-1'],
    ['text indexed from 0 in a loop', 'function f(text) { var n = 0; for (var i = 0; i < text.length; i++) { if (text[i] == "a") { n++; } } return n; }', 'index-before-1'],
    ['index nested inside the loop body', 'var a = [1,2,3]; for (var i = 0; i < 3; i++) { if (i > 0) { print(a[i]); } }', 'index-before-1'],
  ];
  for (const [name, code, key] of flaggedCases) it(`flags: ${name}`, () => assert.ok(flagged(code, key).length > 0));

  const passCases: Array<[string, string]> = [
    ['loop from 1 reading x[i]', 'var a = [1,2,3]; for (var i = 1; i <= 3; i++) { print(a[i]); }'],
    ['loop from 0 reading x[i + 1]', 'var a = [1,2,3]; for (var i = 0; i < 3; i++) { print(a[i + 1]); }'],
    ['loop from 2 reading x[i - 1]', 'var a = [1,2,3]; for (var i = 2; i <= 3; i++) { print(a[i - 1]); }'],
    ['loop reading x[i] and x[i + 1]', 'var a = [1,2,3]; for (var i = 1; i <= 2; i++) { print(a[i] + a[i + 1]); }'],
    ['counting down from n', 'var a = [1,2,3]; for (var i = 3; i >= 1; i--) { print(a[i]); }'],
    ['loop from 0 that does not index', 'var t = 0; for (var i = 0; i < 5; i++) { t += i; }'],
    ['loop from 0 indexing through another variable', 'var a = [1,2,3]; for (var i = 0; i < 3; i++) { var k = i + 1; print(a[k]); }'],
    ['literal position 1', 'var a = [1, 2]; var b = a[1];'],
    ['text[1], as in the worked example', 'function s(text, letter) { if (text.length == 0) { return false; } return text[1] == letter; }'],
  ];
  for (const [name, code] of passCases) it(`accepts: ${name}`, () => passes(code));
});
