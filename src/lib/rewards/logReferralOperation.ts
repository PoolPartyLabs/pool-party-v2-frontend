/**
 * @id PP-REW-LIB-009 (POO-853)
 * @name logReferralOperation
 * @implements-rules-version v1
 *
 * Server-only referred-tx operation log (POO-853 [R6]) — the v2 port of v1's `POST /referral/operation`
 * fired after a referred wallet's add-liquidity / collect / remove tx. This is the audit + rewards layer,
 * NOT the count itself (the count is the `referees` row from apply-code). It NEVER blocks or fails the tx
 * UX: the caller invokes it fire-and-forget after the receipt confirms, and every failure here is
 * swallowed. The backend dedups on `txHash`.
 *
 * Identity: the referee wallet comes from the SIWE session (never client-supplied). One raw referral read
 * yields the wallet's `referredBy.code` — only a wallet that WAS referred logs an operation; a non-referred
 * wallet no-ops without a POST. Keeping `apiFetch` + the session read server-side means the `x-api-key`
 * never reaches the browser.
 *
 * PP-INTEGRATION-POINT (POO-853): log ← pool-party-api `POST /api/v1/referral/operation` body
 * `{ referralCode, refereeWallet, operation, amountUSD, txHash, positionInfo? }` (enum
 * ADD_LIQUIDITY | COLLECT_FEES | REMOVE_LIQUIDITY, txHash-deduped server-side). Mock mode no-ops.
 */
import "server-only";

import { apiFetch } from "@/lib/api/client";
import { getSessionWallet } from "@/lib/auth/session";
import { isMockMode } from "@/lib/services";
import type { ReferralOperation } from "./referralApiSchema";
import { apiReferralSchema } from "./referralApiSchema";

/** Opaque position context echoed to the operation log (audit only); shape mirrors what the host knows. */
export interface ReferralOperationPositionInfo {
  strategyId?: string;
  positionId?: string;
  network?: string;
}

/** Input for a referred-tx operation log. `amountUsd` is the operation size in USD (maps to `amountUSD`). */
export interface LogReferralOperationInput {
  operation: ReferralOperation;
  amountUsd: number;
  txHash: string;
  positionInfo?: ReferralOperationPositionInfo;
}

/**
 * Log a referred wallet's confirmed operation. No-ops in mock mode, with no session, or when the wallet
 * was never referred. Never throws — safe to invoke fire-and-forget right after the receipt confirms.
 */
export async function logReferralOperation(input: LogReferralOperationInput): Promise<void> {
  // [R6][R7] Mock mode: no-op (no referral rewards backend in the design harness).
  if (isMockMode) return;

  // [R6] The referee wallet comes from the SIWE session, never client-supplied. No session → nothing to log.
  const wallet = await getSessionWallet();
  if (!wallet) return;

  try {
    // Only a wallet that WAS referred has an operation to attribute. One raw read yields `referredBy.code`.
    // PP-INTEGRATION-POINT (POO-853): guard read ← pool-party-api `GET /api/v1/referral/:wallet`.
    const record = await apiFetch(`referral/${wallet}`, { schema: apiReferralSchema.nullable() });
    const referralCode = record?.referredBy?.code;
    if (!referralCode) return;

    // PP-INTEGRATION-POINT (POO-853): the referred-tx operation log (audit/rewards, txHash-deduped).
    await apiFetch("referral/operation", {
      method: "POST",
      body: {
        referralCode,
        refereeWallet: wallet,
        operation: input.operation,
        amountUSD: input.amountUsd,
        txHash: input.txHash,
        ...(input.positionInfo ? { positionInfo: input.positionInfo } : {}),
      },
    });
  } catch {
    // Never blocks or fails the tx UX: a guard-read or log-POST failure is swallowed (the backend also
    // dedups on txHash, so a lost race is safe). PP-NOTE: server-side observability is a follow-up.
  }
}
