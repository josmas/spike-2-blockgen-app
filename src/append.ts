import * as Blockly from 'blockly/core';
import type {ModelResponse} from './llm/parse';

type Json = Record<string, any>;

const PROCEDURE_DEFS = ['procedures_defnoreturn', 'procedures_defreturn'];

// These blocks serialize extraState as an XML string that Blockly derives
// from their fields and inputs. A JSON object there crashes the loader, so
// whatever the model wrote is dropped.
const DERIVED_EXTRA_STATE = [
  'procedures_ifreturn',
  'text_charAt',
  'math_number_property',
  'math_on_list',
];

/** Names of the functions defined in a workspace. */
export function functionNames(ws: Blockly.Workspace): string[] {
  return ws
    .getAllBlocks(false)
    .filter((b) => PROCEDURE_DEFS.includes(b.type))
    .map((b) => String(b.getFieldValue('NAME')));
}

/** Parameter names of the functions in a workspace, by function name. */
export function functionSignatures(
  ws: Blockly.Workspace,
): Map<string, string[]> {
  const signatures = new Map<string, string[]>();
  for (const b of ws.getAllBlocks(false)) {
    if (!PROCEDURE_DEFS.includes(b.type)) continue;
    const state = Blockly.serialization.blocks.save(b, {
      addInputBlocks: false,
      addNextBlocks: false,
    }) as Json | null;
    const params: Json[] = state?.extraState?.params ?? [];
    signatures.set(
      String(b.getFieldValue('NAME')),
      params.map((p) => String(p.name)),
    );
  }
  return signatures;
}

/** Calls fn for every serialized block in the tree (inputs and next chains). */
export function walkBlocks(block: Json, fn: (b: Json) => void): void {
  fn(block);
  for (const input of Object.values<Json>(block.inputs ?? {})) {
    if (input?.block) walkBlocks(input.block, fn);
    if (input?.shadow) walkBlocks(input.shadow, fn);
  }
  if (block.next?.block) walkBlocks(block.next.block, fn);
}

/**
 * Appends the model's blocks to the workspace, below what is already there.
 * Variables that already exist (same name) are reused, and block ids are
 * dropped so they cannot clash with existing blocks.
 * Throws if Blockly rejects the state.
 */
export function appendResponse(
  ws: Blockly.Workspace,
  response: ModelResponse,
): number {
  const {variables = []} = response.workspaceJson;
  const blocks = response.workspaceJson.blocks.blocks;

  // Map the model's variable ids onto existing variables of the same name.
  const idMap = new Map<string, string>();
  for (const v of variables) {
    const existing = ws.getVariableMap().getVariable(v.name, v.type ?? '');
    if (existing) {
      idMap.set(v.id, existing.getId());
    } else {
      ws.getVariableMap().createVariable(v.name, v.type ?? '', v.id);
    }
  }

  const remap = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(remap);
    } else if (value && typeof value === 'object') {
      const obj = value as Json;
      if (typeof obj.id === 'string' && idMap.has(obj.id)) {
        obj.id = idMap.get(obj.id);
      }
      Object.values(obj).forEach(remap);
    }
  };

  // Blocks are copied so a failed attempt never mutates the model's response.
  const copy: Json[] = JSON.parse(JSON.stringify(blocks));
  // Headless workspaces (used for validation) have no layout, so no offset.
  const yOffset =
    ws instanceof Blockly.WorkspaceSvg && ws.getTopBlocks(false).length > 0
      ? ws.getBlocksBoundingBox().bottom + 40
      : 0;
  let count = 0;

  for (const top of copy) {
    walkBlocks(top, (b) => {
      delete b.id;
      if (DERIVED_EXTRA_STATE.includes(b.type)) delete b.extraState;
      count++;
    });
    // Variable ids can sit in fields (VAR) and extraState (params).
    remap(top);
    top.x = Number(top.x ?? 0);
    top.y = Number(top.y ?? 0) + yOffset;
    Blockly.serialization.blocks.append(
      top as unknown as Blockly.serialization.blocks.State,
      ws,
    );
  }
  return count;
}
