import './helpers/setup';
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {checkCode} from '../../src/llm/codeCheck';
import {messagesAboutCode, translateCode, TranslateError} from '../../src/llm/codeToBlocks';
import type {FunctionInfo} from '../../src/llm/codeToBlocks';
import {buildFromFlat} from '../../src/llm/flat';
import {validate} from '../../src/llm/validate';
import {generateJs, newWorkspace} from './helpers/blockly';
import {runDialect, runGenerated} from './helpers/sandbox';
import {MERGE_SORT_FITS_RULE, MERGE_SORT_ITERATIVE_SHARED_NAMES} from './helpers/fixtures';

interface Translated {
  js: string;
  output: string[];
  error: string | null;
  blockTypes: string[];
}

/** Translates a dialect program and runs the JavaScript Blockly generates from the blocks. */
function viaBlocks(code: string, existing?: Map<string, FunctionInfo>): Translated {
  const check = checkCode(code, existing?.keys());
  assert.deepEqual(check.violations.map((v) => v.message), [], 'the test program must be inside the dialect');
  const {blocks, lineOf} = translateCode(code, existing);
  const signatures = new Map([...(existing ?? [])].map(([name, info]) => [name, info.params]));
  const built = buildFromFlat({summary: 'test', blocks}, signatures);
  assert.deepEqual(built.errors, [], 'build');
  const problems = validate(built.response!, newWorkspace());
  assert.deepEqual(messagesAboutCode(problems, lineOf), [], 'validate');
  const js = generateJs(built.response!);
  const exec = runGenerated(js);
  return {js, output: exec.output, error: exec.error, blockTypes: blocks.map((b) => b.type)};
}

/** The blocks must print what is expected, and the same as the program as written. */
function same(code: string, expected: string[]): Translated {
  const blocks = viaBlocks(code);
  assert.equal(blocks.error, null, blocks.js);
  assert.deepEqual(blocks.output, expected, `blocks\n${blocks.js}`);
  const written = runDialect(code);
  assert.deepEqual(written.output, expected, 'the program as written');
  return blocks;
}

describe('translator: one case per construct (blocks and as-written agree)', () => {
  const cases: Array<[string, string, string[]]> = [
    ['print a number and a text', 'print(42);\nprint("hi");', ['42', 'hi']],
    ['print a boolean and null', 'print(1 < 2);\nprint(null);', ['true', 'null']],
    ['variables and assignment', 'var x = 2;\nx = x * 5;\nprint(x);', ['10']],
    ['var without a value makes no block', 'var x;\nx = 3;\nprint(x);', ['3']],
    ['several declarators', 'var a = 1, b = 2;\nprint(a + b);', ['3']],
    ['x += e, x -= e, x *= e, x /= e', 'var x = 10;\nx += 5;\nx -= 3;\nx *= 2;\nx /= 4;\nprint(x);', ['6']],
    ['x++ and x--', 'var x = 0;\nx++;\nx++;\nx--;\nprint(x);', ['1']],
    ['arithmetic and modulo', 'print(7 + 3 * 2 - 1);\nprint(17 % 5);\nprint(9 / 2);', ['12', '2', '4.5']],
    ['negative numbers and unary minus', 'var a = 3;\nprint(-5);\nprint(-a);\nprint(2 - -3);', ['-5', '-3', '5']],
    ['comparisons', 'print(1 == 1);\nprint(1 != 1);\nprint(2 < 1);\nprint(2 >= 2);\nprint(3 === 3);\nprint(3 !== 3);', ['true', 'false', 'false', 'true', 'true', 'false']],
    ['logic', 'print(true && false);\nprint(true || false);\nprint(!true);', ['false', 'true', 'false']],
    ['ternary', 'var n = 5;\nprint(n > 3 ? "big" : "small");', ['big']],
    ['a number as a condition is compared with 0', 'var n = 6;\nif (n % 2) { print("odd"); } else { print("even"); }', ['even']],
    ['if / else if / else', 'function f(n) { if (n < 0) { return "neg"; } else if (n == 0) { return "zero"; } else { return "pos"; } }\nprint(f(-1));\nprint(f(0));\nprint(f(4));', ['neg', 'zero', 'pos']],
    ['if without else, empty body', 'if (false) { }\nprint("ok");', ['ok']],
    ['while', 'var i = 0;\nwhile (i < 3) { i++; }\nprint(i);', ['3']],
    ['break and continue', 'var s = 0;\nfor (var i = 1; i <= 10; i++) { if (i == 3) { continue; } if (i == 6) { break; } s += i; }\nprint(s);', ['12']],
    ['list literal, index, length', 'var xs = [10, 20, 30];\nprint(xs[1]);\nprint(xs[3]);\nprint(xs.length);', ['10', '30', '3']],
    ['empty list', 'var xs = [];\nprint(xs.length);', ['0']],
    ['list[i] = e and push', 'var xs = [1, 2];\nxs[1] = 9;\nxs.push(3);\nprint(join(xs[1], ",", xs[3]));\nprint(xs.length);', ['9,3', '3']],
    ['list[i] += e', 'var xs = [1, 2];\nxs[2] += 5;\nxs[1] *= 4;\nprint(join(xs[1], ",", xs[2]));', ['4,7']],
    ['for-of', 'var s = 0;\nfor (var x of [1, 2, 3]) { s += x; }\nprint(s);', ['6']],
    ['text: join, case, trim, index, length', 'var t = join("  Ab", "c ");\nprint(t.trim());\nprint(t.trim().toUpperCase());\nprint(t.toLowerCase().trim());\nvar w = "hello";\nprint(w[1]);\nprint(w[5]);\nprint(w.length);', ['Abc', 'ABC', 'abc', 'h', 'o', '5']],
    ['text positions are 1-based on a text parameter too', 'function first(t) { return t[1]; }\nprint(first("xyz"));', ['x']],
    ['print wraps non-text, join takes any mix', 'var n = 3;\nprint(n + 1);\nprint(join("n=", n, " ", [1, 2]));', ['4', 'n=3 1,2']],
    ['Math: abs sqrt floor ceil round pow', 'print(Math.abs(-3));\nprint(Math.sqrt(16));\nprint(Math.floor(2.7));\nprint(Math.ceil(2.1));\nprint(Math.round(2.5));\nprint(Math.pow(2, 10));', ['3', '4', '2', '3', '3', '1024']],
    ['Math: max, min, PI, E, log, exp', 'print(Math.max(3, 9, 4));\nprint(Math.min(3, 9, 4));\nprint(Math.PI > 3.14);\nprint(Math.E < 2.72);\nprint(Math.log(1));\nprint(Math.exp(0));', ['9', '3', 'true', 'true', '0', '1']],
    ['Math: trigonometry in radians', 'print(Math.round(Math.sin(Math.PI / 2) * 100));\nprint(Math.round(Math.cos(0)));\nprint(Math.round(Math.asin(1) * 100));\nprint(Math.round(Math.atan(1) * 100));', ['100', '1', '157', '79']],
    ['functions: value, no value, recursion, early return', 'function fact(n) { if (n <= 1) { return 1; } return n * fact(n - 1); }\nfunction hello(name) { print(join("hi ", name)); }\nfunction firstNeg(xs) { for (var x of xs) { if (x < 0) { return x; } } return 0; }\nhello("bo");\nprint(fact(5));\nprint(firstNeg([1, -2, 3]));\nprint(firstNeg([1]));', ['hi bo', '120', '-2', '0']],
    ['return in the middle of a loop, and a bare return', 'function f(n) { if (n > 2) { print("big"); return; } print("small"); }\nf(1);\nf(5);', ['small', 'big']],
    ['a function that returns on only some paths', 'function f(n) { if (n > 0) { return 1; } }\nprint(f(1));', ['1']],
    ['a call whose result is ignored', 'function f() { print("ran"); return 1; }\nf();', ['ran']],
    ['top-level code after functions, in order', 'print("a");\nfunction f() { return "f"; }\nprint(f());\nprint("c");', ['a', 'f', 'c']],
  ];
  for (const [name, code, expected] of cases) it(name, () => void same(code, expected));
});

describe('translator: counting loops (guard, strictness, direction, empty ranges)', () => {
  const run = (header: string) => `var s = "";\n${header} { s = join(s, i, " "); }\nprint(s);`;
  const loops: Array<[string, string, string]> = [
    ['up, <=', 'for (var i = 1; i <= 4; i++)', '1 2 3 4 '],
    ['up, <', 'for (var i = 1; i < 4; i++)', '1 2 3 '],
    ['down, >=', 'for (var i = 4; i >= 1; i--)', '4 3 2 1 '],
    ['down, >', 'for (var i = 4; i > 1; i--)', '4 3 2 '],
    ['step 2', 'for (var i = 1; i <= 8; i += 2)', '1 3 5 7 '],
    ['step 3 down', 'for (var i = 10; i >= 1; i -= 3)', '10 7 4 1 '],
    ['literal empty range (guarded)', 'for (var i = 1; i <= 0; i++)', ''],
    ['literal empty range, strict', 'for (var i = 3; i < 3; i++)', ''],
    ['literal empty range, down', 'for (var i = 1; i >= 4; i--)', ''],
    ['one pass', 'for (var i = 2; i <= 2; i++)', '2 '],
    ['i = assignment instead of var', 'var i;\nfor (i = 1; i <= 3; i++)', '1 2 3 '],
  ];
  for (const [name, header, expected] of loops) {
    it(name, () => {
      const code = header.startsWith('var i;') ? `var s = "";\n${header} { s = join(s, i, " "); }\nprint(s);` : run(header);
      same(code, [expected]);
    });
  }
  for (const n of [0, 1, 2, 5]) {
    it(`variable bounds: n = ${n} (empty and tiny ranges)`, () => {
      const code = `function f(n) { var s = ""; for (var i = 1; i <= n; i++) { s = join(s, i); } return s; }\nfunction g(n) { var s = ""; for (var i = n; i > 0; i--) { s = join(s, i); } return s; }\nfunction h(xs) { var c = 0; for (var i = 1; i < xs.length; i++) { c++; } return c; }\nprint(f(${n}));\nprint(g(${n}));\nprint(h([${Array(n).fill(1)}]));`;
      assert.deepEqual(viaBlocks(code).output, runDialect(code).output);
    });
  }
  it('a bound that is a call is evaluated once, into a temporary', () => {
    // JavaScript would call limit() on every pass (three times here); the blocks call it once.
    const t = viaBlocks('function limit() { print("limit called"); return 2; }\nvar s = 0;\nfor (var i = 1; i <= limit(); i++) { s += i; }\nprint(s);');
    assert.deepEqual(t.output, ['limit called', '3']);
    assert.ok(t.js.includes('loopEnd1'));
  });
  it('a bound the body changes becomes a while loop (JavaScript re-reads it each pass)', () => {
    const code = 'var xs = [1, 2];\nvar n = 0;\nfor (var i = 1; i <= xs.length; i++) { n++; if (n < 5) { xs.push(0); } }\nprint(n);\nprint(xs.length);';
    const t = same(code, ['6', '6']);
    assert.ok(t.blockTypes.includes('controls_whileUntil') && !t.blockTypes.includes('controls_for'));
  });
  it('writing list items does not change the list\'s length: such a loop stays a count-with loop, even with continue', () => {
    const code = 'var xs = [3, 0, 5, 0, 7];\nvar n = 0;\nfor (var i = 1; i <= xs.length; i++) { if (xs[i] == 0) { continue; } xs[i] = xs[i] * 2; n += xs[i]; }\nprint(n);\nprint(join(xs[1], ",", xs[2], ",", xs[3], ",", xs[4], ",", xs[5]));';
    const t = same(code, ['30', '6,0,10,0,14']);
    assert.ok(t.blockTypes.includes('controls_for') && !t.blockTypes.includes('controls_whileUntil'));
  });
  it('but a bound that reads the items themselves does change when they are written', () => {
    const code = 'var xs = [1, 2, 3];\nvar k = 0;\nfor (var i = 1; i <= xs[3]; i++) { xs[3] = 2; k++; }\nprint(k);';
    const t = same(code, ['2']);
    assert.ok(t.blockTypes.includes('controls_whileUntil'));
  });
  it('...unless it also uses continue, which that translation cannot do', () => {
    const code = 'var xs = [1];\nfor (var i = 1; i <= xs.length; i++) { if (i > 2) { continue; } xs.push(1); }';
    assert.throws(() => translateCode(code), (e: Error) => e instanceof TranslateError && /Line 2:.*continue/.test(e.message));
  });
  it('the counter is one past the end afterwards, as in JavaScript', () => {
    same('var i;\nfor (i = 1; i <= 3; i++) { }\nprint(i);', ['4']);
    same('var i;\nfor (i = 3; i >= 1; i--) { }\nprint(i);', ['0']);
  });
  it('a loop that counts one way and tests the other is refused', () => {
    assert.throws(() => translateCode('for (var i = 1; i >= 0; i++) { }'), /Line 1:.*counts up/);
  });
});

describe('translator: variable scoping (only parameters are local in blocks)', () => {
  it('two functions that both declare i, one calling the other, stay correct', () => {
    const code = 'function inner(n) { var t = 0; for (var i = 1; i <= n; i++) { t += i; } return t; }\nfunction outer(n) { var s = 0; for (var i = 1; i <= n; i++) { s += inner(i); } return s; }\nprint(outer(4));';
    const t = same(code, ['20']);
    assert.ok(t.js.includes('inner__i') || t.js.includes('outer__i'), 'the clash is renamed');
  });
  it('a local that clashes with a top-level variable is renamed', () => {
    const t = same('var total = 100;\nfunction f(n) { var total = n * 2; return total; }\nprint(f(4));\nprint(total);', ['8', '100']);
    assert.ok(t.js.includes('f__total'));
  });
  it('a name that is only one function\'s local keeps its readable name', () => {
    const t = same('function f(n) { var count = n; return count; }\nprint(f(2));', ['2']);
    assert.ok(!t.js.includes('__'));
  });
  it('a local that shares its name with another function\'s parameter does not clash', () => {
    const t = same('function f(x) { return x + 1; }\nfunction g(n) { var x = n * 2; return f(x); }\nprint(g(3));', ['7']);
    assert.ok(!t.js.includes('__'));
  });
  it('merge sort fixtures stay correct on random input', () => {
    for (const program of [MERGE_SORT_FITS_RULE, MERGE_SORT_ITERATIVE_SHARED_NAMES]) {
      for (const literal of ['[]', '[5]', '[2, 1]', '[3, 1, 2, 3, 0, -4, 9]']) {
        const code = `${program}\nprint(join(mergeSort(${literal})));`;
        assert.deepEqual(viaBlocks(code).output, runDialect(code).output, literal);
      }
    }
  });
});

describe('translator: functions that already exist in the workspace', () => {
  const existing = new Map<string, FunctionInfo>([
    ['double', {params: ['x'], returns: true}],
    ['shout', {params: ['t'], returns: false}],
  ]);
  it('chooses the call block by whether the function returns a value', () => {
    const blocks = translateCode('shout("a");\nprint(double(4));', existing).blocks.map((b) => b.type);
    assert.ok(blocks.includes('procedures_callnoreturn') && blocks.includes('procedures_callreturn'));
  });
  it('using the result of a function that returns nothing is an error about the code', () => {
    assert.throws(() => translateCode('print(shout("a"));', existing), /Line 1:.*does not return a value/);
  });
  it('a call with the wrong number of values is an error about the code', () => {
    assert.throws(() => translateCode('print(double(1, 2));', existing), /Line 1: "double" takes 1 value \(x\), but this call gives 2/);
  });
});

describe('translator: errors name the code, not the blocks', () => {
  it('a type clash found by Blockly is reported with the line of the code', () => {
    const code = 'var a = 1;\nvar b = (a > 1) + 2;';
    const {blocks, lineOf} = translateCode(code);
    const built = buildFromFlat({summary: '', blocks});
    const problems = built.response ? validate(built.response, newWorkspace()) : built.errors;
    assert.ok(problems.length > 0, 'Blockly rejects a boolean in an arithmetic input');
    const text = messagesAboutCode(problems, lineOf).join('\n');
    assert.match(text, /line 2|Line 2/, text);
    assert.ok(!/\bb\d+\b/.test(text), `no block ids left in: ${text}`);
  });
});
