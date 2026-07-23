/**
 * @id PP-CORE (POO-206)
 * @name toUserError
 * @implements-rules-version v1
 *
 * Maps an ApiError to a user-facing error descriptor. The i18nKey is looked up
 * by the UI layer via useTranslations; the isRetryable flag drives retry affordances.
 */
import type { ApiError } from "./errors";

export interface UserError {
  /** Dot-path i18n key (e.g. "errors.api.networkError"). */
  i18nKey: string;
  /** Whether the user should be offered a retry action. */
  isRetryable: boolean;
}

/** Known error code to i18n key mapping. */
const CODE_MAP: Record<string, UserError> = {
  SYSTEM_NETWORK_ERROR: { i18nKey: "errors.api.networkError", isRetryable: true },
  SYSTEM_NOT_CONFIGURED: { i18nKey: "errors.api.notConfigured", isRetryable: false },
  SYSTEM_UPSTREAM_UNAVAILABLE: { i18nKey: "errors.api.upstreamUnavailable", isRetryable: true },
  SYSTEM_RATE_LIMITED: { i18nKey: "errors.api.rateLimited", isRetryable: true },
  // [R12] Client-side timeout (apiFetch AbortController). Same user-facing meaning as an
  // unavailable upstream — a transient slow/stuck backend the user can retry.
  SYSTEM_TIMEOUT: { i18nKey: "errors.api.upstreamUnavailable", isRetryable: true },
};

/** HTTP status to i18n key fallback (when code is not in CODE_MAP). */
const STATUS_MAP: Record<number, UserError> = {
  401: { i18nKey: "errors.api.unauthorized", isRetryable: false },
  403: { i18nKey: "errors.api.unauthorized", isRetryable: false },
  404: { i18nKey: "errors.api.notFound", isRetryable: false },
  // [R12] Backend-origin 408 (response-path Request Timeout). Converge with the
  // client-side timeout (SYSTEM_TIMEOUT in CODE_MAP) onto the same transient,
  // retryable upstreamUnavailable message. CODE_MAP still wins for SYSTEM_TIMEOUT.
  408: { i18nKey: "errors.api.upstreamUnavailable", isRetryable: true },
  429: { i18nKey: "errors.api.rateLimited", isRetryable: true },
};

const FALLBACK: UserError = { i18nKey: "errors.api.unknown", isRetryable: true };

/**
 * Map an API error to a user-facing error descriptor.
 * Priority: exact code match > HTTP status match > fallback.
 */
export function toUserError(error: ApiError): UserError {
  return CODE_MAP[error.code] ?? STATUS_MAP[error.status] ?? FALLBACK;
}
