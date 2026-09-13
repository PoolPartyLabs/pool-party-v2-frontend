/**
 * @id PP-CORE-LIB-050 (POO-1107)
 * @name Uniswap error classification tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Rules under test (POO-1107 rules v1):
 *   [R1] a transient upstream failure (429, 5xx, timeout, network) MUST NOT be read as
 *        "no route exists"; a routing verdict (404) still must be
 *
 * These cases exist because the planner's own tests cannot catch the failure they guard against.
 * `buildPlan.test.ts` mocks `quoteSwap` at the module boundary and hands `priceLeg` a code it
 * chose itself, so it passes for ANY vocabulary, including one the live transport cannot emit.
 * The list below is pinned to the codes the real path produces, hop by hop.
 */
import { describe, expect, it } from "vitest";
import { isTransientFailureCode } from "./errors";

describe("isTransientFailureCode [R1]", () => {
  // Hop 2, forwarded verbatim by pool-party-api's `UniswapUpstreamException`.
  it.each([
    "UNISWAP_NETWORK_ERROR",
    "UNISWAP_TIMEOUT",
    "UNISWAP_RATE_LIMITED",
    "UNISWAP_UPSTREAM_ERROR",
  ])("treats the forwarded upstream code %s as an outage", (code) => {
    expect(isTransientFailureCode(code)).toBe(true);
  });

  // pool-party-api's own back-pressure. The reason POO-1107 exists: these are the throttles that
  // actually fire, and reading either as a routing verdict tells a funded wallet it is short.
  it.each([
    "FUNDING_WALLET_RATE_LIMITED",
    "THROTTLER",
  ])("treats the backend's own throttle %s as an outage", (code) => {
    expect(isTransientFailureCode(code)).toBe(true);
  });

  // Hop 1: the request never reached the backend, so `apiFetch` supplied the code.
  it.each([
    "SYSTEM_NETWORK_ERROR",
    "SYSTEM_TIMEOUT",
    "SYSTEM_RATE_LIMITED",
  ])("treats the transport-level code %s as an outage", (code) => {
    expect(isTransientFailureCode(code)).toBe(true);
  });

  // The bound on the fix. Widening it to "any failure" would make every unroutable pair fail the
  // whole plan instead of moving to the next source.
  it("leaves a 404 as the routing verdict it is", () => {
    expect(isTransientFailureCode("UNISWAP_REQUEST_ERROR")).toBe(false);
  });

  // A credential does not come right on its own, so a retry prompt would hide the outage.
  it.each([
    "UNISWAP_UNAUTHORIZED",
    "UNISWAP_KEY_MISSING",
    "SYSTEM_NOT_CONFIGURED",
  ])("does not call the credential failure %s transient", (code) => {
    expect(isTransientFailureCode(code)).toBe(false);
  });

  it("does not call contract drift transient, because it fails identically on retry", () => {
    expect(isTransientFailureCode("SCHEMA_MISMATCH")).toBe(false);
  });

  it("handles an absent code", () => {
    expect(isTransientFailureCode(undefined)).toBe(false);
  });
});
