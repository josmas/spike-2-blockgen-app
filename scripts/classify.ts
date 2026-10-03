import type {FailureCategory} from './types';

/**
 * Buckets an error message from the app (see src/llm/validate.ts, slots.ts,
 * openrouter.ts and generate.ts) into a coarse category for the report.
 * Order matters: more specific patterns come first.
 */
export function classify(error: string): FailureCategory {
  // Flat reply format: problems found while wiring blocks together (flat.ts).
  if (/^Problem with (block|the block list)/.test(error)) return 'flat-structure';
  if (/is empty; (it needs a block|add a block)/.test(error)) return 'empty-input';
  if (/not valid JSON/i.test(error)) return 'invalid-json';
  if (/ran out of tokens/i.test(error)) return 'out-of-tokens';
  if (/No data from the model/i.test(error)) return 'timeout';
  if (/returned no content/i.test(error)) return 'no-content';
  if (/^OpenRouter( error)?[ :]/i.test(error)) return 'http-error';
  if (/not in the allowed list/i.test(error)) return 'block-type';
  if (
    /needs (a statement|a value) block|cannot have a "next"|must be written as|is a value block; it must be plugged|is a top-level block/i.test(
      error,
    )
  ) {
    return 'wrong-slot';
  }
  if (/accepts \[/i.test(error)) return 'type-mismatch';
  if (
    /function name|already exists in the workspace|defined more than once|called but never defined/i.test(
      error,
    )
  ) {
    return 'function-names';
  }
  if (/Variable id .* not listed/i.test(error)) return 'variables';
  if (
    /missing a\(n\)|could not connect|Blockly warning|Only \d+ of \d+ blocks|Invalid block definition|dropdown|Connection checks failed|Could not add the blocks/i.test(
      error,
    )
  ) {
    return 'blockly-load';
  }
  if (/SyntaxError|Unexpected (token|identifier|end)|Invalid or unexpected/i.test(error)) {
    return 'javascript';
  }
  return 'other';
}

export const CATEGORY_LABELS: Record<FailureCategory, string> = {
  'invalid-json': 'Invalid JSON',
  'block-type': 'Unknown block type',
  'wrong-slot': 'Block in wrong slot',
  'flat-structure': 'Flat wiring error',
  'empty-input': 'Empty required input',
  'type-mismatch': 'Value type mismatch',
  'function-names': 'Function names',
  variables: 'Undeclared variable',
  'blockly-load': 'Blockly load error',
  javascript: 'Generated JS invalid',
  'http-error': 'HTTP / API error',
  timeout: 'Timeout',
  'out-of-tokens': 'Out of tokens',
  'no-content': 'Empty reply',
  other: 'Other',
};
