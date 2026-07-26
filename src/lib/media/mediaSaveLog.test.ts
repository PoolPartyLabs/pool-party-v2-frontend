/**
 * @id PP-CORE-LIB-037 (POO-702 Secondary #1) — tests
 * @implements-rules-version v1
 *
 * The real-mode persist observability: the request log prints the PATCH body SHAPE (keys + avatar/banner
 * URL classification, never a value) so the next save reveals whether the https URL reached the PATCH;
 * the error log prints the API failure so a silent 4xx is diagnosable. Both carry the PP-MEDIA-SAVE prefix.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { classifyUrl, logMediaSaveError, logMediaSaveRequest } from "./mediaSaveLog";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifyUrl", () => {
  it("is absent for a missing / empty / non-string value", () => {
    expect(classifyUrl(undefined)).toBe("absent");
    expect(classifyUrl("")).toBe("absent");
    expect(classifyUrl(42)).toBe("absent");
  });

  it("is non-https for a data: / http: value (the exact drop POO-702 must catch)", () => {
    expect(classifyUrl("data:image/png;base64,AAAA")).toBe("non-https");
    expect(classifyUrl("http://cdn.example.com/a.png")).toBe("non-https");
  });

  it("is https for a hosted CDN url", () => {
    expect(classifyUrl("https://cdn.example.test/managers/0x/avatar?v=1")).toBe("https");
  });
});

describe("logMediaSaveRequest", () => {
  it("logs the PP-MEDIA-SAVE request with sorted body keys + url classification, never a value", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const avatar = "https://cdn.pool-party.xyz/avatars/0x/avatar?v=9";
    logMediaSaveRequest("manager", { displayName: "x", bio: "y", avatarUrl: avatar });

    expect(info).toHaveBeenCalledTimes(1);
    const [prefix, payload] = info.mock.calls[0] as [string, Record<string, unknown>];
    expect(prefix).toBe("PP-MEDIA-SAVE request");
    expect(payload).toMatchObject({
      surface: "manager",
      bodyKeys: ["avatarUrl", "bio", "displayName"],
      avatarUrl: "https",
      bannerUrl: "absent",
    });
    // PII-safe: the actual URL value is never in the log payload.
    expect(JSON.stringify(payload)).not.toContain(avatar);
  });
});

describe("logMediaSaveError", () => {
  it("logs the PP-MEDIA-SAVE error with the API status / code / message", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logMediaSaveError(
      "investor",
      new ApiError(400, "VALIDATION_ERROR", "phone must be <= 32 chars"),
    );

    expect(error).toHaveBeenCalledTimes(1);
    const [prefix, payload] = error.mock.calls[0] as [string, Record<string, unknown>];
    expect(prefix).toBe("PP-MEDIA-SAVE error");
    expect(payload).toMatchObject({
      surface: "investor",
      name: "ApiError",
      status: 400,
      code: "VALIDATION_ERROR",
      message: "phone must be <= 32 chars",
    });
  });
});
