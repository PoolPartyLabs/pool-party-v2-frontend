import { expect, it } from "vitest";
import { requireSolanaOracleReference, solanaReferenceAvailability } from "./oracle";

it("refuses absent references even when the Manager disables the maximum", () => {
  expect(() => requireSolanaOracleReference(undefined, false)).toThrow(
    "SOLANA_ORACLE_REFERENCE_MISSING",
  );
});
it("preserves unavailable reasons and refuses stale or closed-market data", () => {
  expect(
    solanaReferenceAvailability({ status: "unavailable", reason: "STOCK_DATA_UNAVAILABLE" }, true),
  ).toEqual({ status: "unavailable", reason: "STOCK_DATA_UNAVAILABLE" });
  expect(
    solanaReferenceAvailability(
      { status: "available", expiresAt: 100, marketOpen: true },
      false,
      100,
    ),
  ).toEqual({ status: "unavailable", reason: "SOLANA_ORACLE_REFERENCE_STALE" });
  expect(
    solanaReferenceAvailability(
      { status: "available", expiresAt: 200, marketOpen: false },
      true,
      100,
    ),
  ).toEqual({ status: "unavailable", reason: "SOLANA_ORACLE_MARKET_CLOSED" });
});
