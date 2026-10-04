/**
 * @id PP-STR-LIB-031 (POO-2179)
 * @name chainExplorer
 * @implements-rules-version v1
 * Validated explorer links shared by fund actions and launch journeys.
 */
const bases = {
  42161: "https://arbiscan.io",
  4663: "https://robinhoodchain.blockscout.com",
} as const;
export function explorerTxUrl(chainId: number, hash: string): string | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash) || !(chainId in bases)) return null;
  return `${bases[chainId as keyof typeof bases]}/tx/${hash}`;
}
export function explorerAddressUrl(chainId: number, address: string): string | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !(chainId in bases)) return null;
  return `${bases[chainId as keyof typeof bases]}/address/${address}`;
}
