/**
 * @id PP-REW-LIB-001
 * @name useReferral
 * @implements-rules-version v1
 *
 * Client-side referral-program state shared by every referral surface (Home card, Profile featured
 * card, Rubber Rush aside, Referral hero — POO-290 R1). A module-level cache + listener set keeps
 * the surfaces consistent: when the one-time code is created anywhere, every mounted surface
 * updates. `program` is `null` while the first fetch is in flight.
 *
 * Read source (POO-661): mock mode reads the mock `rewardsService.getReferral()` directly (client-safe,
 * byte-unchanged); real mode reads real pp-api `/referral/:wallet` data via the `getReferralAction`
 * Server Action (the server-only `apiFetch` + the SIWE session run server-side, so they never reach the
 * client bundle — mirrors `useQuacksBalance` → `getQuacksBalanceAction`). A failed real read leaves the
 * program null (surfaces render their skeleton) rather than throwing.
 *
 * Write source (POO-853 [R1]): mock mode creates through the mock `rewardsService.createReferralCode()`
 * directly (client-safe, byte-unchanged); real mode creates via the `createReferralCodeAction` Server
 * Action (server-only `apiFetch` + SIWE session), which POSTs `/referral` and re-reads the confirmed
 * program — mirroring the read branch above. `createCode` resolves `true` on success and `false` on a
 * taken/rejected code (the form surfaces it and stays usable); it never throws.
 */
"use client";

import { useEffect, useState } from "react";
import type { ReferralProgram } from "@/lib/schemas";
import { isMockMode, rewardsService } from "@/lib/services";
import { createReferralCodeAction, getReferralAction } from "./actions";

let cache: ReferralProgram | null = null;
let inflight: Promise<ReferralProgram> | null = null;
const listeners = new Set<(program: ReferralProgram) => void>();

/** Test-only: clears the module-level cache so each test starts from a fresh fetch. */
export function __resetReferralStateForTests() {
  cache = null;
  inflight = null;
}

function publish(program: ReferralProgram) {
  cache = program;
  for (const listener of listeners) listener(program);
}

/** Shared referral-program state + the one-time code creation. */
export function useReferral(initial?: ReferralProgram): {
  /** The referral program, or `null` while loading. `program.code === null` → not created yet. */
  program: ReferralProgram | null;
  /** Create the one-time code (stored as typed). Resolves `true` on success, `false` on a taken/rejected code; never throws. */
  createCode: (code: string) => Promise<boolean>;
} {
  const [program, setProgram] = useState<ReferralProgram | null>(cache ?? initial ?? null);

  useEffect(() => {
    listeners.add(setProgram);
    if (cache) {
      setProgram(cache);
    } else {
      // Mock mode reads the mock service directly (byte-unchanged); real mode reads pp-api via the
      // server action (wallet derived from the SIWE session server-side).
      inflight ??= isMockMode ? rewardsService.getReferral() : getReferralAction();
      inflight
        .then((fetched) => {
          // A creation may have landed while the fetch was in flight — never clobber newer state.
          if (!cache) publish(fetched);
        })
        // A real-read outage leaves the program null (surfaces show the skeleton); the SSR page path
        // surfaces a hard failure to the route error boundary instead.
        .catch(() => {});
    }
    return () => {
      listeners.delete(setProgram);
    };
  }, []);

  async function createCode(code: string): Promise<boolean> {
    // [R1] Mock mode creates through the mock service directly (client-safe, byte-unchanged); real mode
    // goes through the Server Action (server-only apiFetch + SIWE session). Both publish the confirmed
    // program on success. A taken/rejected code resolves false so the form can surface it.
    if (isMockMode) {
      try {
        publish(await rewardsService.createReferralCode(code));
        return true;
      } catch {
        return false;
      }
    }
    const outcome = await createReferralCodeAction(code);
    if (outcome.status === "created") {
      publish(outcome.program);
      return true;
    }
    return false;
  }

  return { program, createCode };
}
