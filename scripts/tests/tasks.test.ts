import './helpers/setup';
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {toRunnable} from '../../src/llm/codeCheck';
import {TASKS, evaluate} from '../tasks';
import {BUBBLE_SORT, MERGE_SORT_FITS_RULE} from './helpers/fixtures';

/** Runs a task's checks on a dialect program, as the benchmark does for the code format. */
function grade(taskId: string, code: string, blockTypes: string[] = []) {
  const task = TASKS.find((t) => t.id === taskId);
  assert.ok(task, `unknown task ${taskId}`);
  return evaluate(task, toRunnable(code), new Set(blockTypes), {dialect: true}).checks;
}
const passes = (taskId: string, code: string) => grade(taskId, code).every((c) => c.passed);
const failure = (taskId: string, code: string) =>
  grade(taskId, code).filter((c) => !c.passed).map((c) => c.detail).join(' ; ');

/** [task, label, program, should it pass, text expected in the failure detail] */
const cases: Array<[string, string, string, boolean, string?]> = [
  // sorting
  ['bubble', 'a correct bubble sort', BUBBLE_SORT, true],
  ['bubble', 'a sort that never swaps', BUBBLE_SORT.replace('list[j] = list[j + 1];', ''), false, 'expected [1,2,5,9]'],
  ['faster', 'merge sort (fast enough on 100,000 numbers)', MERGE_SORT_FITS_RULE, true],
  // functions by name
  ['parity', 'correct isEven/isOdd/isDivisible', 'function isEven(n) { return n % 2 == 0; }\nfunction isOdd(n) { return n % 2 != 0; }\nfunction isDivisible(a, b) { return a % b == 0; }', true],
  ['parity', 'isOdd written as n % 2 == 1 (wrong for negatives)', 'function isEven(n) { return n % 2 == 0; }\nfunction isOdd(n) { return n % 2 == 1; }\nfunction isDivisible(a, b) { return a % b == 0; }', false, 'isOdd(-7)'],
  ['parity', 'a function missing', 'function isEven(n) { return n % 2 == 0; }\nfunction isOdd(n) { return n % 2 != 0; }', false, 'divisible'],
  ['parity', 'other function names are still found', 'function evenNumber(n) { return n % 2 == 0; }\nfunction oddNumber(n) { return n % 2 != 0; }\nfunction numberIsDivisibleBy(a, b) { return a % b == 0; }', true],
  ['zerosum', 'correct with for-of', 'function zeroSum(nums) { var total = 0; for (var item of nums) { total += item; } return total == 0; }', true],
  ['zerosum', 'correct with a 1-based index loop', 'function zeroSum(nums) { var total = 0; for (var i = 1; i <= nums.length; i++) { total += nums[i]; } return total == 0; }', true],
  ['zerosum', 'a 0-based slip', 'function zeroSum(nums) { var total = 0; for (var i = 0; i < nums.length; i++) { total += nums[i]; } return total == 0; }', false, 'zeroSum([1,2,-3])'],
  ['zerosum', 'the "some pair sums to zero" reading', 'function zeroSum(nums) { for (var i = 1; i <= nums.length; i++) { for (var j = i + 1; j <= nums.length; j++) { if (nums[i] + nums[j] == 0) { return true; } } } return false; }', false],
  // text
  ['palindrome', 'correct', 'function isPalindrome(text) { var n = text.length; for (var i = 1; i <= n; i++) { if (text[i] != text[n - i + 1]) { return false; } } return true; }', true],
  ['palindrome', 'off by one', 'function isPalindrome(text) { var n = text.length; for (var i = 1; i <= n; i++) { if (text[i] != text[n - i]) { return false; } } return true; }', false, 'racecar'],
  ['reverse', 'correct', 'function reverseText(text) { var result = ""; for (var i = text.length; i >= 1; i--) { result = join(result, text[i]); } return result; }', true],
  ['reverse', 'forgets to reverse', 'function reverseText(text) { var result = ""; for (var i = 1; i <= text.length; i++) { result = join(result, text[i]); } return result; }', false, '"abc"'],
  ['vowels', 'correct', 'function countVowels(text) { var count = 0; for (var i = 1; i <= text.length; i++) { var c = text[i]; if (c == "a" || c == "e" || c == "i" || c == "o" || c == "u") { count += 1; } } return count; }', true],
  ['vowels', 'counts y as a vowel', 'function countVowels(text) { var count = 0; for (var i = 1; i <= text.length; i++) { var c = text[i]; if (c == "a" || c == "e" || c == "i" || c == "o" || c == "u" || c == "y") { count += 1; } } return count; }', false, '"sky"'],
  // recursion and loops
  ['factorial', 'recursive, parameters only', 'function factorial(n) { if (n <= 1) { return 1; } return n * factorial(n - 1); }', true],
  ['factorial', 'iterative', 'function factorial(n) { var r = 1; for (var i = 2; i <= n; i++) { r = r * i; } return r; }', true],
  ['factorial', 'never ends for 0', 'function factorial(n) { if (n == 1) { return 1; } return n * factorial(n - 1); }', false, 'factorial(0)'],
  ['fibonacci', 'recursive', 'function fib(n) { if (n < 2) { return n; } return fib(n - 1) + fib(n - 2); }', true],
  ['fibonacci', 'wrong recurrence', 'function fib(n) { if (n < 2) { return n; } return fib(n - 1) + fib(n - 3); }', false, 'fib(2)'],
  ['gcd', 'Euclid with a while loop', 'function gcd(a, b) { while (b != 0) { var t = b; b = a % b; a = t; } return a; }', true],
  ['gcd', 'returns the wrong variable', 'function gcd(a, b) { while (b != 0) { var t = b; b = a % b; a = t; } return b; }', false, 'gcd(12, 18)'],
  ['fizzbuzz', 'returns the number as text', 'function fizzBuzz(n) { if (n % 15 == 0) { return "FizzBuzz"; } if (n % 3 == 0) { return "Fizz"; } if (n % 5 == 0) { return "Buzz"; } return join(n); }', true],
  ['fizzbuzz', 'returns the number itself (also accepted)', 'function fizzBuzz(n) { if (n % 15 == 0) { return "FizzBuzz"; } if (n % 3 == 0) { return "Fizz"; } if (n % 5 == 0) { return "Buzz"; } return n; }', true],
  ['fizzbuzz', 'Fizz and Buzz swapped', 'function fizzBuzz(n) { if (n % 15 == 0) { return "FizzBuzz"; } if (n % 3 == 0) { return "Buzz"; } if (n % 5 == 0) { return "Fizz"; } return n; }', false, 'fizzBuzz(3)'],
  ['binsearch', 'correct: 1-based, 0 when absent', 'function binarySearch(list, target) { var low = 1; var high = list.length; while (low <= high) { var mid = Math.floor((low + high) / 2); if (list[mid] == target) { return mid; } if (list[mid] < target) { low = mid + 1; } else { high = mid - 1; } } return 0; }', true],
  ['binsearch', 'returns -1 when absent', 'function binarySearch(list, target) { var low = 1; var high = list.length; while (low <= high) { var mid = Math.floor((low + high) / 2); if (list[mid] == target) { return mid; } if (list[mid] < target) { low = mid + 1; } else { high = mid - 1; } } return -1; }', false, 'expected 0'],
  ['matrix', 'nested loops over m[i][j]', 'function matrixSum(m) { var total = 0; for (var i = 1; i <= m.length; i++) { for (var j = 1; j <= m[i].length; j++) { total += m[i][j]; } } return total; }', true],
  ['matrix', 'skips the last row', 'function matrixSum(m) { var total = 0; for (var i = 1; i <= m.length - 1; i++) { for (var j = 1; j <= m[i].length; j++) { total += m[i][j]; } } return total; }', false, 'matrixSum([[1,2],[3,4]])'],
  ['matrix', 'a helper plus the main function', 'function rowSum(row) { var s = 0; for (var x of row) { s += x; } return s; }\nfunction matrixSum(m) { var total = 0; for (var row of m) { total += rowSum(row); } return total; }', true],
];

describe('task checks: every task tells a correct program from a plausible wrong one', () => {
  for (const [taskId, label, code, shouldPass, detail] of cases) {
    it(`${taskId}: ${label}`, () => {
      if (shouldPass) {
        assert.equal(passes(taskId, code), true, failure(taskId, code));
      } else {
        assert.equal(passes(taskId, code), false);
        if (detail) assert.ok(failure(taskId, code).includes(detail), `${detail} not in: ${failure(taskId, code)}`);
      }
    });
  }

  it('the "faster" task rejects a quadratic sort on the 100,000-number check', () => {
    const checks = grade('faster', BUBBLE_SORT);
    assert.ok(checks.some((c) => !c.passed && /fast enough/.test(c.name)), JSON.stringify(checks.map((c) => c.name + c.passed)));
  });

  it('a task fails when it uses a forbidden built-in block', () => {
    const checks = grade('bubble', BUBBLE_SORT, ['lists_sort']);
    assert.ok(checks.some((c) => !c.passed && /built-in sort block/.test(c.name)));
  });

  it('every task has an id, a prompt and either sorting or function checks', () => {
    const ids = new Set<string>();
    for (const t of TASKS) {
      assert.ok(t.id && t.prompt, t.id);
      assert.ok(!ids.has(t.id), `duplicate task id ${t.id}`);
      ids.add(t.id);
      if (!['bubble', 'faster'].includes(t.id)) assert.ok(t.functions && t.functions.length > 0, t.id);
    }
    assert.equal(TASKS.length, 13);
  });
});
