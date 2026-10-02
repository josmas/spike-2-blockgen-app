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
