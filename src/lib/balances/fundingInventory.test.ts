/**
 * @id PP-CORE-LIB-053 (POO-1031)
 * @name funding inventory tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Rules under test (POO-1031 rules v1):
 *   [R1] the inventory is holdings ∩ what Uniswap can route; an unroutable token is never offered
 *   [R2] an entry carries token, chain, symbol, base-unit amount (decimal string), USD and reach
 *   [R3] a per-chain read failure is skipped, never fatal
 *   [R4] every chain failing degrades to the USDC-only on-chain read, not to an empty wallet
 *   [R5] sub-$1 dust stays filtered (`MIN_DISPLAY_USD`)
 *   [R6] USD comes from the holdings feed; no `/quote` is spent to price a row
 *
 * Nothing here touches the network: `apiFetch` (the holdings feed), `readUsdcBalance` (the on-chain
 * fallback) and the Uniswap server actions are all mocked, so the REAL `fetchWalletHoldings` and
 * `getRealTokenBalances` run underneath. That is deliberate: [R3] and [R4] are properties of the
 * fan-out, and stubbing the readers themselves would assert nothing about either.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_DISPLAY_USD } from "./groupWalletBalances";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  readUsdcBalance: vi.fn(),
  listSwappableTokens: vi.fn(),
  quoteSwap: vi.fn(),
  sessionWallet: null as string | null,
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: (...args: unknown[]) => mocks.apiFetch(...args) };
});
vi.mock("@/lib/account/readUsdcBalance", () => ({
  readUsdcBalance: (address: `0x${string}`, chainId: number) =>
    mocks.readUsdcBalance(address, chainId),
}));
vi.mock("@/lib/uniswap/actions", () => ({
  listSwappableTokens: (...args: unknown[]) => mocks.listSwappableTokens(...args),
  quoteSwap: (...args: unknown[]) => mocks.quoteSwap(...args),
}));
vi.mock("@/lib/auth/session", () => ({ getSessionWallet: async () => mocks.sessionWallet }));

import { getFundingInventory, MAX_ROUTABILITY_LOOKUPS } from "./fundingInventory";
import { getFundingInventoryAction } from "./fundingInventoryActions";

const WALLET = "0x1234567890abcdef1234567890abcdef12345678" as `0x${string}`;
const ARBITRUM = 42161;
const BASE = 8453;
const POLYGON = 137;
/** Ethereum mainnet: routable by Uniswap, but not a chain this app operates on. */
const MAINNET = 1;

const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const WETH_POLYGON = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";

/** One holding row as pool-party-api returns it. Priced, so the mapper keeps it. */
function row(over: Record<string, unknown> = {}) {
  return {
    address: WETH_POLYGON,
    name: "Wrapped Ether",
    symbol: "WETH",
    logo: "https://logo/weth.png",
    decimals: 18,
    balance: 1,
    formattedBalance: "1",
    priceUSD: 2500,
    formattedBalanceInUSD: "2500",
    isNative: false,
    ...over,
  };
}

/** Resolve the holdings feed per network, keyed by the `?network=` slug. An Error rejects. */
function holdingsByNetwork(map: Record<string, unknown>) {
  mocks.apiFetch.mockImplementation((path: string) => {
    const slug = /network=([a-z]+)/.exec(path)?.[1] ?? "";
    const data = map[slug];
    if (data instanceof Error) return Promise.reject(data);
    return Promise.resolve(data ?? { tokensBalance: [] });
  });
}

/** Uniswap can route the queried token to `chainIds` (one token per chain is enough). */
function routableTo(...chainIds: number[]) {
  return {
    ok: true,
    tokens: chainIds.map((chainId) => ({ address: USDC_ARBITRUM, chainId })),
  };
}

describe("getFundingInventory (POO-1031)", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.readUsdcBalance.mockReset();
    mocks.listSwappableTokens.mockReset();
    mocks.quoteSwap.mockReset();
    mocks.listSwappableTokens.mockResolvedValue(routableTo(ARBITRUM, BASE, POLYGON));
  });

  it("returns nothing, and reads nothing, without an address", async () => {
    expect(await getFundingInventory("" as `0x${string}`)).toEqual([]);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(mocks.listSwappableTokens).not.toHaveBeenCalled();
  });

  // [R2] The entry the planner and the funding selector consume.
  it("carries token, chain, symbol, base-unit amount, USD and the chains it reaches", async () => {
    holdingsByNetwork({
      polygon: {
        tokensBalance: [row({ formattedBalance: "0.5", formattedBalanceInUSD: "1250" })],
      },
    });
    mocks.listSwappableTokens.mockResolvedValue(routableTo(ARBITRUM, POLYGON));

    const [source] = await getFundingInventory(WALLET);

    expect(source).toEqual({
      address: WETH_POLYGON,
      chainId: POLYGON,
      symbol: "WETH",
      decimals: 18,
      // Base units (wei), decimal string: exactly what `POST /quote` takes as `amount`.
      amount: "500000000000000000",
      usd: 1250,
      reachableChainIds: [ARBITRUM, POLYGON],
      isNative: false,
      logoUrl: "https://logo/weth.png",
    });
  });

  // [R2] The precision rule, and the reason the exact decimal string is carried end to end: an
  // 18-decimal balance round-tripped through a float lands ABOVE the real balance, and a plan sized
  // from that reverts on chain for a balance the wallet never had.
  it("keeps the balance exact instead of rounding it through a float", async () => {
    holdingsByNetwork({
      polygon: {
        tokensBalance: [
          row({ formattedBalance: "1.234567890123456789", formattedBalanceInUSD: "3086" }),
        ],
      },
    });

    const [source] = await getFundingInventory(WALLET);

    expect(source?.amount).toBe("1234567890123456789");
  });

  // [R1] The intersection. A token Uniswap will not route cannot fund anything, so it is never
  // offered: showing it would produce a plan that dies at quote time, after the user picked it.
  it("excludes a held token Uniswap cannot route", async () => {
    holdingsByNetwork({
      arbitrum: {
        tokensBalance: [
          row({ address: USDC_ARBITRUM, symbol: "USDC", decimals: 6, formattedBalance: "100" }),
        ],
      },
      polygon: { tokensBalance: [row({ symbol: "SCAM" })] },
    });
    mocks.listSwappableTokens.mockImplementation(async (input: { tokenIn: string }) =>
      input.tokenIn === USDC_ARBITRUM ? routableTo(ARBITRUM, BASE) : { ok: true, tokens: [] },
    );

    const symbols = (await getFundingInventory(WALLET)).map((s) => s.symbol);

    expect(symbols).toEqual(["USDC"]);
  });

  // [R1] The reach question is per token AND per chain: the same symbol on two chains does not
  // necessarily route the same way.
  it("asks Uniswap what each held token can reach, by token and by chain", async () => {
    holdingsByNetwork({
      polygon: { tokensBalance: [row()] },
    });

    await getFundingInventory(WALLET);

    expect(mocks.listSwappableTokens).toHaveBeenCalledWith({
      tokenIn: WETH_POLYGON,
      tokenInChainId: POLYGON,
    });
  });

  // [R1] "Routable" means routable to a chain this app runs on. A token that only reaches mainnet
  // cannot fund a Pool Party operation, so it is not a funding source.
  it("reports only supported chains, and drops a token that reaches none of them", async () => {
    holdingsByNetwork({ polygon: { tokensBalance: [row()] } });
    mocks.listSwappableTokens.mockResolvedValue(routableTo(MAINNET));

    expect(await getFundingInventory(WALLET)).toEqual([]);
  });

  // [R1] An unresolved lookup is not a licence to offer the token: we cannot prove it routes.
  it("excludes a token whose routability lookup fails", async () => {
    holdingsByNetwork({ polygon: { tokensBalance: [row()] } });
    mocks.listSwappableTokens.mockResolvedValue({
      ok: false,
      code: "UNISWAP_HTTP_503",
      message: "upstream unavailable",
    });

    expect(await getFundingInventory(WALLET)).toEqual([]);
  });

  // [R3] The rule that keeps one bad RPC from making a funded wallet look empty.
  it("skips a chain whose read failed instead of hiding funds on the others", async () => {
    holdingsByNetwork({
      arbitrum: new Error("rpc down"),
      base: {
        tokensBalance: [
          row({ address: USDC_ARBITRUM, symbol: "USDC", decimals: 6, formattedBalance: "100" }),
        ],
      },
      polygon: { tokensBalance: [row()] },
    });

    const sources = await getFundingInventory(WALLET);

    expect(sources.map((s) => s.chainId).sort((a, b) => a - b)).toEqual([POLYGON, BASE]);
  });

  // [R4] Every chain failing is the degraded case the shipped fallback already covers. The wallet
  // still shows the USDC we can read on chain, rather than nothing at all.
  it("degrades to the USDC-only on-chain read when every chain read fails", async () => {
    holdingsByNetwork({
      arbitrum: new Error("endpoint not enabled"),
      base: new Error("endpoint not enabled"),
      polygon: new Error("endpoint not enabled"),
    });
    mocks.readUsdcBalance.mockImplementation(async (_address: string, chainId: number) =>
      chainId === ARBITRUM ? 250 : 0,
    );

    const sources = await getFundingInventory(WALLET);

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      symbol: "USDC",
      chainId: ARBITRUM,
      // The USDC contract on Arbitrum, resolved from the chain config: a funding source with no
      // token address cannot be quoted.
      address: USDC_ARBITRUM,
      amount: "250000000",
      usd: 250,
    });
  });

  // [R5] Dust costs more to bridge than it moves.
  it("filters holdings worth less than the display minimum, and keeps the boundary", async () => {
    holdingsByNetwork({
      polygon: {
        tokensBalance: [
          row({ symbol: "DUST", formattedBalanceInUSD: String(MIN_DISPLAY_USD - 0.01) }),
          row({ symbol: "EXACTLY_MIN", formattedBalanceInUSD: String(MIN_DISPLAY_USD) }),
        ],
      },
    });

    const symbols = (await getFundingInventory(WALLET)).map((s) => s.symbol);

    expect(symbols).toEqual(["EXACTLY_MIN"]);
  });

  // [R5] Filtering before the fan-out, not after: a routability lookup is an upstream call on a
  // rate-limited, key-authenticated API, and dust can never be spent anyway.
  it("spends no routability lookup on dust", async () => {
    holdingsByNetwork({
      polygon: {
        tokensBalance: [
          row({ symbol: "DUST_A", formattedBalanceInUSD: "0.10" }),
          row({ symbol: "DUST_B", formattedBalanceInUSD: "0.90" }),
          row({ symbol: "REAL", formattedBalanceInUSD: "40" }),
        ],
      },
    });

    await getFundingInventory(WALLET);

    expect(mocks.listSwappableTokens).toHaveBeenCalledTimes(1);
  });

  // [R6] The USD figure is display-grade and already priced by the holdings feed. Quoting each row
  // to USDC just to label it would be one upstream call per token, per render of the selector.
  it("prices from the holdings feed and never quotes a row to price it", async () => {
    holdingsByNetwork({
      polygon: { tokensBalance: [row({ formattedBalanceInUSD: "1250.42" })] },
    });

    const [source] = await getFundingInventory(WALLET);

    expect(source?.usd).toBe(1250.42);
    expect(mocks.quoteSwap).not.toHaveBeenCalled();
  });

  // The fan-out is bounded. An unbounded one is how a wallet holding fifty tokens trips the
  // upstream rate limit and ends up with NO funding sources at all, which is the failure this rule
  // set exists to prevent. Ordered by value, so a cap can only ever defer the least valuable rows.
  it("bounds the routability fan-out, keeping the most valuable holdings", async () => {
    const many = Array.from({ length: MAX_ROUTABILITY_LOOKUPS + 3 }, (_, index) =>
      row({ symbol: `TKN${index}`, formattedBalanceInUSD: String(index + 1) }),
    );
    holdingsByNetwork({ polygon: { tokensBalance: many } });

    const sources = await getFundingInventory(WALLET);

    expect(mocks.listSwappableTokens).toHaveBeenCalledTimes(MAX_ROUTABILITY_LOOKUPS);
    expect(sources).toHaveLength(MAX_ROUTABILITY_LOOKUPS);
    // The three least valuable rows are the ones deferred, never the largest.
    expect(sources.map((s) => s.usd)).not.toContain(1);
    expect(sources[0]?.usd).toBe(many.length);
  });
});

describe("getFundingInventoryAction (POO-1031)", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.listSwappableTokens.mockReset();
    mocks.listSwappableTokens.mockResolvedValue(routableTo(POLYGON));
    mocks.sessionWallet = null;
  });

  it("returns nothing, and reads nothing, when there is no session", async () => {
    expect(await getFundingInventoryAction()).toEqual([]);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  // The security rule the whole action layer inherits: the wallet is the session's, and a client
  // cannot name someone else's.
  it("reads the inventory for the SIWE session's wallet", async () => {
    mocks.sessionWallet = WALLET;
    holdingsByNetwork({ polygon: { tokensBalance: [row()] } });

    const sources = await getFundingInventoryAction();

    expect(sources.map((s) => s.symbol)).toEqual(["WETH"]);
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      expect.stringContaining(`wallet/${WALLET}`),
      expect.anything(),
    );
  });
});
