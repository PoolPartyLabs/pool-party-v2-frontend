/**
 * @id PP-CORE-LIB-036 (POO-702 Secondary #1) — tests
 * @implements-rules-version v1
 *
 * describeError reduces any caught value to a flat, PII-free { name, message, status?, code?, digest? }.
 * These pin the duck-typed extraction the save/upload failure logs depend on.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { describeError } from "./describeError";

describe("describeError", () => {
  it("captures the class name and message of a plain Error", () => {
    expect(describeError(new TypeError("boom"))).toEqual({ name: "TypeError", message: "boom" });
  });

  it("captures status + code from an ApiError-shaped error", () => {
    const described = describeError(new ApiError(400, "VALIDATION_ERROR", "phone too long"));
    expect(described).toEqual({
      name: "ApiError",
      message: "phone too long",
      status: 400,
      code: "VALIDATION_ERROR",
    });
  });

  it("captures the Next.js server-action digest for correlation", () => {
    const redacted = Object.assign(
      new Error("An error occurred in the Server Components render."),
      {
        digest: "3141592653",
      },
    );
    expect(describeError(redacted)).toMatchObject({ digest: "3141592653" });
  });

  it("describes an Error-like object (non-Error throwable) via its own fields", () => {
    const thrown = { name: "S3Error", message: "AccessDenied", status: 403, code: "AccessDenied" };
    expect(describeError(thrown)).toEqual({
      name: "S3Error",
      message: "AccessDenied",
      status: 403,
      code: "AccessDenied",
    });
  });

  it("falls back to UnknownError for a primitive throwable", () => {
    expect(describeError("kaboom")).toEqual({ name: "UnknownError", message: "kaboom" });
    expect(describeError(undefined)).toEqual({ name: "UnknownError", message: "undefined" });
  });
});
