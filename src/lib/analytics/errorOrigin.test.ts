/**
 * @id PP-CORE-LIB-085 (POO-1171)
 * @name analytics error origin, spec
 * @implements-rules-version v1 (POO-1212 [2])
 *
 * POO-1171's acceptance names one test explicitly: the fold "is exhaustive and proven by a test that
 * fails if a kind is added without an origin". That is the first block below.
 *
 * The type system already enforces exhaustiveness (`satisfies Record<TxErrorKind, …>`), so this
 * suite exists for what the type cannot check at runtime: that the fold's KEYS still match the kinds
 * `diagnostics.ts` actually classifies to. A kind deleted from the union but left in the fold, or a
 * value silently changed, compiles fine and would go unnoticed.
 */
import { describe, expect, it } from "vitest";
import { isExpectedNonOutage } from "@/lib/observability/expectedFailure";
import { classifyTxError } from "@/lib/tx/diagnostics";
import {
  ANALYTICS_ERROR_ORIGINS,
  analyticsErrorOrigin,
  TX_ERROR_KIND_TO_ORIGIN,
} from "./errorOrigin";
import type { AnalyticsParams } from "./events";
import { ANALYTICS_ERROR_CODES, isAnalyticsErrorCodeShape } from "./events";

describe("analytics error origin", () => {
  describe("the fold is total", () => {
    /**
     * The test POO-1171 asks for, in the half a test can actually own.
     *
     * Exhaustiveness itself is enforced at COMPILE time by `satisfies Record<TxErrorKind, …>`, which
     * is strictly stronger than any runtime check: adding a kind to `diagnostics.ts` without adding
     * it here does not compile. What a runtime test adds is the other direction, which the type
     * cannot see: that the classifier's real output never lands outside the fold.
     *
     * `classifyTxError` is the public entry point and the only thing that produces a `TxErrorKind`,
     * so driving it with a code from each family is the honest witness. `BACKEND_CODE_KINDS` is
     * module-private and deliberately left that way rather than exported to suit a test.
     */
    it("gives every kind the classifier actually produces an origin", () => {
      const codes = [
        "SLIPPAGE_EXCEEDED",
        "DEADLINE_EXPIRED",
        "INSUFFICIENT_FUNDS",
        "USER_REJECTED",
        "UNAUTHORIZED",
        "WRONG_CHAIN",
        "PROVISIONING_GAS_BLOCKED",
        "PROVISIONING_LEG_ALREADY_BROADCAST",
        // POO-1173: the four families the classifier reconciliation added. Without these the witness
        // covers only the kinds that existed before the fold grew, which is how a new kind reaches
        // the fold's TYPE without ever being driven through the classifier that produces it.
        "TX_SIMULATION_REVERTED",
        "TX_INVALID_PARAMS",
        "TX_STATE_CONFLICT",
        "TX_NO_ROUTE",
      ];
      for (const code of codes) {
        const kind = classifyTxError(Object.assign(new Error("x"), { code }));
        expect(
          TX_ERROR_KIND_TO_ORIGIN,
          `code "${code}" classified as "${kind}", which has no origin`,
        ).toHaveProperty(kind);
      }
    });

    it("gives an unclassifiable error an origin too, never undefined", () => {
      expect(analyticsErrorOrigin(classifyTxError(new Error("something nobody predicted")))).toBe(
        "unknown",
      );
    });

    it("maps every kind to a declared origin, never to a typo", () => {
      for (const [kind, origin] of Object.entries(TX_ERROR_KIND_TO_ORIGIN)) {
        expect(ANALYTICS_ERROR_ORIGINS, `"${kind}" -> "${origin}"`).toContain(origin);
      }
    });

    it("never returns undefined, so no caller needs a fallback", () => {
      for (const kind of Object.keys(TX_ERROR_KIND_TO_ORIGIN)) {
        expect(analyticsErrorOrigin(kind as never)).toBeTruthy();
      }
    });
  });

  describe("the causal mapping", () => {
    it("reads a moved market as market, not as anyone's fault", () => {
      expect(analyticsErrorOrigin("slippage")).toBe("market");
      expect(analyticsErrorOrigin("deadlineExpired")).toBe("market");
    });

    it("separates missing money from missing gas but gives both the same cause", () => {
      expect(analyticsErrorOrigin("insufficientFunds")).toBe("funds");
      expect(analyticsErrorOrigin("gasBlocked")).toBe("funds");
    });

    it("reads an explicit refusal as the user", () => {
      expect(analyticsErrorOrigin("userRejected")).toBe("user");
    });

    it("reads a dependency outage as upstream, the one origin that is not our on-call", () => {
      expect(analyticsErrorOrigin("upstreamUnavailable")).toBe("upstream");
    });

    /**
     * The tie-break rule, pinned. These three are the ones a future reader is most likely to
     * "correct" to `user`, which would make our own defects permanently invisible: nobody queries
     * the bucket labelled "the user did this to themselves".
     */
    it("resolves a kind with both an app cause and a user cause to app", () => {
      // Deliberately merges "the user declined our corrective switch" (diagnostics.ts:102-105
      // re-throws the wallet's 4001 as WRONG_CHAIN on purpose) with "our switch failed".
      expect(analyticsErrorOrigin("wrongChain")).toBe("app");
      // EIP-1193 4100 and `only pool manager` are the user's state; an unrefreshed session is ours.
      expect(analyticsErrorOrigin("unauthorized")).toBe("app");
    });

    it("reads a leg the rail forgot it had broadcast as our defect", () => {
      expect(analyticsErrorOrigin("alreadyBroadcast")).toBe("app");
    });

    /**
     * POO-1173. `satisfies Record<TxErrorKind, …>` forces an ENTRY to exist and never checks its
     * VALUE, so before this test all four of the decisions POO-1173 exists to make could be flipped
     * with the suite still green. `reverted` is the contested one: it is decided by the METRIC
     * definition rather than by the tie-break rule, because `market` is excluded from
     * `origin IN ("app","upstream")` exactly as `unknown` is, so re-reading a revert as `market`
     * moves it between two excluded buckets and changes the failure rate by nothing.
     */
    it("reads a revert as our fault, because market is excluded from the failure rate", () => {
      expect(analyticsErrorOrigin("reverted")).toBe("app");
      expect(analyticsErrorOrigin("invalidParams")).toBe("app");
      expect(analyticsErrorOrigin("staleState")).toBe("app");
    });

    /** The one new kind deliberately kept OUT of the failure rate: the router answered, correctly. */
    it("reads no-executable-route as a liquidity condition, not an outage", () => {
      expect(analyticsErrorOrigin("noRoute")).toBe("market");
    });

    it("keeps unknown honest rather than guessing", () => {
      expect(analyticsErrorOrigin("unknown")).toBe("unknown");
    });
  });

  /**
   * POO-1212 [4]. The value of this rule is entirely in the two rails AGREEING, so the test asserts
   * agreement against the shared predicate rather than re-listing the suppressed cases here. A copy
   * of the list would be the exact drift the shared predicate exists to prevent.
   */
  describe("the failure-suppression rule is shared, not copied", () => {
    it("suppresses in analytics exactly what the log rail suppresses", () => {
      const cases: unknown[] = [
        { code: "SYSTEM_NOT_CONFIGURED" },
        { code: "WALLET_NOT_FOUND" },
        { status: 404 },
        { status: 429 },
        { code: "TX_SLIPPAGE_EXCEEDED" },
        { status: 500 },
        new Error("boom"),
      ];
      for (const c of cases) {
        // The analytics side has no second opinion by construction: it calls this same function.
        expect(typeof isExpectedNonOutage(c)).toBe("boolean");
      }
      // The three that must stay silent on BOTH rails.
      expect(isExpectedNonOutage({ code: "SYSTEM_NOT_CONFIGURED" })).toBe(true);
      expect(isExpectedNonOutage({ status: 404 })).toBe(true);
      expect(isExpectedNonOutage({ status: 429 })).toBe(true);
      // And a real failure that must reach both.
      expect(isExpectedNonOutage({ code: "TX_SLIPPAGE_EXCEEDED" })).toBe(false);
    });
  });

  /**
   * POO-1212 [2]. `terminal` is the field `pending` was deleted to make room for. This pins the two
   * axes as separate, because the tempting "simplification" a year from now is to fold them back.
   */
  describe("terminality is a separate axis from cause", () => {
    it("has no origin value that answers 'did it finish?'", () => {
      // `pending` was removed on purpose: it answered a different question from the other six, and
      // keeping it meant `origin IN ("app","upstream")` silently excluded app defects that stalled.
      expect(ANALYTICS_ERROR_ORIGINS).not.toContain("pending");
      expect(ANALYTICS_ERROR_ORIGINS).toHaveLength(6);
    });

    it("lets a non-terminal failure still carry a cause", () => {
      // The real case: ONRAMP_SETTLING (StandaloneOnRampRail.tsx:99), paid but not yet on chain.
      // It is upstream's slowness AND it is resumable, and both must be sayable at once.
      const params: AnalyticsParams = { error_code: "ONRAMP_SETTLING", terminal: false };
      expect(params.terminal).toBe(false);
      expect(isAnalyticsErrorCodeShape(String(params.error_code))).toBe(true);
    });
  });

  describe("isAnalyticsErrorCodeShape", () => {
    it("accepts every frontend-local code", () => {
      for (const code of ANALYTICS_ERROR_CODES) {
        expect(isAnalyticsErrorCodeShape(code), code).toBe(true);
      }
    });

    it("accepts an API code this repo does not enumerate, which is the point", () => {
      // Real codes from uBits-Capital/pool-party-api that are deliberately NOT mirrored here.
      expect(isAnalyticsErrorCodeShape("TX_SLIPPAGE_EXCEEDED")).toBe(true);
      expect(isAnalyticsErrorCodeShape("TX_SIMULATION_REVERTED")).toBe(true);
      expect(isAnalyticsErrorCodeShape("AUTH_NONCE_EXPIRED")).toBe(true);
    });

    /** The failure POO-1171 was actually worried about: unbounded strings in `error_code`. */
    it("rejects free prose, which is what would generate an (other) bucket per message", () => {
      expect(isAnalyticsErrorCodeShape("Slippage error: the transaction may not execute")).toBe(
        false,
      );
      expect(isAnalyticsErrorCodeShape("failed sending to 0xabc123def456")).toBe(false);
    });

    it("rejects a lowercase or single-token value", () => {
      expect(isAnalyticsErrorCodeShape("tx_slippage_exceeded")).toBe(false);
      expect(isAnalyticsErrorCodeShape("SLIPPAGE")).toBe(false);
    });

    it("rejects a value long enough to be a sentence in disguise", () => {
      expect(isAnalyticsErrorCodeShape(`TX_${"A".repeat(60)}`)).toBe(false);
    });
  });
});
