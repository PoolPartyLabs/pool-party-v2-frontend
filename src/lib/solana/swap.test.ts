import { expect, it } from "vitest";
import { SOLANA_LP_CHOICES } from "./lpChoices";
import {
  resolveMaxPriceImpactBps,
  SOLANA_PRICE_IMPACT_CONFIG,
  type SolanaApiSignedQuote,
  validateSolanaApiQuote,
} from "./swap";

const pool = SOLANA_LP_CHOICES[0];
if (!pool) throw new Error("FIXTURE_MISSING");
const request = {
  poolId: pool.poolId,
  fund: "0x1111111111111111111111111111111111111111",
  solanaAddress: "manager-key",
  maxPriceImpactBps: 100,
};
const quote: SolanaApiSignedQuote = {
  version: 1,
  ...request,
  tokenIn: pool.tokens[1].mint,
  tokenOut: pool.tokens[0].mint,
  amountIn: "1000000",
  minAmountOut: "99",
  referenceAmountOut: "100",
  priceImpactBps: 100,
  expiresAt: 2000000000,
  signedPayload: "0x01",
  signature: "0x02",
};
it("uses configured defaults and accepts only bounded integer bps", () => {
  expect(resolveMaxPriceImpactBps()).toBe(SOLANA_PRICE_IMPACT_CONFIG.defaultBps);
  expect(resolveMaxPriceImpactBps(1)).toBe(1);
  expect(resolveMaxPriceImpactBps(500)).toBe(500);
});
it.each([0, -1, 501, 10000, 1.5, NaN, Infinity])("rejects unsafe impact %s", (value) => {
  expect(() => resolveMaxPriceImpactBps(value)).toThrow("SOLANA_PRICE_IMPACT_INVALID");
});
it("consumes the API quote at the Manager's maximum without accepting a Manager quote", () => {
  expect(validateSolanaApiQuote(quote, request, 1999999999)).toEqual(quote);
  expect(Object.isFrozen(validateSolanaApiQuote(quote, request, 1999999999))).toBe(true);
});
it.each([
  { signature: "" },
  { signedPayload: "" },
  { poolId: SOLANA_LP_CHOICES[1]?.poolId },
  { fund: "0x2222222222222222222222222222222222222222" },
  { solanaAddress: "other" },
  { priceImpactBps: 101 },
  { maxPriceImpactBps: 101 },
  { expiresAt: 1999999999 },
  { amountIn: "0" },
  { minAmountOut: "1.5" },
  { tokenOut: "unknown" },
  { tokenOut: quote.tokenIn },
  { extraManagerQuote: "9999" },
])("rejects malformed, mismatched, expired or over-impact API quotes %j", (change) => {
  expect(() => validateSolanaApiQuote({ ...quote, ...change }, request, 1999999999)).toThrow(
    "SOLANA_API_QUOTE_INVALID",
  );
});
