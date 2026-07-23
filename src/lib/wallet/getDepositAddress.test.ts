/**
 * @id PP-WALLET (POO-198)
 * @name getDepositAddress tests
 * @implements-rules-version v1
 */
import { describe, expect, it } from "vitest";
import { getDepositAddress, NoWalletError } from "./getDepositAddress";

describe("getDepositAddress", () => {
  // [AC-1] returns the connected wallet's checksummed 0x address
  it("returns a checksummed EVM address", () => {
    const raw = "0xaf88d065e77c8cc2239327c5edb3a432268e5831" as `0x${string}`;
    const result = getDepositAddress(raw);

    // EIP-55 checksummed
    expect(result).toBe("0xaf88d065e77c8cC2239327C5EDb3A432268e5831");
    expect(result).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("preserves an already-checksummed address", () => {
    const checksummed = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as `0x${string}`;
    expect(getDepositAddress(checksummed)).toBe(checksummed);
  });

  // [AC-2] throws when no wallet is connected
  it("throws NoWalletError when address is undefined", () => {
    expect(() => getDepositAddress(undefined)).toThrow(NoWalletError);
    expect(() => getDepositAddress(undefined)).toThrow("No wallet connected");
  });
});
