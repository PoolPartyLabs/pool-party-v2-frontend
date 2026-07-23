/**
 * @id PP-MGR (POO-306)
 * @name Manager contracts
 * @implements-rules-version v1
 *
 * Per-network PoolPartyManager contract address (the Permit2 batch spender + create-pool target),
 * read from env like the interface. Public addresses → NEXT_PUBLIC_*. Returns null until configured,
 * so create-pool is dormant (not broken) without the deployment env.
 *
 * PP-INTEGRATION-POINT: PoolPartyManager addresses ← NEXT_PUBLIC_{CHAIN}_POOL_PARTY_MANAGER_WRITE_CONTRACT.
 */

// Literal accesses so Next.js inlines each NEXT_PUBLIC_* value at build time.
const RAW: Record<string, string | undefined> = {
  arbitrum: process.env.NEXT_PUBLIC_ARBITRUM_POOL_PARTY_MANAGER_WRITE_CONTRACT,
  base: process.env.NEXT_PUBLIC_BASE_POOL_PARTY_MANAGER_WRITE_CONTRACT,
  polygon: process.env.NEXT_PUBLIC_POLYGON_POOL_PARTY_MANAGER_WRITE_CONTRACT,
};

/** The PoolPartyManager contract for a network, or null when not configured. */
export function poolPartyManagerAddress(network: string): `0x${string}` | null {
  const address = RAW[network];
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return null;
  return address as `0x${string}`;
}
