/**
 * @id PP-BALANCES (POO-239)
 * @name getRealTokenBalances tests
 * @implements-rules-version v1
 *
 * Real on-chain wallet balances: one USDC entry per network with a non-zero balance, priced 1:1,
 * tolerant of per-network RPC failures. readUsdcBalance is mocked (no real RPC).
 * POO-1776 [R1]: the fan-out enumerates the ACTIVE chains, so a flag-gated chain's RPC is never
 * read while its flag is off.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { activeChainMetas, ROBINHOOD_CHAIN_ID, supportedChainMetas } from "@/lib/chains/config";
import { isFeatureEnabled } from "@/lib/features";

const mockReadUsdcBalance = vi.fn();
vi.mock("@/lib/account/readUsdcBalance", () => ({
  readUsdcBalance: (address: `0x${string}`, chainId: number) =>
    mockReadUsdcBalance(address, chainId),
}));

const { getRealTokenBalances } = await import("./getRealTokenBalances");

const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678" as `0x${string}`;
// Supported network chain ids.
const ARBITRUM = 42161;
const BASE = 8453;
const POLYGON = 137;

/** The chains this environment actually reads (the gated chains are off by default). */
const activeChainIds = () => activeChainMetas(isFeatureEnabled).map((meta) => meta.chain.id);

/** The launch chains' shared USDC art, read from the config rather than retyped as a URL literal. */
const usdcLogo = () => supportedChainMetas.find((m) => m.chain.id === ARBITRUM)?.usdc.logoUrl;

describe("getRealTokenBalances", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mockReadUsdcBalance.mockReset();
  });

  it("returns one USDC holding per network with a non-zero balance, priced 1:1", async () => {
    mockReadUsdcBalance.mockImplementation(async (_address: `0x${string}`, chainId: number) => {
      if (chainId === ARBITRUM) return 5;
      if (chainId === POLYGON) return 0.13;
      return 0; // base: omitted
    });

    const balances = await getRealTokenBalances(ADDRESS);

    expect(balances).toHaveLength(2);
    expect(balances.every((b) => b.symbol === "USDC" && b.usd === b.amount)).toBe(true);
    expect(balances.map((b) => b.chainId).sort((a, b) => a - b)).toEqual([POLYGON, ARBITRUM]);
    // Base held zero → omitted entirely.
    expect(balances.map((b) => b.chainId)).not.toContain(BASE);
  });

  it("skips a network whose RPC read fails instead of hiding funds held elsewhere", async () => {
    mockReadUsdcBalance.mockImplementation(async (_address: `0x${string}`, chainId: number) => {
      if (chainId === ARBITRUM) throw new Error("rpc down");
      return 2; // base + polygon
    });

    const balances = await getRealTokenBalances(ADDRESS);

    // Every ACTIVE chain but the failing one — counted from the config, so adding a chain does
    // not need this number retyped and cannot pass by accident (POO-1776 [R2]).
    expect(balances).toHaveLength(activeChainIds().length - 1);
    expect(balances.map((b) => b.chainId)).not.toContain(ARBITRUM);
    expect(balances.every((b) => b.amount === 2)).toBe(true);
  });

  it("returns an empty list when the wallet holds no USDC anywhere", async () => {
    mockReadUsdcBalance.mockResolvedValue(0);
    expect(await getRealTokenBalances(ADDRESS)).toEqual([]);
  });

  /**
   * @rule POO-1776 [R1] — the flag gates the DATA FAN-OUT, not only the network picker. This read is
   * an RPC round-trip to the alpha chain's public endpoint, fired for every connected wallet on the
   * degraded path; with the chain switched off it must not be made at all.
   */
  it("[R1] never reads a flag-gated chain's RPC while its flag is off", async () => {
    mockReadUsdcBalance.mockResolvedValue(0);

    await getRealTokenBalances(ADDRESS);

    const read = mockReadUsdcBalance.mock.calls.map((call) => call[1]);
    expect(read).not.toContain(ROBINHOOD_CHAIN_ID);
    expect(read).toEqual(activeChainIds());
  });

  // @rule POO-1776 [R1] — flag on, the gated chain's balance is read like any other.
  it("[R1] reads a flag-gated chain's RPC once its flag is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_ROBINHOOD_CHAIN", "on");
    mockReadUsdcBalance.mockResolvedValue(0);

    await getRealTokenBalances(ADDRESS);

    const read = mockReadUsdcBalance.mock.calls.map((call) => call[1]);
    expect(read).toEqual(supportedChainMetas.map((meta) => meta.chain.id));
  });

  /**
   * @rule POO-1779 [R1] — the wallet modal's row is this object, so everything it prints is whatever
   * this function put in `symbol` / `name` / `logoUrl`. On 4663 the balance read is USDG, and a row
   * reading "USDC · USD Coin" over a USDG figure is the exact mislabel [R1] exists to stop.
   *
   * The ICON counts as a label: it is 36px of colour beside four characters of text, so it is what
   * an investor reads first. It comes off the same meta entry as the ticker, which is the whole
   * point of `ChainMeta.usdc` carrying both — the two cannot drift apart.
   */
  it("[R1] labels the Robinhood holding USDG / Global Dollar, over the USDG mark", async () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_ROBINHOOD_CHAIN", "on");
    mockReadUsdcBalance.mockImplementation(async (_address: `0x${string}`, chainId: number) =>
      chainId === ROBINHOOD_CHAIN_ID ? 12.5 : 0,
    );

    const [robinhood, ...rest] = await getRealTokenBalances(ADDRESS);

    expect(rest).toEqual([]);
    expect(robinhood).toMatchObject({
      chainId: ROBINHOOD_CHAIN_ID,
      symbol: "USDG",
      name: "Global Dollar",
      // [R1] the label changes, the money does not: 6 decimals, still read at parity.
      decimals: 6,
      amount: 12.5,
      usd: 12.5,
    });
    // Asserted as an inequality, not against a URL literal: what must hold is that the row does not
    // wear the USDC art, whichever CDN path either token's mark ends up on.
    expect(robinhood?.logoUrl).not.toBe(usdcLogo());
    expect(robinhood?.logoUrl).toBe(
      supportedChainMetas.find((m) => m.chain.id === ROBINHOOD_CHAIN_ID)?.usdc.logoUrl,
    );
  });

  // @rule POO-1779 [R2] — every launch chain keeps USDC / USD Coin, and the USDC art.
  it("[R2] leaves the launch chains labelled USDC / USD Coin", async () => {
    mockReadUsdcBalance.mockResolvedValue(3);

    const balances = await getRealTokenBalances(ADDRESS);

    expect(balances.map((b) => b.chainId)).toEqual([ARBITRUM, BASE, POLYGON]);
    expect(
      balances.every(
        (b) => b.symbol === "USDC" && b.name === "USD Coin" && b.logoUrl === usdcLogo(),
      ),
    ).toBe(true);
  });
});
