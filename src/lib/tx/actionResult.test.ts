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
});
