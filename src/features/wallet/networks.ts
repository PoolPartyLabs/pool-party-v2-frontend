/**
 * @id PP-BALANCES (POO-238)
 * @name networks (wallet presentation)
 * @implements-rules-version v1
 * Presentation metadata (display name + brand color) for the supported networks shown in the
 * wallet modal's filter chips and token badges. The canonical chain LIST and ids are owned by
 * src/lib/chains/config.ts (POO-195 / INT-W3); this only adds display identity.
 *
 * PP-NOTE: the hex values are network BRAND colors (identity, like a logo), not theme tokens, so
 * they are intentionally NOT design-system variables. Keep these ids in sync with supportedChains.
 */

/** Display metadata for one network. */
export interface NetworkMeta {
  /** Chain id (matches supportedChains). */
  id: number;
  /** Short display name shown in chips and token subtitles. */
  name: string;
  /** NetworkLogo slug (matches NETWORK_VISUALS keys in PP-CORE-CMP-041). */
  slug: string;
  /** Brand color (identity, not a theme token). */
  color: string;
}

/** Supported networks, in display order. Keep in sync with supportedChains (POO-195). */
export const NETWORKS: readonly NetworkMeta[] = [
  { id: 42161, name: "Arbitrum", slug: "arbitrum", color: "#28a0f0" },
  { id: 8453, name: "Base", slug: "base", color: "#0052ff" },
  { id: 137, name: "Polygon", slug: "polygon", color: "#8247e5" },
] as const;

/** Display name for a chain id (falls back to a neutral label). */
export function networkName(chainId: number): string {
  return NETWORKS.find((network) => network.id === chainId)?.name ?? "Network";
}

/** NetworkLogo slug for a chain id (falls back to an empty slug → monogram). */
export function networkSlug(chainId: number): string {
  return NETWORKS.find((network) => network.id === chainId)?.slug ?? "";
}

/** Brand color for a chain id (falls back to a muted grey). */
export function networkColor(chainId: number): string {
  return NETWORKS.find((network) => network.id === chainId)?.color ?? "#737373";
}
