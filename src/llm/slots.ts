import * as Blockly from 'blockly/core';
import {ALLOWED_TYPES} from './catalog';

type Json = Record<string, any>;

/**
 * What a block plugs into. 'value' blocks have an output and go in value
 * inputs; 'statement' blocks go in statement inputs or a `next` chain; 'top'
 * blocks (function definitions) have neither and can only sit at top level.
 */
type Kind = 'value' | 'statement' | 'top';

const KIND_LABEL: Record<Kind, string> = {
  value: 'a value block (it has an output)',
  statement: 'a statement block',
  top: 'a top-level block',
};

/**
 * Finds blocks plugged into the wrong kind of slot, such as a number in a
 * `DO` input or an expression in a `next` chain. Blockly's own message for
 * this ("missing a previous connection") names neither the block's parent nor
 * the input, so the model could not tell where the mistake was.
 */
export function checkSlots(tops: Json[]): string[] {
  const scratch = new Blockly.Workspace();
  const kinds = new Map<string, Kind>();
  const errors: string[] = [];

  const kindOf = (type: string): Kind => {
    let kind = kinds.get(type);
    if (!kind) {
      const block = scratch.newBlock(type);
      kind = block.outputConnection
        ? 'value'
        : block.previousConnection || block.nextConnection
          ? 'statement'
          : 'top';
      block.dispose();
      kinds.set(type, kind);
    }
    return kind;
  };

  // Is `inputName` of a `parentType` block a statement slot or a value slot?
  const slotKind = (parentType: string, inputName: string): Kind => {
    const block = scratch.newBlock(parentType);
    const input = block.getInput(inputName);
    block.dispose();
    if (input) {
      return input.type === Blockly.inputs.inputTypes.STATEMENT
        ? 'statement'
        : 'value';
    }
    // Inputs added by a mutator (IF1, DO1, ...) are not on a fresh block.
    return /^(DO\d*|ELSE|STACK)$/.test(inputName) ? 'statement' : 'value';
  };

  const check = (
    child: Json,
    expected: Kind,
    where: string,
  ): void => {
    if (!child || !ALLOWED_TYPES.has(child.type)) return;
    const actual = kindOf(child.type);
    if (actual !== expected) {
      errors.push(
        `${where} needs ${KIND_LABEL[expected]}, but "${child.type}" is ${KIND_LABEL[actual]}.`,
      );
    }
  };

  // Value inputs also restrict the type of value they accept (add_text takes
  // only a String, math inputs only a Number...). Uses Blockly's own checker.
  const checkTypes = (
    parentType: string,
    inputName: string,
    childType: string,
  ): void => {
    if (!ALLOWED_TYPES.has(childType) || kindOf(childType) !== 'value') return;
    const parent = scratch.newBlock(parentType);
    const child = scratch.newBlock(childType);
    const slot = parent.getInput(inputName)?.connection;
    const out = child.outputConnection;
    if (slot && out && !scratch.connectionChecker.doTypeChecks(slot, out)) {
      errors.push(
        `Input ${inputName} of "${parentType}" accepts ${JSON.stringify(slot.getCheck())}, but "${childType}" produces ${JSON.stringify(out.getCheck())}. ${hint(slot.getCheck())}`,
      );
    }
    parent.dispose();
    child.dispose();
  };

  const hint = (accepted: string[] | null): string =>
    accepted?.includes('String')
      ? 'Wrap the value in text_join to make it text.'
      : 'Use a block that produces that type.';

  const visit = (block: Json): void => {
    if (!ALLOWED_TYPES.has(block.type)) return;
    for (const [name, input] of Object.entries<Json>(block.inputs ?? {})) {
      const child = input?.block ?? input?.shadow;
      if (!child) continue;
      const expected = slotKind(block.type, name);
      check(child, expected, `Input ${name} of "${block.type}"`);
      if (expected === 'value') checkTypes(block.type, name, child.type);
      visit(child);
    }
    const next = block.next?.block;
    if (next) {
      check(next, 'statement', `The "next" of "${block.type}"`);
      visit(next);
    }
  };

  try {
    for (const top of tops) {
      if (ALLOWED_TYPES.has(top.type) && kindOf(top.type) === 'value') {
        errors.push(
          `Top-level block "${top.type}" is a value block; it must be plugged into an input of another block (or wrapped, e.g. in add_text).`,
        );
      }
      visit(top);
    }
  } finally {
    scratch.dispose();
  }
  return errors;
}
