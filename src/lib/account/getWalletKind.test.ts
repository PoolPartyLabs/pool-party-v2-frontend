/**
 * @id PP-ACCOUNT (POO-197)
 * @name getWalletKind tests
 * @implements-rules-version v1
 *
 * Tests for wallet kind detection (embedded vs external).
 */
import type { ConnectedWallet } from "@privy-io/react-auth";
import { describe, expect, it } from "vitest";
import { getWalletKind } from "./getWalletKind";

/** Helper to build a minimal ConnectedWallet stub. */
function wallet(address: string, walletClientType: string): ConnectedWallet {
  return { address, walletClientType } as unknown as ConnectedWallet;
}

describe("getWalletKind", () => {
  // [AC-3] returns 'embedded' for a walletClientType:'privy' wallet
  it("returns 'embedded' when the active wallet is a Privy embedded wallet", () => {
    const wallets = [wallet("0xABC", "privy")];
    expect(getWalletKind(wallets, "0xABC")).toBe("embedded");
  });

  // [AC-3] returns 'external' for non-privy wallets
  it("returns 'external' for a MetaMask wallet", () => {
    const wallets = [wallet("0xDEF", "metamask")];
    expect(getWalletKind(wallets, "0xDEF")).toBe("external");
  });

  it("returns 'external' for a WalletConnect wallet", () => {
    const wallets = [wallet("0x123", "walletconnect")];
    expect(getWalletKind(wallets, "0x123")).toBe("external");
  });

  it("matches address case-insensitively", () => {
    const wallets = [wallet("0xAbC", "privy")];
    expect(getWalletKind(wallets, "0xabc")).toBe("embedded");
  });

  it("returns 'external' when no wallets are connected", () => {
    expect(getWalletKind([], "0xABC")).toBe("external");
  });

  it("returns 'external' when activeAddress is undefined", () => {
    const wallets = [wallet("0xABC", "privy")];
    expect(getWalletKind(wallets, undefined)).toBe("external");
  });

  it("returns 'external' when active address is not in the wallets array", () => {
    const wallets = [wallet("0xABC", "privy")];
    expect(getWalletKind(wallets, "0x999")).toBe("external");
  });

  it("picks the correct wallet when multiple are connected", () => {
    const wallets = [wallet("0xABC", "privy"), wallet("0xDEF", "metamask")];
    expect(getWalletKind(wallets, "0xABC")).toBe("embedded");
    expect(getWalletKind(wallets, "0xDEF")).toBe("external");
  });
});
