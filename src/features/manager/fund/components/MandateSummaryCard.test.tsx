/**
 * @id PP-MGR-CMP-026
 * @name MandateSummaryCard tests
 * @implements-rules-version v3 (POO-2127 rules v1, POO-2142 rules v2, POO-2167 rules v3)
 * @analytics-events none, a read-only card emits nothing; the landing that renders it owns the view
 *   event (PP-MGR-SCR-002)
 *
 * What the Build phase prints back at the manager about the mandate they just closed (POO-2127 [B1]).
 * The card derives every row from the draft and the catalog, so the tests pin the derivations rather
 * than the markup: which protocols come first, how a long pool list is truncated, which cap rows
 * exist at all, and the one notice that is a claim about the strategy rather than a description of it
 * (R13, the Broad mandate flag).
 */
import { describe, expect, it } from "vitest";
import {
  renderWithProviders,
  screen,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import { buildMandateCatalog, type MandateCatalog } from "../mandateCatalog";
import {
  createEmptyDraft,
  type MandateDraft,
  type MandatePoolRef,
  type MandateTokenRef,
  type NetworkId,
  REQUIRED_PROTOCOLS,
  tokenKey,
  withNetworks,
  withProtocols,
} from "../mandateDraft";
import { MandateSummaryCard } from "./MandateSummaryCard";

/**
 * The catalog offers Arbitrum and Robinhood Chain only (rules v2, POO-2142), so a two-network
 * fixture has no other pair to be made of.
 */
const catalog: MandateCatalog = buildMandateCatalog();

/** A draft with the hub only, as the builder creates it. */
function base(over: Partial<MandateDraft> = {}): MandateDraft {
  return { ...createEmptyDraft("2026-10-01T00:00:00.000Z", "d-1"), ...over };
}

/** A token the manager chose, as opposed to the locked deposit row. */
function unlocked(symbol: string, network: NetworkId): MandateTokenRef {
  return {
    address: `0x${symbol.toLowerCase().padEnd(40, "0")}`,
    symbol,
    name: symbol,
    network,
    logoUrl: null,
    locked: false,
  };
}

/**
 * A pool fixture: enough of the shape for the row, with the fields the card actually reads. On
 * Uniswap v4, the position protocol the buildathon scope offers (R20 v3, POO-2167).
 */
function pool(index: number, over: Partial<MandatePoolRef> = {}): MandatePoolRef {
  return {
    id: `p-${index}`,
    address: `0x${String(index).padStart(40, "0")}`,
    network: "arbitrum",
    protocol: "uniswap-v4",
    token0: { address: "0xaaa", symbol: "ETH", name: "Ether", logoUrl: null },
    token1: { address: "0xbbb", symbol: "USDC", name: "USD Coin", logoUrl: null },
    feeBps: 5,
    feeTier: 500,
    tvlUsd: 1_000_000,
    aprPct: 12,
    tierSharePct: null,
    hasHook: false,
    ...over,
  };
}

function renderCard(draft: MandateDraft, broad?: boolean) {
  return renderWithProviders(<MandateSummaryCard draft={draft} catalog={catalog} broad={broad} />);
}

describe("MandateSummaryCard", () => {
  // @rule B1
  it("heads the card with Your mandate and labels every group", () => {
    renderCard(base());

    expect(screen.getByRole("heading", { name: "Your mandate" })).toBeInTheDocument();
    expect(screen.getByText("Networks")).toBeInTheDocument();
    expect(screen.getByText("Protocols")).toBeInTheDocument();
    expect(screen.getByText("Tokens")).toBeInTheDocument();
    expect(screen.getByText("Limits")).toBeInTheDocument();
  });

  // @rule B1
  it("names the chosen networks and draws a logo for each", () => {
    const draft = withNetworks(base(), ["arbitrum", "robinhood"], catalog);

    renderCard(draft);

    const networks = screen.getByTestId("mandate-summary-networks");
    expect(networks).toHaveTextContent("Arbitrum");
    expect(networks).toHaveTextContent("Robinhood Chain");
    // R10: a 16 px circle is not a network name, so each logo carries one.
    expect(screen.getAllByRole("img", { name: "Arbitrum" }).length).toBeGreaterThan(0);
  });

  // @rule B1
  it("lists the required protocols first and marks them as always included", () => {
    const draft = withProtocols(base(), [...REQUIRED_PROTOCOLS, "aave-v3"]);

    renderCard(draft);

    const protocols = screen.getByTestId("mandate-summary-protocols");
    expect(protocols).toHaveTextContent("Uniswap v3");
    expect(protocols).toHaveTextContent("Across");
    expect(protocols).toHaveTextContent("Aave v3");
    // The two required ones carry the Lock, so the row says which protocols the manager chose.
    expect(screen.getAllByTestId("mandate-summary-protocol-locked")).toHaveLength(
      REQUIRED_PROTOCOLS.length,
    );
  });

  // @rule B1
  it("groups a token held on two networks into one entry carrying both logos", () => {
    // R27: a token takes one slot per network, so the draft holds two ETH entries. The summary
    // says "ETH, on these two networks" rather than printing ETH twice.
    const draft = withNetworks(base(), ["arbitrum", "robinhood"], catalog);

    renderCard({
      ...draft,
      tokens: [...draft.tokens, unlocked("ETH", "arbitrum"), unlocked("ETH", "robinhood")],
    });

    const tokens = screen.getByTestId("mandate-summary-tokens");
    expect(tokens.querySelectorAll('[data-summary-token="ETH"]')).toHaveLength(1);
    expect(tokens).toHaveTextContent("ETH");
    expect(within(tokens).getAllByRole("img", { name: "Robinhood Chain" }).length).toBeGreaterThan(
      0,
    );
  });

  // @rule B1
  it("prints each pool as its pair, its protocol and its fee tier", () => {
    const draft = withProtocols(base(), [...REQUIRED_PROTOCOLS, "uniswap-v4"]);

    renderCard({ ...draft, pools: [pool(1)] });

    const pools = screen.getByTestId("mandate-summary-pools");
    expect(pools).toHaveTextContent("ETH/USDC");
    expect(pools).toHaveTextContent("Uniswap v4");
    expect(pools).toHaveTextContent("0.05% fee tier");
  });

  // @rule B1
  it("shows the first four pools and counts the rest", () => {
    const draft = withProtocols(base(), [...REQUIRED_PROTOCOLS, "uniswap-v4"]);
    const pools = [1, 2, 3, 4, 5, 6].map((index) =>
      pool(index, {
        token0: { address: `0x${index}`, symbol: `T${index}`, name: `T${index}`, logoUrl: null },
      }),
    );

    renderCard({ ...draft, pools });

    expect(screen.getByText("T1/USDC")).toBeInTheDocument();
    expect(screen.getByText("T4/USDC")).toBeInTheDocument();
    expect(screen.queryByText("T5/USDC")).not.toBeInTheDocument();
    expect(screen.getByText("and 2 more")).toBeInTheDocument();
  });

  // @rule B1
  it("has no Pools group at all when the mandate holds no position protocol", () => {
    // R29: a mandate with no DEX never had a Pools step, so the summary has nothing to summarise.
    renderCard(base());

    expect(screen.queryByTestId("mandate-summary-pools")).not.toBeInTheDocument();
    expect(screen.queryByText("Pools")).not.toBeInTheDocument();
  });

  // @rule B1
  it("prints a capped row as its share and an uncapped one as No cap", () => {
    const draft = withProtocols(withNetworks(base(), ["arbitrum", "robinhood"], catalog), [
      ...REQUIRED_PROTOCOLS,
      "aave-v3",
    ]);

    renderCard({
      ...draft,
      caps: {
        ...draft.caps,
        networks: { ...draft.caps.networks, robinhood: { noCap: false, pct: 40 } },
        protocols: { "aave-v3": { noCap: true, pct: 0 } },
      },
    });

    const limits = screen.getByTestId("mandate-summary-limits");
    expect(limits).toHaveTextContent("Robinhood Chain · 40%");
    expect(limits).toHaveTextContent("Aave v3 · No cap");
  });

  // @rule B1
  it("never gives the hub, the required protocols or the deposit token a cap row", () => {
    // R40/R43: the hub holds what is not sent elsewhere, the swap and the bridge are not places
    // capital sits, and the deposit row is not removable.
    const draft = withNetworks(base(), ["arbitrum", "robinhood"], catalog);

    renderCard({
      ...draft,
      caps: {
        ...draft.caps,
        networks: { ...draft.caps.networks, robinhood: { noCap: false, pct: 25 } },
      },
    });

    const limits = screen.getByTestId("mandate-summary-limits");
    expect(limits).toHaveTextContent("Robinhood Chain · 25%");
    expect(limits).not.toHaveTextContent("Arbitrum ·");
    expect(limits).not.toHaveTextContent("Across ·");
    expect(limits).not.toHaveTextContent("USDC ·");
  });

  // @rule B1
  it("shows an unanswered cap as Not set rather than as zero", () => {
    const draft = withNetworks(base(), ["arbitrum", "robinhood"], catalog);

    renderCard(draft);

    expect(screen.getByTestId("mandate-summary-limits")).toHaveTextContent(
      "Robinhood Chain · Not set",
    );
  });

  // @rule B1
  it("says so when nothing in the mandate can be capped at all", () => {
    renderCard(base());

    expect(screen.getByTestId("mandate-summary-limits")).toHaveTextContent(
      "Nothing to cap here: nothing was added in this group.",
    );
  });

  // @rule B1
  it("names a token cap row by its symbol", () => {
    const draft = withNetworks(base(), ["arbitrum"], catalog);
    const token = unlocked("ETH", "arbitrum");

    renderCard({
      ...draft,
      tokens: [...draft.tokens, token],
      caps: { ...draft.caps, tokens: { [tokenKey(token)]: { noCap: false, pct: 15 } } },
    });

    expect(screen.getByTestId("mandate-summary-limits")).toHaveTextContent("ETH · 15%");
  });

  // @rule B1
  // @rule R13
  it("raises the Broad mandate notice only when the caller says the mandate is broad", () => {
    renderCard(base(), true);

    expect(screen.getByRole("note")).toHaveTextContent(
      "This strategy will carry a Broad mandate flag",
    );
    expect(screen.getByRole("note")).toHaveTextContent(
      /Investors see the flag before they deposit/,
    );
  });

  // @rule R13
  it("stays silent about the flag when broad is absent or false", () => {
    const { unmount } = renderCard(base());
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    unmount();

    renderCard(base(), false);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
