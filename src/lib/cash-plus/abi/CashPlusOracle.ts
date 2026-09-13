/** Generated from the companion Solidity artifact. Regenerate with cash-plus:export. */
export const cashPlusOracleAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "c",
        type: "tuple",
        internalType: "struct CashPlusTypes.Config",
        components: [
          {
            name: "usdc",
            type: "address",
            internalType: "address",
          },
          {
            name: "secondary",
            type: "address",
            internalType: "address",
          },
          {
            name: "aqua",
            type: "address",
            internalType: "address",
          },
          {
            name: "router",
            type: "address",
            internalType: "address",
          },
          {
            name: "pool",
            type: "address",
            internalType: "address",
          },
          {
            name: "usdcAToken",
            type: "address",
            internalType: "address",
          },
          {
            name: "secondaryAToken",
            type: "address",
            internalType: "address",
          },
          {
            name: "usdcFeed",
            type: "address",
            internalType: "address",
          },
          {
            name: "secondaryFeed",
            type: "address",
            internalType: "address",
          },
          {
            name: "sequencerFeed",
            type: "address",
            internalType: "address",
          },
          {
            name: "usdcMaxAge",
            type: "uint32",
            internalType: "uint32",
          },
          {
            name: "secondaryMaxAge",
            type: "uint32",
            internalType: "uint32",
          },
          {
            name: "maxFeedSkew",
            type: "uint32",
            internalType: "uint32",
          },
          {
            name: "sequencerGrace",
            type: "uint32",
            internalType: "uint32",
          },
          {
            name: "pegDeviationBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "governance",
            type: "address",
            internalType: "address",
          },
          {
            name: "keeper",
            type: "address",
            internalType: "address",
          },
          {
            name: "guardian",
            type: "address",
            internalType: "address",
          },
          {
            name: "hardDepositCap",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "MAX_FEED_SKEW",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "PEG_DEVIATION_BPS",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "SECONDARY_DECIMALS",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "uint8",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "SECONDARY_FEED",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IPriceFeed",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "SECONDARY_FEED_SCALE",
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
    name: "SECONDARY_MAX_AGE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "SECONDARY_SCALE",
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
    name: "SEQUENCER_FEED",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IPriceFeed",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "SEQUENCER_GRACE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "USDC_FEED",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IPriceFeed",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "USDC_FEED_SCALE",
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
    name: "USDC_MAX_AGE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "priceTrade",
    inputs: [
      {
        name: "p",
        type: "tuple",
        internalType: "struct CashPlusTypes.Policy",
        components: [
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
            name: "maxFillBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "dailyBudgetBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "secondaryTargetBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "secondaryCapBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "baseSpreadBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "maxSurchargeBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "hotUsdcBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "hotSecondaryBps",
            type: "uint16",
            internalType: "uint16",
          },
        ],
      },
      {
        name: "usdcIn",
        type: "bool",
        internalType: "bool",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "x",
        type: "uint256[4]",
        internalType: "uint256[4]",
      },
    ],
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
    name: "prices",
    inputs: [],
    outputs: [
      {
        name: "p0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "p1",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "validateTrade",
    inputs: [
      {
        name: "p",
        type: "tuple",
        internalType: "struct CashPlusTypes.Policy",
        components: [
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
            name: "maxFillBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "dailyBudgetBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "secondaryTargetBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "secondaryCapBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "baseSpreadBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "maxSurchargeBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "hotUsdcBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "hotSecondaryBps",
            type: "uint16",
            internalType: "uint16",
          },
        ],
      },
      {
        name: "usdcIn",
        type: "bool",
        internalType: "bool",
      },
      {
        name: "x",
        type: "uint256[8]",
        internalType: "uint256[8]",
      },
    ],
    outputs: [
      {
        name: "inputValue",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "outputValue",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "valueSecondary",
    inputs: [
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "p0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "p1",
        type: "uint256",
        internalType: "uint256",
      },
    ],
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
    type: "error",
    name: "DailyBudget",
    inputs: [],
  },
  {
    type: "error",
    name: "FeedSkew",
    inputs: [],
  },
  {
    type: "error",
    name: "FillLimit",
    inputs: [],
  },
  {
    type: "error",
    name: "InsufficientCash",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAmount",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidConfiguration",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidOracle",
    inputs: [
      {
        name: "feed",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "InventoryLimit",
    inputs: [],
  },
  {
    type: "error",
    name: "PegDeviation",
    inputs: [
      {
        name: "feed",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "SequencerUnavailable",
    inputs: [],
  },
  {
    type: "error",
    name: "StaleOracle",
    inputs: [
      {
        name: "feed",
        type: "address",
        internalType: "address",
      },
    ],
  },
] as const;
