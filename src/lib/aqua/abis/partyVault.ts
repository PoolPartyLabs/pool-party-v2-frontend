import "server-only";

/**
 * The slice of PartyVault the read-only investor page depends on.
 *
 * Server-only like the rest of the module, even though an ABI holds no secret: the read-only
 * page never needs these in the browser, and keeping the guard uniform means the first client
 * component that genuinely needs an ABI has to say so deliberately rather than inherit access
 * by accident. Lifting it is a one-line change if the deposit flow later wants it.
 *
 * The full artifact is committed alongside this file as `PartyVault.json`, exported from the
 * pool-party-aqua repo by `contracts/script/export-abis.sh`. That JSON is a bare ABI array and
 * gives viem nothing to infer from, so every read would need a cast and would silently return
 * `unknown`. Declaring the handful of views we actually call as a const gives full inference
 * and, more usefully, documents exactly which parts of the vault this page is coupled to.
 *
 * Anything added here must exist in the artifact; `abis.test.ts` checks that both directions
 * stay in sync, so a contract change that drops one of these fails a test rather than a page.
 */
export const PARTY_VAULT_VIEW_ABI = [
  {
    type: "function",
    name: "totalAssets",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalShares",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "liquidUsdc",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "activeStrategies",
    inputs: [],
    outputs: [{ type: "bytes32[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "ADAPTER",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "maxTvl",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "seeded",
    inputs: [],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
] as const;

/** ADP-R3: interest-inclusive aToken balance, so it grows every block. */
export const CARRY_ADAPTER_VIEW_ABI = [
  {
    type: "function",
    name: "parkedBalance",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

/** Aqua's per-strategy accounting. Registration only: these are not wallet balances. */
export const AQUA_RAW_BALANCES_ABI = [
  {
    type: "function",
    name: "rawBalances",
    inputs: [
      { name: "maker", type: "address" },
      { name: "app", type: "address" },
      { name: "strategyHash", type: "bytes32" },
      { name: "token", type: "address" },
    ],
    outputs: [
      { name: "balance", type: "uint248" },
      { name: "tokensCount", type: "uint8" },
    ],
    stateMutability: "view",
  },
] as const;

export const CHAINLINK_FEED_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
    stateMutability: "view",
  },
] as const;
