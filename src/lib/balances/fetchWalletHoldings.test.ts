/**
 * @id PP-BALANCES (POO-815)
 * @name fetchWalletHoldings tests
 * @implements-rules-version v1
 * Server-side multi-network wallet-holdings read: per-network fan-out + merge, unpriced rows
 * dropped, a per-network failure tolerated, an all-networks failure surfaced (so the caller falls
 * back to the USDC-only read).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

async function importFetch() {
  vi.resetModules();
  return import("./fetchWalletHoldings");
}

/** A backend holding row with sensible defaults. */
function row(over: Record<string, unknown> = {}) {
  return {
    address: "0xtoken",
    name: "Token",
    symbol: "TKN",
    logo: "l",
    decimals: 18,
    balance: 1,
    formattedBalance: "1",
    priceUSD: 1,
    formattedBalanceInUSD: "1",
    isNative: false,
    ...over,
  };
}

/** Resolve apiFetch per network by the `?network=` slug in the path. */
function byNetwork(map: Record<string, unknown>) {
  return (path: string) => {
    const slug = /network=([a-z]+)/.exec(path)?.[1] ?? "";
    const data = map[slug];
    if (data instanceof Error) return Promise.reject(data);
    return Promise.resolve(data ?? { tokensBalance: [] });
  };
}

describe("fetchWalletHoldings", () => {
  beforeEach(() => apiFetch.mockReset());

  it("returns [] without any call when no address is given", async () => {
    const { fetchWalletHoldings } = await importFetch();
    expect(await fetchWalletHoldings("")).toEqual([]);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("fans out over every network and merges the holdings", async () => {
    apiFetch.mockImplementation(
      byNetwork({
        arbitrum: { tokensBalance: [row({ symbol: "USDC", formattedBalanceInUSD: "340.5" })] },
        base: {
          tokensBalance: [row({ symbol: "ETH", isNative: true, formattedBalanceInUSD: "50" })],
        },
        polygon: { tokensBalance: [row({ symbol: "DAI", formattedBalanceInUSD: "30" })] },
      }),
    );
    const { fetchWalletHoldings } = await importFetch();
    const balances = await fetchWalletHoldings("0xwallet");
    expect(apiFetch).toHaveBeenCalledTimes(3);
    expect(balances.map((b) => b.symbol).sort()).toEqual(["DAI", "ETH", "USDC"]);
    // The USD value comes from formattedBalanceInUSD.
    expect(balances.find((b) => b.symbol === "USDC")?.usd).toBe(340.5);
    // Native ETH lands on Base (chain 8453).
    expect(balances.find((b) => b.symbol === "ETH")?.chainId).toBe(8453);
  });

  it("drops unpriced rows (null priceUSD)", async () => {
    apiFetch.mockImplementation(
      byNetwork({
        base: {
          tokensBalance: [
            row({ symbol: "USDC", formattedBalanceInUSD: "100" }),
            row({ symbol: "SCAM", priceUSD: null, formattedBalanceInUSD: "NaN" }),
          ],
        },
      }),
    );
    const { fetchWalletHoldings } = await importFetch();
    const balances = await fetchWalletHoldings("0xwallet");
    expect(balances.map((b) => b.symbol)).toEqual(["USDC"]);
  });

  it("skips a network whose read fails instead of hiding funds held elsewhere", async () => {
    apiFetch.mockImplementation(
      byNetwork({
        arbitrum: new Error("rpc down"),
        base: { tokensBalance: [row({ symbol: "USDC", formattedBalanceInUSD: "100" })] },
        polygon: { tokensBalance: [] },
      }),
    );
    const { fetchWalletHoldings } = await importFetch();
    const balances = await fetchWalletHoldings("0xwallet");
    expect(balances.map((b) => b.symbol)).toEqual(["USDC"]);
  });

  it("throws when every network read fails (so the caller can fall back)", async () => {
    apiFetch.mockImplementation(
      byNetwork({
        arbitrum: new Error("endpoint not enabled"),
        base: new Error("endpoint not enabled"),
        polygon: new Error("endpoint not enabled"),
      }),
    );
    const { fetchWalletHoldings } = await importFetch();
    await expect(fetchWalletHoldings("0xwallet")).rejects.toThrow("endpoint not enabled");
  });
});
