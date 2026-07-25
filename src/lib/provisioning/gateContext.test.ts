/**
 * @id PP-CORE-LIB-057 (POO-1042)
 * @name provisioning gate context, tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The server-side assembly that turns a wallet into everything the pre-flight gate needs:
 * per-chain balances [R1], a gas verdict for EVERY candidate chain [R9], and a REAL gas estimate
 * [R4]. The whole point of the file is the fail-safe posture [R6]: a degraded read must resolve to
 * "no context" (and therefore no gate) rather than to a wallet that looks empty.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenBalance } from "@/lib/balances/types";

const fetchWalletHoldings = vi.fn<(address: string) => Promise<TokenBalance[]>>();
const getFundingInventory = vi.fn();
const quoteSwap = vi.fn();

vi.mock("@/lib/balances/fetchWalletHoldings", () => ({
  fetchWalletHoldings: (address: string) => fetchWalletHoldings(address),
}));
vi.mock("@/lib/balances/fundingInventory", () => ({
  getFundingInventory: (...args: unknown[]) => getFundingInventory(...args),
}));
vi.mock("@/lib/uniswap/actions", () => ({
  quoteSwap: (...args: unknown[]) => quoteSwap(...args),
}));

const { buildProvisioningGateContext } = await import("./gateContext");

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const BASE = 8453;
const ARBITRUM = 42161;
const POLYGON = 137;

/** A backend holdings row, priced. */
function holding(
  over: Partial<TokenBalance> & Pick<TokenBalance, "chainId" | "usd">,
): TokenBalance {
  return {
    symbol: "USDC",
    name: "USD Coin",
    amount: over.usd,
    decimals: 6,
    logoUrl: "",
    address: "0x2222222222222222222222222222222222222222",
    isNative: false,
    ...over,
  };
}

/** A funding source as the inventory returns it. */
function source(chainId: number, over: Record<string, unknown> = {}) {
  return {
    address: "0x2222222222222222222222222222222222222222",
    chainId,
    symbol: "USDC",
    decimals: 6,
    amount: "1000000000",
    usd: 1_000,
    reachableChainIds: [BASE, ARBITRUM, POLYGON],
    isNative: false,
    logoUrl: "",
    ...over,
  };
}

/** A `/quote` response carrying a live gas figure. */
function quoteWithGas(gasFeeUSD: string) {
  return { ok: true, quote: { routing: "CLASSIC", quote: { gasFeeUSD } } };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchWalletHoldings.mockResolvedValue([]);
  getFundingInventory.mockResolvedValue([]);
  quoteSwap.mockResolvedValue(quoteWithGas("0.02"));
});

describe("buildProvisioningGateContext", () => {
  it("[R1] splits the live holdings into per-chain native and token USD", async () => {
    fetchWalletHoldings.mockResolvedValue([
      holding({ chainId: BASE, usd: 1_200 }),
      holding({ chainId: BASE, usd: 3, symbol: "ETH", isNative: true, address: "0x0" }),
      holding({ chainId: POLYGON, usd: 40, symbol: "WETH" }),
    ]);

    const context = await buildProvisioningGateContext(WALLET, BASE);

    expect(context?.balancesByChain[BASE]).toEqual({ nativeUsd: 3, tokenUsd: 1_200 });
    expect(context?.balancesByChain[POLYGON]).toEqual({ nativeUsd: 0, tokenUsd: 40 });
  });

  it("[R1] counts a sub-dollar native balance the funding inventory would have filtered as dust", async () => {
    // The inventory drops sub-$1 rows because they cannot be SPENT. Gas is measured in cents, so a
    // $0.40 native balance is the difference between "you can transact" and a gate that fires on a
    // funded wallet. The balances must come from the raw holdings, never from the filtered list.
    fetchWalletHoldings.mockResolvedValue([
      holding({ chainId: BASE, usd: 0.4, symbol: "ETH", isNative: true, address: "0x0" }),
    ]);

    const context = await buildProvisioningGateContext(WALLET, BASE);

    expect(context?.balancesByChain[BASE]?.nativeUsd).toBeCloseTo(0.4, 6);
  });

  it("[R9] returns a gas verdict for every source chain AND the operation's chain", async () => {
    fetchWalletHoldings.mockResolvedValue([holding({ chainId: POLYGON, usd: 500 })]);
    getFundingInventory.mockResolvedValue([source(POLYGON)]);

    const context = await buildProvisioningGateContext(WALLET, ARBITRUM);

    expect(
      Object.keys(context?.gasByChain ?? {})
        .map(Number)
        .sort(),
    ).toEqual([ARBITRUM, POLYGON]);
  });

  it("[R4] takes the gas estimate from a live quote, never the hardcoded 0.5", async () => {
    fetchWalletHoldings.mockResolvedValue([
      holding({ chainId: BASE, usd: 9, symbol: "ETH", isNative: true, address: "0x0" }),
    ]);
    quoteSwap.mockResolvedValue(quoteWithGas("0.04"));

    const context = await buildProvisioningGateContext(WALLET, BASE);

    // Quoted 0.04, plus the classifier's headroom. The only thing under test is that it is derived
    // from the quote: never 0.5, and it moves when the quote moves.
    expect(context?.gasEstimateUsd).toBeGreaterThan(0.04);
    expect(context?.gasEstimateUsd).toBeLessThan(0.2);
    expect(context?.gasEstimateUsd).not.toBe(0.5);
    expect(context?.gasByChain[BASE]?.quotedGasUsd).toBeCloseTo(0.04, 6);
  });

  it("[R4] a gas quote that fails degrades to the classifier's floor, not to an invented figure", async () => {
    quoteSwap.mockResolvedValue({ ok: false, code: "SYSTEM_INTERNAL", message: "down" });

    const context = await buildProvisioningGateContext(WALLET, BASE);

    expect(context?.gasByChain[BASE]?.quotedGasUsd).toBe(0);
    expect(context?.gasEstimateUsd).toBeGreaterThan(0);
  });

  it("[R6] a total holdings-read failure yields NO context, so the gate cannot fire", async () => {
    fetchWalletHoldings.mockRejectedValue(new Error("every network failed"));

    await expect(buildProvisioningGateContext(WALLET, BASE)).resolves.toBeNull();
  });

  it("[R6] never throws across the boundary when the inventory read fails", async () => {
    getFundingInventory.mockRejectedValue(new Error("swappable_tokens down"));
    fetchWalletHoldings.mockResolvedValue([holding({ chainId: BASE, usd: 100 })]);

    const context = await buildProvisioningGateContext(WALLET, BASE);

    // Balances are still known, so the gate can still judge gas; there is simply nothing to spend.
    expect(context?.sources).toEqual([]);
    expect(context?.balancesByChain[BASE]?.tokenUsd).toBe(100);
  });

  it("passes the already-read holdings to the inventory instead of reading them twice", async () => {
    const holdings = [holding({ chainId: BASE, usd: 100 })];
    fetchWalletHoldings.mockResolvedValue(holdings);

    await buildProvisioningGateContext(WALLET, BASE);

    expect(fetchWalletHoldings).toHaveBeenCalledTimes(1);
    expect(getFundingInventory).toHaveBeenCalledWith(WALLET, holdings);
  });

  it("quotes gas once per candidate chain, not once per holding", async () => {
    fetchWalletHoldings.mockResolvedValue([
      holding({ chainId: BASE, usd: 100 }),
      holding({ chainId: BASE, usd: 200, symbol: "WETH" }),
      holding({ chainId: BASE, usd: 3, symbol: "ETH", isNative: true, address: "0x0" }),
    ]);
    getFundingInventory.mockResolvedValue([source(BASE), source(BASE, { symbol: "WETH" })]);

    await buildProvisioningGateContext(WALLET, ARBITRUM);

    expect(quoteSwap).toHaveBeenCalledTimes(2); // Base + Arbitrum
  });
});
