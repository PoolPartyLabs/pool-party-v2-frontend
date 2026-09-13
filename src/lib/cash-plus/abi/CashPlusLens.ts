/** Generated from the companion Solidity artifact. Regenerate with cash-plus:export. */
export const cashPlusLensAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "vault",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "VAULT",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract ICashPlusViews",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "checkpointData",
    inputs: [],
    outputs: [
      {
        name: "assets",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "index0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "index1",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "valued",
        type: "bool",
        internalType: "bool",
      },
      {
        name: "rebalance",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "inventory",
    inputs: [],
    outputs: [
      {
        name: "items",
        type: "tuple[]",
        internalType: "struct CashPlusTypes.InventoryItem[]",
        components: [
          {
            name: "token",
            type: "address",
            internalType: "address",
          },
          {
            name: "adapter",
            type: "address",
            internalType: "address",
          },
          {
            name: "receiptToken",
            type: "address",
            internalType: "address",
          },
          {
            name: "decimals",
            type: "uint8",
            internalType: "uint8",
          },
          {
            name: "walletBalance",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "adapterIdleBalance",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "lendingBalance",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "valueUsdc",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "status",
    inputs: [],
    outputs: [
      {
        name: "s",
        type: "tuple",
        internalType: "struct CashPlusTypes.Status",
        components: [
          {
            name: "initialized",
            type: "bool",
            internalType: "bool",
          },
          {
            name: "depositsPaused",
            type: "bool",
            internalType: "bool",
          },
          {
            name: "tradingPaused",
            type: "bool",
            internalType: "bool",
          },
          {
            name: "emergencyMode",
            type: "bool",
            internalType: "bool",
          },
          {
            name: "rebalanceRequired",
            type: "bool",
            internalType: "bool",
          },
          {
            name: "valuationAvailable",
            type: "bool",
            internalType: "bool",
          },
          {
            name: "settlementState",
            type: "uint8",
            internalType: "uint8",
          },
          {
            name: "policyVersion",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "depositCap",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "minDeposit",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "assetsUsdc",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "shares",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "dailyBaselineUsdc",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "dailyVolumeUsdc",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "dailyRemainingUsdc",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "budgetDay",
            type: "uint64",
            internalType: "uint64",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;
