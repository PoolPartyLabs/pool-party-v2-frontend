/** Generated from the companion Solidity artifact. Regenerate with cash-plus:export. */
export const cashPlusPricingAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "vault",
        type: "address",
        internalType: "address",
      },
      {
        name: "router",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "ROUTER",
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
    name: "extruction",
    inputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
      {
        name: "nextPC",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "query",
        type: "tuple",
        internalType: "struct SwapQuery",
        components: [
          {
            name: "orderHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "maker",
            type: "address",
            internalType: "address",
          },
          {
            name: "taker",
            type: "address",
            internalType: "address",
          },
          {
            name: "tokenIn",
            type: "address",
            internalType: "address",
          },
          {
            name: "tokenOut",
            type: "address",
            internalType: "address",
          },
          {
            name: "isExactIn",
            type: "bool",
            internalType: "bool",
          },
        ],
      },
      {
        name: "swap",
        type: "tuple",
        internalType: "struct SwapRegisters",
        components: [
          {
            name: "balanceIn",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "balanceOut",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "amountIn",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "amountOut",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "amountNetPulled",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
      {
        name: "args",
        type: "bytes",
        internalType: "bytes",
      },
      {
        name: "",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "updatedSwap",
        type: "tuple",
        internalType: "struct SwapRegisters",
        components: [
          {
            name: "balanceIn",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "balanceOut",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "amountIn",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "amountOut",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "amountNetPulled",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "error",
    name: "ExactOutputUnsupported",
    inputs: [],
  },
  {
    type: "error",
    name: "InsufficientVirtualLiquidity",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidContext",
    inputs: [],
  },
] as const;
