/**
 * @id PP-WALLET (POO-198)
 * @name getDepositAddress
 * @implements-rules-version v1
 *
 * Returns the connected wallet's checksummed EVM address for crypto deposits.
 * Throws a typed error when no wallet is connected.
 */
import { getAddress } from "viem";

/** Typed error for when no wallet is connected. */
export class NoWalletError extends Error {
  constructor() {
    super("No wallet connected");
    this.name = "NoWalletError";
  }
}

/**
 * Return the checksummed deposit address for the connected wallet.
 *
 * @param address - The raw address from wagmi's useAccount.
 * @returns The EIP-55 checksummed `0x...` address.
 * @throws {NoWalletError} When no wallet is connected.
 */
export function getDepositAddress(address: `0x${string}` | undefined): string {
  if (!address) {
    throw new NoWalletError();
  }
  return getAddress(address);
}
