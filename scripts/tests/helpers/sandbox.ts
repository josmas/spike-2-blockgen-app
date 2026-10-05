import {execute} from '../../execute';
import {toRunnable} from '../../../src/llm/codeCheck';

/**
 * Runs a program written in the code dialect (1-based lists, print/join) in
 * the benchmark's sandbox and returns what it printed.
 */
export function runDialect(code: string): {output: string[]; error: string | null} {
  const exec = execute(toRunnable(code), 3000, {dialect: true});
  return {output: exec.output, error: exec.runtimeError};
}

/** Runs the JavaScript Blockly generated (it prints through addText). */
export function runGenerated(js: string): {output: string[]; error: string | null} {
  const exec = execute(js, 3000);
  return {output: exec.output, error: exec.runtimeError};
}
