/** Generated from the companion Solidity artifact. Regenerate with cash-plus:export. */
export const cashPlusProgramFactoryAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "vault",
        type: "address",
        internalType: "address",
      },
      {
        name: "pricing",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "CANONICAL_TRAITS",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "PRICING",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "PROGRAM_VERSION",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "VAULT",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "build",
    inputs: [
      {
        name: "p",
        type: "tuple",
        internalType: "struct CashPlusTypes.ProgramParameters",
        components: [
          {
            name: "policyVersion",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "deadline",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "salt",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "usdcVirtualBalance",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "secondaryVirtualBalance",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct CashPlusTypes.Order",
        components: [
          {
            name: "maker",
            type: "address",
            internalType: "address",
          },
          {
            name: "traits",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "data",
            type: "bytes",
            internalType: "bytes",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "encode",
    inputs: [
      {
        name: "p",
        type: "tuple",
        internalType: "struct CashPlusTypes.ProgramParameters",
        components: [
          {
            name: "policyVersion",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "deadline",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "salt",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "usdcVirtualBalance",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "secondaryVirtualBalance",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hash",
    inputs: [
      {
        name: "p",
        type: "tuple",
        internalType: "struct CashPlusTypes.ProgramParameters",
        components: [
          {
            name: "policyVersion",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "deadline",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "salt",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "usdcVirtualBalance",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "secondaryVirtualBalance",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "error",
    name: "InvalidDeadline",
    inputs: [],
  },
] as const;
