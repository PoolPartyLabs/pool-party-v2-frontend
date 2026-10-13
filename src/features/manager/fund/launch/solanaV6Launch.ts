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
import { z } from "zod";
import type { BuildCreation, EvmBuild, UnsignedSolanaBuild } from "@/lib/api/v2/solanaSchemas";
import { SOLANA_SPOKE_PROGRAM } from "@/lib/solana/release";
import type { SolanaBuiltTransaction } from "@/lib/solana/transaction";
import type { BuildPlan, Chain } from "../build/plan/buildPlan";
import { type ReviewDraft, rawUsdc } from "./review";

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
/** The fixed v6 Mandate values the API seals for every Manager (creation-options `mandate`). */
export const SOLANA_V6_MINIMUM_RAW = BigInt(50_000_000);
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";

export const SOLANA_CREATION_STEPS = [
  "plan",
  "sign-binding",
  "sign-policy",
  "approve-seed",
  "create-fund",
  "create-spoke",
  "discover",
  "bootstrap",
  "verify",
] as const;
export const SOLANA_OPERATION_STEPS = [
  "solana-report",
  "send-to-solana",
  "arrival",
  "adapters",
  "kamino-supply",
  "swap",
  "raydium-open",
  "final-report",
] as const;
export const SOLANA_LAUNCH_STEPS = [...SOLANA_CREATION_STEPS, ...SOLANA_OPERATION_STEPS] as const;
export type SolanaLaunchStepId = (typeof SOLANA_LAUNCH_STEPS)[number];
export type SolanaLaunchStepStatus =
  | "idle"
  | "running"
  | "submitted"
  | "waiting"
  | "done"
  | "skipped"
  | "failed";

const uint = z.string().regex(/^\d{1,78}$/);
const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const stepRecordSchema = z.object({
  status: z.enum(["idle", "running", "submitted", "waiting", "done", "skipped", "failed"]),
  error: z.string().optional(),
  /** EVM transaction hash or the LAST Solana signature of the step. */
  txHash: z.string().optional(),
  chain: z.union([z.literal(42161), z.literal(4663), z.literal("solana")]).optional(),
  /** Every Solana signature the step persisted before its broadcast, in order. */
  signatures: z.array(z.string()).optional(),
  /** Solana only: the API blockhash's last valid block height; past it an unseen signature is dead. */
  lastValid: z.string().optional(),
  retryAt: z.number().optional(),
  at: z.number().optional(),
});
export type SolanaLaunchStepRecord = z.infer<typeof stepRecordSchema>;

const stateSchema = z.object({
  version: z.literal(1),
  draftId: z.string().min(1),
  manager: address,
  solanaKey: base58,
  createdAt: z.number(),
  request: z.object({
    managementFeeBps: z.number().int(),
    performanceFeeBps: z.number().int(),
    payoutFeeBps: z.number().int(),
    assets: z.array(z.enum(["usdc", "wsol"])),
    venues: z.array(
      z.union([
        z.object({ kind: z.literal("kamino"), reserve: base58 }),
        z.object({ kind: z.literal("raydium"), pool: base58 }),
      ]),
    ),
    seedAmount: uint,
    bindingTtlSeconds: z.number().int(),
  }),
  plan: z
    .object({
      core: address,
      fundId: z.string(),
      creationNumber: uint,
      bindingNonce: uint,
      bindingExpiry: uint,
      expiresAt: z.string(),
      fundPda: base58,
      vault: base58,
      usdcAta: base58,
      robinhoodSpokeVault: address,
    })
    .optional(),
  signatures: z
    .object({
      binding: z.string().optional(),
      swapPolicy: z.string().optional(),
    })
    .default({}),
  bootstrapBody: z.record(z.unknown()).optional(),
  amounts: z.object({
    send: uint,
    kamino: uint,
    swap: uint,
    raydiumUsdc: uint,
  }),
  transit: z.object({ transitId: z.string(), amountToArrive: uint }).optional(),
  steps: z.record(stepRecordSchema),
});
export type SolanaLaunchState = z.infer<typeof stateSchema>;

export function solanaLaunchKey(manager: string, draftId: string): string {
  return `pp:v2:solana-launch:1:${manager.toLowerCase()}:${draftId}`;
}
export function loadSolanaLaunch(
  storage: Pick<Storage, "getItem">,
  manager: string,
  draftId: string,
): SolanaLaunchState | null {
  const raw = storage.getItem(solanaLaunchKey(manager, draftId));
  if (!raw) return null;
  const parsed = stateSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error("SOLANA_LAUNCH_STORAGE_INVALID");
  return parsed.data;
}
export function saveSolanaLaunch(storage: Pick<Storage, "setItem">, state: SolanaLaunchState) {
  storage.setItem(solanaLaunchKey(state.manager, state.draftId), JSON.stringify(state));
}

/** Whether the plan is a v6 Hub + Robinhood + Solana plan the API can create. */
export function isSolanaV6Plan(plan: BuildPlan): boolean {
  return plan.spokes.some((spoke) => spoke.network === "solana");
}

function solanaChains(plan: BuildPlan): Chain[] {
  return plan.spokes.filter((spoke) => spoke.network === "solana").flatMap((spoke) => spoke.chains);
}
function chainsWith(plan: BuildPlan, kind: string): Chain[] {
  return solanaChains(plan).filter((chain) =>
    chain.steps.some((step) => step.family === "position" && step.kind === kind),
  );
}

/**
 * §3.13 request from the saved Mandate/Build/Review. Venues follow the Solana blocks of the plan;
 * a stock pool is refused (DEC-204), a plan with neither block takes the API's reviewed default pair.
 */
export function solanaCreationRequest(plan: BuildPlan, review: ReviewDraft) {
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
  const seed = rawUsdc(review.seed);
  if (seed < SOLANA_V6_MINIMUM_RAW) throw new Error("SOLANA_SEED_BELOW_MINIMUM");
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
    seedAmount: seed.toString(),
    bindingTtlSeconds: 14_400,
  };
}

const sharePct = (chains: Chain[]) => chains.reduce((total, chain) => total + chain.sharePct, 0);
/**
 * Default amounts of the first Solana operations, from the plan's shares of the seed principal.
 * The send stays under the 50 USDC spoke cap; the Raydium budget is split half USDC (kept) and half
 * swapped to SOL. Every amount is editable on the journey before it is used.
 */
export function solanaLaunchAmounts(plan: BuildPlan, seedRaw: bigint) {
  const principal = (seedRaw * BigInt(99)) / BigInt(100);
  const solanaPct = plan.spokes
    .filter((spoke) => spoke.network === "solana")
    .reduce((total, spoke) => total + spoke.sharePct, 0);
  const pct = (value: number) => (principal * BigInt(Math.round(value * 100))) / BigInt(10_000);
  const cap = BigInt(50_000_000);
  let send = pct(solanaPct || 50);
  if (send > cap) send = cap;
  if (send < BigInt(1_000_000)) send = BigInt(1_000_000);
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
  now?: number;
}): SolanaLaunchState {
  const request = solanaCreationRequest(input.plan, input.review);
  return {
    version: 1,
    draftId: input.draftId,
    manager: input.manager.toLowerCase(),
    solanaKey: input.solanaKey,
    createdAt: input.now ?? Date.now(),
    request,
    signatures: {},
    amounts: solanaLaunchAmounts(input.plan, BigInt(request.seedAmount)),
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
  expected: { manager: string; solanaKey: string; core?: string },
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
  if (
    policy.primaryType !== "SolanaSwapPolicy" ||
    !same(policy.domain.verifyingContract, plan.core)
  )
    fail();
  const { approve, createFund, createSpoke } = plan.transactions;
  const evm = (tx: EvmBuild | null, chainId: number, to: string) => {
    if (!tx) return;
    if (tx.chainId !== chainId || !same(tx.to, to) || !same(tx.from, expected.manager)) fail();
  };
  evm(approve, 42161, ARBITRUM_USDC);
  evm(createFund, 42161, SOLANA_V6_FACTORY);
  evm(createSpoke, 4663, SOLANA_V6_FACTORY);
  if (approve && !approve.data.toLowerCase().startsWith("0x095ea7b3")) fail();
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
  return state.steps["create-fund"]?.status === "done";
}
