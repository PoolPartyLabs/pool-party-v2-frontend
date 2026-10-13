/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/pp_spoke.json`.
 */
export type PpSpoke = {
  "address": "7PptZ653uyn5eoAFKqs4DXR1ijxH6sf49f2YAGMLTfCx",
  "metadata": {
    "name": "ppSpoke",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Pool Party v2 per-Fund Solana spoke"
  },
  "instructions": [
    {
      "name": "buildReport",
      "docs": [
        "DEC-093, DEC-120, DEC-121, DEC-122, DEC-192: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        180,
        185,
        115,
        28,
        220,
        131,
        99,
        42
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "wormholeProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "collectIncomeAll",
      "docs": [
        "DEC-188, DEC-190, DEC-195: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        78,
        237,
        31,
        90,
        3,
        251,
        95,
        26
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "executeCloseOrder",
      "docs": [
        "DEC-093, DEC-120, DEC-121, DEC-122, DEC-192: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        254,
        191,
        233,
        154,
        140,
        72,
        226,
        152
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "wormholeProgram"
        },
        {
          "name": "postedVaa"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "executeCollectOrder",
      "docs": [
        "DEC-093, DEC-120, DEC-121, DEC-122, DEC-192: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        60,
        53,
        128,
        184,
        61,
        224,
        156,
        74
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "wormholeProgram"
        },
        {
          "name": "postedVaa"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "executeOrder",
      "docs": [
        "DEC-093, DEC-120, DEC-121, DEC-122, DEC-192: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        115,
        61,
        180,
        24,
        168,
        32,
        215,
        20
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "wormholeProgram"
        },
        {
          "name": "postedVaa"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "executeUnwindOrder",
      "docs": [
        "DEC-093, DEC-120, DEC-121, DEC-122, DEC-192: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        59,
        51,
        82,
        28,
        123,
        251,
        181,
        4
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "wormholeProgram"
        },
        {
          "name": "postedVaa"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "initializeAdapter",
      "docs": [
        "DEC-190, DEC-193: materialize only a sealed adapter admission."
      ],
      "discriminator": [
        220,
        38,
        219,
        51,
        46,
        10,
        185,
        59
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              }
            ]
          }
        },
        {
          "name": "venueProgram"
        },
        {
          "name": "venue"
        },
        {
          "name": "positionOrPolicy",
          "writable": true
        },
        {
          "name": "collateralOrLedger",
          "writable": true
        },
        {
          "name": "collateralMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "ataProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "initializeFund",
      "docs": [
        "DEC-188, DEC-190, DEC-195: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        212,
        42,
        24,
        245,
        146,
        141,
        78,
        198
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true
        },
        {
          "name": "vault"
        },
        {
          "name": "usdcMint",
          "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        },
        {
          "name": "tslaxMint",
          "address": "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB"
        },
        {
          "name": "wsolMint",
          "address": "So11111111111111111111111111111111111111112"
        },
        {
          "name": "usdcAta",
          "writable": true
        },
        {
          "name": "tslaxAta",
          "writable": true
        },
        {
          "name": "wsolAta",
          "writable": true
        },
        {
          "name": "usdcLedger",
          "writable": true
        },
        {
          "name": "tslaxLedger",
          "writable": true
        },
        {
          "name": "wsolLedger",
          "writable": true
        },
        {
          "name": "cctpRoute",
          "writable": true
        },
        {
          "name": "cctpLedger",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "token2022Program"
        },
        {
          "name": "ataProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "kaminoCollectIncome",
      "docs": [
        "DEC-068, DEC-193: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        194,
        13,
        231,
        223,
        58,
        12,
        86,
        13
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "kaminoProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "kaminoRedeem",
      "docs": [
        "DEC-068, DEC-193: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        143,
        225,
        240,
        130,
        123,
        5,
        160,
        84
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "fund",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "fund.hub_chain_id",
                "account": "fundState"
              },
              {
                "kind": "account",
                "path": "fund.hub_core",
                "account": "fundState"
              },
              {
                "kind": "account",
                "path": "fund.spoke_index",
                "account": "fundState"
              },
              {
                "kind": "account",
                "path": "fund.policy_hash",
                "account": "fundState"
              }
            ]
          },
          "relations": [
            "position",
            "tokenLedger"
          ]
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              },
              {
                "kind": "const",
                "value": [
                  179,
                  202,
                  137,
                  111,
                  221,
                  158,
                  115,
                  25,
                  162,
                  110,
                  6,
                  205,
                  249,
                  173,
                  95,
                  238,
                  78,
                  35,
                  242,
                  73,
                  187,
                  64,
                  103,
                  200,
                  157,
                  91,
                  96,
                  42,
                  205,
                  34,
                  224,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "venue",
          "accounts": [
            {
              "name": "kaminoProgram",
              "address": "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
            },
            {
              "name": "market",
              "address": "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"
            },
            {
              "name": "reserve",
              "writable": true,
              "address": "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59"
            },
            {
              "name": "marketAuthority"
            },
            {
              "name": "liquidityMint",
              "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
            },
            {
              "name": "collateralMint",
              "writable": true,
              "address": "B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D"
            },
            {
              "name": "liquiditySupply",
              "writable": true,
              "address": "Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6"
            },
            {
              "name": "vaultUsdc",
              "writable": true
            },
            {
              "name": "vaultCollateral",
              "writable": true
            },
            {
              "name": "tokenProgram",
              "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
            },
            {
              "name": "instructionsSysvar",
              "address": "Sysvar1nstructions1111111111111111111111111"
            }
          ]
        },
        {
          "name": "tokenLedger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              },
              {
                "kind": "const",
                "value": [
                  198,
                  250,
                  122,
                  243,
                  190,
                  219,
                  173,
                  58,
                  61,
                  101,
                  243,
                  106,
                  171,
                  201,
                  116,
                  49,
                  177,
                  187,
                  228,
                  194,
                  210,
                  246,
                  224,
                  228,
                  124,
                  166,
                  2,
                  3,
                  69,
                  47,
                  93,
                  97
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "kaminoRefresh",
      "docs": [
        "DEC-068, DEC-193: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        170,
        8,
        236,
        163,
        138,
        43,
        47,
        224
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "fund",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "fund.hub_chain_id",
                "account": "fundState"
              },
              {
                "kind": "account",
                "path": "fund.hub_core",
                "account": "fundState"
              },
              {
                "kind": "account",
                "path": "fund.spoke_index",
                "account": "fundState"
              },
              {
                "kind": "account",
                "path": "fund.policy_hash",
                "account": "fundState"
              }
            ]
          },
          "relations": [
            "position"
          ]
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              },
              {
                "kind": "const",
                "value": [
                  179,
                  202,
                  137,
                  111,
                  221,
                  158,
                  115,
                  25,
                  162,
                  110,
                  6,
                  205,
                  249,
                  173,
                  95,
                  238,
                  78,
                  35,
                  242,
                  73,
                  187,
                  64,
                  103,
                  200,
                  157,
                  91,
                  96,
                  42,
                  205,
                  34,
                  224,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "vaultCollateral"
        },
        {
          "name": "kaminoProgram"
        },
        {
          "name": "market"
        },
        {
          "name": "reserve",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "kaminoSupply",
      "docs": [
        "DEC-068, DEC-193: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        145,
        46,
        142,
        2,
        176,
        57,
        162,
        159
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "fund",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "fund.hub_chain_id",
                "account": "fundState"
              },
              {
                "kind": "account",
                "path": "fund.hub_core",
                "account": "fundState"
              },
              {
                "kind": "account",
                "path": "fund.spoke_index",
                "account": "fundState"
              },
              {
                "kind": "account",
                "path": "fund.policy_hash",
                "account": "fundState"
              }
            ]
          },
          "relations": [
            "position",
            "tokenLedger"
          ]
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              },
              {
                "kind": "const",
                "value": [
                  179,
                  202,
                  137,
                  111,
                  221,
                  158,
                  115,
                  25,
                  162,
                  110,
                  6,
                  205,
                  249,
                  173,
                  95,
                  238,
                  78,
                  35,
                  242,
                  73,
                  187,
                  64,
                  103,
                  200,
                  157,
                  91,
                  96,
                  42,
                  205,
                  34,
                  224,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "venue",
          "accounts": [
            {
              "name": "kaminoProgram",
              "address": "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
            },
            {
              "name": "market",
              "address": "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"
            },
            {
              "name": "reserve",
              "writable": true,
              "address": "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59"
            },
            {
              "name": "marketAuthority"
            },
            {
              "name": "liquidityMint",
              "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
            },
            {
              "name": "collateralMint",
              "writable": true,
              "address": "B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D"
            },
            {
              "name": "liquiditySupply",
              "writable": true,
              "address": "Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6"
            },
            {
              "name": "vaultUsdc",
              "writable": true
            },
            {
              "name": "vaultCollateral",
              "writable": true
            },
            {
              "name": "tokenProgram",
              "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
            },
            {
              "name": "instructionsSysvar",
              "address": "Sysvar1nstructions1111111111111111111111111"
            }
          ]
        },
        {
          "name": "tokenLedger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              },
              {
                "kind": "const",
                "value": [
                  198,
                  250,
                  122,
                  243,
                  190,
                  219,
                  173,
                  58,
                  61,
                  101,
                  243,
                  106,
                  171,
                  201,
                  116,
                  49,
                  177,
                  187,
                  228,
                  194,
                  210,
                  246,
                  224,
                  228,
                  124,
                  166,
                  2,
                  3,
                  69,
                  47,
                  93,
                  97
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "pruneRegistry",
      "docs": [
        "DEC-151/191: remove only proved empty position inventory, never pending claims."
      ],
      "discriminator": [
        107,
        28,
        24,
        254,
        214,
        63,
        17,
        2
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "fund",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "publishReport",
      "docs": [
        "DEC-093, DEC-120, DEC-121, DEC-122, DEC-192: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        5,
        33,
        230,
        243,
        220,
        209,
        218,
        101
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "wormholeProgram",
          "address": "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth"
        },
        {
          "name": "emitter",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  109,
                  105,
                  116,
                  116,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              }
            ]
          }
        },
        {
          "name": "bridge",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  66,
                  114,
                  105,
                  100,
                  103,
                  101
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                14,
                10,
                88,
                154,
                65,
                165,
                95,
                189,
                102,
                197,
                42,
                71,
                95,
                45,
                146,
                166,
                211,
                220,
                155,
                71,
                71,
                17,
                76,
                185,
                175,
                130,
                90,
                152,
                181,
                69,
                211,
                206
              ]
            }
          }
        },
        {
          "name": "sequence",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  83,
                  101,
                  113,
                  117,
                  101,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "emitter"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                14,
                10,
                88,
                154,
                65,
                165,
                95,
                189,
                102,
                197,
                42,
                71,
                95,
                45,
                146,
                166,
                211,
                220,
                155,
                71,
                71,
                17,
                76,
                185,
                175,
                130,
                90,
                152,
                181,
                69,
                211,
                206
              ]
            }
          }
        },
        {
          "name": "feeCollector",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  99,
                  111,
                  108,
                  108,
                  101,
                  99,
                  116,
                  111,
                  114
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                14,
                10,
                88,
                154,
                65,
                165,
                95,
                189,
                102,
                197,
                42,
                71,
                95,
                45,
                146,
                166,
                211,
                220,
                155,
                71,
                71,
                17,
                76,
                185,
                175,
                130,
                90,
                152,
                181,
                69,
                211,
                206
              ]
            }
          }
        },
        {
          "name": "message",
          "writable": true,
          "signer": true
        },
        {
          "name": "clock",
          "address": "SysvarC1ock11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "raydiumClosePosition",
      "docs": [
        "DEC-193, DEC-194: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        26,
        183,
        7,
        8,
        189,
        159,
        57,
        67
      ],
      "accounts": [
        {
          "name": "operation",
          "accounts": [
            {
              "name": "authority",
              "signer": true
            },
            {
              "name": "fund",
              "writable": true,
              "relations": [
                "ledger"
              ]
            },
            {
              "name": "vault",
              "writable": true
            },
            {
              "name": "raydiumProgram"
            },
            {
              "name": "systemProgram",
              "address": "11111111111111111111111111111111"
            },
            {
              "name": "positionRecord",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "const",
                    "value": [
                      112,
                      111,
                      115,
                      105,
                      116,
                      105,
                      111,
                      110
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "fund"
                  },
                  {
                    "kind": "account",
                    "path": "personalPosition"
                  }
                ]
              }
            },
            {
              "name": "ledger",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "const",
                    "value": [
                      114,
                      97,
                      121,
                      100,
                      105,
                      117,
                      109,
                      95,
                      108,
                      101,
                      100,
                      103,
                      101,
                      114
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "fund"
                  },
                  {
                    "kind": "account",
                    "path": "pool"
                  }
                ]
              }
            },
            {
              "name": "tokenLedger0",
              "writable": true
            },
            {
              "name": "tokenLedger1",
              "writable": true
            },
            {
              "name": "nftAccount",
              "writable": true
            },
            {
              "name": "personalPosition",
              "writable": true
            },
            {
              "name": "pool",
              "writable": true,
              "relations": [
                "ledger"
              ]
            },
            {
              "name": "protocolPosition"
            },
            {
              "name": "tokenVault0",
              "writable": true
            },
            {
              "name": "tokenVault1",
              "writable": true
            },
            {
              "name": "tickArrayLower",
              "writable": true
            },
            {
              "name": "tickArrayUpper",
              "writable": true
            },
            {
              "name": "tokenAccount0",
              "writable": true
            },
            {
              "name": "tokenAccount1",
              "writable": true
            },
            {
              "name": "tokenProgram",
              "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
            },
            {
              "name": "tokenProgram2022"
            },
            {
              "name": "memoProgram",
              "address": "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
            },
            {
              "name": "mint0"
            },
            {
              "name": "mint1"
            },
            {
              "name": "bitmap",
              "writable": true
            },
            {
              "name": "rewardVault0",
              "writable": true,
              "optional": true
            },
            {
              "name": "rewardQuarantine0",
              "writable": true,
              "optional": true
            },
            {
              "name": "rewardMint0",
              "optional": true
            },
            {
              "name": "rewardVault1",
              "writable": true,
              "optional": true
            },
            {
              "name": "rewardQuarantine1",
              "writable": true,
              "optional": true
            },
            {
              "name": "rewardMint1",
              "optional": true
            },
            {
              "name": "rewardVault2",
              "writable": true,
              "optional": true
            },
            {
              "name": "rewardQuarantine2",
              "writable": true,
              "optional": true
            },
            {
              "name": "rewardMint2",
              "optional": true
            }
          ]
        },
        {
          "name": "nftMint",
          "writable": true
        },
        {
          "name": "rentPayer",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "raydiumCollectFees",
      "docs": [
        "DEC-193, DEC-194: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        205,
        50,
        6,
        138,
        141,
        127,
        188,
        238
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "fund",
          "writable": true,
          "relations": [
            "ledger"
          ]
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "raydiumProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "positionRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              },
              {
                "kind": "account",
                "path": "personalPosition"
              }
            ]
          }
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  97,
                  121,
                  100,
                  105,
                  117,
                  109,
                  95,
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "tokenLedger0",
          "writable": true
        },
        {
          "name": "tokenLedger1",
          "writable": true
        },
        {
          "name": "nftAccount",
          "writable": true
        },
        {
          "name": "personalPosition",
          "writable": true
        },
        {
          "name": "pool",
          "writable": true,
          "relations": [
            "ledger"
          ]
        },
        {
          "name": "protocolPosition"
        },
        {
          "name": "tokenVault0",
          "writable": true
        },
        {
          "name": "tokenVault1",
          "writable": true
        },
        {
          "name": "tickArrayLower",
          "writable": true
        },
        {
          "name": "tickArrayUpper",
          "writable": true
        },
        {
          "name": "tokenAccount0",
          "writable": true
        },
        {
          "name": "tokenAccount1",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "tokenProgram2022"
        },
        {
          "name": "memoProgram",
          "address": "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
        },
        {
          "name": "mint0"
        },
        {
          "name": "mint1"
        },
        {
          "name": "bitmap",
          "writable": true
        },
        {
          "name": "rewardVault0",
          "writable": true,
          "optional": true
        },
        {
          "name": "rewardQuarantine0",
          "writable": true,
          "optional": true
        },
        {
          "name": "rewardMint0",
          "optional": true
        },
        {
          "name": "rewardVault1",
          "writable": true,
          "optional": true
        },
        {
          "name": "rewardQuarantine1",
          "writable": true,
          "optional": true
        },
        {
          "name": "rewardMint1",
          "optional": true
        },
        {
          "name": "rewardVault2",
          "writable": true,
          "optional": true
        },
        {
          "name": "rewardQuarantine2",
          "writable": true,
          "optional": true
        },
        {
          "name": "rewardMint2",
          "optional": true
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "raydiumDecreasePosition",
      "docs": [
        "DEC-193, DEC-194: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        154,
        49,
        58,
        11,
        34,
        52,
        230,
        209
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "raydiumProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "raydiumIncreasePosition",
      "docs": [
        "DEC-193, DEC-194: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        96,
        154,
        76,
        245,
        93,
        166,
        5,
        188
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "raydiumProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "raydiumOpenPosition",
      "docs": [
        "DEC-193, DEC-194: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        250,
        136,
        87,
        252,
        126,
        159,
        209,
        30
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true,
          "relations": [
            "ledger"
          ]
        },
        {
          "name": "vault"
        },
        {
          "name": "raydiumProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "policy"
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  97,
                  121,
                  100,
                  105,
                  117,
                  109,
                  95,
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "tokenLedger0",
          "writable": true
        },
        {
          "name": "tokenLedger1",
          "writable": true
        },
        {
          "name": "positionRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              },
              {
                "kind": "account",
                "path": "personalPosition"
              }
            ]
          }
        },
        {
          "name": "nftMint",
          "writable": true,
          "signer": true
        },
        {
          "name": "nftAccount",
          "writable": true
        },
        {
          "name": "pool",
          "writable": true,
          "relations": [
            "ledger"
          ]
        },
        {
          "name": "protocolPosition"
        },
        {
          "name": "tickArrayLower",
          "writable": true
        },
        {
          "name": "tickArrayUpper",
          "writable": true
        },
        {
          "name": "personalPosition",
          "writable": true
        },
        {
          "name": "tokenAccount0",
          "writable": true
        },
        {
          "name": "tokenAccount1",
          "writable": true
        },
        {
          "name": "tokenVault0",
          "writable": true
        },
        {
          "name": "tokenVault1",
          "writable": true
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "tokenProgram2022"
        },
        {
          "name": "mint0"
        },
        {
          "name": "mint1"
        },
        {
          "name": "bitmap",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "receiveAndCredit",
      "docs": [
        "DEC-191: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        68,
        71,
        135,
        22,
        209,
        28,
        224,
        134
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "fund.hub_chain_id",
                "account": "fundState"
              },
              {
                "kind": "account",
                "path": "fund.hub_core",
                "account": "fundState"
              },
              {
                "kind": "account",
                "path": "fund.spoke_index",
                "account": "fundState"
              },
              {
                "kind": "account",
                "path": "fund.policy_hash",
                "account": "fundState"
              }
            ]
          },
          "relations": [
            "route",
            "ledger",
            "tokenLedger"
          ]
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              }
            ]
          }
        },
        {
          "name": "route",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  99,
                  116,
                  112,
                  95,
                  114,
                  111,
                  117,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              }
            ]
          }
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  99,
                  116,
                  112,
                  95,
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              }
            ]
          }
        },
        {
          "name": "transit",
          "writable": true
        },
        {
          "name": "usdcAta",
          "writable": true
        },
        {
          "name": "tokenLedger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              },
              {
                "kind": "const",
                "value": [
                  198,
                  250,
                  122,
                  243,
                  190,
                  219,
                  173,
                  58,
                  61,
                  101,
                  243,
                  106,
                  171,
                  201,
                  116,
                  49,
                  177,
                  187,
                  228,
                  194,
                  210,
                  246,
                  224,
                  228,
                  124,
                  166,
                  2,
                  3,
                  69,
                  47,
                  93,
                  97
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "recognizeRefund",
      "docs": [
        "DEC-191: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        130,
        224,
        171,
        133,
        149,
        121,
        49,
        62
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "cctpProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "refreshIncomeResults",
      "docs": [
        "DEC-188, DEC-190, DEC-195: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        157,
        181,
        97,
        124,
        154,
        171,
        121,
        141
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "resumeCommand",
      "docs": [
        "DEC-120/122/151: resume one authenticated command step without dropping pending custody."
      ],
      "discriminator": [
        209,
        148,
        117,
        25,
        51,
        1,
        58,
        243
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true,
          "relations": [
            "command",
            "usdcLedger"
          ]
        },
        {
          "name": "command",
          "writable": true
        },
        {
          "name": "usdcLedger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              },
              {
                "kind": "const",
                "value": [
                  198,
                  250,
                  122,
                  243,
                  190,
                  219,
                  173,
                  58,
                  61,
                  101,
                  243,
                  106,
                  171,
                  201,
                  116,
                  49,
                  177,
                  187,
                  228,
                  194,
                  210,
                  246,
                  224,
                  228,
                  124,
                  166,
                  2,
                  3,
                  69,
                  47,
                  93,
                  97
                ]
              }
            ]
          }
        },
        {
          "name": "spokeProgram",
          "address": "7PptZ653uyn5eoAFKqs4DXR1ijxH6sf49f2YAGMLTfCx"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "retryReceive",
      "docs": [
        "DEC-191: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        33,
        173,
        126,
        131,
        8,
        165,
        249,
        189
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "fund.hub_chain_id",
                "account": "fundState"
              },
              {
                "kind": "account",
                "path": "fund.hub_core",
                "account": "fundState"
              },
              {
                "kind": "account",
                "path": "fund.spoke_index",
                "account": "fundState"
              },
              {
                "kind": "account",
                "path": "fund.policy_hash",
                "account": "fundState"
              }
            ]
          },
          "relations": [
            "route",
            "ledger",
            "tokenLedger"
          ]
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              }
            ]
          }
        },
        {
          "name": "route",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  99,
                  116,
                  112,
                  95,
                  114,
                  111,
                  117,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              }
            ]
          }
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  99,
                  116,
                  112,
                  95,
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              }
            ]
          }
        },
        {
          "name": "transit",
          "writable": true
        },
        {
          "name": "usdcAta",
          "writable": true
        },
        {
          "name": "tokenLedger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              },
              {
                "kind": "const",
                "value": [
                  198,
                  250,
                  122,
                  243,
                  190,
                  219,
                  173,
                  58,
                  61,
                  101,
                  243,
                  106,
                  171,
                  201,
                  116,
                  49,
                  177,
                  187,
                  228,
                  194,
                  210,
                  246,
                  224,
                  228,
                  124,
                  166,
                  2,
                  3,
                  69,
                  47,
                  93,
                  97
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "sendToHub",
      "docs": [
        "DEC-191: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        201,
        122,
        202,
        2,
        75,
        213,
        164,
        105
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "fund.hub_chain_id",
                "account": "fundState"
              },
              {
                "kind": "account",
                "path": "fund.hub_core",
                "account": "fundState"
              },
              {
                "kind": "account",
                "path": "fund.spoke_index",
                "account": "fundState"
              },
              {
                "kind": "account",
                "path": "fund.policy_hash",
                "account": "fundState"
              }
            ]
          },
          "relations": [
            "route",
            "ledger",
            "tokenLedger"
          ]
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              }
            ]
          }
        },
        {
          "name": "route",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  99,
                  116,
                  112,
                  95,
                  114,
                  111,
                  117,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              }
            ]
          }
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  99,
                  116,
                  112,
                  95,
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              }
            ]
          }
        },
        {
          "name": "transit",
          "writable": true
        },
        {
          "name": "usdcAta",
          "writable": true
        },
        {
          "name": "tokenLedger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              },
              {
                "kind": "const",
                "value": [
                  198,
                  250,
                  122,
                  243,
                  190,
                  219,
                  173,
                  58,
                  61,
                  101,
                  243,
                  106,
                  171,
                  201,
                  116,
                  49,
                  177,
                  187,
                  228,
                  194,
                  210,
                  246,
                  224,
                  228,
                  124,
                  166,
                  2,
                  3,
                  69,
                  47,
                  93,
                  97
                ]
              }
            ]
          }
        },
        {
          "name": "eventAccount",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "stageSwapPolicy",
      "discriminator": [
        195,
        229,
        155,
        190,
        25,
        242,
        10,
        131
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund"
        },
        {
          "name": "stage",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "swapExactIn",
      "docs": [
        "DEC-136, DEC-193: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        104,
        104,
        131,
        86,
        161,
        189,
        180,
        216
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund"
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "swapProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "swapToRatio",
      "docs": [
        "DEC-136, DEC-193: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        103,
        17,
        237,
        141,
        44,
        47,
        227,
        206
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "fund",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "fund.hub_chain_id",
                "account": "fundState"
              },
              {
                "kind": "account",
                "path": "fund.hub_core",
                "account": "fundState"
              },
              {
                "kind": "account",
                "path": "fund.spoke_index",
                "account": "fundState"
              },
              {
                "kind": "account",
                "path": "fund.policy_hash",
                "account": "fundState"
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              }
            ]
          }
        },
        {
          "name": "swapProgram",
          "address": "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "sweepExcess",
      "docs": [
        "DEC-188, DEC-190, DEC-195: fail-closed track-owned scaffold; payload is not a stable wire API."
      ],
      "discriminator": [
        255,
        74,
        219,
        182,
        1,
        126,
        233,
        6
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payload",
          "type": "bytes"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "cctpLedger",
      "discriminator": [
        145,
        188,
        250,
        102,
        67,
        129,
        113,
        154
      ]
    },
    {
      "name": "cctpRoute",
      "discriminator": [
        150,
        123,
        78,
        64,
        44,
        213,
        142,
        100
      ]
    },
    {
      "name": "fundState",
      "discriminator": [
        3,
        254,
        145,
        43,
        146,
        96,
        162,
        104
      ]
    },
    {
      "name": "hubCommand",
      "discriminator": [
        156,
        97,
        168,
        201,
        117,
        144,
        227,
        201
      ]
    },
    {
      "name": "kaminoPosition",
      "discriminator": [
        86,
        17,
        7,
        116,
        197,
        32,
        16,
        230
      ]
    },
    {
      "name": "raydiumLedger",
      "discriminator": [
        109,
        74,
        224,
        233,
        20,
        34,
        200,
        241
      ]
    },
    {
      "name": "raydiumPolicy",
      "discriminator": [
        33,
        197,
        204,
        96,
        163,
        75,
        84,
        193
      ]
    },
    {
      "name": "raydiumPosition",
      "discriminator": [
        135,
        72,
        77,
        56,
        67,
        238,
        22,
        1
      ]
    },
    {
      "name": "tokenLedger",
      "discriminator": [
        156,
        247,
        9,
        188,
        54,
        108,
        85,
        77
      ]
    },
    {
      "name": "transit",
      "discriminator": [
        152,
        210,
        161,
        15,
        63,
        138,
        171,
        165
      ]
    }
  ],
  "events": [
    {
      "name": "cctpTransitRecorded",
      "discriminator": [
        185,
        255,
        218,
        128,
        73,
        33,
        136,
        39
      ]
    },
    {
      "name": "coreFundInitialized",
      "discriminator": [
        251,
        57,
        135,
        92,
        5,
        88,
        27,
        252
      ]
    },
    {
      "name": "fundInitialized",
      "discriminator": [
        253,
        64,
        136,
        81,
        179,
        19,
        1,
        155
      ]
    },
    {
      "name": "hubArrivalAcknowledged",
      "discriminator": [
        225,
        84,
        192,
        139,
        226,
        97,
        139,
        179
      ]
    },
    {
      "name": "hubCommandAccepted",
      "discriminator": [
        47,
        120,
        6,
        134,
        116,
        205,
        173,
        134
      ]
    },
    {
      "name": "kaminoRedeemed",
      "discriminator": [
        104,
        75,
        201,
        55,
        70,
        17,
        55,
        137
      ]
    },
    {
      "name": "kaminoSupplied",
      "discriminator": [
        13,
        235,
        187,
        106,
        94,
        31,
        116,
        178
      ]
    },
    {
      "name": "kaminoValued",
      "discriminator": [
        49,
        166,
        148,
        33,
        94,
        228,
        70,
        66
      ]
    },
    {
      "name": "kaminoWithdrawalPending",
      "discriminator": [
        244,
        219,
        155,
        82,
        162,
        248,
        77,
        202
      ]
    },
    {
      "name": "ledgerChanged",
      "discriminator": [
        127,
        142,
        36,
        243,
        240,
        196,
        106,
        254
      ]
    },
    {
      "name": "nativeReportPublished",
      "discriminator": [
        155,
        84,
        46,
        45,
        92,
        162,
        101,
        103
      ]
    },
    {
      "name": "oracleCrossCheckUnavailable",
      "discriminator": [
        202,
        74,
        241,
        34,
        228,
        117,
        15,
        227
      ]
    },
    {
      "name": "oracleDeviation",
      "discriminator": [
        75,
        106,
        95,
        95,
        114,
        68,
        163,
        114
      ]
    },
    {
      "name": "raydiumFeesCollected",
      "discriminator": [
        19,
        229,
        125,
        86,
        197,
        191,
        48,
        204
      ]
    },
    {
      "name": "raydiumPositionClosed",
      "discriminator": [
        12,
        13,
        4,
        10,
        166,
        97,
        47,
        131
      ]
    },
    {
      "name": "raydiumRewardQuarantined",
      "discriminator": [
        154,
        125,
        119,
        132,
        82,
        51,
        223,
        204
      ]
    },
    {
      "name": "reportPublished",
      "discriminator": [
        2,
        113,
        153,
        1,
        101,
        123,
        112,
        132
      ]
    },
    {
      "name": "signedSwapExecuted",
      "discriminator": [
        45,
        124,
        121,
        63,
        167,
        73,
        82,
        15
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidSignature"
    },
    {
      "code": 6001,
      "name": "expired"
    },
    {
      "code": 6002,
      "name": "replay"
    },
    {
      "code": 6003,
      "name": "invalidQuote"
    }
  ],
  "types": [
    {
      "name": "asset",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "accountingId",
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "stock",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "cctpLedger",
      "docs": [
        "DEC-191: isolated accounting interface for T1; never infer principal from donations."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "principal",
            "type": "u64"
          },
          {
            "name": "outboundGross",
            "type": "u64"
          },
          {
            "name": "outboundInFlight",
            "type": "u64"
          },
          {
            "name": "receivedPrincipal",
            "type": "u64"
          },
          {
            "name": "feeSurplusPrincipal",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "cctpRoute",
      "docs": [
        "DEC-188, DEC-190, DEC-191: created and sealed only by verified Fund initialization."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "mandateHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "hubConnector",
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "solanaChainId",
            "type": "u64"
          },
          {
            "name": "maxFeeBpsScaled",
            "docs": [
              "TODO(decision): numeric immutable ceiling; no production default (DEC-191)."
            ],
            "type": "u64"
          },
          {
            "name": "sealed",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "cctpTransitRecorded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "transitId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "outbound",
            "type": "bool"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "maxFee",
            "type": "u64"
          },
          {
            "name": "credited",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "coreFundInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "hubCore",
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "managerEvm",
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "managerSolana",
            "type": "pubkey"
          },
          {
            "name": "nativeMandateHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bindingDigest",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "fundInitialized",
      "docs": [
        "DEC-190: emitted only after both Manager authorizations are verified by T1."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "mandateHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "managerSolana",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "fundState",
      "docs": [
        "DEC-188, DEC-190: immutable per-Fund identity and sealed native configuration."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "hubCore",
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "spokeIndex",
            "type": "u16"
          },
          {
            "name": "fundId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "mandateHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "managerEvm",
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "managerSolana",
            "type": "pubkey"
          },
          {
            "name": "reportSequence",
            "type": "u64"
          },
          {
            "name": "orderSequence",
            "type": "u64"
          },
          {
            "name": "closed",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "emitterBump",
            "type": "u8"
          },
          {
            "name": "hubChainId",
            "type": "u64"
          },
          {
            "name": "factory",
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "spokeChainId",
            "type": "u64"
          },
          {
            "name": "nativeMandateHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bindingNonce",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bindingDigest",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bindingExpiry",
            "type": "u64"
          },
          {
            "name": "hubEmitter",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "hubEmitterChain",
            "type": "u16"
          },
          {
            "name": "cumulativeReceived",
            "type": "u128"
          },
          {
            "name": "cumulativeSentHome",
            "type": "u128"
          },
          {
            "name": "activePositions",
            "type": "u16"
          },
          {
            "name": "pendingTransits",
            "type": "u16"
          },
          {
            "name": "pendingResults",
            "type": "u16"
          },
          {
            "name": "assets",
            "type": {
              "vec": {
                "defined": {
                  "name": "asset"
                }
              }
            }
          },
          {
            "name": "venues",
            "type": {
              "vec": {
                "defined": {
                  "name": "venue"
                }
              }
            }
          },
          {
            "name": "transport",
            "type": {
              "defined": {
                "name": "transport"
              }
            }
          },
          {
            "name": "positionRegistry",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "transitRegistry",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "policyHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "hubPolicyHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "activeCommand",
            "type": "pubkey"
          },
          {
            "name": "closeRequested",
            "type": "bool"
          },
          {
            "name": "commandRegistry",
            "type": {
              "vec": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "hubArrivalAcknowledged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "transitId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "sequence",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "hubCommand",
      "docs": [
        "DEC-120/122/151: retain execution evidence and reserved custody across retries."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "orderId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "requestId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "attempt",
            "type": "u32"
          },
          {
            "name": "sequence",
            "type": "u64"
          },
          {
            "name": "reserved",
            "type": "u64"
          },
          {
            "name": "amountSent",
            "type": "u64"
          },
          {
            "name": "amountToArrive",
            "type": "u64"
          },
          {
            "name": "transitId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "delivered",
            "type": "u64"
          },
          {
            "name": "excluded",
            "type": "u64"
          },
          {
            "name": "completed",
            "type": "bool"
          },
          {
            "name": "rentPayer",
            "type": "pubkey"
          },
          {
            "name": "payload",
            "type": {
              "array": [
                "u8",
                352
              ]
            }
          },
          {
            "name": "deliveredSteps",
            "type": {
              "vec": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "hubCommandAccepted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "orderId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "kaminoPosition",
      "docs": [
        "DEC-068, DEC-080, DEC-193: only credited principal and recorded cTokens are Share Assets.",
        "T1 creates this PDA and credits it atomically with authenticated USDC arrivals.",
        "TODO(decision): coordinate the final shared ledger interface; no public credit setter exists."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "reserve",
            "type": "pubkey"
          },
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "units",
            "type": "u64"
          },
          {
            "name": "principal",
            "type": "u64"
          },
          {
            "name": "idlePrincipal",
            "type": "u64"
          },
          {
            "name": "idleIncome",
            "type": "u64"
          },
          {
            "name": "cumulativeRealizedIncome",
            "type": "u64"
          },
          {
            "name": "pendingUnits",
            "type": "u64"
          },
          {
            "name": "pendingMinLiquidity",
            "type": "u64"
          },
          {
            "name": "lastValue",
            "type": "u64"
          },
          {
            "name": "lastPrincipal",
            "type": "u64"
          },
          {
            "name": "lastIncome",
            "type": "u64"
          },
          {
            "name": "lastRefreshSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "kaminoRedeemed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "units",
            "type": "u64"
          },
          {
            "name": "principal",
            "type": "u64"
          },
          {
            "name": "income",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "kaminoSupplied",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "liquidity",
            "type": "u64"
          },
          {
            "name": "collateral",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "kaminoValue",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "units",
            "type": "u64"
          },
          {
            "name": "value",
            "type": "u64"
          },
          {
            "name": "principal",
            "type": "u64"
          },
          {
            "name": "income",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "kaminoValued",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "value",
            "type": {
              "defined": {
                "name": "kaminoValue"
              }
            }
          }
        ]
      }
    },
    {
      "name": "kaminoWithdrawalPending",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "units",
            "type": "u64"
          },
          {
            "name": "expectedLiquidity",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "ledgerChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "principal",
            "type": "u64"
          },
          {
            "name": "collectedIncome",
            "type": "u64"
          },
          {
            "name": "cumulativeIncome",
            "type": "u128"
          }
        ]
      }
    },
    {
      "name": "nativeReportPublished",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "reportSequence",
            "type": "u64"
          },
          {
            "name": "wormholeSequence",
            "type": "u64"
          },
          {
            "name": "message",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "consistency",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "oracleCrossCheckUnavailable",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "feed",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "oracleDeviation",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "deviationBps",
            "type": "u128"
          },
          {
            "name": "boundBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "raydiumFeesCollected",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "fees0",
            "type": "u64"
          },
          {
            "name": "fees1",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "raydiumLedger",
      "docs": [
        "DEC-079, DEC-193: authenticated allocations, never raw balances, fund entries.",
        "TODO(decision): T1 must credit/debit this ledger atomically across all adapters."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "idlePrincipal0",
            "type": "u64"
          },
          {
            "name": "idlePrincipal1",
            "type": "u64"
          },
          {
            "name": "idleIncome0",
            "type": "u64"
          },
          {
            "name": "idleIncome1",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "raydiumPolicy",
      "docs": [
        "DEC-190, DEC-193, DEC-194: T1 creates this immutable admission at Fund creation.",
        "TODO(decision): coordinator must authenticate its contents against the Hub Mandate."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "mandateHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "minimumTick",
            "type": "i32"
          },
          {
            "name": "maximumTick",
            "type": "i32"
          },
          {
            "name": "enabled",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "raydiumPosition",
      "docs": [
        "DEC-193, DEC-195: fees are separate from principal; rent belongs to the payer."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "personalPosition",
            "type": "pubkey"
          },
          {
            "name": "nftMint",
            "type": "pubkey"
          },
          {
            "name": "rentPayer",
            "type": "pubkey"
          },
          {
            "name": "tickLower",
            "type": "i32"
          },
          {
            "name": "tickUpper",
            "type": "i32"
          },
          {
            "name": "liquidity",
            "type": "u128"
          },
          {
            "name": "collectedFees0",
            "type": "u64"
          },
          {
            "name": "collectedFees1",
            "type": "u64"
          },
          {
            "name": "closed",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "raydiumPositionClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "rentPayer",
            "type": "pubkey"
          },
          {
            "name": "rent",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "raydiumRewardQuarantined",
      "docs": [
        "DEC-206: incidental exit rewards stay outside principal, income and NAV."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "reportPublished",
      "docs": [
        "DEC-192: publishing is not evidence that guardians have finalized the VAA."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "sequence",
            "type": "u64"
          },
          {
            "name": "wormholeSequence",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "signedSwapExecuted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "inputMint",
            "type": "pubkey"
          },
          {
            "name": "outputMint",
            "type": "pubkey"
          },
          {
            "name": "inputUnits",
            "type": "u64"
          },
          {
            "name": "outputUnits",
            "type": "u64"
          },
          {
            "name": "minimumOut",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tokenLedger",
      "docs": [
        "DEC-055, DEC-080: observations never authorize credits; adapters mutate recorded buckets."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "principal",
            "type": "u64"
          },
          {
            "name": "collectedIncome",
            "type": "u64"
          },
          {
            "name": "cumulativeIncome",
            "type": "u128"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "transit",
      "docs": [
        "DEC-191, DEC-195: persistent business-id receipt/claim and original rent payer."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "transitId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "outbound",
            "type": "bool"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "maxFee",
            "type": "u64"
          },
          {
            "name": "inFlight",
            "type": "u64"
          },
          {
            "name": "credited",
            "type": "u64"
          },
          {
            "name": "feeExecuted",
            "type": "u64"
          },
          {
            "name": "feeSurplusPrincipal",
            "type": "u64"
          },
          {
            "name": "nonce",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "messageHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "eventAccount",
            "type": "pubkey"
          },
          {
            "name": "rentPayer",
            "type": "pubkey"
          },
          {
            "name": "received",
            "type": "bool"
          },
          {
            "name": "transferKind",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "transport",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "hubUsdc",
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "tokenMessenger",
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "messageTransmitter",
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "destinationDomain",
            "type": "u32"
          },
          {
            "name": "mintRecipient",
            "type": "pubkey"
          },
          {
            "name": "destinationCaller",
            "type": "pubkey"
          },
          {
            "name": "remoteTokenMessenger",
            "type": "pubkey"
          },
          {
            "name": "remoteVaultAuthority",
            "type": "pubkey"
          },
          {
            "name": "fastFeeCeiling",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "venue",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "program",
            "type": "pubkey"
          },
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "reserve",
            "type": "pubkey"
          },
          {
            "name": "token0",
            "type": "pubkey"
          },
          {
            "name": "token1",
            "type": "pubkey"
          }
        ]
      }
    }
  ]
};
