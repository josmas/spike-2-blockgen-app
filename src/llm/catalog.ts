/**
 * The blocks the LLM may use, with their serialization shapes. This is both
 * the prompt's block catalog and the allow-list used by validation.
 */

export interface CatalogEntry {
  type: string;
  doc: string;
}

const VAR = 'field VAR: {"id": "<variable id>"}';

export const CATALOG: CatalogEntry[] = [
  // Logic
  {
    type: 'controls_if',
    doc: 'statement. inputs IF0 (boolean), DO0 (statements), then IF1/DO1... for else-if, ELSE (statements). When using else-if or else, set extraState {"elseIfCount": N, "hasElse": true|false}.',
  },
  {
    type: 'logic_compare',
    doc: 'value (boolean). field OP: EQ|NEQ|LT|LTE|GT|GTE. inputs A, B.',
  },
  {
    type: 'logic_operation',
    doc: 'value (boolean). field OP: AND|OR. inputs A, B.',
  },
  {type: 'logic_negate', doc: 'value (boolean). input BOOL.'},
  {type: 'logic_boolean', doc: 'value. field BOOL: TRUE|FALSE.'},
  {type: 'logic_null', doc: 'value. no fields.'},
  {type: 'logic_ternary', doc: 'value. inputs IF, THEN, ELSE.'},
  // Loops
  {
    type: 'controls_repeat_ext',
    doc: 'statement. input TIMES (number), DO (statements).',
  },
  {
    type: 'controls_whileUntil',
    doc: 'statement. field MODE: WHILE|UNTIL. inputs BOOL, DO (statements).',
  },
  {
    type: 'controls_for',
    doc: `statement. ${VAR} (the counter). inputs FROM, TO, BY (numbers), DO (statements).`,
  },
  {
    type: 'controls_forEach',
    doc: `statement. ${VAR} (the item). inputs LIST, DO (statements).`,
  },
  {
    type: 'controls_flow_statements',
    doc: 'statement, only inside a loop. field FLOW: BREAK|CONTINUE.',
  },
  // Math
  {type: 'math_number', doc: 'value. field NUM: a JSON number.'},
  {
    type: 'math_arithmetic',
    doc: 'value. field OP: ADD|MINUS|MULTIPLY|DIVIDE|POWER. inputs A, B.',
  },
  {
    type: 'math_single',
    doc: 'value. field OP: ROOT|ABS|NEG|LN|LOG10|EXP|POW10. input NUM.',
  },
  {
    type: 'math_trig',
    doc: 'value. field OP: SIN|COS|TAN|ASIN|ACOS|ATAN. input NUM.',
  },
  {
    type: 'math_constant',
    doc: 'value. field CONSTANT: PI|E|GOLDEN_RATIO|SQRT2|SQRT1_2|INFINITY.',
  },
  {
    type: 'math_number_property',
    doc: 'value (boolean). field PROPERTY: EVEN|ODD|PRIME|WHOLE|POSITIVE|NEGATIVE|DIVISIBLE_BY. input NUMBER_TO_CHECK. For DIVISIBLE_BY also give input DIVISOR.',
  },
  {
    type: 'math_round',
    doc: 'value. field OP: ROUND|ROUNDUP|ROUNDDOWN. input NUM.',
  },
  {
    type: 'math_on_list',
    doc: 'value. field OP: SUM|MIN|MAX|AVERAGE|MEDIAN|MODE|STD_DEV|RANDOM. input LIST.',
  },
  {type: 'math_modulo', doc: 'value. inputs DIVIDEND, DIVISOR.'},
  {type: 'math_constrain', doc: 'value. inputs VALUE, LOW, HIGH.'},
  {type: 'math_random_int', doc: 'value. inputs FROM, TO.'},
  {type: 'math_random_float', doc: 'value. no inputs.'},
  {type: 'math_atan2', doc: 'value. inputs X, Y.'},
  // Text
  {type: 'text', doc: 'value. field TEXT: a string.'},
  {
    type: 'text_join',
    doc: 'value. extraState {"itemCount": N}, inputs ADD0..ADD(N-1).',
  },
  {type: 'text_append', doc: `statement. ${VAR}. input TEXT.`},
  {type: 'text_length', doc: 'value. input VALUE.'},
  {type: 'text_isEmpty', doc: 'value (boolean). input VALUE.'},
  {
    type: 'text_indexOf',
    doc: 'value. field END: FIRST|LAST. inputs VALUE (text to search in), FIND.',
  },
  {
    type: 'text_charAt',
    doc: 'value. field WHERE: FROM_START|FROM_END|FIRST|LAST|RANDOM. input VALUE; for FROM_START/FROM_END also input AT (1-based).',
  },
  {
    type: 'text_changeCase',
    doc: 'value. field CASE: UPPERCASE|LOWERCASE|TITLECASE. input TEXT.',
  },
  {
    type: 'text_trim',
    doc: 'value. field MODE: BOTH|LEFT|RIGHT. input TEXT.',
  },
  {type: 'text_count', doc: 'value. inputs SUB, TEXT.'},
  {type: 'text_replace', doc: 'value. inputs FROM, TO, TEXT.'},
  {type: 'text_reverse', doc: 'value. input TEXT.'},
  {
    type: 'add_text',
    doc: 'statement. Appends a paragraph with the given value to the output pane. input TEXT. Use it to display demo results.',
  },
  // Lists
  {
    type: 'lists_create_with',
    doc: 'value. extraState {"itemCount": N}, inputs ADD0..ADD(N-1).',
  },
  {type: 'lists_repeat', doc: 'value. inputs ITEM, NUM.'},
  {type: 'lists_length', doc: 'value. input VALUE.'},
  {type: 'lists_isEmpty', doc: 'value (boolean). input VALUE.'},
  {
    type: 'lists_indexOf',
    doc: 'value. field END: FIRST|LAST. inputs VALUE (the list), FIND.',
  },
  {
    type: 'lists_getIndex',
    doc: 'value. fields MODE: GET|GET_REMOVE, WHERE: FROM_START|FROM_END|FIRST|LAST|RANDOM. input VALUE (the list); for FROM_START/FROM_END also input AT (1-based).',
  },
  {
    type: 'lists_setIndex',
    doc: 'statement. fields MODE: SET|INSERT, WHERE: FROM_START|FROM_END|FIRST|LAST|RANDOM. inputs LIST, TO; for FROM_START/FROM_END also input AT (1-based).',
  },
  {
    type: 'lists_sort',
    doc: 'value. fields TYPE: NUMERIC|TEXT|IGNORE_CASE, DIRECTION: "1"|"-1". input LIST.',
  },
  {type: 'lists_reverse', doc: 'value. input LIST.'},
  // Variables
  {type: 'variables_get', doc: `value. ${VAR}.`},
  {type: 'variables_set', doc: `statement. ${VAR}. input VALUE.`},
  {type: 'math_change', doc: `statement. ${VAR}. input DELTA.`},
  // Functions
  {
    type: 'procedures_defnoreturn',
    doc: 'top-level statement block. field NAME. extraState {"params": [{"name": "x", "id": "<variable id>"}]}. input STACK (statements).',
  },
  {
    type: 'procedures_defreturn',
    doc: 'top-level block. field NAME. extraState {"params": [{"name": "x", "id": "<variable id>"}]}. input STACK (statements, optional), RETURN (the returned value).',
  },
  {
    type: 'procedures_callnoreturn',
    doc: 'statement. extraState {"name": "<function name>", "params": ["x"]}. inputs ARG0, ARG1... one per param.',
  },
  {
    type: 'procedures_callreturn',
    doc: 'value. extraState {"name": "<function name>", "params": ["x"]}. inputs ARG0, ARG1... one per param.',
  },
  {
    type: 'procedures_ifreturn',
    doc: 'statement, only inside a function definition. Returns early when CONDITION is true. inputs CONDITION and, inside procedures_defreturn only, VALUE (the returned value).',
  },
];

export const ALLOWED_TYPES: ReadonlySet<string> = new Set(
  CATALOG.map((e) => e.type),
);

export const catalogText = (): string =>
  CATALOG.map((e) => `- ${e.type}: ${e.doc}`).join('\n');
