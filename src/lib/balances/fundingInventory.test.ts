/**
 * @id PP-CORE-LIB-053 (POO-1031, POO-1157)
 * @name funding inventory tests
 * @implements-rules-version v3 (POO-1157 / POO-1129 rules v3) · v1 (POO-1031 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * Rules under test (POO-1031 rules v1):
 *   [R1] the inventory is holdings ∩ what Uniswap can route; see POO-1157 below for the same-chain
 *        refinement (an empty CROSS-CHAIN reach no longer means "not a funding source")
 *   [R2] an entry carries token, chain, symbol, base-unit amount (decimal string), USD and reach
 *   [R3] a per-chain read failure is skipped, never fatal
 *   [R4] every chain failing degrades to the USDC-only on-chain read, not to an empty wallet
 *   [R5] sub-$1 dust stays filtered (`MIN_DISPLAY_USD`)
 *   [R6] USD comes from the holdings feed; no `/quote` is spent to price a row
 *
 * POO-1157 (epic POO-1129 rules v3): an empty reachable set is no longer a drop. `reachableChainIds`
 * lists Uniswap BRIDGE DESTINATIONS and excludes the token's own chain (POO-1155), so an empty result
 * means "spendable only on its own chain", not "stranded". The inventory keeps such a holding with
 * `reachableChainIds: []`, which the consumers (`reachesChain`, `computePlanAction`) read as same-chain
 * only. A DEGRADED lookup (`listSwappableTokens` not ok) is kept the same way, but recorded, so a
 * transient upstream blip degrades a row's cross-chain reach instead of silently removing a funded
 * holding from "Choose tokens".
 *
 * Nothing here touches the network: `apiFetch` (the holdings feed), `readUsdcBalance` (the on-chain
 * fallback) and the Uniswap server actions are all mocked, so the REAL `fetchWalletHoldings` and
 * `getRealTokenBalances` run underneath. That is deliberate: [R3] and [R4] are properties of the
 * fan-out, and stubbing the readers themselves would assert nothing about either.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeChainMetas, ROBINHOOD_CHAIN_ID } from "@/lib/chains/config";
import { isFeatureEnabled } from "@/lib/features";
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

// POO-1157: the real consumer that turns a kept `reachableChainIds: []` into "same-chain only". Imported
// so the end-to-end claim (a same-chain-only holding survives the inventory AND is offered same-chain,
// refused cross-chain) is asserted against the shipped predicate, not a hand-built stub.
import { reachesChain } from "@/features/strategies/components/provisioning/fundingSelection";
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
      // Ascending chain id, so the set is stable whatever order the API answers in.
      reachableChainIds: [POLYGON, ARBITRUM],
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

  // [R1] / POO-1157. A token Uniswap advertises NO bridge destination for used to be pruned here,
  // conflating "no route off this chain" with "not spendable". It is now KEPT as same-chain-only
  // (`reachableChainIds: []`) alongside a token with real destinations, so the inventory no longer
  // hides a holding that is perfectly spendable for an operation on its own chain.
  it("keeps a token Uniswap routes only on its own chain, as same-chain-only", async () => {
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

    const sources = await getFundingInventory(WALLET);
    const scam = sources.find((s) => s.symbol === "SCAM");

    expect(sources.map((s) => s.symbol).sort()).toEqual(["SCAM", "USDC"]);
    expect(scam?.reachableChainIds).toEqual([]);
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

  // [R1] "Routable" still means a chain this app runs on: a mainnet-only destination contributes no
  // SUPPORTED reachable chain. POO-1157: that empties the set, but no longer drops the token. It is
  // kept on its own chain (polygon), spendable there and offered nowhere else.
  it("reports only supported chains, and keeps a token that reaches none of them as same-chain-only", async () => {
    holdingsByNetwork({ polygon: { tokensBalance: [row()] } });
    mocks.listSwappableTokens.mockResolvedValue(routableTo(MAINNET));

    const [source] = await getFundingInventory(WALLET);

    expect(source?.chainId).toBe(POLYGON);
    expect(source?.reachableChainIds).toEqual([]);
  });

  /**
   * @rule POO-1776 [R1] — ONE `featureFlag` decides both halves: what a surface may OFFER and what
   * the app spends a round-trip on. `reachableChainIds` is an offer surface (it feeds the funding
   * route's destination chains), so a flag-gated chain must not appear in it while its flag is off,
   * whatever Uniswap answers.
   *
   * Inert today, and that is exactly why it is pinned: Uniswap's `/swappable_tokens` never returns
   * chainId 4663, so the enumeration can never match. The day it does, a flag-off environment would
   * offer a bridge onto a chain whose catalog and holdings it is deliberately not reading.
   */
  it("[R1] never reports a flag-gated chain as reachable while its flag is off", async () => {
    holdingsByNetwork({ polygon: { tokensBalance: [row()] } });
    mocks.listSwappableTokens.mockResolvedValue(routableTo(ARBITRUM, ROBINHOOD_CHAIN_ID));

    const [source] = await getFundingInventory(WALLET);

    expect(source?.reachableChainIds).toEqual([ARBITRUM]);
  });

  // POO-1157. A degraded lookup is an unknown, not proof the token is stranded, so it is no longer a
  // drop: the holding survives as same-chain-only rather than vanishing from "Choose tokens" on a
  // transient blip. The degrade is recorded (unlike a genuine empty answer) so a silently shrinking
  // usable balance is observable.
  it("keeps a token whose routability lookup degraded, as same-chain-only, and records the degrade", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    holdingsByNetwork({ polygon: { tokensBalance: [row()] } });
    mocks.listSwappableTokens.mockResolvedValue({
      ok: false,
      code: "UNISWAP_HTTP_503",
      message: "upstream unavailable",
    });

    const [source] = await getFundingInventory(WALLET);

    expect(source?.reachableChainIds).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
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
    // Derived from the chain config: "every chain" has to keep meaning every chain the fan-out
    // actually reads as chains are added, or [R4] quietly becomes "every chain except the new one"
    // (POO-1776 [R1]/[R2]).
    holdingsByNetwork(
      Object.fromEntries(
        activeChainMetas(isFeatureEnabled).map((meta) => [
          meta.apiNetworkId,
          new Error("endpoint not enabled"),
        ]),
      ),
    );
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

describe("a same-chain-only holding is kept, not dropped (POO-1157)", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.readUsdcBalance.mockReset();
    mocks.listSwappableTokens.mockReset();
    mocks.quoteSwap.mockReset();
    mocks.listSwappableTokens.mockResolvedValue(routableTo(ARBITRUM, BASE, POLYGON));
  });

  // The whole point of POO-1157, end to end: a holding whose Uniswap destination list is empty (WETH
  // on Polygon, routable only on its own chain) survives the inventory AND is judged by the shipped
  // consumer as spendable same-chain, refused cross-chain. Feeding the produced source into the real
  // `reachesChain` ties the two layers: revert the inventory keep and the source is gone; break the
  // consumer's same-chain short-circuit and the same-chain assertion fails.
  it("survives the inventory, offered same-chain and refused cross-chain", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    holdingsByNetwork({ polygon: { tokensBalance: [row()] } });
    mocks.listSwappableTokens.mockResolvedValue({ ok: true, tokens: [] });

    const sources = await getFundingInventory(WALLET);
    const source = sources[0];

    expect(source).toBeDefined();
    if (!source) return;
    expect(source.reachableChainIds).toEqual([]);
    // Offered for an operation on its OWN chain, which needs no bridge at all.
    expect(reachesChain(source, POLYGON)).toBe(true);
    // Not offered cross-chain, where the missing route is the whole question.
    expect(reachesChain(source, ARBITRUM)).toBe(false);
    // A genuine empty answer is not a degrade, so nothing is recorded.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  // The degraded read and the genuine empty must be INDISTINGUISHABLE downstream (same source, same
  // same-chain-only reach), so a transient Uniswap failure degrades a row's cross-chain reach rather
  // than removing a funded holding. The single difference is the recorded degrade.
  it("makes a degraded lookup indistinguishable from a genuine empty, save for the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    holdingsByNetwork({ polygon: { tokensBalance: [row()] } });
    mocks.listSwappableTokens.mockResolvedValue({ ok: true, tokens: [] });
    const [fromEmpty] = await getFundingInventory(WALLET);
    expect(warn).not.toHaveBeenCalled();

    mocks.apiFetch.mockReset();
    holdingsByNetwork({ polygon: { tokensBalance: [row()] } });
    mocks.listSwappableTokens.mockResolvedValue({
      ok: false,
      code: "UNISWAP_HTTP_503",
      message: "upstream unavailable",
    });
    const [fromDegraded] = await getFundingInventory(WALLET);

    // Byte for byte the same funding source: both are same-chain-only.
    expect(fromDegraded).toEqual(fromEmpty);
    // The only observable difference between the two is the recorded degrade.
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
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
