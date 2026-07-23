/**
 * @id PP-ACCOUNT (POO-544)
 * @name useExportPrivateKey — mock-mode tests
 * @implements-rules-version v2
 *
 * Mock mode (isMockMode true, the default): the hook returns a throwaway 0xMOCK... generator and never
 * touches any Privy hook (so it works with PrivyProvider unmounted). POO-544 R3.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services", () => ({ isMockMode: true }));

// The mock branch returns before these are called, but the module imports them at the top level.
vi.mock("@privy-io/react-auth", () => ({
  useExportWallet: () => ({ exportWallet: vi.fn() }),
  useWallets: () => ({ wallets: [] }),
  getEmbeddedConnectedWallet: () => null,
}));

const { useExportPrivateKey } = await import("./useExportPrivateKey");

describe("useExportPrivateKey (mock mode)", () => {
  it("returns the mock branch with a 0xMOCK generator", () => {
    const { result } = renderHook(() => useExportPrivateKey());
    expect(result.current.isMock).toBe(true);
    if (!result.current.isMock) throw new Error("expected mock branch");
    expect(result.current.revealMockKey()).toMatch(/^0xMOCK[0-9a-f]{60}$/);
  });

  it("generates a fresh throwaway value per call (never a literal)", () => {
    const { result } = renderHook(() => useExportPrivateKey());
    if (!result.current.isMock) throw new Error("expected mock branch");
    const a = result.current.revealMockKey();
    const b = result.current.revealMockKey();
    expect(a).not.toEqual(b);
  });
});
