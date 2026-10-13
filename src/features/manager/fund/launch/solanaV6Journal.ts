/**
 * @id PP-MGR-LIB-101 (POO-2262)
 * @name solanaV6Journal
 * @implements-rules-version DEC-188, DEC-190 (founder rulings, unversioned)
 * @analytics-events none: a pure model.
 *
 * The v6 launch journal's steps, stored shape and storage key, without the Solana SDK: Review imports
 * this module, so it stays light for every Manager (the signing checks live in `solanaV6Launch.ts`).
 */
import { z } from "zod";
import type { BuildPlan } from "../build/plan/buildPlan";

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
  /** EVM: the wallet was asked to send; without a hash the outcome is unknown until reconciled. */
  attempted: z.boolean().optional(),
  /** EVM: the Manager's pending nonce on the step's chain right before the wallet prompt. */
  nonce: z.string().optional(),
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
    minFirstDeposit: uint,
    spokeCap: uint,
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
