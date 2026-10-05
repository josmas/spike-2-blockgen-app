import {checkCalls, checkSorts, definedFunctions, execute} from './execute';
import type {CallCase, ExecuteOptions} from './execute';
import type {CheckResult} from './types';

export interface Task {
  id: string;
  label: string;
  /** Exactly what is typed into the app's text area. */
  prompt: string;
  /** Blocks that would be cheating, e.g. the built-in sort block. */
  forbidBlocks: string[];
  /** Also time the function on a large array. Catches quadratic algorithms. */
  perf?: {size: number; timeoutMs: number};
  /**
   * For tasks that are not sorting: functions to find by name, each with calls
   * to check. `name` is a case-insensitive regular expression.
   */
  functions?: Array<{label: string; name: string; calls: CallCase[]}>;
}

export const TASKS: Task[] = [
  {
    id: 'bubble',
    label: 'Bubble sort',
    prompt: 'a bubble sort function',
    forbidBlocks: ['lists_sort'],
  },
  {
    id: 'faster',
    label: 'Faster than bubble sort',
    prompt: 'a sorting function faster than bubble sort',
    forbidBlocks: ['lists_sort'],
    // Bubble, insertion and selection sort all need billions of steps here;
    // an O(n log n) sort needs a few million.
    perf: {size: 100_000, timeoutMs: 3000},
  },
];

TASKS.push(
  {
    id: 'parity',
    label: 'isOdd, isEven, isDivisible',
    prompt: 'functions isOdd, isEven and isDivisible',
    // These would make the task trivial: Blockly has a block for each.
    forbidBlocks: ['math_number_property'],
    functions: [
      {
        label: 'isOdd',
        name: 'odd',
        calls: [
          {args: [7], expect: true},
          {args: [4], expect: false},
          {args: [-7], expect: true},
          {args: [0], expect: false},
        ],
      },
      {
        label: 'isEven',
        name: 'even',
        calls: [
          {args: [4], expect: true},
          {args: [7], expect: false},
          {args: [-4], expect: true},
          {args: [0], expect: true},
        ],
      },
      {
        // "isDivisible(a, b)": is a divisible by b.
        label: 'isDivisible',
        name: 'divisible',
        calls: [
          {args: [10, 5], expect: true},
          {args: [10, 3], expect: false},
          {args: [9, 3], expect: true},
          {args: [0, 7], expect: true},
        ],
      },
    ],
  },
  {
    id: 'zerosum',
    label: 'Zero sum',
    prompt: 'a function that tells whether the numbers in a list add up to zero',
    forbidBlocks: ['math_on_list'],
    functions: [
      {
        label: 'zeroSum',
        name: 'zero|sum',
        calls: [
          {args: [[1, 2, -3]], expect: true},
          {args: [[4, 2]], expect: false},
          {args: [[]], expect: true},
          {args: [[0]], expect: true},
          {args: [[5, -2, -2]], expect: false},
          {args: [[-1, 1, 3, -3]], expect: true},
        ],
      },
    ],
  },
);

// ---- tasks that probe where the code dialect leaks --------------------------
// Text, recursion, loops with text output, searching, and nested lists.

const text = (args: unknown[], expect: unknown, asText?: true): CallCase => ({args, expect, ...(asText ? {asText} : {})});

TASKS.push(
  {
    id: 'palindrome',
    label: 'Palindrome',
    prompt: 'a function that tells whether a text is a palindrome',
    forbidBlocks: ['text_reverse'],
    functions: [
      {
        label: 'palindrome',
        name: 'palindrome',
        calls: [text(['racecar'], true), text(['hello'], false), text([''], true), text(['a'], true), text(['abba'], true), text(['abca'], false)],
      },
    ],
  },
  {
    id: 'reverse',
    label: 'Reverse a text',
    prompt: 'a function that reverses a text',
    forbidBlocks: ['text_reverse'],
    functions: [
      {
        label: 'reverse',
        name: 'revers',
        calls: [text(['abc'], 'cba'), text([''], ''), text(['a'], 'a'), text(['hello world'], 'dlrow olleh')],
      },
    ],
  },
  {
    id: 'vowels',
    label: 'Count vowels',
    prompt: 'a function that counts the vowels in a text',
    forbidBlocks: [],
    functions: [
      {
        label: 'countVowels',
        name: 'vowel',
        calls: [text(['hello'], 2), text(['sky'], 0), text(['banana'], 3), text([''], 0), text(['education'], 5)],
      },
    ],
  },
  {
    id: 'factorial',
    label: 'Factorial',
    prompt: 'a function that computes the factorial of a number',
    forbidBlocks: [],
    functions: [
      {
        label: 'factorial',
        name: 'fact',
        calls: [text([0], 1), text([1], 1), text([5], 120), text([10], 3628800)],
      },
    ],
  },
  {
    id: 'fibonacci',
    label: 'Fibonacci',
    prompt: 'a function that returns the n-th Fibonacci number, counting from 0: the 0th number is 0, the 1st is 1, the 2nd is 1, the 3rd is 2',
    forbidBlocks: [],
    functions: [
      {
        label: 'fibonacci',
        name: 'fib',
        calls: [text([0], 0), text([1], 1), text([2], 1), text([10], 55), text([15], 610)],
      },
    ],
  },
  {
    id: 'gcd',
    label: 'Greatest common divisor',
    prompt: 'a function that computes the greatest common divisor of two numbers',
    forbidBlocks: [],
    functions: [
      {
        label: 'gcd',
        name: 'gcd|greatest|common|divisor',
        calls: [text([12, 18], 6), text([7, 13], 1), text([100, 75], 25), text([5, 0], 5)],
      },
    ],
  },
  {
    id: 'fizzbuzz',
    label: 'FizzBuzz',
    prompt:
      'a function fizzBuzz that takes a number and returns the text Fizz for multiples of 3, Buzz for multiples of 5, FizzBuzz for multiples of both, and otherwise the number as text',
    forbidBlocks: [],
    functions: [
      {
        label: 'fizzBuzz',
        name: 'fizz',
        calls: [text([3], 'Fizz'), text([5], 'Buzz'), text([15], 'FizzBuzz'), text([7], '7', true), text([30], 'FizzBuzz'), text([4], '4', true)],
      },
    ],
  },
  {
    id: 'binsearch',
    label: 'Binary search',
    prompt:
      'a function binarySearch that takes a sorted list and a number and returns the 1-based position of the number in the list, or 0 when it is not there',
    forbidBlocks: ['lists_indexOf'],
    functions: [
      {
        label: 'binarySearch',
        name: 'search|find|position|index',
        calls: [
          text([[1, 3, 5, 7, 9], 7], 4),
          text([[1, 3, 5, 7, 9], 1], 1),
          text([[1, 3, 5, 7, 9], 9], 5),
          text([[1, 3, 5, 7, 9], 4], 0),
          text([[], 3], 0),
          text([[2], 2], 1),
        ],
      },
    ],
  },
  {
    id: 'matrix',
    label: 'Matrix sum',
    prompt: 'a function that adds up all the numbers in a list of lists',
    forbidBlocks: [],
    functions: [
      {
        label: 'matrixSum',
        name: 'sum|total|matrix|add',
        calls: [text([[[1, 2], [3, 4]]], 10), text([[[5]]], 5), text([[[], [1]]], 1), text([[[1, 2, 3], [4, 5, 6]]], 21), text([[]], 0)],
      },
    ],
  },
);

export interface Evaluation {
  checks: CheckResult[];
  functionNames: string[];
  programOutput: string[];
}

/**
 * Executes an accepted program and runs the task's checks on it.
 * `blockTypes` are the block types present in the final workspace.
 */
export function evaluate(
  task: Task,
  code: string,
  blockTypes: Set<string>,
  options: ExecuteOptions = {},
): Evaluation {
  const exec = execute(code, 3000, options);
  const functionNames = definedFunctions(code);
  const checks: CheckResult[] = [
    {
      name: 'program runs without error',
      passed: exec.runtimeError === null,
      detail: exec.runtimeError ?? `${exec.output.length} output line(s)`,
    },
  ];

  const used = task.forbidBlocks.filter((t) => blockTypes.has(t));
  checks.push({
    name: 'does not use a built-in sort block',
    passed: used.length === 0,
    detail: used.length ? `uses ${used.join(', ')}` : 'ok',
  });

  if (task.functions) {
    // Several functions, each found by name and called with fixed arguments.
    for (const f of task.functions) {
      // Models often define helpers with similar names, so the task passes if
      // any function matching the name does what is asked.
      const candidates = functionNames.filter((n) => new RegExp(f.name, 'i').test(n));
      if (candidates.length === 0) {
        checks.push({
          name: `${f.label} is defined`,
          passed: false,
          detail: `no function matching /${f.name}/i among ${functionNames.join(', ') || 'none'}`,
        });
        continue;
      }
      const results = candidates.map((n) => checkCalls(exec, n, f.calls, `${f.label} (${n}) is correct`));
      checks.push(results.find((r) => r.passed) ?? results[0]);
    }
    return {checks, functionNames, programOutput: exec.output};
  }

  // Judge the function that looks like the sort, else the first one defined.
  const target = functionNames.find((n) => /sort/i.test(n)) ?? functionNames[0];
  if (!target) {
    checks.push({name: 'defines a function', passed: false, detail: 'none found'});
  } else {
    checks.push(...checkSorts(exec, target, task.perf));
  }
  return {checks, functionNames, programOutput: exec.output};
}
