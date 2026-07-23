/**
 * @id PP-CORE (POO-453)
 * @name isTransientApiError tests
 * @implements-rules-version v1
 *
 * The predicate the client uses to decide "retry, do not hard-fail the page" vs a real error.
 * Mirrors the server-side retry set (429/502/503/504/408) plus network failures (status 0).
 */
import { describe, expect, it } from "vitest";
import { ApiError, ApiParseError, isTransientApiError } from "./errors";

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
