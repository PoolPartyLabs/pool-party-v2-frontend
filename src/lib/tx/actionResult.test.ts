/**
 * @id PP-CORE-LIB-023 (POO-475)
 * @name build-tx action result tests
 * @implements-rules-version v1
 *
 * The build server actions surface failures as typed data instead of throwing across the RSC
 * boundary (POO-475). `buildTxFailure` maps a caught throwable to a stable { ok: false } shape:
 * an ApiError preserves its code + message verbatim [R2], an ApiParseError becomes SCHEMA_MISMATCH
 * [R2], anything else becomes SYSTEM_INTERNAL with String(error) [R2]. Nothing is masked.
 */
import { describe, expect, it } from "vitest";
import { ApiError, ApiParseError } from "@/lib/api/errors";
import { buildTxFailure } from "./actionResult";

describe("buildTxFailure", () => {
  it("preserves an ApiError's code and message verbatim", () => {
    // @rule R2
    const failure = buildTxFailure(
      new ApiError(400, "SLIPPAGE_EXCEEDED", "price slippage check failed"),
    );
    expect(failure).toEqual({
      ok: false,
      code: "SLIPPAGE_EXCEEDED",
      message: "price slippage check failed",
    });
  });

  it("maps an ApiParseError to SCHEMA_MISMATCH keeping its message", () => {
    // @rule R2
    const failure = buildTxFailure(new ApiParseError("response validation failed", []));
    expect(failure.ok).toBe(false);
    expect(failure.code).toBe("SCHEMA_MISMATCH");
    expect(failure.message).toBe("response validation failed");
  });

  it("maps an unknown Error to SYSTEM_INTERNAL with String(error)", () => {
    // @rule R2
    const failure = buildTxFailure(new Error("boom"));
    expect(failure).toEqual({
      ok: false,
      code: "SYSTEM_INTERNAL",
      message: "Error: boom",
    });
  });

  it("maps a non-Error throwable to SYSTEM_INTERNAL with String(error)", () => {
    // @rule R2
    const failure = buildTxFailure("plain string failure");
    expect(failure).toEqual({
      ok: false,
      code: "SYSTEM_INTERNAL",
      message: "plain string failure",
    });
  });

  /**
   * @rule POO-1251 R1 — the correlation id has to cross the RSC boundary AS DATA for the same reason
   * the code does. `ApiError` already carried it and this mapper dropped it, which is why the error
   * dialog could never show a reference: the id existed server-side for every failed build and
   * nothing carried it the last hop.
   */
  it("carries an ApiError's correlation id through to the failure", () => {
    const failure = buildTxFailure(
      new ApiError(500, "SLIPPAGE_EXCEEDED", "slippage", "80a8cbb7d98b4bc9ba2f7c6c5e78c17d"),
    );
    expect(failure.correlationId).toBe("80a8cbb7d98b4bc9ba2f7c6c5e78c17d");
  });

  it("carries an ApiParseError's correlation id through to the failure", () => {
    const failure = buildTxFailure(
      new ApiParseError("drift", [], "80a8cbb7d98b4bc9ba2f7c6c5e78c17d"),
    );
    expect(failure.correlationId).toBe("80a8cbb7d98b4bc9ba2f7c6c5e78c17d");
  });

  // A call that never reached the backend has no id, and the key is ABSENT rather than undefined, so
  // a consumer's `?? fallback` fires and the dialog falls back to the browser's own trace id.
  it("omits the correlation id when the failure never reached the backend", () => {
    expect("correlationId" in buildTxFailure(new ApiError(0, "SYSTEM_NETWORK_ERROR", "down"))).toBe(
      false,
    );
    expect("correlationId" in buildTxFailure(new Error("boom"))).toBe(false);
  });
});
