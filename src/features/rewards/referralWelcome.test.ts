/**
 * @id PP-REW-LIB-010 (POO-579)
 * @name referralWelcome tests
 * @implements-rules-version v1
 *
 * Feature B (POO-579): a one-time "you joined through a referral" flag, persisted across the
 * `router.refresh()` navigation to Home. `mark` sets it; `consume` reads-and-clears it so the
 * welcome banner shows exactly once.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  consumeReferralWelcomePending,
  markReferralWelcomePending,
  REFERRAL_WELCOME_KEY,
} from "./referralWelcome";

describe("referralWelcome", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  // @rule R10: nothing marked → consume is false
  it("returns false when nothing is pending", () => {
    expect(consumeReferralWelcomePending()).toBe(false);
  });

  // @rule R10: mark then consume returns true exactly once
  it("marks a pending welcome and consumes it once", () => {
    markReferralWelcomePending();
    expect(consumeReferralWelcomePending()).toBe(true);
    // Second consume is false — the flag was cleared on read.
    expect(consumeReferralWelcomePending()).toBe(false);
  });

  // @rule R10: consuming clears the underlying key
  it("clears the stored key on consume", () => {
    markReferralWelcomePending();
    consumeReferralWelcomePending();
    expect(window.localStorage.getItem(REFERRAL_WELCOME_KEY)).toBeNull();
  });
});
