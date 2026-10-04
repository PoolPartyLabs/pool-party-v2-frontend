/**
 * @id PP-E2E-V2-003
 * @name launch chain switching regressions R1-R5
 * @implements-rules-version v1
 */
import type { Page } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { CHAINS, ROBINHOOD_USDG, rpcUrl } from "../e2e/config";
import { installMockWallet } from "../e2e/wallet/mockWallet";

describe("R1-R5 independent launch wallet chain support", () => {
  it("defines authoritative Robinhood mainnet and USDG without application imports", () => {
    expect(CHAINS.robinhood.id).toBe(4663);
    expect(CHAINS.robinhood.rpcUrls.default.http[0]).toBe(
      "https://rpc.mainnet.chain.robinhood.com",
    );
    expect(ROBINHOOD_USDG).toBe("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
    vi.stubEnv("E2E_ROBINHOOD_RPC_URL", "");
    expect(rpcUrl("robinhood")).toBe("https://rpc.mainnet.chain.robinhood.com");
    vi.unstubAllEnvs();
  });
  it("switches the Node wallet to Robinhood and back without signing or network requests", async () => {
    const exposeFunction = vi.fn();
    const page = { exposeFunction, addInitScript: vi.fn() } as unknown as Page;
    const wallet = await installMockWallet(page, {
      privateKey: `0x${"1".repeat(64)}`,
      chainKey: "arbitrum",
    });
    const bridge = exposeFunction.mock.calls[0]?.[1] as (request: {
      method: string;
      params?: unknown[];
    }) => Promise<unknown>;
    await bridge({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1237" }] });
    expect(wallet.currentChain()).toBe("robinhood");
    expect(await bridge({ method: "eth_chainId" })).toBe("0x1237");
    expect(await bridge({ method: "net_version" })).toBe("4663");
    await bridge({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xa4b1" }] });
    expect(wallet.currentChain()).toBe("arbitrum");
    await expect(
      bridge({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] }),
    ).rejects.toMatchObject({ code: 4902 });
  });
});
