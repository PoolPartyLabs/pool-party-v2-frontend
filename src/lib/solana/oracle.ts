export type SolanaOracleReference =
  | { status: "unavailable"; reason: string }
  | { status: "available"; expiresAt: number; marketOpen: boolean };

export function solanaReferenceAvailability(
  reference: SolanaOracleReference | undefined,
  stockMarketHoursRequired: boolean,
  now = Math.floor(Date.now() / 1000),
): { status: "available" } | { status: "unavailable"; reason: string } {
  if (!reference) return { status: "unavailable", reason: "SOLANA_ORACLE_REFERENCE_MISSING" };
  if (reference.status === "unavailable")
    return {
      status: "unavailable",
      reason: reference.reason || "SOLANA_ORACLE_REFERENCE_MISSING",
    };
  if (!Number.isSafeInteger(reference.expiresAt) || reference.expiresAt <= now)
    return { status: "unavailable", reason: "SOLANA_ORACLE_REFERENCE_STALE" };
  if (stockMarketHoursRequired && reference.marketOpen !== true)
    return { status: "unavailable", reason: "SOLANA_ORACLE_MARKET_CLOSED" };
  return { status: "available" };
}

/** DEC-203/204: API quotes cannot replace a missing, stale or closed-market on-chain reference. */
export function requireSolanaOracleReference(
  reference: SolanaOracleReference | undefined,
  stockMarketHoursRequired: boolean,
) {
  const availability = solanaReferenceAvailability(reference, stockMarketHoursRequired);
  if (availability.status === "unavailable") throw new Error(availability.reason);
}
