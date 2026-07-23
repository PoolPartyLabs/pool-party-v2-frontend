/**
 * @id PP-REW (POO-209, POO-270, POO-718)
 * @name Rewards server actions
 * @implements-rules-version v1
 *
 * Server Actions for the rewards surface. The browser invokes these; the actual
 * analytics-indexer calls run server-side inside fetchRubberRush (server-only),
 * so the browser never calls the indexer directly.
 *
 * POO-270: the read derives the wallet from the SIWE session (not client-supplied), so a
 * client cannot read an arbitrary wallet's rewards. The analytics indexer is a separate auth
 * domain, so the pool-party-api Bearer is not forwarded here. The writes still carry a
 * client-signed wallet payload — hardening those is a follow-up.
 */
"use server";

import { getSessionWallet } from "@/lib/auth/session";
import { type ApplyReferralOutcome, applyReferralCode } from "@/lib/rewards/applyReferralCode";
import { type CreateReferralOutcome, createReferralCode } from "@/lib/rewards/createReferralCode";
import { fetchRubberRush } from "@/lib/rewards/fetchRubberRush";
import { loadReferralProgram } from "@/lib/rewards/loadReferralProgram";
import {
  type LogReferralOperationInput,
  logReferralOperation,
} from "@/lib/rewards/logReferralOperation";
import {
  type DuckShootOutcome,
  type GrantDuckShootTryOutcome,
  type SayQuackOutcome,
  submitDailyQuack,
  submitDuckShootPlay,
  submitGrantDuckShootTry,
} from "@/lib/rewards/writes";
import type { ReferralProgram, RubberRush } from "@/lib/schemas";
import { isMockMode, rewardsService } from "@/lib/services";

/**
 * Fetch the Rubber Rush dashboard for the signed-in wallet. Not signed in → zero-state
 * (fetchRubberRush returns it without any network call).
 */
export async function getRubberRushAction(): Promise<RubberRush> {
  return fetchRubberRush((await getSessionWallet()) ?? undefined);
}

/**
 * Fetch the referral / invite-and-earn program for the connected investor (POO-661). Mock mode returns
 * the mock program; real mode reads pp-api `GET /referral/:wallet` with the wallet derived from the
 * SIWE session (not client-supplied). The mock↔real branch + the session read live in
 * `loadReferralProgram` (server-only), so `useReferral` (client) can call this without touching the
 * server-only API client.
 */
export async function getReferralAction(): Promise<ReferralProgram> {
  return loadReferralProgram();
}

/**
 * Create the connected investor's one-time referral code (POO-853 [R1]). Real mode POSTs to pool-party-api
 * with the wallet derived from the SIWE session (never client-supplied) and re-reads the confirmed
 * program; mock mode keeps the session-local mock create. The mock↔real branch + the session read live in
 * `createReferralCode` (server-only), so `useReferral` (client) can call this without touching the
 * server-only API client. Returns `unavailable` on a taken/rejected code so the form stays usable.
 */
export async function createReferralCodeAction(code: string): Promise<CreateReferralOutcome> {
  return createReferralCode(code);
}

/**
 * The user's Quacks balance for the header pill (PP-CORE-CMP-023). Mirrors the Rubber Rush screen:
 * mock mode reads the mock dashboard (so the pill matches the rewards screen in design preview), real
 * mode derives the wallet from the SIWE session and reads the analytics indexer. No wallet → 0.
 */
export async function getQuacksBalanceAction(): Promise<number> {
  if (isMockMode) {
    return (await rewardsService.getRubberRush()).quacks;
  }
  return (await fetchRubberRush((await getSessionWallet()) ?? undefined)).quacks;
}

/**
 * Record the daily Say Quack check-in. The message is signed client-side with the
 * connected wallet; this action only forwards the signed payload server-side.
 */
export async function sayQuackAction(input: {
  wallet: string;
  signature: string;
  date: string;
}): Promise<SayQuackOutcome> {
  return submitDailyQuack(input);
}

/** Play one Duck Shoot try for the connected wallet. */
export async function playDuckShootAction(wallet: string): Promise<DuckShootOutcome> {
  return submitDuckShootPlay(wallet);
}

/**
 * Grant a Duck Shoot try for a confirmed protocol transaction (POO-764). Called after every mined
 * protocol tx. The wallet is derived from the SIWE session (never client-supplied, mirroring the
 * reads) so a client cannot grant tries for an arbitrary wallet; the backend decides eligibility
 * (tx belongs to the wallet, not already used, under the weekly cap). No session → no-op error.
 */
export async function grantDuckShootTryAction(txHash: string): Promise<GrantDuckShootTryOutcome> {
  const wallet = await getSessionWallet();
  if (!wallet) return { status: "error" };
  return submitGrantDuckShootTry({ wallet, txHash });
}

/**
 * Apply the pending `?ref=` referral code to the signed-in wallet (POO-718). The code is read from the
 * `pp_ref` cookie and the referee wallet from the SIWE session, both server-side (never client-supplied);
 * the `ReferralTracker` client component invokes this once a session exists. See `applyReferralCode` for
 * the guard/identity model and the mock-vs-real seam.
 */
export async function applyReferralCodeAction(): Promise<ApplyReferralOutcome> {
  return applyReferralCode();
}

/**
 * Log a referred wallet's confirmed protocol tx to the referral operation feed (POO-853 [R6]). The referee
 * wallet + the referrer code are resolved server-side from the SIWE session (never client-supplied); a
 * non-referred wallet no-ops. Never throws — the caller fires it and forgets right after the receipt
 * confirms, so a failing log never affects the tx UX. Mock mode no-ops. See `logReferralOperation`.
 */
export async function logReferralOperationAction(input: LogReferralOperationInput): Promise<void> {
  return logReferralOperation(input);
}
