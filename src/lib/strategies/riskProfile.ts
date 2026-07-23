/**
 * @id PP-STR (POO-298)
 * @name risk profile classifier
 * @implements-rules-version v1
 *
 * Classifies a pool by its token pair into a risk profile, mirroring the backend
 * classifier so the FE risk band matches what the API would filter on.
 *
 * CANONICAL SOURCE: pool-party-api/src/pools/risk-profile.config.ts. The token lists
 * are duplicated here only because `GET /pools` does not return the computed profile.
 *
 * PP-INTEGRATION-POINT: have pool-party-api return `riskProfile` per pool so the FE can
 * drop these lists and read the field directly (avoids drift as new tokens are added).
 *
 * Risk band mapping (confirmed with Rafael, 2026-06-12): steady → 1, dynamic → 3, wild → 5.
 */

/** Both currencies in this list ⇒ "steady" (low-volatility stablecoins). */
export const STEADY_TOKENS = [
  "USDC",
  "USDT",
  "DAI",
  "FRAX",
  "LUSD",
  "USDS",
  "PYUSD",
  "EURC",
  "BUSD",
  "GUSD",
  "USDP",
  "TUSD",
  "SUSD",
  "BRZ",
  "BRLA",
  "USD+",
];

/** Major tokens with moderate volatility — at least one ⇒ "dynamic" (when both are known). */
export const DYNAMIC_TOKENS = ["ETH", "WETH", "WBTC", "BTC"];

/** A pool's risk profile. */
export type RiskProfile = "steady" | "dynamic" | "wild";

/** The FE risk band (1–5) for each profile. */
export const RISK_PROFILE_LEVEL: Record<RiskProfile, 1 | 3 | 5> = {
  steady: 1,
  dynamic: 3,
  wild: 5,
};

/**
 * Classify a pool by its two token symbols (case-insensitive).
 * - Both stablecoins → "steady".
 * - Both known and at least one major → "dynamic".
 * - Anything with an unknown token → "wild".
 */
export function getRiskProfile(currency0Symbol: string, currency1Symbol: string): RiskProfile {
  const sym0 = currency0Symbol.toUpperCase();
  const sym1 = currency1Symbol.toUpperCase();

  const isKnown = (s: string) => STEADY_TOKENS.includes(s) || DYNAMIC_TOKENS.includes(s);

  const isSteady0 = STEADY_TOKENS.includes(sym0);
  const isSteady1 = STEADY_TOKENS.includes(sym1);
  const isDynamic0 = DYNAMIC_TOKENS.includes(sym0);
  const isDynamic1 = DYNAMIC_TOKENS.includes(sym1);

  if (isSteady0 && isSteady1) return "steady";
  if (isKnown(sym0) && isKnown(sym1) && (isDynamic0 || isDynamic1)) return "dynamic";
  return "wild";
}

/** The FE risk band (1–5) for a token pair. */
export function getRiskLevel(currency0Symbol: string, currency1Symbol: string): 1 | 3 | 5 {
  return RISK_PROFILE_LEVEL[getRiskProfile(currency0Symbol, currency1Symbol)];
}
