/**
 * @id PP-REW-LIB-007 (POO-718, POO-853)
 * @name pendingReferralCode tests
 * @implements-rules-version v1
 *
 * [R1] Validate the ?ref= shape (POO-853 [R2]: the full backend contract 3-10 alphanumerics, so legacy
 * short codes still count). [R2] Persist the captured code as the
 * first-touch `pp_ref` cookie (never overwrite an existing pending code) and clear it. The cookie ops
 * run against jsdom's `document.cookie` (no Secure flag on the http test origin).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPendingReferralCode,
  isValidReferralCode,
  PENDING_REFERRAL_COOKIE,
  qualifiesForApplyRetry,
  readPendingReferralCode,
  writePendingReferralCodeFirstTouch,
} from "./pendingReferralCode";

/** Wipe the pp_ref cookie so each test starts clean. */
function wipeCookie() {
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom test setup; mirrors the module's own cookie writes.
  document.cookie = `${PENDING_REFERRAL_COOKIE}=; Max-Age=0; path=/`;
}

describe("isValidReferralCode", () => {
  // @rule R2 (POO-853): accepts the FULL backend contract 3-10 alphanumerics, case preserved, so a
  // legacy short code arriving via ?ref= still counts.
  it("accepts 3 to 10 alphanumerics (the full backend contract)", () => {
    expect(isValidReferralCode("ABC")).toBe(true); // 3 chars (legacy short code)
    expect(isValidReferralCode("abc12")).toBe(true); // 5 chars
    expect(isValidReferralCode("ABC123")).toBe(true);
    expect(isValidReferralCode("MiXeD9Case")).toBe(true); // 10 chars
  });

  // @rule R2 (POO-853): rejects empty / too short (<3) / too long (>10) / non-alphanumeric / nullish
  it("rejects empty, too-short, too-long, or malformed values", () => {
    expect(isValidReferralCode("")).toBe(false);
    expect(isValidReferralCode("ab")).toBe(false); // 2 chars
    expect(isValidReferralCode("MiXeD9Case4")).toBe(false); // 11 chars
    expect(isValidReferralCode("abc-123")).toBe(false); // hyphen
    expect(isValidReferralCode("abc 123")).toBe(false); // space
    expect(isValidReferralCode("code!!")).toBe(false); // symbol
    expect(isValidReferralCode(null)).toBe(false);
    expect(isValidReferralCode(undefined)).toBe(false);
  });
});

describe("pending referral cookie", () => {
  beforeEach(wipeCookie);

  // @rule R2 (persist the captured code, readable back verbatim / case-sensitive)
  it("writes and reads the pending code as-typed", () => {
    expect(readPendingReferralCode()).toBeNull();
    expect(writePendingReferralCodeFirstTouch("AbC123")).toBe(true);
    expect(readPendingReferralCode()).toBe("AbC123");
  });

  // @rule R2 (first-touch: a later ?ref= never overwrites an existing pending code)
  it("does not overwrite an existing pending code (first-touch wins)", () => {
    writePendingReferralCodeFirstTouch("FIRST1");
    expect(writePendingReferralCodeFirstTouch("SECOND2")).toBe(false);
    expect(readPendingReferralCode()).toBe("FIRST1");
  });

  // @rule R8 (clear on terminal outcome)
  it("clears the pending code", () => {
    writePendingReferralCodeFirstTouch("ABC123");
    clearPendingReferralCode();
    expect(readPendingReferralCode()).toBeNull();
  });
});

describe("qualifiesForApplyRetry", () => {
  // @rule R5 (POO-853): retry only when a code is pending AND the invest clears the 20-USDC floor
  it("requires a pending code and a first invest of at least 20 USD", () => {
    expect(qualifiesForApplyRetry(20, true)).toBe(true);
    expect(qualifiesForApplyRetry(1000, true)).toBe(true);
    expect(qualifiesForApplyRetry(19.99, true)).toBe(false); // below the floor
    expect(qualifiesForApplyRetry(50, false)).toBe(false); // no pending code
    expect(qualifiesForApplyRetry(0, false)).toBe(false);
  });
});
