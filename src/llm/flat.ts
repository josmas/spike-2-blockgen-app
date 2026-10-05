/**
 * The flat reply format.
 *
 * Instead of writing blocks inside their parents (deep nesting, long runs of
 * closing braces), the model lists every block once and says which block it
 * plugs into:
 *
 *   {"id":"b3","type":"math_number","parent":"b2","slot":"A","name":"","params":[],
 *    "fields":[{"name":"NUM","value":"5"}]}
 *
 * buildFromFlat() turns that list into the nested ModelResponse that
 * validate() and appendResponse() already understand, and derives what the
 * model should not have to write: variable ids, the variables list, function
 * parameters on callers, if/else counts, item counts and block positions.
 */
import {blockKind} from './catalog';
import type {ModelResponse} from './parse';
import {requiredInputNames} from './required';

type Json = Record<string, any>;

export interface FlatField {
  name: string;
  value: string | number | boolean;
}

/** One block. Unused properties are "" (or [] for params), never missing. */
export interface FlatBlock {
  id: string;
  type: string;
  /** Id of the block this one plugs into, or "" for a top-level block. */
  parent: string;
  /** An input name of the parent, or "next" to run right after the parent. */
  slot: string;
  /** Function name, for definitions and calls. */
  name: string;
  /** Parameter names, for definitions. */
  params: string[];
  fields: FlatField[];
}

export interface FlatResponse {
  summary?: string;
  blocks: FlatBlock[];
}

/** Block types whose VAR field holds a variable (the model writes its name). */
const VAR_FIELD_TYPES = new Set([
  'variables_get',
  'variables_set',
  'math_change',
  'controls_for',
  'controls_forEach',
  'text_append',
]);
const DEF_TYPES = new Set(['procedures_defnoreturn', 'procedures_defreturn']);
const CALL_TYPES = new Set(['procedures_callnoreturn', 'procedures_callreturn']);

/** Slots that hold statements; every other slot holds a value. */
const STATEMENT_SLOT = /^(?:DO\d*|ELSE|STACK|next)$/;

/** ELSE holds statements on controls_if, but is a value slot on logic_ternary. */
const isStatementSlot = (slot: string, parentType: string): boolean =>
  slot === 'ELSE' ? parentType === 'controls_if' : STATEMENT_SLOT.test(slot);

const text = (v: unknown): string =>
  v === null || v === undefined ? '' : String(v);

/** Reads the model's JSON into FlatBlocks, tolerating missing/null properties. */
function normalize(input: unknown, errors: string[]): FlatBlock[] {
  const list =
    input && typeof input === 'object' ? (input as Json).blocks : undefined;
  if (!Array.isArray(list) || list.length === 0) {
    errors.push(
      'Problem with the block list: "blocks" must be a non-empty array of block objects.',
    );
    return [];
  }
  const blocks: FlatBlock[] = [];
  list.forEach((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(
        `Problem with the block list: entry ${i + 1} is not a block object.`,
      );
      return;
    }
    const b = item as Json;
    const fields: FlatField[] = [];
    if (Array.isArray(b.fields)) {
      for (const f of b.fields) {
        if (f && typeof f === 'object' && typeof f.name === 'string') {
          fields.push({name: f.name, value: f.value ?? ''});
        }
      }
    } else if (b.fields && typeof b.fields === 'object') {
      // Tolerate {"OP": "ADD"} from a model that ignores the list form.
      for (const [name, value] of Object.entries(b.fields)) {
        fields.push({name, value: value as string});
      }
    }
    blocks.push({
      id: text(b.id),
      type: text(b.type),
      parent: text(b.parent),
      slot: text(b.slot),
      name: text(b.name),
      params: Array.isArray(b.params) ? b.params.map(text) : [],
      fields,
    });
  });
  return blocks;
}

/** The empty value slots of a block, among those its type always needs. */
function emptySlots(holder: FlatBlock, blocks: FlatBlock[]): string[] {
  const used = new Set(
    blocks.filter((k) => k.parent === holder.id).map((k) => k.slot),
  );
  return requiredInputNames(holder.type).filter((slot) => !used.has(slot));
}

/** For a block that should be an operand but was given a wrong parent. */
function operandHint(
  child: FlatBlock,
  holder: FlatBlock,
  blocks: FlatBlock[],
): string {
  if (blockKind(holder.type) !== 'value') return '';
  const free = emptySlots(holder, blocks);
  return free.length
    ? `If "${child.id}" is an operand of "${holder.id}", make "${holder.id}" its parent and use one of its empty slots instead (${free.join(', ')}).`
    : '';
}

/**
 * Explains a slot that two blocks both claim, and the two usual causes:
 * the same block listed twice, or an operand given the wrong parent (the
 * block that holds the slot, instead of the operator it belongs to).
 */
function slotTakenMessage(
  b: FlatBlock,
  holder: FlatBlock,
  blocks: FlatBlock[],
): string {
  const head = `Problem with block "${b.id}": slot "${b.slot}" of "${b.parent}" already holds "${holder.id}" (${holder.type}), and a slot holds only one block.`;
  const hints: string[] = [];
  const duplicate =
    !isStatementSlot(b.slot, holder.type) &&
    holder.type === b.type &&
    holder.name === b.name &&
    JSON.stringify(holder.fields) === JSON.stringify(b.fields);
  if (duplicate) {
    hints.push(
      `"${b.id}" looks like a second copy of "${holder.id}" (same type and fields). List each block once: remove "${b.id}" and every block whose parent is "${b.id}".`,
    );
  } else {
    const operand = operandHint(b, holder, blocks);
    if (operand) hints.push(operand);
  }
  if (b.slot === 'next') {
    hints.push(
      `A statement has only one follower: chain "${b.id}" after "${holder.id}" (parent "${holder.id}", slot "next") or after the last statement of that chain.`,
    );
  } else if (isStatementSlot(b.slot, holder.type)) {
    hints.push(
      `To put several statements in a slot, give the first one that slot and chain each further one after the previous with slot "next".`,
    );
  }
  if (hints.length === 0) {
    hints.push(
      `Either "${b.id}" repeats a block you already listed (remove it), or its parent or slot is wrong: a block's parent is the block that directly contains it.`,
    );
  }
  return [head, ...hints].join(' ');
}

export interface FlatBuildResult {
  /** The nested form, or null when `errors` is not empty. */
  response: ModelResponse | null;
  /** Problems written for the model, naming blocks by id. */
  errors: string[];
}

/**
 * @param input       the parsed JSON of the model's reply
 * @param signatures  parameter names of functions already in the workspace,
 *                    so calls to them can be built without a definition
 */
export function buildFromFlat(
  input: unknown,
  signatures: Map<string, string[]> = new Map(),
): FlatBuildResult {
  const errors: string[] = [];
  const blocks = normalize(input, errors);
  if (errors.length) return {response: null, errors};

  // ---- ids, parents and slots -------------------------------------------
  const byId = new Map<string, FlatBlock>();
  for (const b of blocks) {
    if (!b.id) {
      errors.push(
        `Problem with the block list: a block of type "${b.type}" has no "id".`,
      );
    } else if (byId.has(b.id)) {
      errors.push(`Problem with block "${b.id}": the id is used more than once.`);
    } else {
      byId.set(b.id, b);
      if (!b.type) errors.push(`Problem with block "${b.id}": it has no "type".`);
    }
  }

  const children = new Map<string, FlatBlock[]>();
  const taken = new Map<string, string>();
  for (const b of blocks) {
    if (!b.id || (!b.parent && !b.slot)) continue;
    if (!b.parent) {
      errors.push(
        `Problem with block "${b.id}": it has slot "${b.slot}" but no parent. A top-level block has parent "" and slot "".`,
      );
      continue;
    }
    if (!byId.has(b.parent)) {
      errors.push(
        `Problem with block "${b.id}": its parent "${b.parent}" does not exist.`,
      );
      continue;
    }
    if (!b.slot) {
      errors.push(
        `Problem with block "${b.id}": it has a parent but no slot. Name one of the parent's inputs (such as "A", "DO" or "ARG0"), or use "next" to run it right after the parent.`,
      );
      continue;
    }
    const key = `${b.parent}\u0000${b.slot}`;
    const other = taken.get(key);
    if (other) {
      errors.push(slotTakenMessage(b, byId.get(other)!, blocks));
      continue;
    }
    taken.set(key, b.id);
    children.set(b.parent, [...(children.get(b.parent) ?? []), b]);
  }

  // A block that is (indirectly) its own parent can never be built.
  for (const b of blocks) {
    const seen = new Set<string>();
    let current: FlatBlock | undefined = b;
    while (current && current.parent) {
      if (seen.has(current.id)) {
        errors.push(
          `Problem with block "${b.id}": the parents form a loop through "${current.id}".`,
        );
        break;
      }
      seen.add(current.id);
      current = byId.get(current.parent);
    }
  }
  if (errors.length) return {response: null, errors: [...new Set(errors)]};

  // A value block in a statement slot (or the reverse) can never be built.
  // Blockly's own message for this names no ids, so say it here.
  for (const b of blocks) {
    const kind = blockKind(b.type);
    if (!kind) continue;
    if (!b.parent) {
      if (kind === 'value') {
        errors.push(
          `Problem with block "${b.id}": "${b.type}" is a value block, so it must plug into a slot of another block. It cannot be top-level (parent "").`,
        );
      }
      continue;
    }
    const parent = byId.get(b.parent)!;
    if (kind === 'top') {
      errors.push(
        `Problem with block "${b.id}": a function definition ("${b.type}") must be top-level, with parent "" and slot "".`,
      );
    } else if (b.slot === 'next') {
      const parentKind = blockKind(parent.type);
      if (parentKind && parentKind !== 'statement') {
        errors.push(
          `Problem with block "${b.id}": slot "next" only follows a statement, but its parent "${b.parent}" is ${parentKind === 'value' ? 'a value block' : 'a function definition'} ("${parent.type}"). ${parentKind === 'value' ? operandHint(b, parent, blocks) : `Make "${b.id}" a separate top-level block (parent "" and slot "").`}`,
        );
      } else if (kind === 'value') {
        errors.push(
          `Problem with block "${b.id}": "${b.type}" is a value block and cannot use slot "next". A value block plugs into an input slot of its parent (such as A, B, VALUE or AT).`,
        );
      }
    } else if (isStatementSlot(b.slot, parent.type) && kind === 'value') {
      errors.push(
        `Problem with block "${b.id}": "${b.type}" is a value block, but slot "${b.slot}" of "${b.parent}" holds statements. Put it in a value slot, or wrap it in a block that consumes it.`,
      );
    } else if (!isStatementSlot(b.slot, parent.type) && kind === 'statement') {
      errors.push(
        `Problem with block "${b.id}": "${b.type}" is a statement block, but slot "${b.slot}" of "${b.parent}" holds a value. Put it in a statement slot, after another statement with "next", or at top level.`,
      );
    }
  }
  if (errors.length) return {response: null, errors: [...new Set(errors)]};

  // ---- functions, variables and fields ----------------------------------
  const nameOf = (b: FlatBlock): string =>
    b.name || text(b.fields.find((f) => f.name === 'NAME')?.value);

  const defined = new Map<string, string[]>();
  for (const b of blocks) {
    if (!DEF_TYPES.has(b.type)) continue;
    const name = nameOf(b);
    if (!name) {
      errors.push(
        `Problem with block "${b.id}": a function definition needs a "name", for example "name":"bubbleSort".`,
      );
    } else {
      defined.set(name, b.params);
    }
    if (b.params.some((p) => !p.trim())) {
      errors.push(
        `Problem with block "${b.id}": parameter names in "params" must not be empty.`,
      );
    }
  }
  const signatureOf = (name: string) => defined.get(name) ?? signatures.get(name);

  for (const b of blocks) {
    if (CALL_TYPES.has(b.type)) {
      const name = nameOf(b);
      const signature = name ? signatureOf(name) : undefined;
      if (!name) {
        errors.push(
          `Problem with block "${b.id}": a function call needs a "name", the function to call.`,
        );
      } else if (!signature) {
        errors.push(
          `Problem with block "${b.id}": it calls "${name}", which is neither defined in your reply nor in the workspace.`,
        );
      } else {
        for (const child of children.get(b.id) ?? []) {
          if (child.slot === 'next') continue; // a call is a statement too: it can have a follower
          const m = /^ARG(\d+)$/.exec(child.slot);
          if (!m || Number(m[1]) >= signature.length) {
            errors.push(
              `Problem with block "${child.id}": slot "${child.slot}" does not exist on the call to "${name}", which takes ${signature.length} argument(s) in slots ARG0${signature.length > 1 ? `..ARG${signature.length - 1}` : ''}.`,
            );
          }
        }
      }
    }
    if (VAR_FIELD_TYPES.has(b.type)) {
      const v = b.fields.find((f) => f.name === 'VAR');
      if (!v || !text(v.value).trim()) {
        errors.push(
          `Problem with block "${b.id}": "${b.type}" needs the field VAR with a variable name, e.g. {"name":"VAR","value":"total"}.`,
        );
      }
    }
    if (b.type === 'math_number') {
      const n = b.fields.find((f) => f.name === 'NUM');
      if (!n || text(n.value).trim() === '' || !Number.isFinite(Number(n.value))) {
        errors.push(
          `Problem with block "${b.id}": math_number needs a numeric field NUM, e.g. {"name":"NUM","value":"5"}.`,
        );
      }
    }
  }
  if (errors.length) return {response: null, errors: [...new Set(errors)]};

  // Variable ids are made up here, one per distinct name.
  const variableIds = new Map<string, string>();
  const variableId = (name: string): string => {
    let id = variableIds.get(name);
    if (!id) {
      id = `v${variableIds.size + 1}`;
      variableIds.set(name, id);
    }
    return id;
  };

  // ---- build the nested blocks -------------------------------------------
  const nodes = new Map<string, Json>();
  for (const b of blocks) {
    // The id is only for error messages; appendResponse() drops it.
    const node: Json = {type: b.type, id: b.id};
    const fields: Json = {};
    for (const f of b.fields) {
      if (f.name === 'VAR' && VAR_FIELD_TYPES.has(b.type)) {
        fields.VAR = {id: variableId(text(f.value).trim())};
      } else if (b.type === 'math_number' && f.name === 'NUM') {
        fields.NUM = Number(f.value);
      } else if (typeof f.value === 'boolean') {
        fields[f.name] = f.value ? 'TRUE' : 'FALSE';
      } else {
        fields[f.name] = text(f.value);
      }
    }
    if (DEF_TYPES.has(b.type)) {
      fields.NAME = nameOf(b);
      node.extraState = {
        params: b.params.map((p) => ({name: p.trim(), id: variableId(p.trim())})),
      };
    } else if (CALL_TYPES.has(b.type)) {
      const name = nameOf(b);
      node.extraState = {name, params: [...(signatureOf(name) ?? [])]};
    }
    if (Object.keys(fields).length) node.fields = fields;
    nodes.set(b.id, node);
  }

  for (const b of blocks) {
    if (!b.parent) continue;
    const parent = nodes.get(b.parent)!;
    const node = nodes.get(b.id)!;
    if (b.slot === 'next') {
      parent.next = {block: node};
    } else {
      (parent.inputs ??= {})[b.slot] = {block: node};
    }
  }

  // Mutation data the model never writes: derived from which slots are used.
  for (const b of blocks) {
    const kids = children.get(b.id) ?? [];
    const node = nodes.get(b.id)!;
    if (b.type === 'controls_if') {
      let elseIfCount = 0;
      let hasElse = false;
      for (const k of kids) {
        const m = /^(?:IF|DO)(\d+)$/.exec(k.slot);
        if (m) elseIfCount = Math.max(elseIfCount, Number(m[1]));
        if (k.slot === 'ELSE') hasElse = true;
      }
      if (elseIfCount || hasElse) node.extraState = {elseIfCount, hasElse};
    } else if (b.type === 'text_join' || b.type === 'lists_create_with') {
      let itemCount = 0;
      for (const k of kids) {
        const m = /^ADD(\d+)$/.exec(k.slot);
        if (m) itemCount = Math.max(itemCount, Number(m[1]) + 1);
      }
      node.extraState = {itemCount};
    }
  }

  // ---- top-level blocks, stacked down the page ---------------------------
  const countBelow = (id: string): number =>
    (children.get(id) ?? []).reduce((n, k) => n + 1 + countBelow(k.id), 0);
  let y = 20;
  const tops: Json[] = [];
  for (const b of blocks) {
    if (b.parent) continue;
    const node = nodes.get(b.id)!;
    node.x = 20;
    node.y = y;
    y += 70 + 30 * countBelow(b.id);
    tops.push(node);
  }

  const summary = text((input as Json).summary);
  return {
    response: {
      ...(summary ? {summary} : {}),
      workspaceJson: {
        blocks: {languageVersion: 0, blocks: tops},
        variables: [...variableIds].map(([name, id]) => ({name, id})),
      },
    },
    errors: [],
  };
}

// ---- the other direction, for the prompt examples and tests ---------------

/** Converts a nested response into flat form. Depth-first, parents first. */
export function nestedToFlat(response: ModelResponse): FlatResponse {
  const variableNames = new Map(
    (response.workspaceJson.variables ?? []).map((v) => [v.id, v.name]),
  );
  const out: FlatBlock[] = [];
  let counter = 0;

  const visit = (node: Json, parent: string, slot: string): void => {
    const id = `b${++counter}`;
    const fields: FlatField[] = [];
    let name = '';
    let params: string[] = [];
    for (const [key, value] of Object.entries<any>(node.fields ?? {})) {
      if (key === 'VAR') {
        fields.push({name: 'VAR', value: variableNames.get(value.id) ?? value.id});
      } else if (key === 'NAME' && DEF_TYPES.has(node.type)) {
        name = String(value);
      } else {
        fields.push({name: key, value: String(value)});
      }
    }
    if (DEF_TYPES.has(node.type)) {
      params = (node.extraState?.params ?? []).map((p: Json) => String(p.name));
    } else if (CALL_TYPES.has(node.type)) {
      name = String(node.extraState?.name ?? '');
    }
    out.push({id, type: node.type, parent, slot, name, params, fields});

    for (const [inputName, input] of Object.entries<any>(node.inputs ?? {})) {
      const child = input?.block ?? input?.shadow;
      if (child) visit(child, id, inputName);
    }
    if (node.next?.block) visit(node.next.block, id, 'next');
  };

  for (const top of response.workspaceJson.blocks.blocks) {
    visit(top as Json, '', '');
  }
  return {summary: response.summary, blocks: out};
}

/** One block per line: easy to read, and no deep nesting to count. */
export function formatFlat(flat: FlatResponse): string {
  return (
    `{"summary":${JSON.stringify(flat.summary ?? '')},"blocks":[\n` +
    flat.blocks.map((b) => JSON.stringify(b)).join(',\n') +
    '\n]}'
  );
}
