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
  {
    type: "function",
    name: "sharesOf",
    inputs: [{ name: "investor", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  // IDX-R3: an investor's value comes from the vault's OWN conversion, never a share price we
  // recompute here, so there is no second implementation to drift from the contract.
  {
    type: "function",
    name: "convertToAssets",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "convertToShares",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

/**
 * The two state-changing calls an investor makes.
 *
 * Deposits are USDC only (VLT-R1) and redeems pay out USDC only (VLT-R5). Both are plain
 * contract calls with no Permit2 leg: the vault pulls with an ordinary `transferFrom` against a
 * direct allowance, which is why the deposit flow is approve-then-deposit rather than the
 * permit dance the Uniswap operations use.
 */
export const PARTY_VAULT_WRITE_ABI = [
  {
    type: "function",
    name: "deposit",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ name: "shares", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "redeem",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "assets", type: "uint256" }],
    stateMutability: "nonpayable",
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
