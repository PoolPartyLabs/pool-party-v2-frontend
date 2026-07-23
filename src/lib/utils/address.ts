/**
 * @id PP-CORE-LIB-015 (POO-410)
 * @name address
 *
 * Display helpers for 0x wallet addresses. `maskAddress` matches the wallet chip / wallet-menu format
 * (`0x1234…cdef`, first 6 + last 4) so a truncated address reads the same everywhere it stands in for
 * a name (e.g. the manager greeting when no display name is set).
 */
import { getAddress, isAddress } from "viem";

/** Mask a 0x address to `0x1234…cdef` (first 6 + last 4). Returns the input unchanged when too short. */
export function maskAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Mask a wallet to the profile display-name DEFAULT format `0x1A2b...5678` (first 6 + last 4, EIP-55
 * checksummed, three ASCII dots). Mirrors pool-party-api `maskWalletAddress` (POO-232 [R2]) EXACTLY so
 * the client-side greeting fallback for a cleared displayName (POO-704 [R2][R5]) reads IDENTICALLY to
 * the server-defaulted name. Distinct from `maskAddress` (the `0x1234…cdef` ellipsis form used by the
 * wallet chips). A non-address (should never reach here) is masked as-is rather than throwing.
 */
export function maskWalletName(address: string): string {
  const normalized = isAddress(address) ? getAddress(address) : address;
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

/** `0x` followed by exactly 40 hex characters (case-insensitive). */
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Whether a string is a syntactically valid EVM address (`0x` + 40 hex). Used to tell a manager
 * handle apart from a wallet address on the shared `/m/<param>` route (POO-618). Not a checksum check.
 */
export function isEvmAddress(value: string): boolean {
  return EVM_ADDRESS_RE.test(value);
}
