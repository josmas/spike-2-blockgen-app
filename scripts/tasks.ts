import {checkSorts, definedFunctions, execute} from './execute';
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
): Evaluation {
  const exec = execute(code);
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

  // Judge the function that looks like the sort, else the first one defined.
  const target = functionNames.find((n) => /sort/i.test(n)) ?? functionNames[0];
  if (!target) {
    checks.push({name: 'defines a function', passed: false, detail: 'none found'});
  } else {
    checks.push(...checkSorts(exec, target, task.perf));
  }
  return {checks, functionNames, programOutput: exec.output};
}
