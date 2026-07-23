/**
 * @id PP-CORE-LIB-010
 * @name analytics user-id client store
 * @implements-rules-version v1
 *
 * Client-side holder for the pseudonymous analytics `user_id` (the server-derived HMAC of the
 * connected wallet — see `hashWalletAddress` + `/api/analytics/user-id`). `AnalyticsIdentify`
 * resolves and sets it; `useAnalytics` reads it on every `track()`. Module state only — nothing
 * persists (the id is re-derived per session from the connected wallet).
 *
 * PP-SECURITY [R2]: this store only ever holds the 64-hex hash, never the raw address.
 */
let analyticsUserId: string | null = null;

/** The current pseudonymous user id, or null when unidentified. */
export function getAnalyticsUserId(): string | null {
  return analyticsUserId;
}

/** Sets (or clears, with null) the pseudonymous user id. */
export function setAnalyticsUserId(userId: string | null): void {
  analyticsUserId = userId;
}

/**
 * Resolves the pseudonymous id for a connected wallet via the server seam. Returns null on any
 * failure (missing secret, network error, invalid response) — identified analytics is best-effort
 * and must never break the app. The raw address goes only to our own API, never to analytics.
 */
export async function fetchAnalyticsUserId(address: string): Promise<string | null> {
  try {
    const response = await fetch("/api/analytics/user-id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    const userId =
      data && typeof data === "object" && "userId" in data
        ? (data as Record<string, unknown>).userId
        : null;
    return typeof userId === "string" && userId.length > 0 ? userId : null;
  } catch {
    return null;
  }
}
