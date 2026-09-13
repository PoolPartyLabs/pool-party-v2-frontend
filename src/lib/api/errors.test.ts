/**
 * @id PP-CORE (POO-453)
 * @name isTransientApiError tests
 * @implements-rules-version v1
 *
 * The predicate the client uses to decide "retry, do not hard-fail the page" vs a real error.
 * Mirrors the server-side retry set (429/502/503/504/408) plus network failures (status 0).
 */
import { describe, expect, it } from "vitest";
import { ApiError, ApiParseError, isTransientApiError, parseApiErrorBody } from "./errors";

describe("isTransientApiError", () => {
  it.each([0, 408, 429, 502, 503, 504])("treats %s as transient", (status) => {
    expect(isTransientApiError(new ApiError(status, "X", "msg"))).toBe(true);
  });

  it.each([400, 401, 403, 404, 422, 500])("treats %s as non-transient", (status) => {
    expect(isTransientApiError(new ApiError(status, "X", "msg"))).toBe(false);
  });

  it("treats a parse error and a plain Error as non-transient", () => {
    expect(isTransientApiError(new ApiParseError("drift", []))).toBe(false);
    expect(isTransientApiError(new Error("boom"))).toBe(false);
    expect(isTransientApiError(null)).toBe(false);
  });
});

/**
 * @id PP-CORE (POO-243)
 * @name parseApiErrorBody tolerance tests
 * @implements-rules-version v3
 *
 * The DEPLOY-ORDER guarantee. pool-party-api is additively growing a nested
 * `error: { code, message, correlationId, timestamp }` object, and this repo's rule (learned the
 * hard way) is that the frontend is made tolerant and ships FIRST. So every one of these must pass
 * against BOTH the API build we are deployed against today and the one that lands next, which is
 * exactly what the four precedence rungs below are.
 */
describe("parseApiErrorBody: the additive error envelope (POO-243)", () => {
  it("reads code, message and correlationId off the new nested envelope", () => {
    expect(
      parseApiErrorBody(422, {
        statusCode: 422,
        timestamp: "2026-07-29T00:00:00.000Z",
        path: "/api/v2/strategies",
        error: {
          code: "STRATEGY_VALIDATION_FAILED",
          message: "tickLower must be below tickUpper",
          correlationId: "0123456789abcdef0123456789abcdef",
          timestamp: "2026-07-29T00:00:00.000Z",
        },
      }),
    ).toEqual({
      code: "STRATEGY_VALIDATION_FAILED",
      message: "tickLower must be below tickUpper",
      correlationId: "0123456789abcdef0123456789abcdef",
    });
  });

  it("prefers the envelope code over a top-level one when the backend sends both", () => {
    const parsed = parseApiErrorBody(500, {
      code: "INTERNAL_SERVER_ERROR",
      message: "generic",
      error: { code: "POOL_NOT_FOUND", message: "specific", correlationId: "abc" },
    });
    expect(parsed.code).toBe("POOL_NOT_FOUND");
    expect(parsed.message).toBe("specific");
  });

  // Rung 2: the POO-886 contract must survive untouched. This is the shape in production today.
  it("still reads the top-level code/message when there is no envelope", () => {
    expect(parseApiErrorBody(404, { code: "POOL_NOT_FOUND", message: "no such pool" })).toEqual({
      code: "POOL_NOT_FOUND",
      message: "no such pool",
    });
  });

  // Rung 3: the original Nest shape.
  it("still reads the nested Nest `response` (string and object forms)", () => {
    expect(parseApiErrorBody(500, { statusCode: 500, response: "Slippage error" }).message).toBe(
      "Slippage error",
    );
    expect(
      parseApiErrorBody(400, { response: { error: "Bad Request", message: ["a", "b"] } }),
    ).toEqual({ code: "BAD_REQUEST", message: "a; b" });
  });

  // Rung 4: status class.
  it("still falls back to the status class for a codeless body", () => {
    expect(parseApiErrorBody(429, {}).code).toBe("SYSTEM_RATE_LIMITED");
    expect(parseApiErrorBody(500, undefined).code).toBe("SYSTEM_INTERNAL");
  });

  it("omits correlationId entirely against an API build that does not send one", () => {
    expect("correlationId" in parseApiErrorBody(404, { code: "X", message: "y" })).toBe(false);
  });

  it("is not confused by a top-level `error` STRING (the Nest label, not an envelope)", () => {
    // A body whose `error` is the "Bad Request" label must not be read as the new envelope.
    expect(parseApiErrorBody(400, { error: "Bad Request", message: "bad" })).toEqual({
      code: "SYSTEM_INTERNAL",
      message: "bad",
    });
  });

  it("ignores a malformed envelope rather than throwing (an array, a null, a number code)", () => {
    expect(parseApiErrorBody(500, { error: ["nope"], code: "REAL" }).code).toBe("REAL");
    expect(parseApiErrorBody(500, { error: null, code: "REAL" }).code).toBe("REAL");
    expect(parseApiErrorBody(500, { error: { code: 42 }, message: "m" }).code).toBe(
      "SYSTEM_INTERNAL",
    );
  });
});

describe("ApiError / ApiParseError requestId (POO-243)", () => {
  it("carries the correlation id when one was captured", () => {
    expect(new ApiError(500, "X", "m", "req-1").requestId).toBe("req-1");
    expect(new ApiParseError("drift", [], "req-2").requestId).toBe("req-2");
  });

  it("leaves it absent when the call never reached the backend", () => {
    expect(new ApiError(0, "SYSTEM_NETWORK_ERROR", "fetch failed").requestId).toBeUndefined();
    expect(new ApiParseError("drift", []).requestId).toBeUndefined();
  });
});
