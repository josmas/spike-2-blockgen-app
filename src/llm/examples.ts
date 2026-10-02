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

export const EXAMPLES: Array<{request: string; response: Json}> = [
  {request: 'A function that tells whether a number is even.', response: isEven},
  {request: 'A function that tells whether a number is prime.', response: isPrime},
];
