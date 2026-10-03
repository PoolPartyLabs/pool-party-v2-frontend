/**
 * @id PP-MGR-CMP-037
 * @name TokensStep.test
 * @implements-rules-version v2 (POO-2142 rules v2, POO-2143 rules v2)
 * @analytics-events none, the shell emits
 *
 * POO-2124 [R13] / [R23] / [R24] / [R25] / [R26] / [R27] / [R28], epic POO-2119. Mandate step 3.
 *
 * The reducers are `PP-MGR-LIB-019`'s and tested there; these cases assert the screen's own
 * decisions, and three of them carry the weight of the step.
 *
 * The first is the default list. `catalog.tokensFor(["arbitrum"], …)` returns 374 entries, of which
 * 7 are priced, so a screen that rendered the catalog as-is would bury the seven addable tokens
 * under 367 cards whose only possible answer is "No price feed yet". The default list is therefore
 * priced only, and the unpriced ones are reachable through a search that names them.
 *
 * The second is the slot arithmetic. A token takes one slot per network it runs on (R27), so whether
 * an Add fits is not `used < 16`, it is `used + entries(symbol) <= 16`; ETH on two networks costs
 * two. One case builds a draft at 15 of 16 and asserts that ARB (one network) stays addable while
 * ETH (two) does not, which is the only shape that tells the two readings apart.
 *
 * The third is that every refusal still takes its click. A hard-disabled Add would swallow the one
 * piece of evidence that someone wanted that token, so both refusal paths (no slots, no price feed)
 * are `aria-disabled` and report through `onBlocked` (CLAUDE.md premise 11, blocked intent).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import { buildMandateCatalog } from "../mandateCatalog";
import {
  createEmptyDraft,
  isBlocked,
  type MandateDraft,
  type MandateTokenRef,
  type NetworkId,
  type StepBlock,
  tokenKey,
  withNetworks,
} from "../mandateDraft";
import { TokensStep } from "./TokensStep";

const catalog = buildMandateCatalog();

/** Every token key the catalog can produce, so a rendered card can be read back as a symbol. */
const SYMBOL_BY_KEY = new Map(
  catalog
    .tokensFor(["arbitrum", "robinhood"], ["uniswap-v3-swap", "across"])
    .map((token) => [tokenKey(token), token.symbol] as const),
);

// jsdom implements no scrolling at all, and the step scrolls a blocked card into view.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

/** A draft on the hub plus the given spokes, with its locked deposit rows already in place. */
function draftOn(spokes: NetworkId[] = []): MandateDraft {
  return withNetworks(createEmptyDraft("2026-10-03T00:00:00.000Z", "draft-1"), spokes, catalog);
}

/** One catalog entry, by symbol and network. The address is the real one from the static lists. */
function entryFor(draft: MandateDraft, symbol: string, network: NetworkId = "arbitrum") {
  const found = catalog
    .tokensFor(draft.networks, draft.protocols)
    .find((token) => token.symbol === symbol && token.network === network);
  if (!found) throw new Error(`no catalog entry ${network}:${symbol}`);
  return found;
}

/** A draft token entry built from the catalog, the shape `addToken` would have produced. */
function entryRef(
  draft: MandateDraft,
  symbol: string,
  network: NetworkId = "arbitrum",
): MandateTokenRef {
  const entry = entryFor(draft, symbol, network);
  return {
    address: entry.address,
    symbol: entry.symbol,
    name: entry.name,
    network: entry.network,
    logoUrl: entry.logoUrl,
    locked: false,
  };
}

/** Entries that stand in for a longer mandate, so a draft can sit at an exact slot count. */
function fillers(count: number): MandateTokenRef[] {
  return Array.from({ length: count }, (_, index) => ({
    address: `0x${index.toString(16).padStart(40, "f")}`,
    symbol: `FILL${index}`,
    name: `Filler ${index}`,
    network: "arbitrum" as NetworkId,
    logoUrl: null,
    locked: false,
  }));
}

/** Render the step and expose the draft the reducer it last handed to `update` would produce. */
function renderStep(draft: MandateDraft = draftOn(), block: StepBlock | null = null) {
  const update = vi.fn();
  const onBlocked = vi.fn();
  const view = renderWithProviders(
    <TokensStep
      draft={draft}
      catalog={catalog}
      update={update}
      block={block}
      onBlocked={onBlocked}
    />,
  );
  const draftAfterUpdate = (): MandateDraft => {
    const reducer = update.mock.calls.at(-1)?.[0] as (d: MandateDraft) => MandateDraft;
    const next = reducer(draft);
    if (isBlocked(next)) throw new Error("the reducer refused");
    return next;
  };
  return { ...view, draft, update, onBlocked, draftAfterUpdate };
}

/** Every element the step marked with a row id, catalog cards and "Your tokens" rows alike. */
function markedRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll("[data-mandate-row]"));
}

/** The catalog cards only: a "Your tokens" row carries the `yours:` prefix. */
function catalogCards(): HTMLElement[] {
  return markedRows().filter(
    (el) => !(el.getAttribute("data-mandate-row") ?? "").startsWith("yours:"),
  );
}

/** The symbols the catalog is showing, in render order, read back from the row ids. */
function catalogSymbols(): string[] {
  return catalogCards().map(
    (el) => SYMBOL_BY_KEY.get(el.getAttribute("data-mandate-row") ?? "") ?? "?",
  );
}

/** The catalog card holding this symbol, whatever its slot state. */
function catalogCard(symbol: string): HTMLElement {
  const card = catalogCards()[catalogSymbols().indexOf(symbol)];
  if (!card) throw new Error(`no catalog card for ${symbol}`);
  return card;
}

/** Whether the catalog is showing this symbol at all. */
function hasCatalogCard(symbol: string): boolean {
  return catalogSymbols().includes(symbol);
}

/** The "Your tokens" row for a symbol. */
function yoursRow(symbol: string): HTMLElement {
  const found = document.querySelector(`[data-mandate-row="yours:${symbol}"]`);
  if (!found) throw new Error(`no Your tokens row for ${symbol}`);
  return found as HTMLElement;
}

describe("TokensStep", () => {
  // @rule R25
  it("lists the priced catalog tokens and leaves the deposit token out of the catalog", () => {
    renderStep();

    expect(catalogSymbols()).toEqual(["ARB", "DAI", "ETH", "LINK", "USDT", "WBTC", "wstETH"]);
    expect(hasCatalogCard("USDC")).toBe(false);
    expect(
      screen.getByText(
        "Only tokens on the networks and protocols you chose are listed. Every token is priced on the hub.",
      ),
    ).toBeInTheDocument();
  });

  // @rule R25
  it("hides the unpriced tokens until the search names one", async () => {
    const user = userEvent.setup();
    renderStep();

    // 1INCH is in the static Arbitrum list and outside the hub price source.
    expect(hasCatalogCard("1INCH")).toBe(false);

    await user.type(screen.getByRole("textbox"), "1inch");

    expect(hasCatalogCard("1INCH")).toBe(true);
  });

  // @rule R25
  it("matches a query against the symbol, the name and the start of the address", async () => {
    const user = userEvent.setup();
    renderStep();
    const search = screen.getByRole("textbox");

    await user.type(search, "wbt");
    expect(hasCatalogCard("WBTC")).toBe(true);
    expect(hasCatalogCard("ARB")).toBe(false);

    await user.clear(search);
    await user.type(search, "chainlink token");
    expect(catalogSymbols()).toEqual(["LINK"]);

    await user.clear(search);
    await user.type(search, "0x912CE5");
    expect(catalogSymbols()).toEqual(["ARB"]);
  });

  // @rule R26
  it("narrows the catalog to one network through the network filter", async () => {
    const user = userEvent.setup();
    renderStep(draftOn(["robinhood"]));

    expect(catalogSymbols()).toEqual(["ARB", "DAI", "ETH", "LINK", "USDT", "WBTC", "wstETH"]);

    await user.click(screen.getByRole("button", { name: /^Network:/ }));
    await user.click(screen.getByRole("option", { name: "Robinhood Chain" }));

    // Wrapped Ether is the only priced token the spoke's own list carries.
    expect(catalogSymbols()).toEqual(["ETH"]);
  });

  // @rule R26
  it("counts the visible tokens in the results head and in Add all", async () => {
    const user = userEvent.setup();
    renderStep();

    expect(
      screen.getByText("7 tokens available on your networks and protocols"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add all 7" })).toBeInTheDocument();
    /**
     * [B7] `FilterDropdown` composes its accessible name as "<section>: <selection>", so a label
     * that already carried the selection was announced as "Sort: Name: Name". The visible trigger
     * still reads "Sort: Name" (R26); only the announced name changed.
     */
    const sort = screen.getByRole("button", { name: "Sort: Name" });
    expect(sort).toHaveTextContent("Sort:");
    expect(sort).toHaveTextContent("Name");
    expect(screen.queryByRole("button", { name: "Sort: Name: Name" })).not.toBeInTheDocument();

    await user.type(screen.getByRole("textbox"), "chainlink token");

    expect(
      screen.getByText("1 token available on your networks and protocols"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add all 1" })).toBeInTheDocument();
  });

  // @rule R23
  it("adds a token through addToken and takes it out of the catalog", async () => {
    const user = userEvent.setup();
    const { draftAfterUpdate, unmount } = renderStep();

    await user.click(within(catalogCard("ARB")).getByRole("button"));

    const next = draftAfterUpdate();
    expect(next.tokens.map((token) => token.symbol)).toEqual(["USDC", "ARB"]);
    unmount();

    // The same draft rendered again: the catalog has lost ARB, and the right card has gained it.
    renderStep(next);
    expect(hasCatalogCard("ARB")).toBe(false);
    expect(yoursRow("ARB")).toBeInTheDocument();
  });

  // @rule R23
  it("brings a token back to the catalog when its row is removed", async () => {
    const user = userEvent.setup();
    const base = draftOn();
    const { draftAfterUpdate, unmount } = renderStep({
      ...base,
      tokens: [...base.tokens, entryRef(base, "ARB")],
    });

    await user.click(within(yoursRow("ARB")).getByRole("button", { name: "Remove ARB" }));

    const next = draftAfterUpdate();
    expect(next.tokens.map((token) => token.symbol)).toEqual(["USDC"]);
    unmount();

    renderStep(next);
    expect(hasCatalogCard("ARB")).toBe(true);
  });

  // @rule R24
  it("shows the deposit token as a locked row that carries no remove control", () => {
    renderStep(draftOn(["robinhood"]));

    const usdc = within(yoursRow("USDC"));
    expect(usdc.getByText("Deposit token")).toBeInTheDocument();
    expect(usdc.queryByRole("button")).not.toBeInTheDocument();
    expect(usdc.getByRole("img", { name: "Arbitrum" })).toBeInTheDocument();

    // R18 as the coordinator amended it: the spoke's own stable is USDG, never labelled "USDC".
    const usdg = within(yoursRow("USDG"));
    expect(usdg.getByText("Deposit token")).toBeInTheDocument();
    expect(usdg.getByRole("img", { name: "Robinhood Chain" })).toBeInTheDocument();
  });

  // @rule R24
  it("groups the network entries of one symbol into a single row with all its dots", () => {
    const base = draftOn(["robinhood"]);
    renderStep({
      ...base,
      tokens: [...base.tokens, entryRef(base, "ETH"), entryRef(base, "ETH", "robinhood")],
    });

    expect(
      markedRows().filter((el) => el.getAttribute("data-mandate-row") === "yours:ETH"),
    ).toHaveLength(1);
    const eth = within(yoursRow("ETH"));
    expect(eth.getByRole("img", { name: "Arbitrum" })).toBeInTheDocument();
    expect(eth.getByRole("img", { name: "Robinhood Chain" })).toBeInTheDocument();
    expect(eth.getByText("Wrapped Ether")).toBeInTheDocument();
    // The head counts ENTRIES, which is what the slot counter below it also counts.
    expect(screen.getByText("Your tokens · 4")).toBeInTheDocument();
  });

  // @rule R24
  it("removes every network entry of a symbol through one remove", async () => {
    const user = userEvent.setup();
    const base = draftOn(["robinhood"]);
    const { draftAfterUpdate } = renderStep({
      ...base,
      tokens: [...base.tokens, entryRef(base, "ETH"), entryRef(base, "ETH", "robinhood")],
    });

    await user.click(within(yoursRow("ETH")).getByRole("button", { name: "Remove ETH" }));

    expect(draftAfterUpdate().tokens.map((token) => token.symbol)).toEqual(["USDC", "USDG"]);
  });

  // @rule R24
  it("clears the chosen tokens and keeps the deposit rows", async () => {
    const user = userEvent.setup();
    const base = draftOn();
    const { draftAfterUpdate } = renderStep({
      ...base,
      tokens: [...base.tokens, entryRef(base, "ARB")],
    });

    await user.click(screen.getByRole("button", { name: "Clear all" }));

    expect(draftAfterUpdate().tokens.map((token) => token.symbol)).toEqual(["USDC"]);
  });

  // @rule R24
  it("disables Clear all while only the deposit rows are left", () => {
    renderStep();

    expect(screen.getByRole("button", { name: "Clear all" })).toBeDisabled();
  });

  // @rule R13
  // @rule R26
  it("adds every visible token in order when Add all is pressed, with no warning of its own", async () => {
    const user = userEvent.setup();
    const { draftAfterUpdate, onBlocked } = renderStep();

    await user.click(screen.getByRole("button", { name: "Add all 7" }));

    expect(draftAfterUpdate().tokens.map((token) => token.symbol)).toEqual([
      "USDC",
      "ARB",
      "DAI",
      "ETH",
      "LINK",
      "USDT",
      "WBTC",
      "wstETH",
    ]);
    // R13: a wide selection raises no warning here; the Broad mandate flag is the Pools step's.
    expect(onBlocked).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // @rule R26
  // @rule R27
  it("stops Add all at the first token that does not fit and reports the refusal", async () => {
    const user = userEvent.setup();
    // 1 locked + 12 fillers = 13 of 16. ARB, DAI and ETH fit; LINK is the fourth and does not.
    const base = draftOn();
    const draft = { ...base, tokens: [...base.tokens, ...fillers(12)] };
    const { draftAfterUpdate, onBlocked } = renderStep(draft);

    await user.click(screen.getByRole("button", { name: "Add all 7" }));

    const next = draftAfterUpdate();
    expect(
      next.tokens.filter((token) => !token.symbol.startsWith("FILL")).map((token) => token.symbol),
    ).toEqual(["USDC", "ARB", "DAI", "ETH"]);
    expect(next.tokens).toHaveLength(16);
    expect(onBlocked).toHaveBeenCalledWith({
      step: "tokens",
      reason: "no_slots",
      rowId: tokenKey(entryFor(draft, "LINK")),
    });
  });

  // @rule R27
  it("prints the slot counter and its caption", () => {
    const base = draftOn(["robinhood"]);
    renderStep({ ...base, tokens: [...base.tokens, entryRef(base, "ARB")] });

    expect(screen.getByText("Network slots used")).toBeInTheDocument();
    expect(screen.getByText("3 of 16")).toBeInTheDocument();
    expect(
      screen.getByText(
        "A token takes one slot on each network it runs on. The mandate holds 16 slots.",
      ),
    ).toBeInTheDocument();
  });

  // @rule R27
  it("counts one slot per network when it decides whether a token still fits", async () => {
    const user = userEvent.setup();
    // 2 locked + 13 fillers = 15 of 16. ARB costs one slot and fits; ETH costs two and does not.
    const base = draftOn(["robinhood"]);
    const draft = { ...base, tokens: [...base.tokens, ...fillers(13)] };
    const { update, onBlocked } = renderStep(draft);

    expect(within(catalogCard("ARB")).getByRole("button")).not.toHaveAttribute("aria-disabled");

    const eth = within(catalogCard("ETH")).getByRole("button");
    expect(eth).toHaveAttribute("aria-disabled", "true");
    expect(eth).toHaveAttribute("title", "No slots left");

    await user.click(eth);

    expect(update).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledWith({
      step: "tokens",
      reason: "no_slots",
      rowId: tokenKey(entryFor(draft, "ETH")),
    });
  });

  // @rule R28
  it("renders an unpriced token disabled and reports the click as a blocked intent", async () => {
    const user = userEvent.setup();
    const { update, onBlocked } = renderStep();

    await user.type(screen.getByRole("textbox"), "1inch");

    const card = screen.getByRole("button", { name: "1INCH" });
    expect(card).toHaveAttribute("aria-disabled", "true");
    expect(within(card).getByText("No price feed yet")).toBeInTheDocument();

    await user.click(card);

    expect(update).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledWith({
      step: "tokens",
      reason: "not_priced",
      rowId: card.getAttribute("data-mandate-row"),
    });
  });

  // @rule R26
  it("leaves the unpriced tokens out of Add all", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.type(screen.getByRole("textbox"), "1inch");

    expect(
      screen.getByText("1 token available on your networks and protocols"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Add all/ })).not.toBeInTheDocument();
  });

  // @rule R25
  it("shows the empty state when nothing matches the search", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.type(screen.getByRole("textbox"), "zzzzznothing");

    expect(screen.getByText("No tokens match your search.")).toBeInTheDocument();
    expect(catalogSymbols()).toEqual([]);
  });

  // @rule R27
  it("shows the inline notice only when the block belongs to this step", () => {
    const draft = draftOn();
    const { unmount } = renderStep(draft, {
      step: "protocols",
      reason: "coming_soon",
      rowId: "uniswap-v4",
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();

    renderStep(draft, {
      step: "tokens",
      reason: "no_slots",
      rowId: tokenKey(entryFor(draft, "ETH")),
    });
    expect(screen.getByRole("alert")).toHaveTextContent("No slots left");
  });

  // @rule R28
  it("names the price feed in the inline notice of a not_priced block", () => {
    renderStep(draftOn(), { step: "tokens", reason: "not_priced", rowId: "arbitrum:0xabc" });

    expect(screen.getByRole("alert")).toHaveTextContent("No price feed yet");
  });

  // @rule R27
  it("scrolls the offending card into view when the shell points a block at this step", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const draft = draftOn();

    renderStep(draft, {
      step: "tokens",
      reason: "no_slots",
      rowId: tokenKey(entryFor(draft, "WBTC")),
    });

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });
});
