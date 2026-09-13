/** Generated from the companion Solidity artifact. Regenerate with cash-plus:export. */
export const cashPlusVaultAbi = [
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
      {
        name: "initialPolicy",
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
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "AQUA",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IAqua",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "GOVERNANCE",
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
    name: "GUARDIAN",
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
    name: "HARD_DEPOSIT_CAP",
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
    name: "INITIALIZER",
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
    name: "KEEPER",
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
    name: "LENS",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract CashPlusLens",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MAX_ACTIVE_ORDERS",
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
    name: "MAX_ORDER_LIFETIME",
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
    name: "MIN_SEED",
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
    name: "ORACLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract CashPlusOracle",
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
        internalType: "contract CashPlusPricing",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "PROGRAM_FACTORY",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract CashPlusProgramFactory",
      },
    ],
    stateMutability: "view",
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
    name: "SECONDARY_ADAPTER",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract CashPlusAaveAdapter",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "SECONDARY_STABLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IERC20",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "SEED_HOLDER",
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
    name: "USDC",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IERC20",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "USDC_ADAPTER",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract CashPlusAaveAdapter",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "accountCashflows",
    inputs: [
      {
        name: "owner",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "deposited",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "withdrawnValue",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "incomplete",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "activeStrategies",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32[]",
        internalType: "bytes32[]",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowedTaker",
    inputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "budgetDay",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "componentTokens",
    inputs: [],
    outputs: [
      {
        name: "tokens",
        type: "address[]",
        internalType: "address[]",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "dailyBaselineUsdc",
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
    name: "dailyVolumeUsdc",
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
    name: "deposit",
    inputs: [
      {
        name: "assets",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minShares",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "deadline",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "version",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    outputs: [
      {
        name: "shares",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "depositsPaused",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "dock",
    inputs: [
      {
        name: "hash",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "emergencyMode",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "initialize",
    inputs: [
      {
        name: "sponsor",
        type: "address",
        internalType: "address",
      },
      {
        name: "seed",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "initialized",
    inputs: [],
    outputs: [
      {
        name: "",
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
        name: "",
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
    name: "lowerDepositCap",
    inputs: [
      {
        name: "cap",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "lowerDepositCapWithReason",
    inputs: [
      {
        name: "cap",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "reason",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "park",
    inputs: [
      {
        name: "token",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "policy",
    inputs: [],
    outputs: [
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
    stateMutability: "view",
  },
  {
    type: "function",
    name: "policyVersion",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "postTransferIn",
    inputs: [
      {
        name: "maker",
        type: "address",
        internalType: "address",
      },
      {
        name: "",
        type: "address",
        internalType: "address",
      },
      {
        name: "tokenIn",
        type: "address",
        internalType: "address",
      },
      {
        name: "",
        type: "address",
        internalType: "address",
      },
      {
        name: "amountIn",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "makerData",
        type: "bytes",
        internalType: "bytes",
      },
      {
        name: "takerData",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "postTransferOut",
    inputs: [
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
        name: "hash",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "makerData",
        type: "bytes",
        internalType: "bytes",
      },
      {
        name: "takerData",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "preTransferIn",
    inputs: [
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
        name: "hash",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "makerData",
        type: "bytes",
        internalType: "bytes",
      },
      {
        name: "takerData",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "preTransferOut",
    inputs: [
      {
        name: "maker",
        type: "address",
        internalType: "address",
      },
      {
        name: "",
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
        name: "hash",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "makerData",
        type: "bytes",
        internalType: "bytes",
      },
      {
        name: "takerData",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "previewDeposit",
    inputs: [
      {
        name: "assets",
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
    type: "function",
    name: "previewProportional",
    inputs: [
      {
        name: "shares",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "amounts",
        type: "uint256[]",
        internalType: "uint256[]",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "previewRedeem",
    inputs: [
      {
        name: "shares",
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
    type: "function",
    name: "quoteTrade",
    inputs: [
      {
        name: "hash",
        type: "bytes32",
        internalType: "bytes32",
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
        name: "amountIn",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "version",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    outputs: [
      {
        name: "amountOut",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "rebalanceRequired",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "redeem",
    inputs: [
      {
        name: "shares",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minUsdcOut",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "deadline",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "version",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    outputs: [
      {
        name: "assets",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "redeemAll",
    inputs: [
      {
        name: "minUsdcOut",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "deadline",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "version",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    outputs: [
      {
        name: "assets",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "redeemProportional",
    inputs: [
      {
        name: "shares",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minAmounts",
        type: "uint256[]",
        internalType: "uint256[]",
      },
      {
        name: "deadline",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    outputs: [
      {
        name: "amounts",
        type: "uint256[]",
        internalType: "uint256[]",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setAllowedTaker",
    inputs: [
      {
        name: "taker",
        type: "address",
        internalType: "address",
      },
      {
        name: "allowed",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setEmergencyMode",
    inputs: [
      {
        name: "enabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setPause",
    inputs: [
      {
        name: "deposits",
        type: "bool",
        internalType: "bool",
      },
      {
        name: "trading",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setPolicy",
    inputs: [
      {
        name: "next",
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
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "settlementState",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "enum CashPlusVault.SettlementState",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "shareDecimals",
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
    name: "sharesOf",
    inputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
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
    name: "shipCanonical",
    inputs: [
      {
        name: "params",
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
        name: "hash",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "status",
    inputs: [],
    outputs: [
      {
        name: "",
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
  {
    type: "function",
    name: "strategies",
    inputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "version",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "deadline",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "indexPlusOne",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalAssets",
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
    name: "totalShares",
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
    name: "tradingPaused",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "unpark",
    inputs: [
      {
        name: "token",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "CapacityUpdated",
    inputs: [
      {
        name: "oldCap",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "newCap",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "reasonHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ConversionSettled",
    inputs: [
      {
        name: "orderHash",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "taker",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "tokenIn",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "tokenOut",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "amountIn",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amountOut",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "inputValueUsdc",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "outputValueUsdc",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "policyVersion",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Deposited",
    inputs: [
      {
        name: "owner",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "assets",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "shares",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "policyVersion",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "JitUnparked",
    inputs: [
      {
        name: "orderHash",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "token",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Parked",
    inputs: [
      {
        name: "token",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PauseUpdated",
    inputs: [
      {
        name: "deposits",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
      {
        name: "trading",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
      {
        name: "emergency",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PolicyUpdated",
    inputs: [
      {
        name: "version",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
      {
        name: "policyHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ProportionalExit",
    inputs: [
      {
        name: "owner",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "shares",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "tokens",
        type: "address[]",
        indexed: false,
        internalType: "address[]",
      },
      {
        name: "amounts",
        type: "uint256[]",
        indexed: false,
        internalType: "uint256[]",
      },
      {
        name: "valueUsdc",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "valuationAvailable",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Redeemed",
    inputs: [
      {
        name: "owner",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "shares",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "usdcOut",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Seeded",
    inputs: [
      {
        name: "sponsor",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "assets",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "shares",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "StateCheckpoint",
    inputs: [
      {
        name: "totalAssetsUsdc",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "totalShares",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "usdcLendingIndex",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "secondaryLendingIndex",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "valuationAvailable",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "StrategyDocked",
    inputs: [
      {
        name: "orderHash",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "StrategyShipped",
    inputs: [
      {
        name: "orderHash",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "policyVersion",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
      {
        name: "deadline",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "TakerUpdated",
    inputs: [
      {
        name: "taker",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "allowed",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Unparked",
    inputs: [
      {
        name: "token",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "CapacityExceeded",
    inputs: [],
  },
  {
    type: "error",
    name: "DailyBudget",
    inputs: [],
  },
  {
    type: "error",
    name: "DeadlineExpired",
    inputs: [],
  },
  {
    type: "error",
    name: "FillLimit",
    inputs: [],
  },
  {
    type: "error",
    name: "HookSequence",
    inputs: [],
  },
  {
    type: "error",
    name: "InactiveOrder",
    inputs: [],
  },
  {
    type: "error",
    name: "InsufficientCash",
    inputs: [],
  },
  {
    type: "error",
    name: "InsufficientShares",
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
    name: "InvalidHookData",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidPolicy",
    inputs: [],
  },
  {
    type: "error",
    name: "InventoryLimit",
    inputs: [],
  },
  {
    type: "error",
    name: "NotInitialized",
    inputs: [],
  },
  {
    type: "error",
    name: "Paused",
    inputs: [],
  },
  {
    type: "error",
    name: "PolicyChanged",
    inputs: [],
  },
  {
    type: "error",
    name: "PrefundedAddress",
    inputs: [],
  },
  {
    type: "error",
    name: "ReentrancyGuardReentrantCall",
    inputs: [],
  },
  {
    type: "error",
    name: "SafeERC20FailedOperation",
    inputs: [
      {
        name: "token",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "SettlementBusy",
    inputs: [],
  },
  {
    type: "error",
    name: "Slippage",
    inputs: [],
  },
  {
    type: "error",
    name: "TooManyOrders",
    inputs: [],
  },
  {
    type: "error",
    name: "TransferMismatch",
    inputs: [],
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: [],
  },
  {
    type: "error",
    name: "UnsupportedPair",
    inputs: [],
  },
] as const;
