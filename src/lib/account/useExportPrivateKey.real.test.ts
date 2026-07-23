/**
 * @id PP-ACCOUNT (POO-544)
 * @name useExportPrivateKey — real-mode tests
 * @implements-rules-version v2
 *
 * Real mode (isMockMode false): the hook exports the EMBEDDED wallet's key via Privy's exportWallet()
 * (cross-origin iframe, resolves void). POO-544 R1/R4:
 *  - exportReal calls Privy exportWallet with the embedded wallet's own address (not the active/first).
 *  - no embedded wallet -> exportReal throws, Privy is never called, and canExport is false.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeWallet = { address: string; walletClientType: string };

const { exportWallet, walletsRef } = vi.hoisted(() => ({
  exportWallet: vi.fn(async () => {}),
  walletsRef: { current: [] as FakeWallet[] },
}));

vi.mock("@/lib/services", () => ({ isMockMode: false }));

vi.mock("@privy-io/react-auth", () => ({
  useExportWallet: () => ({ exportWallet }),
  useWallets: () => ({ wallets: walletsRef.current }),
  // Mirror Privy's real helper: return the first Privy-managed (embedded) wallet, or null.
  getEmbeddedConnectedWallet: (wallets: FakeWallet[]) =>
    wallets.find((w) => w.walletClientType === "privy") ?? null,
}));

const { useExportPrivateKey } = await import("./useExportPrivateKey");

describe("useExportPrivateKey (real mode)", () => {
  beforeEach(() => {
    exportWallet.mockReset();
    exportWallet.mockResolvedValue(undefined);
    walletsRef.current = [];
  });

  it("exports the embedded wallet's own address, not the active/first wallet", async () => {
    walletsRef.current = [
      { address: "0xEXTERNAL", walletClientType: "metamask" },
      { address: "0xEMBEDDED", walletClientType: "privy" },
    ];
    const { result } = renderHook(() => useExportPrivateKey());
    expect(result.current.isMock).toBe(false);
    if (result.current.isMock) throw new Error("expected real branch");
    expect(result.current.canExport).toBe(true);

    await result.current.exportReal();
    expect(exportWallet).toHaveBeenCalledTimes(1);
    expect(exportWallet).toHaveBeenCalledWith({ address: "0xEMBEDDED" });
  });

  it("reports canExport=false, throws, and never calls Privy when there is no embedded wallet", async () => {
    walletsRef.current = [{ address: "0xEXTERNAL", walletClientType: "metamask" }];
    const { result } = renderHook(() => useExportPrivateKey());
    if (result.current.isMock) throw new Error("expected real branch");
    expect(result.current.canExport).toBe(false);

    await expect(result.current.exportReal()).rejects.toThrow("no-embedded-wallet");
    expect(exportWallet).not.toHaveBeenCalled();
  });
});
