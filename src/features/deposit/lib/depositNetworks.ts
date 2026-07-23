/**
 * @id PP-DEP-LIB-002 (POO-479, POO-728)
 * @name deposit networks
 * @implements-rules-version v2
 *
 * The networks a user can pick when depositing USDC by crypto transfer (POO-479). The USDC deposit
 * address is the connected wallet and is IDENTICAL across these EVM networks; the choice only drives
 * the "send on this network" instruction + the loss-of-funds warning. Ethereum is offered per product
 * even though the app's operating chains today are Arbitrum/Base/Polygon.
 *
 * POO-728: the picker now opens with a DEFAULT network pre-selected ({@link DEFAULT_DEPOSIT_NETWORK})
 * so Continue is enabled on open. The default is Arbitrum — one of the app's real operating chains —
 * rather than Ethereum, so the default never nudges a user toward a chain we do not run on.
 *
 * PP-INTEGRATION-POINT: which of these networks the backend actually monitors for crypto-deposit
 * auto-detection is a backend contract (real wiring, POO-484); the picker is UI-only today.
 */

/** The slug of a deposit network (matches NetworkLogo + api slugs where they exist). */
export type DepositNetworkSlug = "ethereum" | "arbitrum" | "base" | "polygon";

/** A network the user can say they will send the USDC deposit on. */
export interface DepositNetwork {
  /** Network slug (matches NetworkLogo + api slugs where they exist). */
  slug: DepositNetworkSlug;
  /** Display name (proper noun; not translated). */
  name: string;
}

/** The deposit networks offered in the crypto-deposit network picker (POO-479). */
export const DEPOSIT_NETWORKS: readonly DepositNetwork[] = [
  { slug: "ethereum", name: "Ethereum" },
  { slug: "arbitrum", name: "Arbitrum" },
  { slug: "base", name: "Base" },
  { slug: "polygon", name: "Polygon" },
] as const;

/** The slug of the network pre-selected when the crypto-deposit picker opens (POO-728). */
const DEFAULT_DEPOSIT_NETWORK_SLUG: DepositNetworkSlug = "arbitrum";

/**
 * The network pre-selected when the crypto-deposit picker opens (POO-728): Arbitrum, one of the
 * app's real operating chains, so Continue is enabled on open and the loss-of-funds warning names a
 * chain we actually run on (rather than nudging users toward Ethereum, which the app does not run).
 */
export const DEFAULT_DEPOSIT_NETWORK: DepositNetwork = (() => {
  const found = DEPOSIT_NETWORKS.find((network) => network.slug === DEFAULT_DEPOSIT_NETWORK_SLUG);
  if (!found) {
    throw new Error(`DEPOSIT_NETWORKS must include the default "${DEFAULT_DEPOSIT_NETWORK_SLUG}".`);
  }
  return found;
})();
