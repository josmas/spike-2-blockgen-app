/**
 * JSON Schema for the model's reply, sent as OpenRouter structured output.
 *
 * It is deliberately loose. Strict schemas must spell out every key, but
 * Blockly's field and input names depend on the block type (see catalog.ts),
 * and blocks nest to any depth. So this fixes the overall shape and the
 * recursion, and leaves fields/inputs open. Catalog and Blockly validation
 * still do the detailed checking.
 */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: {type: 'string'},
    workspaceJson: {
      type: 'object',
      properties: {
        blocks: {
          type: 'object',
          properties: {
            languageVersion: {type: 'integer'},
            blocks: {type: 'array', items: {$ref: '#/$defs/block'}},
          },
          required: ['blocks'],
        },
        variables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {name: {type: 'string'}, id: {type: 'string'}},
            required: ['name', 'id'],
          },
        },
      },
      required: ['blocks', 'variables'],
    },
  },
  required: ['summary', 'workspaceJson'],
  $defs: {
    block: {
      type: 'object',
      properties: {
        type: {type: 'string'},
        x: {type: 'number'},
        y: {type: 'number'},
        // Values are strings, numbers, booleans or {"id": "..."} objects.
        fields: {type: 'object'},
        // Block-type specific, e.g. {"itemCount": 2} or {"params": [...]}.
        extraState: {type: 'object'},
        inputs: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              block: {$ref: '#/$defs/block'},
              shadow: {$ref: '#/$defs/block'},
            },
          },
        },
        next: {
          type: 'object',
          properties: {block: {$ref: '#/$defs/block'}},
        },
      },
      required: ['type'],
    },
  },
};

/**
 * JSON Schema for the flat reply format (see flat.ts).
 *
 * Unlike RESPONSE_SCHEMA it needs no recursion and no open-ended objects:
 * every object spells out its properties, lists them all as required and
 * forbids extras, which is what strict structured-output modes (OpenAI,
 * Google) require. Unused values are "" or [], never null, to avoid unions.
 */
export const FLAT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: {type: 'string'},
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {type: 'string'},
          type: {type: 'string'},
          parent: {type: 'string'},
          slot: {type: 'string'},
          name: {type: 'string'},
          params: {type: 'array', items: {type: 'string'}},
          fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {name: {type: 'string'}, value: {type: 'string'}},
              required: ['name', 'value'],
              additionalProperties: false,
            },
          },
        },
        required: ['id', 'type', 'parent', 'slot', 'name', 'params', 'fields'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'blocks'],
  additionalProperties: false,
};
