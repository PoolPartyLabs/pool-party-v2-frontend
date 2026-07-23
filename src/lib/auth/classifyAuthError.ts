/**
 * @id PP-AUTH (POO-199)
 * @name classifyAuthError
 * @implements-rules-version v1
 *
 * Maps Privy PrivyErrorCode strings to a coarse AuthErrorCategory so that
 * consumers (SignInScreen, ConnectWalletScreen) can show category-specific
 * translated messages instead of a generic "something went wrong".
 */

/** Coarse error bucket rendered by auth screens. */
export type AuthErrorCategory = "cancelled" | "network" | "unsupported-chain";

/** Privy codes that mean "the user deliberately closed the popup / denied OAuth". */
const CANCELLED_CODES = new Set(["exited_auth_flow", "oauth_user_denied"]);

/** Privy codes that mean "wrong chain". */
const UNSUPPORTED_CHAIN_CODES = new Set(["unsupported_chain_id"]);

/**
 * Classify a Privy error code into a coarse category.
 *
 * @param code - The `PrivyErrorCode` string from the `onError` callback.
 * @returns The error category. Unrecognized codes default to `"network"`.
 */
export function classifyAuthError(code: string | undefined): AuthErrorCategory {
  if (code && CANCELLED_CODES.has(code)) return "cancelled";
  if (code && UNSUPPORTED_CHAIN_CODES.has(code)) return "unsupported-chain";
  return "network";
}
