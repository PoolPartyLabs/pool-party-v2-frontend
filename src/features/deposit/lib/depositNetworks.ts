/**
 * @id PP-DEP-LIB-002 (POO-479, POO-728, POO-1916)
 * @name deposit networks
 * @implements-rules-version v3 (POO-1916 rules v1) · v2
 *
 * The networks a user can pick when depositing USDC by crypto transfer (POO-479). The USDC deposit
 * address is the connected wallet and is IDENTICAL across these EVM networks; the choice only drives
 * the "send on this network" instruction + the loss-of-funds warning. Ethereum is offered per product
 * even though it is not one of the app's operating chains.
 *
 * This list is a PRODUCT choice, not a mirror of `supportedChainMetas`, and it is asserted in that
 * direction: POO-1776 [R4] keeps Robinhood Chain OUT (no on-ramp in the alpha) even though it is a
 * fully supported operating chain, so a later "the parity test says add every chain" cannot add it.
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

/**
 * POO-1174 [R5] (rules v2): the chain id `deposit_address_copied` reports for the network the user
 * PICKED. Deposit-local on purpose: the app-wide `networkToChainId` is built from the three
 * operating chains, so an Ethereum pick resolved to `undefined` and the
 * event silently emitted no `chain_id` at all. A `Record` over the slug union covers every
 * offerable network by construction, so adding a slug without its chain id fails to compile.
 */
export const DEPOSIT_CHAIN_IDS: Record<DepositNetworkSlug, number> = {
  ethereum: 1,
  arbitrum: 42161,
  base: 8453,
  polygon: 137,
};

/**
 * Does the crypto-deposit surface serve `chainId`? (POO-1916 [R4].)
 *
 * Asked by the provisioning route picker (`resolveFundingRoutes`), which offers a `deposit` ghost
 * link beside the buy card. Until POO-1916 the two shared ONE gate: `deposit` rode along with
 * whether a fiat purchase could reach the target chain, which happened to suppress both on Robinhood
 * Chain and was recorded as "deposit has always been a peer of the buy card". That reasoning is
 * incidental. The real reason is here: {@link DEPOSIT_NETWORKS} excludes 4663 per POO-1776 [R4], so
 * the link would send a user to a surface that cannot name their chain, and it stays excluded now
 * that the purchase itself is offered again.
 *
 * Derived from the list rather than restated beside it, so adding a network to the picker offers the
 * link in the same commit, and an id nobody ships degrades closed.
 */
export function depositServesChain(chainId: number): boolean {
  return DEPOSIT_NETWORKS.some((network) => DEPOSIT_CHAIN_IDS[network.slug] === chainId);
}

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
