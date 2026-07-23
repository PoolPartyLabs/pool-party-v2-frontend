/**
 * @id PP-REW-LIB-006 (POO-718)
 * @name applyReferralCode
 * @implements-rules-version v1
 *
 * Server-only apply resolver for the captured `?ref=` referral code (POO-718 [R3]-[R9]). Consumed by the
 * `applyReferralCodeAction` Server Action, which the client `ReferralTracker` invokes once a session
 * exists. Keeping `apiFetch` + the session read server-side means the `x-api-key` never reaches the
 * browser and the referee wallet is derived from the SIWE session, never client-supplied.
 *
 * Identity: the referee wallet comes from the SIWE session (`getSessionWallet`, the httpOnly
 * `pp_access_token`), which is set the same way for BOTH login methods (Privy social/embedded wallet and
 * external wallet both complete the same SIWE handshake). So the apply fires for any authenticated
 * session, not only external-wallet logins. The pending code comes from the `pp_ref` cookie (written by
 * the client capture), read here via `next/headers` — never passed from the client.
 *
 * Guards run server-side because the client `ReferralProgram` snapshot drops `referredBy`/`isReferee`
 * (they live only in the raw pp-api record). One raw `GET /referral/:wallet` yields both the
 * already-referred signal ([R5]) and the wallet's own referrer code for the self-referral check ([R6]),
 * so both terminal-skip cases avoid the apply POST entirely (acceptance: "do NOT call apply"). The
 * backend re-enforces all three (self-referral throw, already-referred idempotent short-circuit,
 * referrer-not-found throw), so a lost race is still safe.
 *
 * PP-INTEGRATION-POINT (POO-718): apply ← pool-party-api `POST /api/v1/referral/apply-code` body
 * `{ wallet, code }` (deployed). In mock mode this is a simulated success with no network call.
 */
import "server-only";

import { revalidateTag } from "next/cache";
import { cookies } from "next/headers";
import { apiFetch } from "@/lib/api/client";
import { getSessionWallet } from "@/lib/auth/session";
import { isMockMode } from "@/lib/services";
import { referralTag } from "./fetchReferral";
import { isValidReferralCode, PENDING_REFERRAL_COOKIE } from "./pendingReferralCode";
import { apiReferralSchema } from "./referralApiSchema";

/** Terminal (or deferred) outcome of an apply attempt. `no-session` keeps the code pending. */
export type ApplyReferralOutcome =
  | "applied"
  | "already-referred"
  | "self-referral"
  | "not-applicable"
  | "no-session";

/** Expire the `pp_ref` cookie server-side (matches the client's optimistic clear). */
async function clearPendingCookie(): Promise<void> {
  (await cookies()).set(PENDING_REFERRAL_COOKIE, "", { maxAge: 0, path: "/" });
}

/**
 * Apply the pending `?ref=` code to the signed-in wallet. Reads the code from the `pp_ref` cookie and the
 * wallet from the SIWE session; see the module doc for the guard/identity model.
 */
export async function applyReferralCode(): Promise<ApplyReferralOutcome> {
  const code = (await cookies()).get(PENDING_REFERRAL_COOKIE)?.value;

  // Nothing pending, or a malformed cookie value: no-op (and drop the junk if present).
  if (!isValidReferralCode(code)) {
    if (code !== undefined) await clearPendingCookie();
    return "not-applicable";
  }

  // [R9] Mock mode: simulated success, no network, still clears the pending code so the design harness
  // exercises the full capture→apply→clear flow. PP-INTEGRATION-POINT: real POST below.
  if (isMockMode) {
    await clearPendingCookie();
    return "applied";
  }

  // [R3] Referee wallet from the SIWE session (never client-supplied). No wallet → keep it pending for
  // the next authenticated load ([R4]); the client only calls when it believes a session exists.
  const wallet = await getSessionWallet();
  if (!wallet) return "no-session";

  // [R5][R6] One raw read yields both guards. A read blip must not crash the apply, so on failure we fall
  // through to the apply POST and let the backend re-enforce (it is idempotent / rejects self-referral).
  // PP-INTEGRATION-POINT (POO-718): guard read ← pool-party-api `GET /api/v1/referral/:wallet` (deployed),
  // same endpoint/schema as fetchReferral.ts; short-circuited in mock mode above.
  try {
    const record = await apiFetch(`referral/${wallet}`, { schema: apiReferralSchema.nullable() });
    if (record) {
      if (record.referredBy != null || record.isReferee === true) {
        await clearPendingCookie();
        return "already-referred";
      }
      if (record.code && record.code.toLowerCase() === code.toLowerCase()) {
        await clearPendingCookie();
        return "self-referral";
      }
    }
  } catch {
    // Guard read failed — proceed to apply; the backend enforces the guards authoritatively.
  }

  // [R3] Attach the referrer. [R7] Any non-2xx is a soft failure: clear the pending code, never retry,
  // never crash. [R8] On success bust the per-wallet referral read so the referred-by state re-reads.
  try {
    await apiFetch("referral/apply-code", { method: "POST", body: { wallet, code } });
    await clearPendingCookie();
    revalidateTag(referralTag(wallet));
    return "applied";
  } catch {
    await clearPendingCookie();
    return "not-applicable";
  }
}
