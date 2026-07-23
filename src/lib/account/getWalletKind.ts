/**
 * @id PP-ACCOUNT (POO-197)
 * @name getWalletKind
 * @implements-rules-version v1
 *
 * Determines whether the connected wallet is a Privy embedded wallet or an external wallet
 * (MetaMask, Rabby, etc.) by inspecting the Privy user's linked accounts.
 */
import type { ConnectedWallet } from "@privy-io/react-auth";

export type WalletKind = "embedded" | "external";

/**
 * Inspect the Privy wallets array to determine the wallet kind.
 *
 * A wallet with `walletClientType === 'privy'` is an embedded wallet created by Privy on
 * Google sign-in. Everything else is external.
 *
 * @param wallets - The wallets array from Privy's `useWallets()` hook.
 * @param activeAddress - The currently connected address (from wagmi `useAccount`).
 * @returns `'embedded'` if the active wallet is Privy-managed, `'external'` otherwise.
 */
export function getWalletKind(
  wallets: readonly ConnectedWallet[],
  activeAddress: string | undefined,
): WalletKind {
  if (!activeAddress || wallets.length === 0) {
    return "external";
  }

  const activeWallet = wallets.find((w) => w.address.toLowerCase() === activeAddress.toLowerCase());

  return activeWallet?.walletClientType === "privy" ? "embedded" : "external";
}
