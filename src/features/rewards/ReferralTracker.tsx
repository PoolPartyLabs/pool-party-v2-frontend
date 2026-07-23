/**
 * @id PP-REW-CMP-019 (POO-718)
 * @name ReferralTracker
 * @implements-rules-version v1
 *
 * The v2 twin of v1's `ReferralTracker`. An invisible client component mounted in the auth-scoped layout
 * (so it runs on the signed-out `?ref=` landing, the sign-in flow, and the app). It:
 *  - [R1] reads `?ref=` client-side and validates the code shape (malformed → discarded),
 *  - [R2] first-touch persists it as the `pp_ref` cookie and strips `?ref=` from the visible URL,
 *  - [R4] once a SIWE session exists (any login method), applies the pending code exactly once via the
 *    `applyReferralCodeAction` Server Action (which derives the wallet server-side + runs the guards),
 *  - [R8] on a real attach, clears the pending code, flags a one-time Home welcome (POO-579 Feature B),
 *    and refreshes so the referred-by read re-runs.
 *
 * Unlike v1 it does NOT prompt `login()` on a `?ref=` landing (v2's Google/social vs external-wallet
 * logins are separated): the code is persisted and applied opportunistically on the next authenticated
 * session. The already-referred/self-referral guards live in the Server Action (the client
 * `ReferralProgram` snapshot drops `referredBy`), so the tracker only needs the session signal.
 */
"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useSiweSession } from "@/lib/auth/useSiweSession";
import {
  clearPendingReferralCode,
  isValidReferralCode,
  readPendingReferralCode,
  writePendingReferralCodeFirstTouch,
} from "@/lib/rewards/pendingReferralCode";
import { applyReferralCodeAction } from "./actions";
import { markReferralWelcomePending } from "./referralWelcome";

/**
 * Codes already attempted this session. Module-level so it survives the tracker's remounts within the
 * persistent auth layout and a React strict-mode double-mount — the apply fires at most once per code.
 */
const attemptedCodes = new Set<string>();

/** Test-only: reset the once-per-code guard between tests. */
export function __resetReferralTrackerForTests() {
  attemptedCodes.clear();
}

/** Remove `?ref=` from the visible URL without a navigation, preserving any other params. */
function stripRefFromUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("ref")) return;
  url.searchParams.delete("ref");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Invisible capture + opportunistic-apply orchestrator (see the module doc). Renders nothing. */
export function ReferralTracker() {
  const rawRefParam = useSearchParams().get("ref");
  const session = useSiweSession();
  const router = useRouter();
  const [pendingCode, setPendingCode] = useState<string | null>(null);

  // [R1][R2] Capture: first-touch persist a valid `?ref=`, strip it from the URL, then reflect whatever
  // is pending now (freshly captured or a prior visit's cookie) so the apply effect can pick it up. Keyed
  // on the `?ref=` value (not the searchParams identity) so it runs once per distinct code — after the
  // apply clears the cookie, a lingering `?ref=` never re-persists the just-applied code.
  useEffect(() => {
    if (isValidReferralCode(rawRefParam)) writePendingReferralCodeFirstTouch(rawRefParam);
    if (rawRefParam != null) stripRefFromUrl();
    setPendingCode(readPendingReferralCode());
  }, [rawRefParam]);

  // [R3][R4] Apply: once a session exists (any login method) and a code is pending, apply it once.
  useEffect(() => {
    if (!session.isSignedIn || !pendingCode) return;
    if (attemptedCodes.has(pendingCode)) return;
    attemptedCodes.add(pendingCode);

    let active = true;
    void applyReferralCodeAction()
      .then((outcome) => {
        if (!active) return;
        if (outcome === "no-session") {
          // Race: the client believes it is signed in but the server could not derive a wallet. Keep the
          // code pending and let a later authenticated load retry.
          attemptedCodes.delete(pendingCode);
          return;
        }
        // [R5][R7][R8] Terminal (applied / already-referred / self-referral / not-applicable): the
        // Server Action already cleared the cookie; mirror it on the client and drop the pending state.
        clearPendingReferralCode();
        setPendingCode(null);
        // [R8] On a real attach, refresh so the referred-by read re-runs (the action busted the tag).
        // POO-579 (Feature B): a real attach is the FIRST (once-ever) successful referral join — flag
        // a one-time Home welcome BEFORE the refresh so the banner survives the navigation to Home.
        if (outcome === "applied") {
          markReferralWelcomePending();
          router.refresh();
        }
      })
      .catch(() => {
        // The action is designed not to throw; a transport error still must not crash. Allow a retry.
        if (active) attemptedCodes.delete(pendingCode);
      });

    return () => {
      active = false;
    };
  }, [session.isSignedIn, pendingCode, router]);

  return null;
}
