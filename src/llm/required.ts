import {ALLOWED_TYPES} from './catalog';

type Json = Record<string, any>;

/**
 * Value inputs that must hold a block, per block type.
 *
 * Blockly accepts an empty value input and the generator substitutes a default
 * ([] for a list, 0 for a number...), so the program loads and runs but means
 * something else, e.g. `n = [].length`. Only inputs that are always present
 * regardless of a block's dropdowns are listed here; inputs that appear
 * conditionally (AT, DIVISOR) and genuinely optional ones (the loop's BY, the
 * items of text_join and lists_create_with, a function's STACK) are handled
 * separately or left out on purpose.
 */
const REQUIRED_INPUTS: Record<string, string[]> = {
  controls_if: ['IF0'],
  logic_compare: ['A', 'B'],
  logic_operation: ['A', 'B'],
  logic_negate: ['BOOL'],
  logic_ternary: ['IF', 'THEN', 'ELSE'],
  controls_repeat_ext: ['TIMES'],
  controls_whileUntil: ['BOOL'],
  controls_for: ['FROM', 'TO'],
  controls_forEach: ['LIST'],
  math_arithmetic: ['A', 'B'],
  math_single: ['NUM'],
  math_trig: ['NUM'],
  math_number_property: ['NUMBER_TO_CHECK'],
  math_round: ['NUM'],
  math_on_list: ['LIST'],
  math_modulo: ['DIVIDEND', 'DIVISOR'],
  math_constrain: ['VALUE', 'LOW', 'HIGH'],
  math_random_int: ['FROM', 'TO'],
  math_atan2: ['X', 'Y'],
  text_append: ['TEXT'],
  text_length: ['VALUE'],
  text_isEmpty: ['VALUE'],
  text_indexOf: ['VALUE', 'FIND'],
  text_charAt: ['VALUE'],
  text_changeCase: ['TEXT'],
  text_trim: ['TEXT'],
  text_count: ['SUB', 'TEXT'],
  text_replace: ['FROM', 'TO', 'TEXT'],
  text_reverse: ['TEXT'],
  add_text: ['TEXT'],
  lists_repeat: ['ITEM', 'NUM'],
  lists_length: ['VALUE'],
  lists_isEmpty: ['VALUE'],
  lists_indexOf: ['VALUE', 'FIND'],
  lists_getIndex: ['VALUE'],
  lists_setIndex: ['LIST', 'TO'],
  lists_sort: ['LIST'],
  lists_reverse: ['LIST'],
  variables_set: ['VALUE'],
  math_change: ['DELTA'],
  procedures_defreturn: ['RETURN'],
  procedures_ifreturn: ['CONDITION'],
};

/** Blocks whose AT input exists only for WHERE = FROM_START or FROM_END. */
const AT_BLOCKS = new Set(['lists_getIndex', 'lists_setIndex', 'text_charAt']);

const CALLS = new Set(['procedures_callnoreturn', 'procedures_callreturn']);

/** The value inputs a block type always needs (see REQUIRED_INPUTS). */
export const requiredInputNames = (type: string): string[] =>
  REQUIRED_INPUTS[type] ?? [];

const isFilled = (block: Json, input: string): boolean => {
  const slot = block.inputs?.[input];
  return Boolean(slot?.block ?? slot?.shadow);
};

/** The input names a block needs, given its own fields and extraState. */
function requiredFor(block: Json): string[] {
  const names = [...(REQUIRED_INPUTS[block.type] ?? [])];

  if (AT_BLOCKS.has(block.type)) {
    // Blockly's default for WHERE is FROM_START.
    const where = block.fields?.WHERE ?? 'FROM_START';
    if (where === 'FROM_START' || where === 'FROM_END') names.push('AT');
  }
  if (
    block.type === 'math_number_property' &&
    block.fields?.PROPERTY === 'DIVISIBLE_BY'
  ) {
    names.push('DIVISOR');
  }
  if (block.type === 'controls_if') {
    // Every else-if branch (DOn) needs its condition (IFn).
    for (const name of Object.keys(block.inputs ?? {})) {
      const m = /^DO(\d+)$/.exec(name);
      if (m && Number(m[1]) > 0) names.push(`IF${m[1]}`);
    }
  }
  if (CALLS.has(block.type)) {
    const count = Array.isArray(block.extraState?.params)
      ? block.extraState.params.length
      : 0;
    for (let i = 0; i < count; i++) names.push(`ARG${i}`);
  }
  return [...new Set(names)];
}

/**
 * Finds value inputs that were left empty although the block needs them.
 * `block.id` is only present on blocks the flat builder made; when it is, the
 * message names it so the model can find the block it forgot to connect.
 */
export function checkRequiredInputs(tops: Json[]): string[] {
  const errors: string[] = [];

  const visit = (block: Json): void => {
    if (!block || !ALLOWED_TYPES.has(block.type)) return;
    for (const input of requiredFor(block)) {
      if (!isFilled(block, input)) {
        errors.push(
          block.id
            ? `Input ${input} of "${block.type}" (block "${block.id}") is empty; add a block whose parent is "${block.id}" and whose slot is "${input}".`
            : `Input ${input} of "${block.type}" is empty; it needs a block plugged in.`,
        );
      }
    }
    for (const slot of Object.values<Json>(block.inputs ?? {})) {
      const child = slot?.block ?? slot?.shadow;
      if (child) visit(child);
    }
    if (block.next?.block) visit(block.next.block);
  };

  for (const top of tops) visit(top);
  return errors;
}
