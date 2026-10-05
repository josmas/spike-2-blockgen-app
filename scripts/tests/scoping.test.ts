import './helpers/setup';
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {runDialect} from './helpers/sandbox';
import {randomArrays, withBlocklyScoping} from './helpers/scoping';
import {
  MERGE_SORT_FITS_RULE,
  MERGE_SORT_ITERATIVE_SHARED_NAMES,
  MERGE_SORT_RECURSIVE_LOCALS,
  QUICKSORT_WITH_LOCALS,
} from './helpers/fixtures';

/** Sorts `arrays` with `sortCall(arrayLiteral)` appended to `program`; returns how many come out wrong. */
function countWrong(program: string, sortCall: (literal: string) => string): number {
  let wrong = 0;
  for (const a of randomArrays(120)) {
    const run = runDialect(`${program}\nprint(join(${sortCall(JSON.stringify(a))}));`);
    const expected = [...a].sort((x, y) => x - y).join(',');
    if (run.output[0] !== expected) wrong++;
  }
  return wrong;
}
const mergeSortCall = (literal: string) => `mergeSort(${literal})`;
const global = (code: string) => withBlocklyScoping(code, {rename: false});
const renamed = (code: string) => withBlocklyScoping(code, {rename: true});

describe('the scoping transform (Blockly: only parameters are local)', () => {
  const source = 'var top = 1;\nfunction f(p) { var x = p; for (var i = 1; i <= x; i++) { top += list.length; } return x; }';
  it('hoists every variable to one global declaration and removes the var keywords', () => {
    const out = global(source);
    assert.match(out, /^var top, x, i;\n/);
    assert.ok(!/\bvar [a-z]+ =/.test(out.split('\n').slice(1).join('\n')), out);
  });
  it('leaves parameters and property names alone, and renames locals per function when asked', () => {
    const out = renamed('function f(p) { var length = p; return length + p.length; }');
    assert.ok(out.includes('f__length'));
    assert.ok(out.includes('p.length'), 'the .length property must not be renamed');
    assert.ok(out.includes('(p)'), 'parameters stay');
  });
  it('declares nothing when there are no variables (an empty "var ;" would be a syntax error)', () => {
    assert.equal(global('function f(a) { return a; }').startsWith('var '), false);
  });
});

describe('recursion: locals kept across recursive calls break once variables are global', () => {
  it('merge sort with recursive locals is correct as written', () => {
    assert.equal(countWrong(MERGE_SORT_RECURSIVE_LOCALS, mergeSortCall), 0);
  });
  it('...but wrong with global variables, even when renamed per function', () => {
    assert.ok(countWrong(global(MERGE_SORT_RECURSIVE_LOCALS), mergeSortCall) > 0);
    assert.ok(countWrong(renamed(MERGE_SORT_RECURSIVE_LOCALS), mergeSortCall) > 0, 'renaming cannot fix recursion');
  });
  it('a merge sort that fits the recursion rule stays correct with global variables, renamed', () => {
    assert.equal(countWrong(MERGE_SORT_FITS_RULE, mergeSortCall), 0);
    assert.equal(countWrong(renamed(MERGE_SORT_FITS_RULE), mergeSortCall), 0);
  });
  it('the conservative rule rejects an in-place quicksort that is in fact safe (0 wrong with globals)', () => {
    const quick = (literal: string) => `quickSort(${literal}, 1, ${literal.split(',').length})`;
    assert.equal(countWrong(global(QUICKSORT_WITH_LOCALS), quick), 0);
  });
});

describe('cross-function clobbering: two functions using the same variable names', () => {
  it('iterative merge sort is correct as written', () => {
    assert.equal(countWrong(MERGE_SORT_ITERATIVE_SHARED_NAMES, mergeSortCall), 0);
  });
  it('...breaks with global variables that are not renamed (merge overwrites mergeSort\'s i)', () => {
    // merge() and mergeSort() both use i/left/right; an unrenamed global makes the outer loop restart.
    const program = global(MERGE_SORT_ITERATIVE_SHARED_NAMES);
    const run = runDialect(`${program}\nprint(join(mergeSort([5, 2, 9, 1, 7, 3])));`);
    assert.notEqual(run.output[0], '1,2,3,5,7,9');
  });
  it('...and is correct again once each function\'s variables are renamed to be unique', () => {
    assert.equal(countWrong(renamed(MERGE_SORT_ITERATIVE_SHARED_NAMES), mergeSortCall), 0);
  });
});
