/**
 * @id PP-CORE-LIB-095
 * @name errorCode.test
 * @implements-rules-version v1
 *
 * POO-1173 D1 [R2] [R3]: `error_code` must never arrive blank.
 *
 * The defect Rafael measured: `toTxError` sets `code: String(providerCode)`, so an EIP-1193 wallet
 * error arrives as the digits `"4001"`. `isAnalyticsErrorCodeShape` requires `^[A-Z]`, so
 * `sanitizeParams` DROPS the param. The single most common failure in the product, the user
 * declining the wallet prompt, reached GA4 with no `error_code` at all. Not a wrong bucket: a blank
 * dimension, on the exact event the shape-versus-union decision was opened about.
 */
import { describe, expect, it } from "vitest";
import { classifyTxError, type TxErrorKind, toTxError } from "@/lib/tx/diagnostics";
import { TransactionError } from "@/lib/tx/sendTransaction";
import { KIND_CODES, toAnalyticsErrorCode } from "./errorCode";
import { isAnalyticsErrorCodeShape } from "./events";
import { sanitizeParams } from "./sanitizeParams";

/** A real EIP-1193 provider rejection: an Error carrying a numeric `code`. */
function providerError(code: number, message = "User rejected the request.") {
  return Object.assign(new Error(message), { code });
}

/** An error carrying a backend-style string code. */
function codedError(code: string, message = ".") {
  return Object.assign(new Error(message), { code });
}

/**
 * The HOUSE contract: the code rides on `error.cause.code`, never as an own property.
 *
 * This is how every stable code in this repo is actually thrown (`src/lib/tx/actionResult.ts:26`,
 * `src/features/strategies/lib/buildPlanSteps.ts:1412`, `sendTransaction.ts` and ~12 hook call
 * sites). An own `code` is what a RAW EIP-1193 provider error has, and nothing else, so a suite
 * built only from `Object.assign(new Error(), { code })` measures a shape production never emits.
 */
function houseError(code: string, message = "boom") {
  return new TransactionError(message, { code });
}

/**
 * Resolve exactly the way `trackFailure` does: classify, then map.
 *
 * Deliberately NOT `tx.kind`, which is optional on `TxError`. Production never reads it either; it
 * calls `classifyTxError` and gets a definite kind. Mirroring that here keeps the test measuring the
 * real path rather than a shape the caller happens to have.
 */
function resolve(error: unknown): string {
  return toAnalyticsErrorCode(error, classifyTxError(error));
}

describe("toAnalyticsErrorCode", () => {
  // [R2] The defect, end to end: what a wallet rejection actually reaches the dataLayer with.
  it("resolves a wallet rejection to a named code instead of dropping it", () => {
    expect(toTxError(providerError(4001), "TX_FAILED").code).toBe("4001");

    const resolved = resolve(providerError(4001));
    const clean = sanitizeParams({ error_code: resolved, value: 100 }, true);

    expect(clean).toHaveProperty("error_code", "USER_REJECTED");
  });

  // [R2] The other two numerics Rafael named. `-32603` is the generic provider error and `4902` is
  // an unrecognised chain; both were dropped for the same reason.
  it.each([-32603, 4902])("never leaves a blank error_code for provider code %s", (code) => {
    const clean = sanitizeParams({ error_code: resolve(providerError(code, ".")) }, true);

    expect(clean).toHaveProperty("error_code");
    expect(String((clean as Record<string, unknown>).error_code)).not.toMatch(/^-?\d+$/);
  });

  // [R2] The split this closes: the SAME condition reported by the provider as digits and by the
  // backend as a name must land on ONE GA4 row, not two.
  it("collapses the provider and backend spellings of one condition", () => {
    expect(resolve(providerError(4001))).toBe(resolve(codedError("USER_REJECTED")));
  });

  /**
   * [R2] Code-first, kind-fallback, and this test is why.
   *
   * POO-1173's original text asked for "kind first, then the stable code". Taken literally that
   * would collapse `TX_REVERTED` and `TX_SIMULATION_REVERTED` into one row, because D3 [R2] gave
   * them ONE kind on purpose and said `error_code` is what separates them in GA4. The two
   * instructions conflict; resolving in favour of the code preserves both, because a usable code is
   * strictly more specific than the kind it classifies to.
   */
  it("keeps two codes that share a kind distinguishable", () => {
    const post = resolve(codedError("TX_REVERTED"));
    const pre = resolve(codedError("TX_SIMULATION_REVERTED"));

    expect(post).toBe("TX_REVERTED");
    expect(pre).toBe("TX_SIMULATION_REVERTED");
    expect(post).not.toBe(pre);
  });

  /**
   * [R2] The same claim, against the shape the app ACTUALLY throws.
   *
   * The case above is the provider shape (an own `code`), which only a raw EIP-1193 error has. Every
   * stable code this repo produces rides on `error.cause.code`, so a resolver that reads one own
   * property collapses `TX_SIMULATION_REVERTED` into `TX_REVERTED` in production while that test
   * stays green. The two shapes must resolve identically, and this is the one that pins it.
   */
  it("reads the code off the cause chain, the way this repo throws it", () => {
    const post = resolve(houseError("TX_REVERTED"));
    const pre = resolve(houseError("TX_SIMULATION_REVERTED"));

    expect(post).toBe("TX_REVERTED");
    expect(pre).toBe("TX_SIMULATION_REVERTED");
    expect(post).not.toBe(pre);
    // A bare `cause` object is the same contract without the class, and must behave the same.
    expect(resolve(new Error("boom", { cause: { code: "TX_SIMULATION_REVERTED" } }))).toBe(
      "TX_SIMULATION_REVERTED",
    );
    // The planner's own pre-broadcast block, thrown the same way. It happens to share its name with
    // the `gasBlocked` fallback, so it cannot prove the walk by itself; it is here because it is a
    // real throw and must not regress to something else.
    expect(resolve(houseError("PROVISIONING_GAS_BLOCKED"))).toBe("PROVISIONING_GAS_BLOCKED");
  });

  /**
   * [R2] [R3] The names a kind-first read makes unreachable.
   *
   * `WRONG_ACCOUNT` is the one this PR just registered in `ANALYTICS_ERROR_CODES`, and it maps to
   * kind `unauthorized`; `TX_POSITION_NOT_FOUND` maps to `staleState`, whose own docstring in
   * `diagnostics.ts` says the two "stay distinguishable in GA4 by error_code";
   * `PROVISIONING_GAS_BLOCKED` and `SESSION_MISSING` are shape-valid names the planner and the
   * session guard throw. Every one is thrown on `cause`, so every one is blank-by-kind without the
   * chain walk.
   */
  it.each([
    "WRONG_ACCOUNT",
    "TX_POSITION_NOT_FOUND",
    "SESSION_MISSING",
    "SYSTEM_INTERNAL",
  ])("resolves %s from the cause chain rather than folding to its kind", (code) => {
    expect(resolve(houseError(code))).toBe(code);
    // Non-vacuity guard: each of these folds to a DIFFERENT name by kind, so the assertion above
    // can only pass by reading the code itself off the chain. Asserted as an inequality rather
    // than a pinned kind name so the classifier's table can evolve without falsifying the claim.
    expect(KIND_CODES[classifyTxError(houseError(code))]).not.toBe(code);
  });

  /**
   * The table IS the invariant. `KIND_CODES` is the one path a resolved code does not go through, so
   * a kind added with an unusable name (`REVERTED`, `TX-NO-ROUTE`) would compile clean and
   * reintroduce the blank dimension this module exists to prevent.
   */
  it.each(Object.entries(KIND_CODES))("the %s fallback is a usable code", (kind, code) => {
    expect(isAnalyticsErrorCodeShape(code)).toBe(true);
    expect(
      sanitizeParams({ error_code: toAnalyticsErrorCode(undefined, kind as TxErrorKind) }, true),
    ).toHaveProperty("error_code", code);
  });

  // [R2] Free prose must not survive as a code. It fails the shape check, so the kind answers.
  it("replaces a prose message-derived code with the kind's name", () => {
    const resolved = resolve(new Error("execution reverted: insufficient output amount"));

    expect(resolved).not.toMatch(/\s/);
    expect(sanitizeParams({ error_code: resolved }, true)).toHaveProperty("error_code");
  });

  // The floor: whatever happens, something shape-valid comes out. A blank is the one outcome this
  // function exists to make impossible.
  it("always returns a shape-valid code", () => {
    for (const raw of ["", "   ", "4001", "a lowercase sentence", "TX_REVERTED"]) {
      expect(sanitizeParams({ error_code: resolve(codedError(raw)) }, true)).toHaveProperty(
        "error_code",
      );
    }
  });
});
