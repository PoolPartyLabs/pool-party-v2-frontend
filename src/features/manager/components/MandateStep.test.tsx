/**
 * @id PP-MGR-SCR-002
 * @name MandateStep.test
 * Behavior: Next is disabled until a pool is picked. Neither the range (lives on the Build step's
 * pool node) nor the identity (lives on Review & launch) is set here — picking a pool seeds a
 * silent ±10% default into the selection handed up; search filters the list to an empty state /
 * finds a pool by address.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { uniswapPools } from "@/mocks/data/pools";
import {
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { MandateStep, poolHasMarketPrice, poolHasToken } from "./MandateStep";

// Flip isMockMode per test (default mock) + stub the dex-pools action for the real-mode picker.
const cfg = vi.hoisted(() => ({ mockMode: true, getDexPools: vi.fn() }));
vi.mock("@/lib/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services")>()),
  get isMockMode() {
    return cfg.mockMode;
  },
}));
vi.mock("../actions", () => ({ getDexPoolsAction: cfg.getDexPools }));

const realPool = {
  id: "0xrealpool",
  network: "base",
  networkName: "Base",
  token0: "ETH",
  token1: "USDC",
  feeBps: 5,
  tvlUsd: 1_000_000,
  aprPct: 12,
  currentPrice: 1700,
  address: "0xrealpool",
  token0Address: "0xeth",
  token1Address: "0xusdc",
};

// A genuinely low-priced pair (USDC/cbBTC ≈ 1.58e-5 cbBTC per USDC) — the POO-770 repro. decimals
// enable the exact on-chain snap, mirroring the real-mode /dex-pools shape.
const lowPricePool = {
  id: "base-usdc-cbbtc-5",
  network: "base",
  networkName: "Base",
  token0: "USDC",
  token1: "cbBTC",
  feeBps: 5,
  tvlUsd: 5_000_000,
  aprPct: 8,
  currentPrice: 0.0000158394,
  address: "0xusdccbbtc",
  token0Address: "0xusdc",
  token1Address: "0xcbbtc",
  decimals0: 6,
  decimals1: 8,
};

describe("poolHasMarketPrice (POO-497 R1: no-price pools are not offered)", () => {
  // @rule R1 (POO-497): a pool whose currentPrice is the no-price sentinel (<= Number.MIN_VALUE, set
  // in mapDexPool) has no defined market price and must not be offered in the picker.
  it("rejects a pool at the no-price sentinel", () => {
    expect(poolHasMarketPrice({ ...realPool, currentPrice: Number.MIN_VALUE })).toBe(false);
  });
  it("accepts a pool with a defined market price", () => {
    expect(poolHasMarketPrice({ ...realPool, currentPrice: 1700 })).toBe(true);
    // Any value strictly above the sentinel counts as a defined price.
    expect(poolHasMarketPrice({ ...realPool, currentPrice: Number.MIN_VALUE * 2 })).toBe(true);
  });
});

describe("poolHasToken (2nd-token pair filter, case-insensitive)", () => {
  // Regression: pool addresses come back lowercased, but the token list stores checksum-cased
  // addresses. A raw `===` dropped every matching pool, so picking a 2nd token showed nothing.
  const pairPool = {
    ...realPool,
    token0Address: "0x4200000000000000000000000000000000000006",
    token1Address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  };
  it("matches a checksum-cased address against lowercased pool addresses", () => {
    expect(poolHasToken(pairPool, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")).toBe(true);
    expect(poolHasToken(pairPool, "0x4200000000000000000000000000000000000006")).toBe(true);
  });
  it("returns false when neither token matches", () => {
    expect(poolHasToken(pairPool, "0x0000000000000000000000000000000000000000")).toBe(false);
  });
});

describe("MandateStep", () => {
  beforeEach(() => {
    cfg.mockMode = true;
    cfg.getDexPools.mockReset();
  });
  it("enables Next once a pool is picked, seeding the default range for Build", async () => {
    const onNext = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<MandateStep pools={uniswapPools} onNext={onNext} />);

    const next = screen.getByRole("button", { name: "Next: Build strategy" });
    // Soft-blocked (tappable, reveals what's missing) rather than natively disabled.
    expect(next).toHaveAttribute("aria-disabled", "true");

    // Identity moved to Review & launch; range moved to the Build step's pool node.
    expect(screen.queryByLabelText("Strategy name")).not.toBeInTheDocument();
    expect(screen.queryByText("Min price")).not.toBeInTheDocument();
    expect(screen.queryByText("Calculated automatically")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /USDC\/USDT/ }));
    expect(next).not.toHaveAttribute("aria-disabled");
    await user.click(next);
    // Picking the pool silently seeded the ±10% default so Build opens on a valid range; the
    // identity passes through empty (it's filled on Review).
    expect(onNext).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: expect.objectContaining({ name: "", full: false, activePreset: 10 }),
        rangeWidthPct: expect.closeTo(10, 0),
      }),
    );
  });

  // @rule R3 (POO-408 / POO-770): the seeded ±10% default must be a valid, non-degenerate band at
  // ANY price magnitude. A low-price pool (USDC/cbBTC ≈ 1.58e-5) used to seed "0"/"0" because the
  // seed formatted with a fixed 4-decimal rounder; it must now seed distinct, non-zero bounds.
  it("seeds a non-degenerate ±10% range for a low-price pool (POO-770)", async () => {
    const onNext = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<MandateStep pools={[lowPricePool]} onNext={onNext} />);

    await user.click(screen.getByRole("button", { name: /USDC\/cbBTC/ }));
    await user.click(screen.getByRole("button", { name: "Next: Build strategy" }));

    const arg = onNext.mock.calls.at(0)?.[0];
    if (!arg) throw new Error("expected onNext to be called with the mandate");
    const lo = Number.parseFloat(arg.selection.minPrice);
    const hi = Number.parseFloat(arg.selection.maxPrice);
    expect(lo).toBeGreaterThan(0); // regressed to "0" → 0 before the fix
    expect(hi).toBeGreaterThan(lo); // a real band, not a collapsed point
    expect(arg.rangeWidthPct).toBeCloseTo(10, 0);
  });

  // @rule R3 (POO-770): the collapse band — a price where ±10% is narrower than 4-decimal resolution
  // (≈ 5e-5 … 5e-4). The old rounder mapped both bounds to the same string; both must stay distinct.
  it("seeds distinct min/max for a pool in the collapse band (POO-770)", async () => {
    const onNext = vi.fn();
    const user = userEvent.setup();
    const pool = {
      ...lowPricePool,
      id: "base-collapse",
      token0: "AAA",
      token1: "BBB",
      token0Address: "0xaaa",
      token1Address: "0xbbb",
      currentPrice: 0.0003,
      decimals0: 18,
      decimals1: 18,
    };
    renderWithProviders(<MandateStep pools={[pool]} onNext={onNext} />);

    await user.click(screen.getByRole("button", { name: /AAA\/BBB/ }));
    await user.click(screen.getByRole("button", { name: "Next: Build strategy" }));

    const arg = onNext.mock.calls.at(0)?.[0];
    if (!arg) throw new Error("expected onNext to be called with the mandate");
    const lo = Number.parseFloat(arg.selection.minPrice);
    const hi = Number.parseFloat(arg.selection.maxPrice);
    expect(arg.selection.minPrice).not.toBe(arg.selection.maxPrice);
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(lo);
  });

  it("filters the pool list by search and shows an empty state", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MandateStep pools={uniswapPools} onNext={vi.fn()} />);
    await user.type(screen.getByLabelText("Search by pair, token or pool address"), "zzz");
    expect(screen.getByText("No pools match your search.")).toBeInTheDocument();
  });

  it("finds a pool by its on-chain address", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MandateStep pools={uniswapPools} onNext={vi.fn()} />);
    const target = uniswapPools.find((candidate) => candidate.id === "base-cbbtc-usdc-30");
    if (!target) throw new Error("expected the cbBTC/USDC base pool");
    await user.type(screen.getByLabelText("Search by pair, token or pool address"), target.address);
    expect(screen.getByText("cbBTC/USDC")).toBeInTheDocument();
  });

  it("[real] picks a token, fetches its dex-pools, and enables Next", async () => {
    cfg.mockMode = false;
    cfg.getDexPools.mockResolvedValue([realPool]);
    const onNext = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<MandateStep pools={[]} onNext={onNext} />);

    // Before picking a token: the hint, not a pool list.
    expect(screen.getByText("Pick a token to see its available pools.")).toBeInTheDocument();

    // Search a token (base WETH) → suggestion → pick it. POO-589: the wrapped-ether shows as "ETH"
    // now, so locate the suggestion by its (unchanged) name.
    await user.type(screen.getByLabelText("Search by pair, token or pool address"), "WETH");
    const suggestion = (await screen.findAllByText("Wrapped Ether"))[0]?.closest("button");
    if (!suggestion) throw new Error("expected a Wrapped Ether token suggestion");
    await user.click(suggestion);

    // The picked token drives a real /dex-pools fetch for its address on the selected network.
    await waitFor(() =>
      expect(cfg.getDexPools).toHaveBeenCalledWith(
        "base",
        "0x4200000000000000000000000000000000000006",
      ),
    );

    // The fetched pool renders → pick it → Next enables.
    await user.click(await screen.findByRole("button", { name: /ETH\/USDC/ }));
    expect(screen.getByRole("button", { name: "Next: Build strategy" })).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("[real] shows the top-token list on search focus, before typing (POO-347)", async () => {
    cfg.mockMode = false;
    const user = userEvent.setup();
    renderWithProviders(<MandateStep pools={[]} onNext={vi.fn()} />);

    // Not focused yet → the hint, no token list.
    expect(screen.getByText("Pick a token to see its available pools.")).toBeInTheDocument();

    // Focusing the empty search reveals the curated top tokens without typing.
    await user.click(screen.getByLabelText("Search by pair, token or pool address"));
    // POO-589: the wrapped-ether shows as "ETH" in the curated top list.
    expect((await screen.findAllByText("ETH")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("USDC").length).toBeGreaterThan(0);
    expect(screen.queryByText("Pick a token to see its available pools.")).toBeNull();
  });

  it("[real] closes the token suggestions on blur, even with a typed query (POO-347)", async () => {
    cfg.mockMode = false;
    const user = userEvent.setup();
    renderWithProviders(<MandateStep pools={[]} onNext={vi.fn()} />);
    const input = screen.getByLabelText("Search by pair, token or pool address");

    // Focused + typed → the WETH suggestion is visible.
    await user.type(input, "WETH");
    expect(await screen.findByText("Wrapped Ether")).toBeInTheDocument();

    // Clicking away blurs the field → the dropdown closes. It used to stay open while a query was
    // present (the focus gate only applied to the empty top-tokens list).
    fireEvent.blur(input);
    await waitFor(() => expect(screen.queryByText("Wrapped Ether")).toBeNull());
  });

  it("[real] second-token focus shows top tokens, excluding the first (no USDC/USDC) (POO-347)", async () => {
    cfg.mockMode = false;
    cfg.getDexPools.mockResolvedValue([]); // no pools → keep the DOM free of pool-name "WETH" nodes
    const user = userEvent.setup();
    renderWithProviders(<MandateStep pools={[]} onNext={vi.fn()} />);

    // Pick the first token (WETH, a curated base major, shown as "ETH" per POO-589).
    await user.type(screen.getByLabelText("Search by pair, token or pool address"), "WETH");
    const first = (await screen.findAllByText("Wrapped Ether"))[0]?.closest("button");
    if (!first) throw new Error("expected a Wrapped Ether suggestion");
    await user.click(first);
    await waitFor(() => expect(cfg.getDexPools).toHaveBeenCalled());

    // Focus the empty second-token search → top tokens, minus the already-picked WETH.
    await user.click(screen.getByLabelText("Add a second token (optional)"));
    expect(screen.getAllByText("USDC").length).toBeGreaterThan(0);
    // The wrapped-ether (shown as ETH) is offered only as the first-token chip — never duplicated in
    // the second list.
    expect(screen.getAllByText("ETH")).toHaveLength(1);
  });

  it("[real] pair filter keeps the pool in either token0/token1 order (POO-347)", async () => {
    cfg.mockMode = false;
    const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const weth = "0x4200000000000000000000000000000000000006";
    // Same pair, opposite canonical ordering.
    const poolAB = {
      ...realPool,
      id: "ab",
      token0: "USDC",
      token1: "WETH",
      token0Address: usdc,
      token1Address: weth,
    }; // prettier-ignore
    const poolBA = {
      ...realPool,
      id: "ba",
      token0: "WETH",
      token1: "USDC",
      token0Address: weth,
      token1Address: usdc,
    }; // prettier-ignore
    cfg.getDexPools.mockResolvedValue([poolAB, poolBA]);
    const user = userEvent.setup();
    renderWithProviders(<MandateStep pools={[]} onNext={vi.fn()} />);

    // First token = USDC → fetch returns the pair in both orderings; both render before narrowing.
    await user.type(screen.getByLabelText("Search by pair, token or pool address"), "USDC");
    const first = (await screen.findAllByText("USDC"))[0]?.closest("button");
    if (!first) throw new Error("expected a USDC suggestion");
    await user.click(first);
    await screen.findByRole("button", { name: /USDC\/WETH/ });
    expect(screen.getByRole("button", { name: /WETH\/USDC/ })).toBeInTheDocument();

    // Second token = WETH, picked from the focus list (its "Wrapped Ether" name avoids the pool-row
    // "WETH" nodes). The pair filter must keep BOTH pools regardless of token0/token1 order.
    await user.click(screen.getByLabelText("Add a second token (optional)"));
    await user.click(await screen.findByRole("button", { name: /Wrapped Ether/ }));
    expect(screen.getByRole("button", { name: /USDC\/WETH/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /WETH\/USDC/ })).toBeInTheDocument();
  });

  // @rule R1 (POO-452): discovery is order-independent. Simulate the asymmetric backend — a single-
  // token search finds nothing for the common token, but the pair query (both currencies) finds the
  // pool — and assert that picking the second token re-fetches with BOTH and surfaces the pair.
  it("[real] surfaces the pair on second-token pick even when the first-token search finds nothing (POO-452)", async () => {
    cfg.mockMode = false;
    const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const weth = "0x4200000000000000000000000000000000000006";
    const pool = {
      ...realPool,
      id: "uw",
      token0: "USDC",
      token1: "WETH",
      token0Address: usdc,
      token1Address: weth,
    }; // prettier-ignore
    // currency1 undefined (single-token) → nothing; both currencies (the pair) → the pool.
    cfg.getDexPools.mockImplementation(
      async (_network: string, _currency0: string, currency1?: string) => (currency1 ? [pool] : []),
    );
    const user = userEvent.setup();
    renderWithProviders(<MandateStep pools={[]} onNext={vi.fn()} />);

    // First token = USDC → the single-token fetch finds nothing.
    await user.type(screen.getByLabelText("Search by pair, token or pool address"), "USDC");
    const first = (await screen.findAllByText("USDC"))[0]?.closest("button");
    if (!first) throw new Error("expected a USDC suggestion");
    await user.click(first);
    expect(await screen.findByText("No pools match your search.")).toBeInTheDocument();

    // Second token = WETH → re-fetches with BOTH tokens, surfacing the pair.
    await user.click(screen.getByLabelText("Add a second token (optional)"));
    await user.click(await screen.findByRole("button", { name: /Wrapped Ether/ }));
    expect(await screen.findByRole("button", { name: /USDC\/WETH/ })).toBeInTheDocument();
    // The universe was re-queried with both currencies (a 3-arg call), not the first token alone.
    expect(cfg.getDexPools).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.any(String),
      expect.any(String),
    );
  });

  // @rule R1 (POO-497): a no-price pool is hidden entirely from the mock picker's initial list.
  it("hides a no-price pool from the mock pool list (POO-497 R1)", () => {
    const priced = uniswapPools.find((candidate) => candidate.id === "base-cbbtc-usdc-30");
    if (!priced) throw new Error("expected the cbBTC/USDC base pool");
    // A sibling pool on the same network at the no-price sentinel: it must never render.
    const noPrice = {
      ...priced,
      id: "base-noprice-usdc-30",
      token0: "NOPX",
      token1: "USDC",
      currentPrice: Number.MIN_VALUE,
    };
    renderWithProviders(<MandateStep pools={[priced, noPrice]} onNext={vi.fn()} />);
    // The priced pool is offered; the no-price sibling is not.
    expect(screen.getByRole("button", { name: /cbBTC\/USDC/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /NOPX\/USDC/ })).not.toBeInTheDocument();
  });

  // @rule R1 (POO-497): the filter also applies to search results (search + no-price = still hidden).
  it("hides a no-price pool from mock search results (POO-497 R1)", async () => {
    const user = userEvent.setup();
    const priced = uniswapPools.find((candidate) => candidate.id === "base-cbbtc-usdc-30");
    if (!priced) throw new Error("expected the cbBTC/USDC base pool");
    const noPrice = {
      ...priced,
      id: "base-noprice-usdc-30",
      token0: "NOPX",
      token1: "USDC",
      currentPrice: Number.MIN_VALUE,
    };
    renderWithProviders(<MandateStep pools={[priced, noPrice]} onNext={vi.fn()} />);
    // Searching for the no-price pair yields the empty state, never the no-price pool.
    await user.type(screen.getByLabelText("Search by pair, token or pool address"), "NOPX");
    expect(screen.queryByRole("button", { name: /NOPX\/USDC/ })).not.toBeInTheDocument();
    expect(screen.getByText("No pools match your search.")).toBeInTheDocument();
  });

  // @rule R1 (POO-497): show-more paginates the FILTERED list, so no-price pools never appear on a
  // later page either. With 7 priced pools + a no-price one, page 1 shows 6 and show-more reveals the
  // 7th priced pool — the no-price pool is absent from both pages.
  it("keeps no-price pools out of the show-more page (POO-497 R1)", async () => {
    const user = userEvent.setup();
    const base = uniswapPools.find((candidate) => candidate.id === "base-cbbtc-usdc-30");
    if (!base) throw new Error("expected the cbBTC/USDC base pool");
    const priced = Array.from({ length: 7 }, (_, i) => ({
      ...base,
      id: `base-priced-${i}`,
      token0: `PRC${i}`,
      token1: "USDC",
      currentPrice: 100 + i,
    }));
    const noPrice = {
      ...base,
      id: "base-noprice",
      token0: "NOPX",
      token1: "USDC",
      currentPrice: Number.MIN_VALUE,
    };
    renderWithProviders(<MandateStep pools={[...priced, noPrice]} onNext={vi.fn()} />);
    // The no-price pool never renders, on page 1 …
    expect(screen.queryByRole("button", { name: /NOPX\/USDC/ })).not.toBeInTheDocument();
    // … and reveal the next page: the 7th priced pool shows, the no-price one still does not.
    await user.click(screen.getByRole("button", { name: "Show more pools" }));
    expect(screen.getByRole("button", { name: /PRC6\/USDC/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /NOPX\/USDC/ })).not.toBeInTheDocument();
  });

  // @rule R1 (POO-497): the real-mode fetched-pool list is filtered too — a no-price pool returned by
  // /dex-pools is dropped before it can be picked.
  it("[real] hides a no-price pool from the fetched dex-pools (POO-497 R1)", async () => {
    cfg.mockMode = false;
    const pricedPool = { ...realPool, id: "priced", token0: "ETH", token1: "USDC" };
    const noPricePool = {
      ...realPool,
      id: "noprice",
      token0: "ETH",
      token1: "DAI",
      currentPrice: Number.MIN_VALUE,
    };
    cfg.getDexPools.mockResolvedValue([pricedPool, noPricePool]);
    const user = userEvent.setup();
    renderWithProviders(<MandateStep pools={[]} onNext={vi.fn()} />);

    await user.type(screen.getByLabelText("Search by pair, token or pool address"), "WETH");
    const suggestion = (await screen.findAllByText("Wrapped Ether"))[0]?.closest("button");
    if (!suggestion) throw new Error("expected a Wrapped Ether token suggestion");
    await user.click(suggestion);

    // The priced pool renders; the no-price pool is filtered out of the fetched list.
    expect(await screen.findByRole("button", { name: /ETH\/USDC/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ETH\/DAI/ })).not.toBeInTheDocument();
  });
});
