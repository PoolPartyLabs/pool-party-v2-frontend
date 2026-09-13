/** Generated from the companion Solidity artifact. Regenerate with cash-plus:export. */
export const cashPlusDeploymentFactoryAbi = [
  {
    type: "function",
    name: "deploy",
    inputs: [
      {
        name: "initCode",
        type: "bytes",
        internalType: "bytes",
      },
      {
        name: "usdc",
        type: "address",
        internalType: "address",
      },
      {
        name: "seed",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "salt",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
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
    name: "predict",
    inputs: [
      {
        name: "sponsor",
        type: "address",
        internalType: "address",
      },
      {
        name: "salt",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "initCodeHash",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
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
    type: "event",
    name: "VaultDeployed",
    inputs: [
      {
        name: "vault",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "sponsor",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "initCodeHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "seed",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "BindingMismatch",
    inputs: [],
  },
  {
    type: "error",
    name: "DeploymentFailed",
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
    name: "SeedMismatch",
    inputs: [],
  },
] as const;
