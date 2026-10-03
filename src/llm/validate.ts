import * as Blockly from 'blockly/core';
import {javascriptGenerator} from 'blockly/javascript';
import {appendResponse, functionNames, walkBlocks} from '../append';
import {ALLOWED_TYPES} from './catalog';
import type {ModelResponse} from './parse';
import {checkRequiredInputs} from './required';
import {checkSlots} from './slots';

/**
 * Checks a model response against the real workspace without touching it.
 * Returns a list of problems; empty means the response is safe to append.
 */
export function validate(
  response: ModelResponse,
  ws: Blockly.Workspace,
): string[] {
  const blocks = response?.workspaceJson?.blocks?.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return ['workspaceJson.blocks.blocks must be a non-empty array.'];
  }
  if (blocks.some((b) => !b || typeof b !== 'object' || Array.isArray(b))) {
    return ['Every entry of "blocks" must be a block object.'];
  }

  // 1. Structural checks: allowed types and function-name collisions.
  const errors: string[] = [];
  const existing = new Set(functionNames(ws));
  const defined = new Set<string>();
  const called = new Set<string>();
  const usedVarIds = new Set<string>();
  const knownVarIds = new Set<string>([
    ...ws
      .getVariableMap()
      .getAllVariables()
      .map((v) => v.getId()),
    ...(response.workspaceJson.variables ?? []).map((v) => v.id),
  ]);
  for (const top of blocks) {
    walkBlocks(top, (b) => {
      if (!ALLOWED_TYPES.has(b.type)) {
        errors.push(`Block type "${b.type}" is not in the allowed list.`);
      }
      if (b.fields?.VAR?.id) usedVarIds.add(b.fields.VAR.id);
      for (const p of b.extraState?.params ?? []) {
        if (p?.id) usedVarIds.add(p.id);
      }
      if (b.type?.startsWith('procedures_call') && b.extraState?.name) {
        called.add(b.extraState.name);
      }
      if (b.type?.startsWith('procedures_def')) {
        const name = b.fields?.NAME;
        if (typeof name !== 'string' || !name) {
          errors.push(
            `A "${b.type}" block has no function name. Give it "fields": {"NAME": "<functionName>"}.`,
          );
          return;
        }
        if (existing.has(name)) {
          errors.push(
            `Function "${name}" already exists in the workspace; call it instead of redefining it, or pick a different name.`,
          );
        }
        if (defined.has(name)) {
          errors.push(`Function "${name}" is defined more than once.`);
        }
        defined.add(name);
      }
    });
  }
  for (const id of usedVarIds) {
    if (!knownVarIds.has(id)) {
      errors.push(`Variable id "${id}" is used but not listed in "variables".`);
    }
  }
  for (const name of called) {
    if (!defined.has(name) && !existing.has(name)) {
      errors.push(`Function "${name}" is called but never defined.`);
    }
  }
  if (errors.length) return [...new Set(errors)];
  errors.push(...checkSlots(blocks));
  if (errors.length) return [...new Set(errors)];
  errors.push(...checkRequiredInputs(blocks));
  if (errors.length) return [...new Set(errors)];

  // 2. Dry run on a copy of the workspace: Blockly rejects bad shapes, then
  //    the generated JavaScript must at least parse.
  const scratch = new Blockly.Workspace();
  // Blockly only warns (does not throw) about unknown dropdown values and the
  // like, silently substituting a default. Treat those warnings as errors.
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    errors.push(`Blockly warning: ${args.map(String).join(' ')}`);
  };
  try {
    Blockly.Events.disable();
    Blockly.serialization.workspaces.load(
      Blockly.serialization.workspaces.save(ws),
      scratch,
      undefined,
    );
    const before = scratch.getAllBlocks(false).length;
    appendResponse(scratch, response);
    const added = scratch.getAllBlocks(false).length - before;

    let total = 0;
    for (const top of blocks) walkBlocks(top, () => total++);
    // Shadow blocks and dropped connections show up as a count mismatch.
    if (added < total) {
      errors.push(
        `Only ${added} of ${total} blocks could be created; some blocks were dropped, probably because of invalid inputs or fields.`,
      );
    }

    const code = javascriptGenerator.workspaceToCode(scratch);
    // Parsed, never run.
    new Function(code);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  } finally {
    console.warn = originalWarn;
    Blockly.Events.enable();
    scratch.dispose();
  }
  return errors;
}
