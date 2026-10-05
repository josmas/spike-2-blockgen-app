import * as vm from 'node:vm';
import type {CheckResult} from './types';

/**
 * Runs the JavaScript Blockly generated for an accepted workspace, so the
 * benchmark can tell "valid" from "correct". The code runs in a node:vm
 * context with a fake `document`, and every call has a timeout, because a
 * wrong loop would otherwise hang the benchmark. vm is not a security
 * boundary; this runs model-written code on your machine, with no access to
 * require/process/fs/network from inside the context, which is acceptable for
 * a local benchmark but would not be for untrusted code in general.
 *
 * Blockly's code runs inside a function (see scoped()); the model's own
 * program in the code dialect (options.dialect) runs as it is.
 */

/** Helper functions Blockly itself adds to the output. */
const HELPERS = new Set(['addText', 'print', 'join']);

export interface Execution {
  context: vm.Context;
  /** Output lines written through the addText helper. */
  output: string[];
  runtimeError: string | null;
}

export function definedFunctions(code: string): string[] {
  const names: string[] = [];
  for (const m of code.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
    if (!HELPERS.has(m[1])) names.push(m[1]);
  }
  return names;
}

export interface ExecuteOptions {
  /**
   * Provide print() and join() as the code dialect defines them (see
   * src/llm/dialect.ts), for running the model's own program instead of the
   * JavaScript Blockly generated.
   */
  dialect?: boolean;
}

/**
 * Runs Blockly's generated code inside a function, with its user-defined
 * functions re-exposed on the global object so the checks can call them.
 *
 * Why: Blockly declares every variable with a top-level `var`. In a node:vm
 * context, top-level variables are properties of the context's global object,
 * and each access goes through the vm interceptors: about 250x slower than a
 * local (insertion sort of 20,000 numbers: 44 s against 0.17 s). A browser has
 * no such penalty, so running it like this measures the blocks' algorithm, not
 * the sandbox. The semantics are the same: one scope, everything hoisted.
 */
function scoped(code: string): string {
  const exposed = definedFunctions(code).map((name) => `globalThis.${name} = ${name};`);
  return `(function () {\n${code}\n${exposed.join('\n')}\n})();`;
}

export function execute(
  code: string,
  timeoutMs = 3000,
  options: ExecuteOptions = {},
): Execution {
  const output: string[] = [];
  const sandbox: Record<string, unknown> = {
    ...(options.dialect
      ? {
          print: (value: unknown) => output.push(String(value)),
          join: (...parts: unknown[]) => parts.map(String).join(''),
        }
      : {}),
    document: {
      getElementById: () => ({
        appendChild: (el: {innerText: unknown}) => {
          output.push(String(el.innerText));
        },
      }),
      createElement: () => ({innerText: ''}),
    },
  };
  const context = vm.createContext(sandbox);
  let runtimeError: string | null = null;
  try {
    vm.runInContext(options.dialect ? code : scoped(code), context, {timeout: timeoutMs});
  } catch (e) {
    runtimeError = e instanceof Error ? e.message : String(e);
  }
  return {context, output, runtimeError};
}

// ---- sorting checks -------------------------------------------------------

/** Pseudo-random but fixed, so every model gets the same inputs. */
function lcgArray(length: number, seed: number): number[] {
  const out: number[] = [];
  let x = seed;
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    out.push((x % 2000) - 1000);
  }
  return out;
}

const SORT_CASES: Array<{name: string; input: number[]}> = [
  {name: '[5,2,9,1]', input: [5, 2, 9, 1]},
  {name: '[]', input: []},
  {name: '[1]', input: [1]},
  {name: '[2,1]', input: [2, 1]},
  {name: 'already sorted', input: [1, 2, 3, 4, 5]},
  {name: 'reversed', input: [9, 8, 7, 6, 5, 4]},
  {name: 'duplicates', input: [4, 4, 1, 4, 1]},
  {name: 'negatives and decimals', input: [10, -3, 7, 0, -8, 2.5]},
  {name: '200 pseudo-random numbers', input: lcgArray(200, 42)},
];

type CallResult =
  | {ok: true; value: unknown}
  | {ok: false; error: string; timedOut: boolean};

function run(context: vm.Context, script: string, timeoutMs: number): CallResult {
  try {
    return {ok: true, value: vm.runInContext(script, context, {timeout: timeoutMs})};
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return {ok: false, error, timedOut: /timed out/i.test(error)};
  }
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Calls `fnName` on a set of arrays. A function passes a case if the array it
 * returns, or else the array it was given (in-place sort), is sorted.
 */
export function checkSorts(
  exec: Execution,
  fnName: string,
  perf?: {size: number; timeoutMs: number},
): CheckResult[] {
  const results: CheckResult[] = [];
  if (!IDENTIFIER.test(fnName)) {
    return [{name: 'sorts correctly', passed: false, detail: `bad function name ${fnName}`}];
  }

  let failure: string | null = null;
  for (const c of SORT_CASES) {
    const script = `(function () {
      var a = ${JSON.stringify(c.input)};
      var r = ${fnName}(a);
      return JSON.stringify({ret: r === undefined ? null : r, arg: a});
    })()`;
    const called = run(exec.context, script, 1000);
    if (!called.ok) {
      failure = `${c.name}: ${called.timedOut ? 'did not finish within 1s' : called.error}`;
      break;
    }
    const parsed = JSON.parse(String(called.value)) as {ret: unknown; arg: number[]};
    const got = Array.isArray(parsed.ret) ? (parsed.ret as number[]) : parsed.arg;
    const expected = [...c.input].sort((x, y) => x - y);
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      failure = `${c.name}: got ${JSON.stringify(got).slice(0, 80)}, expected ${JSON.stringify(expected).slice(0, 80)}`;
      break;
    }
  }
  results.push({
    name: `${fnName} sorts correctly`,
    passed: failure === null,
    detail: failure ?? `${SORT_CASES.length} cases`,
  });

  // Only worth timing if it sorts at all.
  if (perf && failure === null) {
    const script = `(function () {
      var a = [], x = 12345;
      for (var i = 0; i < ${perf.size}; i++) {
        x = (x * 1103515245 + 12345) % 2147483648;
        a.push(x % 100000);
      }
      var r = ${fnName}(a);
      var s = Array.isArray(r) ? r : a;
      for (var j = 1; j < s.length; j++) if (s[j - 1] > s[j]) return 'unsorted';
      return s.length === ${perf.size} ? 'ok' : 'wrong length';
    })()`;
    const timed = run(exec.context, script, perf.timeoutMs);
    results.push({
      name: `fast enough on ${perf.size.toLocaleString('en-US')} numbers`,
      passed: timed.ok && timed.value === 'ok',
      detail: timed.ok
        ? String(timed.value)
        : timed.timedOut
          ? `no result within ${perf.timeoutMs / 1000}s (quadratic?)`
          : timed.error,
    });
  }
  return results;
}

// ---- function checks ---------------------------------------------------------

/** One call to check. `args` are JSON values; `expect` is the exact result. */
export interface CallCase {
  args: unknown[];
  expect: unknown;
  /**
   * Compare as text: a result of 7 equals the expected "7". For requests that
   * say "as text", where a model may reasonably return either.
   */
  asText?: true;
}

/** Calls `fnName` with each case's arguments and compares the result. */
export function checkCalls(
  exec: Execution,
  fnName: string,
  cases: CallCase[],
  label: string,
): CheckResult {
  if (!IDENTIFIER.test(fnName)) {
    return {name: label, passed: false, detail: `bad function name ${fnName}`};
  }
  for (const c of cases) {
    const script = `JSON.stringify(${fnName}(${c.args.map((a) => JSON.stringify(a)).join(', ')}))`;
    const called = run(exec.context, script, 1000);
    const shown = `${fnName}(${c.args.map((a) => JSON.stringify(a)).join(', ')})`;
    if (!called.ok) {
      return {
        name: label,
        passed: false,
        detail: `${shown}: ${called.timedOut ? 'did not finish within 1s' : called.error}`,
      };
    }
    const same = c.asText
      ? String(JSON.parse(String(called.value))) === String(c.expect)
      : called.value === JSON.stringify(c.expect);
    if (!same) {
      return {
        name: label,
        passed: false,
        detail: `${shown}: got ${String(called.value).slice(0, 60)}, expected ${JSON.stringify(c.expect)}`,
      };
    }
  }
  return {name: label, passed: true, detail: `${cases.length} calls`};
}
