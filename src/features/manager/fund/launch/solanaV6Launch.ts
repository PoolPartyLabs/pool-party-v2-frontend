/**
 * @id PP-MGR-LIB-101 (POO-2262)
 * @name solanaV6Launch
 * @implements-rules-version DEC-188, DEC-190, DEC-191, DEC-196, DEC-203, DEC-204 (founder rulings, unversioned)
 * @analytics-events none: a pure model. The journey hook emits.
 *
 * The v6 (Hub Arbitrum + Robinhood + Solana) launch as one durable, resumable journal: the step
 * order of pool-party-api `docs/SOLANA_API_CONTRACT.md` §9 (creation 0a-0h, then the Manager's first
 * Solana operations). Every transaction comes from the API; this file decides the order, persists
 * what was signed or sent BEFORE moving on, derives the creation request from the saved Mandate,
 * Build plan and Review, and checks the API's plan against what the Manager is about to sign.
 */
import {
  getAddressEncoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import { decodeFunctionData, erc20Abi, type Hex, keccak256, toHex } from "viem";
import type { BuildCreation, EvmBuild, UnsignedSolanaBuild } from "@/lib/api/v2/solanaSchemas";
import { SOLANA_SPOKE_PROGRAM } from "@/lib/solana/release";
import {
  COMPUTE_BUDGET_PROGRAM as COMPUTE_BUDGET,
  MAX_MICRO_LAMPORTS_PER_CU,
  type SolanaBuiltTransaction,
} from "@/lib/solana/transaction";
import type { BuildPlan, Chain } from "../build/plan/buildPlan";
import { type ReviewDraft, rawUsdc } from "./review";
import { SOLANA_LAUNCH_STEPS, type SolanaLaunchState } from "./solanaV6Journal";

export {
  isSolanaV6Plan,
  loadSolanaLaunch,
  SOLANA_CREATION_STEPS,
  SOLANA_LAUNCH_STEPS,
  SOLANA_OPERATION_STEPS,
  type SolanaLaunchState,
  type SolanaLaunchStepId,
  type SolanaLaunchStepRecord,
  type SolanaLaunchStepStatus,
  saveSolanaLaunch,
  solanaLaunchKey,
} from "./solanaV6Journal";

/** The pinned v6 factory (Arbitrum + Robinhood) the API refuses to build for any other. */
export const SOLANA_V6_FACTORY = "0xe964f36Eb23E95e20049D97122f375FbFe6B40dE";
export const ARBITRUM_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOLANA_WSOL_MINT = "So11111111111111111111111111111111111111112";
export const KAMINO_USDC_RESERVE = "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59";
export const RAYDIUM_SOL_USDC_POOL = "3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv";
/** DEC-204: stock pools are visible in the builder but never sealed by this launch. */
export const RAYDIUM_STOCK_POOLS = new Set([
  "8aDaBQkTrS6HVMjyc6EZebgdiaXhLYGriDWKWWp1NpFF",
  "49iMatQtoyabsYAQc8GafVq6aeBFVDxSRH44oiatyyw6",
]);
/** API #198 floor: the seed must mint one whole share after the 25 bps flow fee. */
export const SOLANA_V6_SEED_FLOOR_RAW = BigInt(1_002_506);
/** API #198 defaults when the Manager types nothing (creation-options `amounts`). */
export const SOLANA_V6_DEFAULT_RAW = BigInt(50_000_000);

function solanaChains(plan: BuildPlan): Chain[] {
  return plan.spokes.filter((spoke) => spoke.network === "solana").flatMap((spoke) => spoke.chains);
}
function chainsWith(plan: BuildPlan, kind: string): Chain[] {
  return solanaChains(plan).filter((chain) =>
    chain.steps.some((step) => step.family === "position" && step.kind === kind),
  );
}

/** The three amounts the Manager types on the launch page (API #198), raw USDC. */
export interface SolanaCreationAmounts {
  seedAmount: string;
  minFirstDeposit: string;
  spokeCap: string;
}
/** Launch-page defaults: the Review's seed and minimum, and a spoke cap the size of the seed. */
export function defaultCreationAmounts(review: ReviewDraft): SolanaCreationAmounts {
  let seed: bigint;
  let minimum: bigint;
  try {
    seed = rawUsdc(review.seed);
  } catch {
    seed = SOLANA_V6_DEFAULT_RAW;
  }
  try {
    minimum = rawUsdc(review.minimum);
  } catch {
    minimum = seed;
  }
  if (minimum > seed) minimum = seed;
  return {
    seedAmount: seed.toString(),
    minFirstDeposit: minimum.toString(),
    spokeCap: (seed > BigInt(0) ? seed : SOLANA_V6_DEFAULT_RAW).toString(),
  };
}
/** API #198 rules, checked before the API is asked (it answers the same codes with a 422). */
export function creationAmountsError(
  amounts: SolanaCreationAmounts,
  maxima?: { seedAmount?: { max?: string }; spokeCap?: { max?: string } },
): string | null {
  const values = [amounts.seedAmount, amounts.minFirstDeposit, amounts.spokeCap];
  if (values.some((value) => !/^\d{1,30}$/.test(value))) return "CREATION_AMOUNT_INVALID";
  const seed = BigInt(amounts.seedAmount);
  if (seed < SOLANA_V6_SEED_FLOOR_RAW) return "CREATION_SEED_BELOW_ONE_SHARE";
  if (BigInt(amounts.minFirstDeposit) > seed) return "CREATION_SEED_BELOW_MIN_FIRST_DEPOSIT";
  if (BigInt(amounts.spokeCap) < BigInt(1)) return "CREATION_SPOKE_CAP_ZERO";
  const above = (value: string, max?: string) =>
    !!max && /^\d{1,78}$/.test(max) && BigInt(value) > BigInt(max);
  if (
    above(amounts.seedAmount, maxima?.seedAmount?.max) ||
    above(amounts.spokeCap, maxima?.spokeCap?.max)
  )
    return "CREATION_AMOUNT_ABOVE_MAX";
  return null;
}

/**
 * §3.13 request from the saved Mandate/Build/Review and the launch-page amounts. Venues follow the
 * Solana blocks of the plan; a stock pool is refused (DEC-204), a plan with neither block takes the
 * API's reviewed default pair.
 */
export function solanaCreationRequest(
  plan: BuildPlan,
  review: ReviewDraft,
  amounts: SolanaCreationAmounts,
) {
  const venues: SolanaLaunchState["request"]["venues"] = [];
  if (chainsWith(plan, "solanaKaminoSupply").length)
    venues.push({ kind: "kamino", reserve: KAMINO_USDC_RESERVE });
  const raydium = chainsWith(plan, "solanaRaydiumPool")
    .flatMap((chain) => chain.steps)
    .find((step) => step.family === "position" && step.kind === "solanaRaydiumPool");
  if (raydium) {
    const pool =
      (raydium.config as { poolAddress?: string } | null)?.poolAddress ?? RAYDIUM_SOL_USDC_POOL;
    if (RAYDIUM_STOCK_POOLS.has(pool)) throw new Error("SOLANA_STOCK_UNAVAILABLE");
    if (pool !== RAYDIUM_SOL_USDC_POOL) throw new Error("SOLANA_POOL_NOT_ADMITTED");
    venues.push({ kind: "raydium", pool });
  }
  const invalid = creationAmountsError(amounts);
  if (invalid) throw new Error(invalid);
  return {
    managementFeeBps: review.managementFeeBps,
    performanceFeeBps: review.performanceFeeBps,
    payoutFeeBps: review.payoutFeeBps,
    assets: ["usdc", "wsol"] as Array<"usdc" | "wsol">,
    venues: venues.length
      ? venues
      : [
          { kind: "kamino" as const, reserve: KAMINO_USDC_RESERVE },
          { kind: "raydium" as const, pool: RAYDIUM_SOL_USDC_POOL },
        ],
    seedAmount: amounts.seedAmount,
    minFirstDeposit: amounts.minFirstDeposit,
    spokeCap: amounts.spokeCap,
    bindingTtlSeconds: 14_400,
  };
}

const sharePct = (chains: Chain[]) => chains.reduce((total, chain) => total + chain.sharePct, 0);
/**
 * Default amounts of the first Solana operations, from the plan's shares of the seed principal.
 * The send stays under the 50 USDC spoke cap; the Raydium budget is split half USDC (kept) and half
 * swapped to SOL. Every amount is editable on the journey before it is used.
 */
export function solanaLaunchAmounts(plan: BuildPlan, seedRaw: bigint, spokeCapRaw: bigint) {
  const principal = (seedRaw * BigInt(99)) / BigInt(100);
  const solanaPct = plan.spokes
    .filter((spoke) => spoke.network === "solana")
    .reduce((total, spoke) => total + spoke.sharePct, 0);
  const pct = (value: number) => (principal * BigInt(Math.round(value * 100))) / BigInt(10_000);
  const cap = spokeCapRaw;
  let send = pct(solanaPct || 50);
  if (send > cap) send = cap;
  if (send < BigInt(1_000_000)) send = cap < BigInt(1_000_000) ? cap : BigInt(1_000_000);
  const kaminoChains = chainsWith(plan, "solanaKaminoSupply");
  const raydiumChains = chainsWith(plan, "solanaRaydiumPool");
  const credited = (send * BigInt(9_990)) / BigInt(10_000);
  let kamino = kaminoChains.length ? pct(sharePct(kaminoChains)) : credited / BigInt(3);
  let raydium = raydiumChains.length ? pct(sharePct(raydiumChains)) : credited / BigInt(3);
  if (kamino + raydium > credited) {
    const total = kamino + raydium;
    kamino = (credited * kamino) / total;
    raydium = credited - kamino;
  }
  const swap = raydium / BigInt(2);
  return {
    send: send.toString(),
    kamino: kamino.toString(),
    swap: swap.toString(),
    raydiumUsdc: (raydium - swap).toString(),
  };
}

export function initialSolanaLaunch(input: {
  draftId: string;
  manager: string;
  solanaKey: string;
  plan: BuildPlan;
  review: ReviewDraft;
  amounts: SolanaCreationAmounts;
  now?: number;
}): SolanaLaunchState {
  const request = solanaCreationRequest(input.plan, input.review, input.amounts);
  return {
    version: 1,
    draftId: input.draftId,
    manager: input.manager.toLowerCase(),
    solanaKey: input.solanaKey,
    createdAt: input.now ?? Date.now(),
    request,
    signatures: {},
    amounts: solanaLaunchAmounts(input.plan, BigInt(request.seedAmount), BigInt(request.spokeCap)),
    steps: Object.fromEntries(SOLANA_LAUNCH_STEPS.map((step) => [step, { status: "idle" }])),
  };
}

function bytes32(base58Key: string): string {
  const bytes = getAddressEncoder().encode(
    base58Key as Parameters<ReturnType<typeof getAddressEncoder>["encode"]>[0],
  );
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
const same = (left: unknown, right: string) =>
  typeof left === "string" && left.toLowerCase() === right.toLowerCase();

/**
 * Before any signature: the API's plan must bind THIS Manager's EVM and Solana keys, the pinned
 * program and factory, and only EVM transactions to the pinned addresses on the expected chains.
 */
export function verifyCreationPlan(
  plan: BuildCreation,
  expected: { manager: string; solanaKey: string; core?: string; seedAmount?: string },
): void {
  const binding = plan.binding.typedData;
  const policy = plan.swapPolicy.typedData;
  const fail = () => {
    throw new Error("SOLANA_PLAN_MISMATCH");
  };
  if (!same(plan.factory, SOLANA_V6_FACTORY)) fail();
  if (expected.core && !same(plan.core, expected.core)) fail();
  if (
    binding.primaryType !== "SolanaBootstrap" ||
    !same(binding.domain.verifyingContract, SOLANA_V6_FACTORY) ||
    !same(binding.message.core, plan.core) ||
    !same(binding.message.solanaKey, bytes32(expected.solanaKey)) ||
    !same(binding.message.program, bytes32(SOLANA_SPOKE_PROGRAM)) ||
    !same(binding.message.fundPda, bytes32(plan.solana.fundPda)) ||
    String(binding.message.nonce) !== plan.binding.nonce ||
    String(binding.message.expiry) !== plan.binding.expiry
  )
    fail();
  // The swap policy consent: this Fund's PDA, this binding, and the policy bytes the API sealed.
  const encoded = plan.swapPolicy.encoded;
  if (
    policy.primaryType !== "SolanaSwapPolicy" ||
    !same(policy.domain.verifyingContract, plan.core) ||
    !same(policy.domain.salt, bytes32(SOLANA_SPOKE_PROGRAM)) ||
    !same(policy.message.fund, bytes32(plan.solana.fundPda)) ||
    !same(policy.message.bindingDigest, plan.binding.digest) ||
    !same(policy.message.policyHash, plan.swapPolicy.hash) ||
    !same(
      keccak256(toHex(new Uint8Array(getBase64Encoder().encode(encoded)))),
      plan.swapPolicy.hash,
    )
  )
    fail();
  const { approve, createFund, createSpoke } = plan.transactions;
  const evm = (tx: EvmBuild | null, chainId: number, to: string) => {
    if (!tx) return;
    if (
      tx.chainId !== chainId ||
      !same(tx.to, to) ||
      !same(tx.from, expected.manager) ||
      tx.value !== "0"
    )
      fail();
  };
  evm(approve, 42161, ARBITRUM_USDC);
  evm(createFund, 42161, SOLANA_V6_FACTORY);
  evm(createSpoke, 4663, SOLANA_V6_FACTORY);
  if (approve) {
    // Only `approve(factory, seed)`: never an unlimited allowance or another spender.
    try {
      const decoded = decodeFunctionData({ abi: erc20Abi, data: approve.data as Hex });
      const [spender, amount] = decoded.args as readonly [string, bigint];
      if (
        decoded.functionName !== "approve" ||
        !same(spender, SOLANA_V6_FACTORY) ||
        (expected.seedAmount !== undefined && amount !== BigInt(expected.seedAmount)) ||
        amount !== BigInt(plan.seed.amount)
      )
        fail();
    } catch {
      fail();
    }
  }
}

/**
 * Decode an API-built Solana transaction and check, before the wallet sees it: v0, fee payer =
 * the Manager's key, signers = the declared ones, and only ComputeBudget + the pinned spoke program
 * invoked (every venue CPI goes through the program).
 */
export function solanaBuildToSign(
  build: UnsignedSolanaBuild,
  manager: string,
): SolanaBuiltTransaction {
  const bytes = new Uint8Array(getBase64Encoder().encode(build.transaction));
  const decoded = getTransactionDecoder().decode(bytes);
  const message = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
  const signers = message.staticAccounts.slice(0, message.header.numSignerAccounts);
  const programs = message.instructions.map(
    (instruction) => message.staticAccounts[instruction.programAddressIndex],
  );
  if (
    message.version !== 0 ||
    message.staticAccounts[0] !== manager ||
    build.requiredSigners[0] !== manager ||
    signers.length !== build.requiredSigners.length ||
    signers.some((signer, index) => signer !== build.requiredSigners[index]) ||
    message.lifetimeToken !== build.blockhash ||
    !programs.includes(SOLANA_SPOKE_PROGRAM) ||
    programs.some((program) => program !== COMPUTE_BUDGET && program !== SOLANA_SPOKE_PROGRAM)
  )
    throw new Error("UNSAFE_SOLANA_TRANSACTION");
  // ComputeBudget: only a unit limit within the declared one and a bounded unit price, so a build
  // cannot burn the Manager's SOL as fees (the API sets no priority fee today).
  for (const instruction of message.instructions) {
    if (message.staticAccounts[instruction.programAddressIndex] !== COMPUTE_BUDGET) continue;
    const data = instruction.data ?? new Uint8Array();
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const limit = data[0] === 2 && data.length === 5 ? view.getUint32(1, true) : null;
    const price = data[0] === 3 && data.length === 9 ? view.getBigUint64(1, true) : null;
    if (
      instruction.accountIndices?.length ||
      (limit === null && price === null) ||
      (limit !== null && limit > Math.max(build.computeUnitLimit, 1_400_000)) ||
      (price !== null && price > MAX_MICRO_LAMPORTS_PER_CU)
    )
      throw new Error("UNSAFE_SOLANA_TRANSACTION");
  }
  return {
    bytes,
    lifetime: {
      blockhash: build.blockhash,
      lastValidBlockHeight: BigInt(build.lastValidBlockHeight),
    },
  };
}

/** A Raydium range of about ±`width` ticks (one tick ≈ 0.01 %) around the price, on the grid. */
export function raydiumRange(tickCurrent: number, tickSpacing: number, width = 500) {
  const lower = Math.floor((tickCurrent - width) / tickSpacing) * tickSpacing;
  const upper = Math.ceil((tickCurrent + width) / tickSpacing) * tickSpacing;
  return { tickLower: lower, tickUpper: upper === lower ? lower + tickSpacing : upper };
}

/** USDC raw (6 decimals) as a plain decimal string for inputs and labels. */
export function formatRawUnits(raw: string, decimals: number): string {
  const value = BigInt(raw);
  const base = BigInt(10) ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** The creation is past the point of no return once the Hub Fund exists. */
export function creationLanded(state: SolanaLaunchState): boolean {
  // A persisted hash or an unresolved wallet prompt may already have created the Fund: starting over
  // then would plan the NEXT creation number and pull the seed a second time.
  const record = state.steps["create-fund"];
  return record?.status === "done" || !!record?.txHash || !!record?.attempted;
}
