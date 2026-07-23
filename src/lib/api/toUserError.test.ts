/**
 * @id PP-CORE (POO-206)
 * @name toUserError tests
 * @implements-rules-version v1
 *
 * Maps ApiError codes to i18n keys for user-facing messages.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "./errors";
import { toUserError } from "./toUserError";

describe("toUserError", () => {
  it("maps SYSTEM_NETWORK_ERROR to errors.api.networkError (retryable)", () => {
    const result = toUserError(new ApiError(0, "SYSTEM_NETWORK_ERROR", "fetch failed"));
    expect(result).toEqual({ i18nKey: "errors.api.networkError", isRetryable: true });
  });

  it("maps SYSTEM_NOT_CONFIGURED to errors.api.notConfigured (not retryable)", () => {
    const result = toUserError(new ApiError(503, "SYSTEM_NOT_CONFIGURED", "missing env"));
    expect(result).toEqual({ i18nKey: "errors.api.notConfigured", isRetryable: false });
  });

  it("maps SYSTEM_UPSTREAM_UNAVAILABLE to errors.api.upstreamUnavailable (retryable)", () => {
    const result = toUserError(new ApiError(502, "SYSTEM_UPSTREAM_UNAVAILABLE", "bad gateway"));
    expect(result).toEqual({ i18nKey: "errors.api.upstreamUnavailable", isRetryable: true });
  });

  // @rule R12
  it("maps SYSTEM_TIMEOUT to errors.api.upstreamUnavailable (retryable)", () => {
    const result = toUserError(new ApiError(408, "SYSTEM_TIMEOUT", "client timeout"));
    expect(result).toEqual({ i18nKey: "errors.api.upstreamUnavailable", isRetryable: true });
  });

  // @rule R12
  it("maps a backend-origin 408 to errors.api.upstreamUnavailable via STATUS_MAP (retryable)", () => {
    const result = toUserError(new ApiError(408, "SYSTEM_INTERNAL", "request timeout"));
    expect(result).toEqual({ i18nKey: "errors.api.upstreamUnavailable", isRetryable: true });
  });

  it("maps SYSTEM_INTERNAL to errors.api.unknown (retryable)", () => {
    const result = toUserError(new ApiError(500, "SYSTEM_INTERNAL", "internal error"));
    expect(result).toEqual({ i18nKey: "errors.api.unknown", isRetryable: true });
  });

  it("maps 401 status to errors.api.unauthorized (not retryable)", () => {
    const result = toUserError(new ApiError(401, "AUTH_TOKEN_EXPIRED", "token expired"));
    expect(result).toEqual({ i18nKey: "errors.api.unauthorized", isRetryable: false });
  });

  it("maps 404 status to errors.api.notFound (not retryable)", () => {
    const result = toUserError(new ApiError(404, "POOL_NOT_FOUND", "pool not found"));
    expect(result).toEqual({ i18nKey: "errors.api.notFound", isRetryable: false });
  });

  it("maps 429 status to errors.api.rateLimited (retryable)", () => {
    const result = toUserError(new ApiError(429, "SYSTEM_RATE_LIMITED", "too many requests"));
    expect(result).toEqual({ i18nKey: "errors.api.rateLimited", isRetryable: true });
  });

  it("maps unknown codes to errors.api.unknown (retryable)", () => {
    const result = toUserError(new ApiError(418, "TEAPOT_BREW_FAILED", "I'm a teapot"));
    expect(result).toEqual({ i18nKey: "errors.api.unknown", isRetryable: true });
  });
});
