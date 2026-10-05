/**
 * Worked examples shown to the model. They are real Blockly serializations and
 * are loaded and code-generated in headless mode as part of verifying this
 * project, so the model is never shown shapes that Blockly would reject.
 */

type Json = Record<string, unknown>;

const num = (n: number): Json => ({block: {type: 'math_number', fields: {NUM: n}}});
const str = (s: string): Json => ({block: {type: 'text', fields: {TEXT: s}}});
const get = (id: string): Json => ({
  block: {type: 'variables_get', fields: {VAR: {id}}},
});

const isEven = {
  summary: 'isEven(n) returns true when n is divisible by 2, with a demo call.',
  workspaceJson: {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: 'procedures_defreturn',
          x: 20,
          y: 20,
          extraState: {params: [{name: 'n', id: 'v_n'}]},
          fields: {NAME: 'isEven'},
          inputs: {
            RETURN: {
              block: {
                type: 'logic_compare',
                fields: {OP: 'EQ'},
                inputs: {
                  A: {
                    block: {
                      type: 'math_modulo',
                      inputs: {DIVIDEND: get('v_n'), DIVISOR: num(2)},
                    },
                  },
                  B: num(0),
                },
              },
            },
          },
        },
        {
          type: 'add_text',
          x: 20,
          y: 200,
          inputs: {
            TEXT: {
              block: {
                type: 'text_join',
                extraState: {itemCount: 2},
                inputs: {
                  ADD0: str('isEven(4) = '),
                  ADD1: {
                    block: {
                      type: 'procedures_callreturn',
                      extraState: {name: 'isEven', params: ['n']},
                      inputs: {ARG0: num(4)},
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
    variables: [{name: 'n', id: 'v_n'}],
  },
};

const isPrime = {
  summary:
    'isPrime(n) tries every divisor from 2 to n-1 and returns false on the first hit, with a demo call.',
  workspaceJson: {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: 'procedures_defreturn',
          x: 20,
          y: 20,
          extraState: {params: [{name: 'n', id: 'v_n'}]},
          fields: {NAME: 'isPrime'},
          inputs: {
            STACK: {
              block: {
                type: 'procedures_ifreturn',
                inputs: {
                  CONDITION: {
                    block: {
                      type: 'logic_compare',
                      fields: {OP: 'LT'},
                      inputs: {A: get('v_n'), B: num(2)},
                    },
                  },
                  VALUE: {
                    block: {type: 'logic_boolean', fields: {BOOL: 'FALSE'}},
                  },
                },
                next: {
                  block: {
                    type: 'controls_for',
                    fields: {VAR: {id: 'v_i'}},
                    inputs: {
                      FROM: num(2),
                      TO: {
                        block: {
                          type: 'math_arithmetic',
                          fields: {OP: 'MINUS'},
                          inputs: {A: get('v_n'), B: num(1)},
                        },
                      },
                      BY: num(1),
                      DO: {
                        block: {
                          type: 'procedures_ifreturn',
                                    inputs: {
                            CONDITION: {
                              block: {
                                type: 'logic_compare',
                                fields: {OP: 'EQ'},
                                inputs: {
                                  A: {
                                    block: {
                                      type: 'math_modulo',
                                      inputs: {
                                        DIVIDEND: get('v_n'),
                                        DIVISOR: get('v_i'),
                                      },
                                    },
                                  },
                                  B: num(0),
                                },
                              },
                            },
                            VALUE: {
                              block: {
                                type: 'logic_boolean',
                                fields: {BOOL: 'FALSE'},
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            RETURN: {
              block: {type: 'logic_boolean', fields: {BOOL: 'TRUE'}},
            },
          },
        },
        {
          type: 'add_text',
          x: 20,
          y: 400,
          inputs: {
            TEXT: {
              block: {
                type: 'text_join',
                extraState: {itemCount: 2},
                inputs: {
                  ADD0: str('isPrime(7) = '),
                  ADD1: {
                    block: {
                      type: 'procedures_callreturn',
                      extraState: {name: 'isPrime', params: ['n']},
                      inputs: {ARG0: num(7)},
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
    variables: [
      {name: 'n', id: 'v_n'},
      {name: 'i', id: 'v_i'},
    ],
  },
};

// ---- an example only the flat prompt shows --------------------------------
// It covers what smaller models get wrong in flat mode: the operands of
// `j + 1` inside a list index belong to the `+` block, not to the block the
// index plugs into, and each block is listed once.

const getAt = (list: string, index: Json): Json => ({
  block: {
    type: 'lists_getIndex',
    fields: {MODE: 'GET', WHERE: 'FROM_START'},
    inputs: {VALUE: get(list), AT: index},
  },
});
const plusOne = (id: string): Json => ({
  block: {
    type: 'math_arithmetic',
    fields: {OP: 'ADD'},
    inputs: {A: get(id), B: num(1)},
  },
});
const setAt = (list: string, index: Json, value: Json): Json => ({
  type: 'lists_setIndex',
  fields: {MODE: 'SET', WHERE: 'FROM_START'},
  inputs: {LIST: get(list), AT: index, TO: value},
});

const swapNeighbors = {
  summary:
    'swapNeighbors(list, j) swaps the items at positions j and j+1, with a demo call.',
  workspaceJson: {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: 'procedures_defreturn',
          x: 20,
          y: 20,
          extraState: {
            params: [
              {name: 'list', id: 'v_list'},
              {name: 'j', id: 'v_j'},
            ],
          },
          fields: {NAME: 'swapNeighbors'},
          inputs: {
            STACK: {
              block: {
                type: 'variables_set',
                fields: {VAR: {id: 'v_temp'}},
                inputs: {VALUE: getAt('v_list', get('v_j'))},
                next: {
                  block: {
                    ...setAt('v_list', get('v_j'), getAt('v_list', plusOne('v_j'))),
                    next: {
                      block: setAt('v_list', plusOne('v_j'), get('v_temp')),
                    },
                  },
                },
              },
            },
            RETURN: get('v_list'),
          },
        },
        {
          type: 'add_text',
          x: 20,
          y: 300,
          inputs: {
            TEXT: {
              block: {
                type: 'text_join',
                extraState: {itemCount: 2},
                inputs: {
                  ADD0: str('swapNeighbors([3, 1, 2], 1) = '),
                  ADD1: {
                    block: {
                      type: 'procedures_callreturn',
                      extraState: {name: 'swapNeighbors', params: ['list', 'j']},
                      inputs: {
                        ARG0: {
                          block: {
                            type: 'lists_create_with',
                            extraState: {itemCount: 3},
                            inputs: {ADD0: num(3), ADD1: num(1), ADD2: num(2)},
                          },
                        },
                        ARG1: num(1),
                      },
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
    variables: [
      {name: 'list', id: 'v_list'},
      {name: 'j', id: 'v_j'},
      {name: 'temp', id: 'v_temp'},
    ],
  },
};

export const FLAT_EXTRA_EXAMPLES: Array<{request: string; response: Json}> = [
  {
    request: 'A function that swaps two neighbouring items of a list.',
    response: swapNeighbors,
  },
];

export const EXAMPLES: Array<{request: string; response: Json}> = [
  {request: 'A function that tells whether a number is even.', response: isEven},
  {request: 'A function that tells whether a number is prime.', response: isPrime},
];

// ---- examples for the code reply format -------------------------------------
// Written in the dialect (1-based lists, print/join). They are checked and
// executed in tests, so the model is never shown a program the checker rejects.
// Deliberately not a sorting algorithm: that is what the benchmark asks for.

export const CODE_EXAMPLES: Array<{request: string; code: string; summary: string}> = [
  {
    request: 'A function that tells whether a number is even.',
    summary: 'isEven(n) returns true when n is divisible by 2, with a demo call.',
    code: `function isEven(n) {
  return n % 2 == 0;
}
print(join("isEven(4) = ", isEven(4)));`,
  },
  {
    request: 'A function that tells whether a number is prime.',
    summary: 'isPrime(n) tries every divisor from 2 to n-1 and returns false on the first hit, with a demo call.',
    code: `function isPrime(n) {
  if (n < 2) {
    return false;
  }
  for (var i = 2; i <= n - 1; i++) {
    if (n % i == 0) {
      return false;
    }
  }
  return true;
}
print(join("isPrime(7) = ", isPrime(7)));`,
  },
  {
    request: 'A function that swaps two neighbouring items of a list.',
    summary: 'swapNeighbors(list, j) swaps the items at positions j and j+1, with a demo call.',
    code: `function swapNeighbors(list, j) {
  var temp = list[j];
  list[j] = list[j + 1];
  list[j + 1] = temp;
  return list;
}
print(join("swapNeighbors([3, 1, 2], 1) = ", swapNeighbors([3, 1, 2], 1)));`,
  },
  {
    request: 'A function that tells whether a text starts with a given letter.',
    summary: 'startsWithLetter(text, letter) compares the first character, with a demo call.',
    code: `function startsWithLetter(text, letter) {
  if (text.length == 0) {
    return false;
  }
  return text[1] == letter;
}
print(join("startsWithLetter(banana, b) = ", startsWithLetter("banana", "b")));`,
  },
];
