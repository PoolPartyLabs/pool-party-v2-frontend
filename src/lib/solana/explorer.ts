/**
 * Solscan links for Solana mainnet signatures and accounts (the EVM twin is `src/lib/chain/explorer.ts`).
 * Inputs are validated, so a malformed value yields no link rather than a crafted URL.
 */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function solscanTxUrl(signature: string): string | null {
  return BASE58.test(signature) && signature.length >= 64 && signature.length <= 88
    ? `https://solscan.io/tx/${signature}`
    : null;
}
export function solscanAccountUrl(account: string): string | null {
  return BASE58.test(account) && account.length >= 32 && account.length <= 44
    ? `https://solscan.io/account/${account}`
    : null;
}
