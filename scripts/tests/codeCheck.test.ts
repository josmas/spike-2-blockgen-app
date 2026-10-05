import './helpers/setup';
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {checkCode, toRunnable, violationMessages} from '../../src/llm/codeCheck';
import {runDialect} from './helpers/sandbox';
import {BUBBLE_SORT, IS_PRIME} from './helpers/fixtures';

const keysOf = (code: string) => new Set(checkCode(code).violations.map((v) => v.key));

describe('code dialect: programs that must pass the check and run correctly', () => {
  const programs: Array<[string, string, string]> = [
    ['bubble sort', BUBBLE_SORT, 'sorted = 1,2,3'],
    ['isPrime', IS_PRIME, 'isPrime(7) = true'],
    [
      'for-of, while, break, ternary, push, Math, text method',
      `var total = 0; var best = -1; var xs = [4, 8, 15];
for (var x of xs) { if (x > best) { best = x; } total += x; }
var k = 3; while (k > 0) { k--; if (k == 1) { break; } }
var label = total > 20 ? "big" : "small";
xs.push(Math.max(total, 7)); print(join(label, " ", xs.length, Math.pow(2, 3), "abc".toUpperCase()));`,
      'big 48ABC',
    ],
  ];
  for (const [name, code, expected] of programs) {
    it(name, () => {
      const result = checkCode(code);
      assert.equal(result.ok, true, violationMessages(result).join('\n'));
      const run = runDialect(code);
      assert.equal(run.error, null);
      assert.equal(run.output[0], expected);
    });
  }
});

describe('code dialect: programs that must be rejected, under the right construct key', () => {
  const cases: Array<[string, string, string[]]> = [
    ['arrow + const + template string', 'const f = (x) => x * 2;\nprint(`value ${f(2)}`);', ['decl:const', 'ArrowFunctionExpression', 'TemplateLiteral']],
    ['arr.sort()', 'var a = [3,1,2];\na.sort();', ['method:sort']],
    ['console.log', 'console.log("hi");', ['method:log']],
    ['charAt', 'function f(s) { return s.charAt(1); }', ['method:charAt']],
    ['destructuring swap', 'var a = [1,2];\n[a[1], a[2]] = [a[2], a[1]];', ['ArrayPattern']],
    ['let in a for loop', 'for (let i = 0; i < 3; i++) { print(i); }', ['decl:let']],
    ['** operator', 'var x = 2 ** 3;', ['op:**']],
    ['object literal', 'var o = {a: 1};', ['ObjectExpression']],
    ['class', 'class A { f() { return 1; } }', ['ClassDeclaration']],
    ['switch', 'var x = 1;\nswitch (x) { case 1: print(1); break; }', ['SwitchStatement']],
    ['i++ inside an expression', 'var i = 0; var j = i++;', ['update:in-expression']],
    ['call to an undefined function', 'print(helper(3));', ['call:helper']],
    ['push used as a value', 'var a = []; var n = a.push(1);', ['push:in-expression']],
    ['text built with +', 'print("total: " + 5);', ['text+']],
    ['non-canonical for loop', 'for (var i = 0; i < 10; i = i * 2) { print(i); }', ['for:shape']],
    ['nested function', 'function outer() { function inner() { return 1; } return inner(); }', ['nested-function']],
    ['do...while', 'var i = 0; do { i++; } while (i < 3);', ['DoWhileStatement']],
    ['try/catch', 'try { print(1); } catch (e) { print(2); }', ['TryStatement']],
    ['undefined identifier', 'var x = undefined;', ['identifier:undefined']],
    ['unknown property', 'var a = [1]; var n = a.size;', ['prop:size']],
    ['Math.random', 'var r = Math.random();', ['math:random']],
    ['top-level return is a syntax error', 'return 5;', ['syntax-error']],
    ['broken syntax', 'function (', ['syntax-error']],
    ['several problems at once', 'const a = [3,1,2];\nconst s = a.sort().map((x) => x * 2);\nconsole.log(`${s}`);', ['decl:const', 'method:sort', 'method:map', 'ArrowFunctionExpression', 'method:log', 'TemplateLiteral']],
  ];
  for (const [name, code, wanted] of cases) {
    it(name, () => {
      const result = checkCode(code);
      assert.equal(result.ok, false);
      const got = keysOf(code);
      for (const key of wanted) assert.ok(got.has(key), `missing ${key}; got ${[...got].join(', ')}`);
    });
  }

  it('reports each rejected construct once, with a message that has a line number', () => {
    const messages = violationMessages(checkCode('const a = [3,1,2];\nconst s = a.sort();'));
    assert.ok(messages.every((m) => /^Line \d+: /.test(m)));
    assert.equal(messages.filter((m) => m.includes('"const"')).length, 2);
    assert.ok(!messages.some((m) => m.includes('TemplateElement')), 'no noise from structural nodes');
  });

  it('does not report a break inside a rejected switch, or calls to a rejected arrow function', () => {
    const keys = keysOf('const f = (x) => x;\nswitch (f(1)) { case 1: break; }');
    assert.ok(!keys.has('break-outside-loop'));
    assert.ok(![...keys].some((k) => k.startsWith('call:')));
  });
});

describe('1-based rewrite for running the model\'s own program', () => {
  it('turns a[expr] into a[(expr)-1], nested indexes included', () => {
    assert.equal(toRunnable('a[j + 1] = b[c[1]];'), 'a[(j + 1)-1] = b[(c[(1)-1])-1];');
  });
  it('makes a 1-based program behave like the dialect says', () => {
    const run = runDialect('var a = [10, 20, 30]; print(join(a[1], a[3]));');
    assert.deepEqual(run.output, ['1030']);
  });
});
