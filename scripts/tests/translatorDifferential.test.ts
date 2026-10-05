import './helpers/setup';
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {translateCode} from '../../src/llm/codeToBlocks';
import {buildFromFlat} from '../../src/llm/flat';
import {generateJs} from './helpers/blockly';
import {runDialect, runGenerated} from './helpers/sandbox';
import {randomArrays} from './helpers/scoping';
import {BUBBLE_SORT, IS_PRIME, MERGE_SORT_FITS_RULE, MERGE_SORT_ITERATIVE_SHARED_NAMES} from './helpers/fixtures';

/**
 * Differential tests: the program as written against the blocks the translator
 * built from it, on many inputs. Any difference is a translation bug (or a
 * documented semantic gap, none of which these programs touch).
 */
function blocksOutput(code: string): string[] {
  const {blocks} = translateCode(code);
  const built = buildFromFlat({summary: '', blocks});
  assert.deepEqual(built.errors, []);
  const exec = runGenerated(generateJs(built.response!));
  assert.equal(exec.error, null);
  return exec.output;
}

/** Runs many calls in ONE program, so it is translated and built once. */
function compare(definitions: string, calls: string[]): void {
  const code = `${definitions}\n${calls.map((c) => `print(join(${c}));`).join('\n')}`;
  const written = runDialect(code);
  assert.equal(written.error, null);
  assert.equal(written.output.length, calls.length, 'one printed line per call');
  assert.deepEqual(blocksOutput(code), written.output);
}

const withoutMain = (program: string) => program.slice(0, program.lastIndexOf('\nprint('));

describe('differential: as written vs as blocks', () => {
  it('counting loops: every direction, strictness and step, over random bounds (empty ranges included)', () => {
    const forms: Array<[string, string]> = [
      ['i <= b; i++', 'a'], ['i < b; i++', 'a'], ['i >= b; i--', 'a'], ['i > b; i--', 'a'],
      ['i <= b; i += 2', 'a'], ['i < b; i += 3', 'a'], ['i >= b; i -= 2', 'a'], ['i > b; i -= 3', 'a'],
    ];
    const defs = forms
      .map(([header], k) => `function loop${k}(a, b) { var s = ""; for (var i = a; ${header}) { s = join(s, i, ","); } return s; }`)
      .join('\n');
    const calls: string[] = [];
    for (let a = -3; a <= 6; a++) for (let b = -3; b <= 6; b++) forms.forEach((_, k) => calls.push(`loop${k}(${a}, ${b})`));
    compare(defs, calls);
  });

  it('loops over list lengths, including the empty list', () => {
    const defs = `function walk(xs) { var s = ""; for (var i = 1; i <= xs.length; i++) { s = join(s, xs[i]); } return s; }
function skip(xs) { var c = 0; for (var i = 2; i < xs.length; i++) { c++; } return c; }
function back(xs) { var s = ""; for (var i = xs.length; i >= 1; i--) { s = join(s, xs[i]); } return s; }`;
    const calls = [[], ...randomArrays(60)].flatMap((a) => ['walk', 'skip', 'back'].map((f) => `${f}([${a}])`));
    compare(defs, calls);
  });

  it('bubble sort, merge sorts (renamed locals) on random arrays', () => {
    for (const program of [withoutMain(BUBBLE_SORT), MERGE_SORT_FITS_RULE, MERGE_SORT_ITERATIVE_SHARED_NAMES]) {
      const name = /function (bubbleSort|mergeSort)\(/.exec(program)![1];
      compare(program, [[], ...randomArrays(80)].map((a) => `${name}([${a}])`));
    }
  });

  it('isPrime over -3..60', () => {
    compare(withoutMain(IS_PRIME), Array.from({length: 64}, (_, i) => `isPrime(${i - 3})`));
  });

  it('while loops, nested loops with break/continue, and early returns', () => {
    const defs = `function collatz(n) { var steps = 0; while (n != 1) { if (n % 2 == 0) { n = n / 2; } else { n = 3 * n + 1; } steps++; } return steps; }
function pairs(n) { var c = 0; for (var i = 1; i <= n; i++) { for (var j = i; j <= n; j++) { if ((i + j) % 3 == 0) { continue; } if (j > 7) { break; } c++; } } return c; }
function firstOver(xs, limit) { for (var x of xs) { if (x > limit) { return x; } } return -1; }`;
    const calls = [
      ...Array.from({length: 20}, (_, i) => `collatz(${i + 1})`),
      ...Array.from({length: 12}, (_, i) => `pairs(${i})`),
      ...randomArrays(40).map((a, i) => `firstOver([${a}], ${i % 15 - 5})`),
    ];
    compare(defs, calls);
  });
});
