/**
 * @id PP-MGR-CMP-038
 * @name PoolsStep.test
 * @implements-rules-version v2 (POO-2142 rules v2)
 * @analytics-events none, the shell emits
 *
 * POO-2125 [R11] / [R13] / [R29] to [R38], epic POO-2119. Mandate step 4.
 *
 * The data adapter is `mandatePoolSource` and it has its own tests, so it is mocked here: these
 * cases are about what the SCREEN decides, and five of them carry the weight.
 *
 * The first is the default universe. Nothing is typed when the step opens, and the manager still has
 * to see "N pools with at least one of your tokens" (R35), so the step fans a search out over every
 * mandate token on every selected network and dedupes by pool id. That count is not cosmetic: it is
 * the denominator `isBroadMandate` divides by (R13), so getting it wrong raises or hides a flag an
 * investor sees before depositing.
 *
 * The second is the address paste. One read per network the mandate holds, and no more: the read
 * itself reports where the address lives, so a pool on another network is named rather than swept
 * for. The cases that matter are the ones where "elsewhere" is still inside the mandate (not an
 * advisory at all) and where the step must not go asking a network the fund contracts do not operate
 * on.
 *
 * The third is that a refusal keeps its click. A hooked pool is listed and disabled (R38); its Add
 * is `aria-disabled`, never natively disabled, because that click is the only evidence a manager
 * wanted a pool the fund contracts cannot hold.
 *
 * The fourth is the error. A failed read is not an empty list, and conflating them would tell a
 * manager their tokens have no pools when the truth is that we could not ask.
 *
 * The fifth is that a universe is only an answer about the mandate it was measured over. An Add can
 * pull a token in (R32), which widens the universe, so the count from a moment earlier is too small
 * and `draft.pools.length` reaches it: the flag goes up on a mandate that is not broad. Those cases
 * hold the reads with deferred promises, because the window being asserted is the one where the
 * re-measure has started and not landed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
  within,
} from "../../../../../tests/utils/renderWithProviders";

const services = vi.hoisted(() => ({ mockMode: true }));

vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return services.mockMode;
  },
}));

vi.mock("../mandatePoolSource", () => ({
  searchMandatePools: vi.fn(),
  findMandatePoolByAddress: vi.fn(),
}));

import { buildMandateCatalog } from "../mandateCatalog";
import {
  addPool,
  addToken,
  createEmptyDraft,
  isBlocked,
  type MandateDraft,
  type MandatePoolRef,
  type MandateTokenRef,
  type NetworkId,
  REQUIRED_PROTOCOLS,
  type StepBlock,
  tokenKey,
  withNetworks,
  withProtocols,
} from "../mandateDraft";
import { findMandatePoolByAddress, searchMandatePools } from "../mandatePoolSource";
import { PoolsStep } from "./PoolsStep";

const catalog = buildMandateCatalog();

/** Real Arbitrum addresses, so a pool's tokens resolve against the bundled token lists. */
const USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const WETH = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";
const ARB = "0x912ce59144191c1204e64559fe8253a0e49e6548";

/** A Robinhood Chain equity token: a real listing, and deliberately outside `PRICED_SYMBOLS`. */
const NVDA = "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec";

/** An address-shaped value to paste. Never a fixture address: the adapter is mocked here. */
const PASTED = "0x1111111111111111111111111111111111111111";

/** A draft on the hub (plus spokes) that can hold liquidity positions, so step 4 exists (R29). */
function draftOn(spokes: NetworkId[] = []): MandateDraft {
  const base = withNetworks(
    createEmptyDraft("2026-10-03T00:00:00.000Z", "draft-1"),
    spokes,
    catalog,
  );
  return withProtocols(base, [...REQUIRED_PROTOCOLS, "uniswap-v3", "uniswap-v4"]);
}

/** One side of a pool, named the way the adapter names it. */
function side(address: string, symbol: string): MandatePoolRef["token0"] {
  return { address, symbol, name: symbol, logoUrl: null };
}

/** A pool the adapter could have returned. Overridable field by field. */
function pool(overrides: Partial<MandatePoolRef> = {}): MandatePoolRef {
  return {
    id: "arb-weth-usdc-30",
    address: "0xc6962004f452be9203591991d15f6b388e09e8d0",
    network: "arbitrum",
    protocol: "uniswap-v3",
    token0: side(WETH, "WETH"),
    token1: side(USDC, "USDC"),
    feeBps: 30,
    feeTier: 3000,
    tvlUsd: 145_000_000,
    aprPct: 11.1,
    tierSharePct: 31,
    hasHook: false,
    ...overrides,
  };
}

/** `count` distinct pools, so pagination and "and N more" have something to page through. */
function pools(count: number, overrides: Partial<MandatePoolRef> = {}): MandatePoolRef[] {
  return Array.from({ length: count }, (_, index) =>
    pool({ id: `pool-${index}`, tvlUsd: 100_000_000 - index, ...overrides }),
  );
}

/** Every search answers the same list, whichever token it was asked about. */
function searchAnswers(result: MandatePoolRef[]) {
  vi.mocked(searchMandatePools).mockResolvedValue(result);
}

/** Each network answers its own pools, so a fan-out can be told apart from a single read. */
function searchAnswersByNetwork(byNetwork: Partial<Record<NetworkId, MandatePoolRef[]>>) {
  vi.mocked(searchMandatePools).mockImplementation(async (input) => byNetwork[input.network] ?? []);
}

/** What the address lookup answers: the pool when it is here, otherwise where it is. */
function located(pool: MandatePoolRef | null, foundOn: NetworkId | null = null) {
  return { pool, foundOn };
}

/** The networks the address lookup was actually asked about, in order. */
function networksAsked(): NetworkId[] {
  return vi.mocked(findMandatePoolByAddress).mock.calls.map((call) => call[0]);
}

/**
 * Every priced token the catalog offers, built straight from the catalog rather than through
 * `addToken`.
 *
 * `addToken` enforces the 16-slot cap, and a two-network mandate runs into it, so looping it would
 * silently drop entries and leave the token half of R13 false, which would make a "the flag stays
 * down" assertion pass for the wrong reason.
 */
function withEveryToken(draft: MandateDraft): MandateDraft {
  const held = new Set(draft.tokens.map(tokenKey));
  const extra: MandateTokenRef[] = catalog
    .tokensFor(draft.networks, draft.protocols)
    .filter((entry) => entry.priced && !held.has(tokenKey(entry)))
    .map((entry) => ({
      address: entry.address,
      symbol: entry.symbol,
      name: entry.name,
      network: entry.network,
      logoUrl: entry.logoUrl,
      locked: false,
    }));
  return { ...draft, tokens: [...draft.tokens, ...extra] };
}

/**
 * A draft with all sixteen slots taken, so any pool bringing a new token is refused `no_slots`.
 *
 * The cap is a BUDGET rather than a property of the pool, which is why {@link canEverAdd} ignores it
 * and the row still offers an Add: the refusal only exists at the moment it is pressed.
 */
function fullSlots(): MandateDraft {
  const base = draftOn();
  const fillers: MandateTokenRef[] = Array.from({ length: 15 }, (_, index) => ({
    address: `0x${index.toString(16).padStart(40, "f")}`,
    symbol: `FILL${index}`,
    name: `Filler ${index}`,
    network: "arbitrum",
    logoUrl: null,
    locked: false,
  }));
  return { ...base, tokens: [...base.tokens, ...fillers] };
}

/**
 * Every priced token but one, so a pool can still pull that one in (R32).
 *
 * The mandate R13 is hardest on is the one a single token short of complete: the Add that completes
 * it is the same Add that widens the pool universe, which is the moment a count measured a moment
 * earlier stopped being an answer to the question being asked.
 */
function withEveryTokenBut(draft: MandateDraft, symbol: string): MandateDraft {
  const every = withEveryToken(draft);
  return { ...every, tokens: every.tokens.filter((token) => token.symbol !== symbol) };
}

/** Apply the real reducer, as the shell's `update` does, so the draft that comes back is honest. */
function afterAdding(draft: MandateDraft, candidates: MandatePoolRef[]): MandateDraft {
  let next = draft;
  for (const candidate of candidates) {
    const result = addPool(next, candidate, catalog);
    if (isBlocked(result)) throw new Error(`the reducer refused ${candidate.id}`);
    next = result;
  }
  return next;
}

/**
 * Render the step the way the shell does, with the draft as a prop.
 *
 * An Add is therefore a RERENDER carrying whatever the reducer answered, never something the step
 * does to itself, and the spies survive it. That is what lets one case read a publish before an Add
 * and after it, which is the whole question here.
 */
function renderControlled(initial: MandateDraft) {
  const update = vi.fn();
  const onBlocked = vi.fn();
  const onError = vi.fn();
  const onUniverseCount = vi.fn();
  const step = (draft: MandateDraft) => (
    <PoolsStep
      draft={draft}
      catalog={catalog}
      update={update}
      block={null}
      onBlocked={onBlocked}
      onError={onError}
      onUniverseCount={onUniverseCount}
    />
  );
  const view = renderWithProviders(step(initial));
  return {
    ...view,
    update,
    onBlocked,
    onError,
    onUniverseCount,
    /** What the shell does with a reducer's answer: render the step again on the new draft. */
    show: (draft: MandateDraft) => view.rerender(step(draft)),
  };
}

/**
 * Hold the pool reads one ROUND at a time, so a pending state is asserted rather than waited out.
 *
 * A universe read is one `searchMandatePools` call per mandate token, awaited as a batch, so a
 * per-call deferral would mean counting calls the test has no business knowing about. Every call
 * made while a round is open answers that round, and settling it opens the next. `search` routes one
 * token address away from the rounds, which is how a visible token search and a background
 * measurement of the universe can be told apart while both are in flight.
 */
function heldRounds(search: { tokenAddress: string; answer: MandatePoolRef[] } | null = null) {
  type Round = {
    promise: Promise<MandatePoolRef[]>;
    settle: (pools: MandatePoolRef[]) => void;
    fail: (error: Error) => void;
  };
  const rounds: Round[] = [];
  let open = 0;
  const roundAt = (index: number): Round => {
    const existing = rounds[index];
    if (existing) return existing;
    let settle: (pools: MandatePoolRef[]) => void = () => undefined;
    let fail: (error: Error) => void = () => undefined;
    const promise = new Promise<MandatePoolRef[]>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    const created: Round = { promise, settle, fail };
    rounds[index] = created;
    return created;
  };
  vi.mocked(searchMandatePools).mockImplementation((input) => {
    if (search && input.tokenAddress.toLowerCase() === search.tokenAddress.toLowerCase()) {
      return Promise.resolve(search.answer);
    }
    return roundAt(open).promise;
  });
  return {
    /** Answer the open round, and open the next one. */
    settle(result: MandatePoolRef[]) {
      const round = roundAt(open);
      open += 1;
      round.settle(result);
    },
    /** Fail the open round, and open the next one. */
    fail(error: Error) {
      const round = roundAt(open);
      open += 1;
      round.fail(error);
    },
    /** Every read asked for so far, rounds and routed searches alike. */
    asked(): number {
      return vi.mocked(searchMandatePools).mock.calls.length;
    },
  };
}

/** Pick a network in the display filter. */
async function pickNetwork(user: ReturnType<typeof userEvent.setup>, label: string): Promise<void> {
  await user.click(screen.getByRole("button", { name: /^Network:/ }));
  await user.click(screen.getByRole("option", { name: label }));
}

/** Render the step and expose what the last `update` reducer would do to the draft. */
function renderStep(
  draft: MandateDraft = draftOn(),
  options: { block?: StepBlock | null; source?: typeof catalog } = {},
) {
  const update = vi.fn();
  const onBlocked = vi.fn();
  const onError = vi.fn();
  const onUniverseCount = vi.fn();
  const view = renderWithProviders(
    <PoolsStep
      draft={draft}
      catalog={options.source ?? catalog}
      update={update}
      block={options.block ?? null}
      onBlocked={onBlocked}
      onError={onError}
      onUniverseCount={onUniverseCount}
    />,
  );
  const draftAfterUpdate = (): MandateDraft => {
    const reducer = update.mock.calls.at(-1)?.[0] as (d: MandateDraft) => MandateDraft;
    const next = reducer(draft);
    if (isBlocked(next)) throw new Error("the reducer refused");
    return next;
  };
  return { ...view, draft, update, onBlocked, onError, onUniverseCount, draftAfterUpdate };
}

/** The result cards currently on screen, in render order. */
function resultCards(): HTMLElement[] {
  return Array.from(document.querySelectorAll("[data-mandate-row]")).filter(
    (el): el is HTMLElement => !(el.getAttribute("data-mandate-row") ?? "").startsWith("yours:"),
  );
}

/** The result card for a pool id. */
function resultCard(id: string): HTMLElement {
  const found = document.querySelector(`[data-mandate-row="${id}"]`);
  if (!found) throw new Error(`no result card for ${id}`);
  return found as HTMLElement;
}

beforeEach(() => {
  services.mockMode = true;
  vi.mocked(searchMandatePools).mockReset();
  vi.mocked(findMandatePoolByAddress).mockReset();
  searchAnswers([]);
  vi.mocked(findMandatePoolByAddress).mockResolvedValue(located(null));
});

describe("PoolsStep", () => {
  it("uses real catalog pricing rather than the static symbol list for pool additions", async () => {
    services.mockMode = false;
    const target = pool({ protocol: "uniswap-v4", token0: side(WETH, "CATALOG") });
    searchAnswers([target]);
    const real = {
      ...catalog,
      dataMode: "real" as const,
      tokensFor: () => [{ ...side(WETH, "CATALOG"), network: "arbitrum" as const, priced: true }],
    };
    const initial = {
      ...draftOn(),
      dataMode: "real" as const,
      catalogVersion: "v2-catalog-v1" as const,
      protocols: ["uniswap-v3-swap" as const, "uniswap-v4" as const],
      positionProtocolsByChain: { arbitrum: ["uniswap-v4" as const] },
    };
    const { draftAfterUpdate } = renderStep(initial, { source: real });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Add" }));
    expect(draftAfterUpdate().pools).toHaveLength(1);
    expect(draftAfterUpdate().tokens.some((token) => token.symbol === "CATALOG")).toBe(true);
  });

  // @rule R29
  it("renders nothing when the mandate holds no DEX protocol", () => {
    const noDex = withProtocols(draftOn(), [...REQUIRED_PROTOCOLS]);
    const { container } = renderStep(noDex);

    expect(container).toBeEmptyDOMElement();
    expect(searchMandatePools).not.toHaveBeenCalled();
  });

  // @rule R35
  // @rule R30
  it("loads the universe on open: one search per mandate token on every selected network", async () => {
    searchAnswers(pools(2));
    const draft = draftOn(["robinhood"]);
    const { onUniverseCount } = renderStep(draft);

    expect(await screen.findByText("2 pools with at least one of your tokens")).toBeInTheDocument();
    // Two locked deposit rows, one per network, so two searches, each scoped to its own network.
    expect(searchMandatePools).toHaveBeenCalledTimes(2);
    expect(searchMandatePools).toHaveBeenCalledWith({
      network: "arbitrum",
      tokenAddress: draft.tokens[0]?.address,
      secondTokenAddress: undefined,
      protocols: ["uniswap-v3", "uniswap-v4"],
    });
    // Deduped by pool id: both searches answered the same two pools. In `waitFor` because the
    // publish is a passive effect: it runs AFTER the commit the results head above matched, so a
    // synchronous read here is a race the test would lose on a slower machine.
    await waitFor(() => expect(onUniverseCount).toHaveBeenLastCalledWith(2));
  });

  // @rule R13
  // @rule R35
  it("measures the universe over every selected network, whatever the filter shows", async () => {
    searchAnswersByNetwork({
      arbitrum: [pool({ id: "arb-a" }), pool({ id: "arb-b" })],
      robinhood: [pool({ id: "rbh-a", network: "robinhood" })],
    });
    const user = userEvent.setup();
    const { onUniverseCount } = renderStep(draftOn(["robinhood"]));
    expect(await screen.findByText("3 pools with at least one of your tokens")).toBeInTheDocument();

    await pickNetwork(user, "Robinhood Chain");

    // The filter narrows what is on screen, and the head and the tab agree with the list ...
    await waitFor(() => expect(resultCards()).toHaveLength(1));
    expect(resultCard("rbh-a")).toBeInTheDocument();
    expect(screen.getByText("1 pool with at least one of your tokens")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "All · 1" })).toBeInTheDocument();
    // ... and it does not touch the denominator the Broad-mandate flag divides by (R13).
    expect(onUniverseCount).toHaveBeenLastCalledWith(3);
    expect(onUniverseCount).not.toHaveBeenCalledWith(1);
  });

  // @rule R13
  it("does not raise the Broad flag because a filtered list was emptied", async () => {
    const spoke = [pool({ id: "rbh-a", network: "robinhood" })];
    searchAnswersByNetwork({
      arbitrum: [pool({ id: "arb-a" }), pool({ id: "arb-b" })],
      robinhood: spoke,
    });
    const user = userEvent.setup();
    // Every priced token is in, so the token half of R13 is satisfied and only the pools decide.
    const { onUniverseCount } = renderStep({
      ...withEveryToken(draftOn(["robinhood"])),
      pools: spoke,
    });
    // Three pools in the universe, one of them already chosen, so two are offered.
    await screen.findByText("2 pools with at least one of your tokens");

    await pickNetwork(user, "Robinhood Chain");

    // Nothing is left to add on the filtered list, and the flag still stays down: two of the three
    // pools this mandate can hold are not in it, and an investor reads that flag before depositing.
    await waitFor(() => expect(resultCards()).toHaveLength(0));
    expect(onUniverseCount).toHaveBeenLastCalledWith(3);
    expect(
      screen.queryByText("This strategy will carry a Broad mandate flag"),
    ).not.toBeInTheDocument();
  });

  // @rule R13
  it("does not let a token search redefine the denominator", async () => {
    const draft = draftOn();
    const deposit = draft.tokens[0]?.address;
    // The universe fans out over the mandate's own tokens; a search asks about the picked one. The
    // mock answers by token so the two reads can be told apart.
    vi.mocked(searchMandatePools).mockImplementation(async (input) =>
      input.tokenAddress === deposit ? pools(4) : [pool({ id: "only-one" })],
    );
    const user = userEvent.setup();
    const { onUniverseCount } = renderStep(draft);
    await screen.findByText("4 pools with at least one of your tokens");

    await user.type(screen.getByLabelText("Token, pair or pool address"), "WETH");
    const options = await screen.findAllByRole("option");
    await user.click(options[0] as HTMLElement);

    await waitFor(() => expect(resultCards()).toHaveLength(1));
    expect(onUniverseCount).toHaveBeenLastCalledWith(4);
  });

  /**
   * [B2a] The denominator has to make `draft.pools.length >= count` true ONLY when every addable
   * pool of the universe is in.
   *
   * A pool pasted by address is in `draft.pools` without ever being in the fetched universe, so it
   * inflated the left side of that comparison: three pools in, three in the universe, and the
   * Broad-mandate flag an investor reads before depositing went up on a mandate missing a third of
   * the pools it could hold.
   */
  // @rule R13
  it("counts a pasted pool that the universe search never returned", async () => {
    const universe = pools(3);
    searchAnswers(universe);
    const outsider = pool({ id: "pasted", address: PASTED });
    // Every priced token is in, so only the pools decide the flag.
    const draft = {
      ...withEveryToken(draftOn()),
      pools: [...universe.slice(0, 2), outsider],
    };
    const { onUniverseCount } = renderStep(draft);

    // One of the three universe pools is still on offer.
    await screen.findByText("1 pool with at least one of your tokens");

    // Three addable universe pools, plus the one selected pool that is not one of them.
    await waitFor(() => expect(onUniverseCount).toHaveBeenLastCalledWith(4));
    expect(
      screen.queryByText("This strategy will carry a Broad mandate flag"),
    ).not.toBeInTheDocument();
  });

  /**
   * [B2b] A count the draft no longer carries is published again.
   *
   * The reducers answer `poolUniverseCount: null` whenever the networks, protocols or tokens change,
   * which is exactly what a pool pulling its other token in does. The old effect only fired when the
   * number it computed moved, so a draft whose stored count had just been cleared kept a null
   * denominator and the flag could never come back. The guard is the stored value itself, so once the
   * draft carries the number the effect is quiet and there is no loop.
   */
  // @rule R13
  it("publishes again when a reducer cleared the count the draft was carrying", async () => {
    searchAnswers(pools(2));
    const update = vi.fn();
    const onBlocked = vi.fn();
    const onUniverseCount = vi.fn();
    const stored = { ...draftOn(), poolUniverseCount: 2 };
    const step = (draft: MandateDraft) => (
      <PoolsStep
        draft={draft}
        catalog={catalog}
        update={update}
        block={null}
        onBlocked={onBlocked}
        onUniverseCount={onUniverseCount}
      />
    );
    const { rerender } = renderWithProviders(step(stored));

    await screen.findByText("2 pools with at least one of your tokens");
    // The draft already says 2, so there is nothing to tell it.
    expect(onUniverseCount).not.toHaveBeenCalled();

    rerender(step({ ...stored, poolUniverseCount: null }));

    await waitFor(() => expect(onUniverseCount).toHaveBeenCalledWith(2));
  });

  /**
   * [B2c] A pasted address must not offer a pool of a protocol the mandate did not name. Real mode
   * resolves an address through the Uniswap v3 endpoint whatever the mandate chose, so the lookup is
   * told which protocols count; `mandatePoolSource.test.ts` asserts the filtering itself.
   */
  // @rule R13
  // @rule R30
  it("asks the address lookup only about the protocols the mandate named", async () => {
    const user = userEvent.setup();
    renderStep(withProtocols(draftOn(), [...REQUIRED_PROTOCOLS, "uniswap-v4"]));
    await screen.findByText("0 pools with at least one of your tokens");

    await user.type(screen.getByLabelText("Token, pair or pool address"), PASTED);

    await waitFor(() =>
      expect(findMandatePoolByAddress).toHaveBeenCalledWith("arbitrum", PASTED, ["uniswap-v4"]),
    );
  });

  // @rule R13
  it("publishes no count before a universe has resolved", async () => {
    let release: (value: MandatePoolRef[]) => void = () => {};
    vi.mocked(searchMandatePools).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const { onUniverseCount } = renderStep();

    // The initial state is zero and the shell persists what it is told, so publishing it would
    // overwrite a stored denominator with a number nothing measured, and mark the draft dirty on
    // open.
    expect(onUniverseCount).not.toHaveBeenCalled();

    release(pools(2));

    await waitFor(() => expect(onUniverseCount).toHaveBeenCalledWith(2));
    expect(onUniverseCount).toHaveBeenCalledTimes(1);
  });

  // @rule R13
  it("publishes no count when the read fails", async () => {
    vi.mocked(searchMandatePools).mockRejectedValue(new Error("mock: pools unavailable"));
    const { onUniverseCount, onError } = renderStep();

    await waitFor(() => expect(onError).toHaveBeenCalled());
    // A failure measured nothing. Zero here would be persisted as "this mandate has no pools".
    expect(onUniverseCount).not.toHaveBeenCalled();
  });

  // @rule R35
  it("does not refetch because a caller passed a fresh callback", async () => {
    searchAnswers(pools(1));
    const draft = draftOn();
    const { rerender } = renderStep(draft);
    await screen.findByText("1 pool with at least one of your tokens");
    expect(searchMandatePools).toHaveBeenCalledTimes(1);

    // An inline arrow is a new identity on every render, which the Storybook harness and any caller
    // that does not memoise will produce. In the effect's dependency array that is one fetch PER
    // RENDER, and since the effect sets state, a self-feeding loop.
    for (let pass = 0; pass < 3; pass++) {
      rerender(
        <PoolsStep
          draft={draft}
          catalog={catalog}
          update={vi.fn()}
          block={null}
          onBlocked={vi.fn()}
          onError={() => undefined}
          onUniverseCount={() => undefined}
        />,
      );
    }

    await waitFor(() => expect(searchMandatePools).toHaveBeenCalledTimes(1));
  });

  // @rule R35
  it("does not refetch the universe for every character typed", async () => {
    searchAnswers(pools(1));
    const user = userEvent.setup();
    renderStep();
    await screen.findByText("1 pool with at least one of your tokens");
    expect(searchMandatePools).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText("Token, pair or pool address"), "ETH");

    // Nothing is picked and nothing is address-shaped, so the list is still answering the question
    // it answered before the first keystroke. Re-asking it costs one /dex-pools call per mandate
    // token per character in real mode.
    expect(await screen.findAllByRole("option")).not.toHaveLength(0);
    expect(searchMandatePools).toHaveBeenCalledTimes(1);
  });

  // @rule R30
  it("shows the loading copy while the universe is in flight", async () => {
    let release: (value: MandatePoolRef[]) => void = () => {};
    vi.mocked(searchMandatePools).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    renderStep();

    expect(screen.getByText("Loading pools…")).toBeInTheDocument();
    release([]);
    await waitFor(() => expect(screen.queryByText("Loading pools…")).not.toBeInTheDocument());
  });

  // @rule R30
  it("searches the picked token after a suggestion is chosen", async () => {
    searchAnswers(pools(1));
    const user = userEvent.setup();
    renderStep();
    await screen.findByText("1 pool with at least one of your tokens");

    await user.type(screen.getByLabelText("Token, pair or pool address"), "WETH");
    // The list is relevance-ranked by `searchTokens`, and several Arbitrum tokens carry "WETH" in
    // their name, so the assertion is about the FIRST option: canonical WETH leads.
    const options = await screen.findAllByRole("option");
    await user.click(options[0] as HTMLElement);

    await waitFor(() =>
      expect(searchMandatePools).toHaveBeenCalledWith(
        expect.objectContaining({ network: "arbitrum", tokenAddress: WETH }),
      ),
    );
    // The chip replaces the field, with the way back out beside it.
    expect(screen.getByRole("button", { name: /Change/ })).toBeInTheDocument();
  });

  // @rule R30
  it("resolves a pasted pool address directly, on the selected network", async () => {
    const target = pool({ id: "pasted", address: PASTED });
    vi.mocked(findMandatePoolByAddress).mockResolvedValue(located(target));
    const user = userEvent.setup();
    renderStep();
    await screen.findByText("0 pools with at least one of your tokens");

    await user.type(screen.getByLabelText("Token, pair or pool address"), PASTED);

    // The lookup being CALLED is one commit earlier than the card the resolution renders, so both
    // reads wait: the first wait proved only that the request went out.
    await waitFor(() =>
      expect(findMandatePoolByAddress).toHaveBeenCalledWith("arbitrum", PASTED, [
        "uniswap-v3",
        "uniswap-v4",
      ]),
    );
    await waitFor(() => expect(resultCard("pasted")).toBeInTheDocument());
  });

  // @rule R30
  it("keeps walking when the pool is on another network the mandate holds, filter or not", async () => {
    // The hub answers "it lives on the spoke". The spoke IS one of this mandate's networks, so that
    // is not a wrong-network fact, it is a hint to ask the next one.
    vi.mocked(findMandatePoolByAddress).mockImplementation(async (network) =>
      network === "robinhood"
        ? located(pool({ id: "pasted", network: "robinhood" }))
        : located(null, "robinhood"),
    );
    const user = userEvent.setup();
    renderStep(draftOn(["robinhood"]));
    await screen.findByText("0 pools with at least one of your tokens");
    await pickNetwork(user, "Robinhood Chain");

    await user.type(screen.getByLabelText("Token, pair or pool address"), PASTED);

    await waitFor(() => expect(resultCard("pasted")).toBeInTheDocument());
    expect(screen.queryByText(/not the network you have selected/)).not.toBeInTheDocument();
    // One read per network the mandate holds, in order, and nothing else.
    expect(networksAsked()).toEqual(["arbitrum", "robinhood"]);
  });

  // @rule R30
  it("shows a pasted pool the network filter does not name", async () => {
    // The filter narrows a LIST. An address resolves to exactly one pool, so hiding it because the
    // filter names another network would turn a successful paste into "no pools match your search".
    vi.mocked(findMandatePoolByAddress).mockImplementation(async (network) =>
      network === "arbitrum" ? located(pool({ id: "pasted" })) : located(null, "arbitrum"),
    );
    const user = userEvent.setup();
    renderStep(draftOn(["robinhood"]));
    await screen.findByText("0 pools with at least one of your tokens");
    await pickNetwork(user, "Robinhood Chain");

    await user.type(screen.getByLabelText("Token, pair or pool address"), PASTED);

    await waitFor(() => expect(resultCard("pasted")).toBeInTheDocument());
    expect(networksAsked()).toEqual(["arbitrum"]);
  });

  /**
   * [F7 L1] The filter is display only, so it may refetch a token search and nothing else.
   *
   * A token search fans out over the DISPLAYED networks, so narrowing them is a different question
   * and a refetch is right. An address lookup walks the mandate's own networks instead, so the
   * filter cannot change its answer: re-asking it threw a resolved card away and flashed the
   * skeleton over a pool the manager was already reading.
   */
  // @rule R30
  it("does not re-ask a pasted address when the display filter changes", async () => {
    vi.mocked(findMandatePoolByAddress).mockImplementation(async (network) =>
      network === "arbitrum" ? located(pool({ id: "pasted" })) : located(null, "arbitrum"),
    );
    const user = userEvent.setup();
    renderStep(draftOn(["robinhood"]));
    await screen.findByText("0 pools with at least one of your tokens");

    await user.type(screen.getByLabelText("Token, pair or pool address"), PASTED);
    await waitFor(() => expect(resultCard("pasted")).toBeInTheDocument());
    const asked = vi.mocked(findMandatePoolByAddress).mock.calls.length;

    await pickNetwork(user, "Robinhood Chain");

    expect(vi.mocked(findMandatePoolByAddress)).toHaveBeenCalledTimes(asked);
    expect(resultCard("pasted")).toBeInTheDocument();
    expect(screen.queryByText("Loading pools…")).not.toBeInTheDocument();
  });

  // @rule R30
  it("says where a pasted address really lives, without sweeping the catalog", async () => {
    // Robinhood Chain is available and NOT selected here, which is the only case that is an
    // advisory. The read says so itself, so no second sweep is needed to find out.
    vi.mocked(findMandatePoolByAddress).mockResolvedValue(located(null, "robinhood"));
    const user = userEvent.setup();
    renderStep();
    await screen.findByText("0 pools with at least one of your tokens");

    await user.type(screen.getByLabelText("Token, pair or pool address"), PASTED);

    expect(
      await screen.findByText(
        "This pool exists on Robinhood Chain, not the network you have selected.",
      ),
    ).toBeInTheDocument();
    expect(resultCards()).toHaveLength(0);
    // The old sweep asked every catalog network in turn: Base, Polygon and Unichain included, where
    // the fund contracts do not operate and an unknown slug can answer 400.
    expect(networksAsked()).toEqual(["arbitrum"]);
  });

  // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
  // // @rule R30
  // it("never asks a network the catalog marks unavailable", async () => {
  //   const user = userEvent.setup();
  //   // A draft saved while a network was enabled and reopened after it was turned off. `withNetworks`
  //   // would refuse it, so it is built by hand: this is about what the step does with stored data.
  //   renderStep({ ...draftOn(), networks: ["arbitrum", "base"] });
  //   await screen.findByText("0 pools with at least one of your tokens");
  //
  //   await user.type(screen.getByLabelText("Token, pair or pool address"), PASTED);
  //
  //   await waitFor(() => expect(findMandatePoolByAddress).toHaveBeenCalled());
  //   expect(networksAsked()).toEqual(["arbitrum"]);
  // });

  // @rule R30 @rule R16 v2
  it("never asks a network the catalog does not know", async () => {
    const user = userEvent.setup();
    // A draft saved before the buildathon scope dropped Base (POO-2142). `withNetworks` would refuse
    // it, so it is built by hand: this is about what the step does with stored data.
    const stale = ["arbitrum", "base"] as unknown as NetworkId[];
    renderStep({ ...draftOn(), networks: stale });
    await screen.findByText("0 pools with at least one of your tokens");

    await user.type(screen.getByLabelText("Token, pair or pool address"), PASTED);

    await waitFor(() => expect(findMandatePoolByAddress).toHaveBeenCalled());
    expect(networksAsked()).toEqual(["arbitrum"]);
  });

  // @rule R30
  it("says so when a pasted address is nowhere", async () => {
    const user = userEvent.setup();
    renderStep();
    await screen.findByText("0 pools with at least one of your tokens");

    await user.type(screen.getByLabelText("Token, pair or pool address"), PASTED);

    expect(await screen.findByText("No pools match your search.")).toBeInTheDocument();
    expect(networksAsked()).toEqual(["arbitrum"]);
  });

  // @rule R30
  it("makes one real-mode read per selected network and no more", async () => {
    services.mockMode = false;
    const user = userEvent.setup();
    renderStep(draftOn(["robinhood"]));
    await screen.findByText("0 pools with at least one of your tokens");

    await user.type(screen.getByLabelText("Token, pair or pool address"), `0x${"ab".repeat(32)}`);

    expect(await screen.findByText("No pools match your search.")).toBeInTheDocument();
    // Two selected networks, two server actions. Never five, and never one for a network the
    // contracts do not operate on, where the API error would turn a plain "not on your networks"
    // into the error state and a POOLS_FETCH_FAILED event.
    expect(findMandatePoolByAddress).toHaveBeenCalledTimes(2);
    expect(networksAsked()).toEqual(["arbitrum", "robinhood"]);
  });

  // @rule R30
  it("shows the error state with a retry, and reports the failure once", async () => {
    vi.mocked(searchMandatePools).mockRejectedValue(new Error("mock: pools unavailable"));
    const user = userEvent.setup();
    const { onError } = renderStep();

    expect(
      await screen.findByText("Couldn't load the pools. Check your connection and try again."),
    ).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith({ code: "POOLS_FETCH_FAILED" });

    searchAnswers(pools(1));
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("1 pool with at least one of your tokens")).toBeInTheDocument();
  });

  // @rule R31
  it("counts the results per protocol in the tabs and filters on the chosen one", async () => {
    searchAnswers([
      pool({ id: "v3-a", protocol: "uniswap-v3" }),
      pool({ id: "v3-b", protocol: "uniswap-v3" }),
      pool({ id: "v4-a", protocol: "uniswap-v4" }),
    ]);
    const user = userEvent.setup();
    renderStep();

    expect(await screen.findByRole("tab", { name: "All · 3" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Uniswap v3 · 2" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Uniswap v4 · 1" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Uniswap v4 · 1" }));

    await waitFor(() => expect(resultCards()).toHaveLength(1));
    expect(resultCard("v4-a")).toBeInTheDocument();
  });

  /**
   * [B7] `FilterDropdown` composes its accessible name as "<section>: <selection>", so a label that
   * already carried the selection was announced as "Sort: TVL: TVL". The visible trigger still reads
   * "Sort: TVL" (R31); only the announced name changed.
   */
  // @rule R31
  it("names the sort control once", async () => {
    searchAnswers(pools(1));
    renderStep();
    await screen.findByText("1 pool with at least one of your tokens");

    const sort = screen.getByRole("button", { name: "Sort: TVL" });
    expect(sort).toHaveTextContent("Sort:");
    expect(sort).toHaveTextContent("TVL");
    expect(screen.queryByRole("button", { name: "Sort: TVL: TVL" })).not.toBeInTheDocument();
  });

  // @rule R31
  it("shows the catalog empty state in real mode instead of the superseded pending notice", async () => {
    services.mockMode = false;
    searchAnswers([pool({ id: "v3-a", protocol: "uniswap-v3" })]);
    const user = userEvent.setup();
    renderStep();

    await user.click(await screen.findByRole("tab", { name: "Uniswap v4 · 0" }));

    expect(
      screen.queryByText("Uniswap v4 pools arrive with the fund contracts data source."),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No pools match your search.")).toBeInTheDocument();
  });

  // @rule R31
  it("adds every result in order and stops at the first refusal", async () => {
    searchAnswers([pool({ id: "first" }), pool({ id: "second" })]);
    const user = userEvent.setup();
    // Sixteen slots used, so the first pool's two tokens cannot enter and `addPool` refuses.
    const full = draftOn();
    const fillers: MandateTokenRef[] = Array.from({ length: 15 }, (_, index) => ({
      address: `0x${index.toString(16).padStart(40, "f")}`,
      symbol: `FILL${index}`,
      name: `Filler ${index}`,
      network: "arbitrum",
      logoUrl: null,
      locked: false,
    }));
    const { onBlocked, update } = renderStep({ ...full, tokens: [...full.tokens, ...fillers] });

    await user.click(await screen.findByRole("button", { name: "Add all 2" }));

    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(onBlocked).toHaveBeenCalledWith({
      step: "pools",
      reason: "no_slots",
      rowId: "first",
    });
    // Nothing was added, so nothing is written: a refusal on the first pool changes no draft.
    expect(update).not.toHaveBeenCalled();
  });

  // @rule R32
  it("draws the pool the way a manager reads it", async () => {
    searchAnswers([pool({ token1: side(ARB, "ARB"), tierSharePct: 31 })]);
    renderStep();

    await waitFor(() => resultCard("arb-weth-usdc-30"));
    const card = within(resultCard("arb-weth-usdc-30"));
    expect(card.getByText("WETH/ARB")).toBeInTheDocument();
    expect(card.getByText("Uniswap v3")).toBeInTheDocument();
    expect(card.getByText(/0\.30%/)).toBeInTheDocument();
    expect(card.getByText(/31% selected/)).toBeInTheDocument();
    // The pool would pull a token into the mandate, and says so before it is added (R32).
    expect(card.getByText(/adds ARB to your tokens/)).toBeInTheDocument();
    expect(card.getByText("$145M")).toBeInTheDocument();
    expect(card.getByText("11.1%")).toBeInTheDocument();
    // R11: one copy chip per side of the pair.
    expect(card.getAllByRole("button", { name: "Copy token address" })).toHaveLength(2);
  });

  // @rule R32
  it("says nothing about a tier share it does not have", async () => {
    searchAnswers([pool({ tierSharePct: null })]);
    renderStep();

    await waitFor(() => resultCard("arb-weth-usdc-30"));
    const card = within(resultCard("arb-weth-usdc-30"));
    expect(card.queryByText(/selected/)).not.toBeInTheDocument();
  });

  // @rule R32
  it("adds a pool through the reducer and drops it from the results", async () => {
    searchAnswers([pool()]);
    const user = userEvent.setup();
    const { draftAfterUpdate } = renderStep();

    await user.click(await screen.findByRole("button", { name: "Add" }));

    expect(draftAfterUpdate().pools.map((p) => p.id)).toEqual(["arb-weth-usdc-30"]);
  });

  // @rule R32
  it("leaves an already-added pool out of the results", async () => {
    const added = pool();
    searchAnswers([added, pool({ id: "other" })]);
    renderStep({ ...draftOn(), pools: [added] });

    await waitFor(() => expect(resultCards()).toHaveLength(1));
    expect(resultCard("other")).toBeInTheDocument();
  });

  // @rule R38
  it("lists a hooked pool, disables it, and still reports the click", async () => {
    searchAnswers([pool({ id: "hooked", hasHook: true })]);
    const user = userEvent.setup();
    const { onBlocked, update } = renderStep();

    await waitFor(() => resultCard("hooked"));
    const card = within(resultCard("hooked"));
    const refusal = card.getByRole("button", { name: /has a hook/ });
    expect(refusal).toHaveAttribute("aria-disabled", "true");

    await user.click(refusal);

    expect(onBlocked).toHaveBeenCalledWith({ step: "pools", reason: "has_hook", rowId: "hooked" });
    expect(update).not.toHaveBeenCalled();
  });

  /**
   * [B1] A side the hub cannot price is a permanent refusal, so the row says so before it is pressed.
   *
   * It used to offer an ordinary Add that went through `update`, where the reducer refused and the
   * shell drew a notice: a manager could press it forever and the funnel recorded nothing, because
   * only `onBlocked` emits `builder_mandate_blocked`. R38's hooked row has always been drawn this
   * way; this is the second half of the same rule.
   */
  // @rule R28
  // @rule R32
  it("draws an unpriced side as a refusal, with no enabled Add, and reports the click", async () => {
    searchAnswers([pool({ id: "unpriced", token1: side(NVDA, "NVDA") })]);
    const user = userEvent.setup();
    const { onBlocked, update } = renderStep();

    await waitFor(() => resultCard("unpriced"));
    const card = within(resultCard("unpriced"));
    expect(card.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
    const refusal = card.getByRole("button", { name: "No price feed yet" });
    // `aria-disabled`, never the native attribute: a native disabled control swallows the click,
    // and that click is the only evidence a manager wanted the pool.
    expect(refusal).toHaveAttribute("aria-disabled", "true");
    expect(refusal).not.toHaveAttribute("disabled");
    expect(refusal).toHaveAttribute("title", "No price feed yet");

    await user.click(refusal);

    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(onBlocked).toHaveBeenCalledWith({
      step: "pools",
      reason: "not_priced",
      rowId: "unpriced",
    });
    expect(update).not.toHaveBeenCalled();
  });

  /**
   * [B1] The slot cap is a budget, not a property, so the row keeps its Add and the press is where
   * the refusal happens. The reducer is previewed once: one report, and nothing written.
   */
  // @rule R32
  it("reports a single Add the reducer refuses for want of slots, and writes nothing", async () => {
    searchAnswers([pool({ id: "tight" })]);
    const user = userEvent.setup();
    const { onBlocked, update } = renderStep(fullSlots());

    await user.click(await screen.findByRole("button", { name: "Add" }));

    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(onBlocked).toHaveBeenCalledWith({ step: "pools", reason: "no_slots", rowId: "tight" });
    expect(update).not.toHaveBeenCalled();
  });

  /**
   * [B1] The same preview covers every refusal `addPool` can raise on the press, including the
   * protocol guard: a pool whose protocol the mandate did not choose is refused `coming_soon`, which
   * is the shape the network case already has today.
   */
  // @rule R32
  it("reports an Add refused because the pool is outside what the mandate named", async () => {
    searchAnswers([pool({ id: "offnet", network: "robinhood" })]);
    const user = userEvent.setup();
    const { onBlocked, update } = renderStep();

    await user.click(await screen.findByRole("button", { name: "Add" }));

    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(onBlocked).toHaveBeenCalledWith({
      step: "pools",
      reason: "coming_soon",
      rowId: "offnet",
    });
    expect(update).not.toHaveBeenCalled();
  });

  // @rule R36
  it("pages the results five at a time", async () => {
    searchAnswers(pools(7));
    const user = userEvent.setup();
    renderStep();

    await waitFor(() => expect(resultCards()).toHaveLength(5));
    await user.click(screen.getByRole("button", { name: "Show more pools (2)" }));

    expect(resultCards()).toHaveLength(7);
    expect(screen.queryByRole("button", { name: /Show more pools/ })).not.toBeInTheDocument();
  });

  // @rule R33
  // @rule R36
  it("lists the mandate's own pools, six of them, then counts the rest", async () => {
    const chosen = pools(8);
    renderStep({ ...draftOn(), pools: chosen });

    expect(await screen.findByText("Your pools · 8")).toBeInTheDocument();
    expect(document.querySelectorAll('[data-mandate-row^="yours:"]')).toHaveLength(6);
    expect(screen.getByText("and 2 more")).toBeInTheDocument();
    // R33: the right card names the fee tier and shows no address and no share.
    expect(screen.getAllByText("0.30% fee tier").length).toBeGreaterThan(0);
  });

  // @rule R33
  it("removes one pool and clears them all", async () => {
    const user = userEvent.setup();
    const chosen = [pool({ id: "keep" }), pool({ id: "drop" })];
    const { draftAfterUpdate } = renderStep({ ...draftOn(), pools: chosen });

    await waitFor(() => screen.getAllByRole("button", { name: "Remove WETH/USDC" }));
    await user.click(screen.getAllByRole("button", { name: "Remove WETH/USDC" })[0] as HTMLElement);
    expect(draftAfterUpdate().pools.map((p) => p.id)).toEqual(["drop"]);

    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(draftAfterUpdate().pools).toHaveLength(0);
  });

  // @rule R34
  it("repeats the slot counter and says pools cannot be added later", async () => {
    renderStep(draftOn(["robinhood"]));

    expect(await screen.findByText("Network slots used")).toBeInTheDocument();
    expect(screen.getByText("2 of 16")).toBeInTheDocument();
    expect(
      screen.getByText("Pools are fixed at launch. You cannot add one later."),
    ).toBeInTheDocument();
  });

  // @rule R37
  it("says every pool is already chosen, without raising a flag the tokens do not earn", async () => {
    const universe = pools(3);
    searchAnswers(universe);
    renderStep({ ...draftOn(), pools: universe });

    expect(
      await screen.findByText("Every pool with your tokens is already in Your pools"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("All 3 pools are selected. Remove one on the right to narrow the mandate."),
    ).toBeInTheDocument();
    // R13: all pools but not all tokens is not a Broad mandate.
    expect(
      screen.queryByText("This strategy will carry a Broad mandate flag"),
    ).not.toBeInTheDocument();
  });

  // @rule R13
  // @rule R38
  it("leaves a pool it can never add out of the denominator", async () => {
    searchAnswers([
      pool({ id: "plain-a" }),
      pool({ id: "plain-b" }),
      pool({ id: "hooked", hasHook: true }),
      pool({ id: "unpriced", token1: side(NVDA, "NVDA") }),
    ]);
    const { onUniverseCount } = renderStep();

    // All four are listed, because a refusal a manager can see is better than a row that vanished.
    expect(await screen.findByText("4 pools with at least one of your tokens")).toBeInTheDocument();
    expect(resultCards()).toHaveLength(4);
    // Two of them can never enter a mandate: a Uniswap v4 hook (R38) and a side the hub cannot
    // price (R28) are properties of the pool, not states a manager can clear. Counting them would
    // make R37 and the Broad flag unreachable for as long as one is in the universe. In `waitFor`
    // because the publish is a passive effect, one commit behind the results head above.
    await waitFor(() => expect(onUniverseCount).toHaveBeenLastCalledWith(2));
    expect(screen.getByRole("button", { name: "Add all 2" })).toBeInTheDocument();
  });

  // @rule R31
  it("adds every pool it can and steps over the ones it cannot", async () => {
    searchAnswers([
      pool({ id: "hooked", hasHook: true }),
      pool({ id: "unpriced", token1: side(NVDA, "NVDA") }),
      pool({ id: "plain-a" }),
      pool({ id: "plain-b" }),
    ]);
    const user = userEvent.setup();
    const { draftAfterUpdate, onBlocked } = renderStep();

    await user.click(await screen.findByRole("button", { name: "Add all 2" }));

    // The two refusals come FIRST in the list. Aborting the batch on a pool the manager never
    // singled out would be a refusal of our own making, so they are skipped, not attempted.
    expect(draftAfterUpdate().pools.map((p) => p.id)).toEqual(["plain-a", "plain-b"]);
    expect(onBlocked).not.toHaveBeenCalled();
  });

  // @rule R37
  it("calls it all selected once nothing addable is left, hooked rows and all", async () => {
    searchAnswers([pool({ id: "plain" }), pool({ id: "hooked", hasHook: true })]);
    renderStep({ ...draftOn(), pools: [pool({ id: "plain" })] });

    // "Every pool with your tokens is already in Your pools" is true: the hooked one was never a
    // pool this mandate could hold. Before this, one hooked row kept the state out of reach.
    expect(
      await screen.findByText("Every pool with your tokens is already in Your pools"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("All 1 pools are selected. Remove one on the right to narrow the mandate."),
    ).toBeInTheDocument();
  });

  // @rule R37
  it("does not call a list of refusals all selected", async () => {
    searchAnswers([pool({ id: "hooked", hasHook: true })]);
    const { onUniverseCount } = renderStep();

    await waitFor(() => resultCard("hooked"));
    expect(
      screen.queryByText("Every pool with your tokens is already in Your pools"),
    ).not.toBeInTheDocument();
    // In `waitFor`: the publish is a passive effect, one commit behind the card the wait matched.
    await waitFor(() => expect(onUniverseCount).toHaveBeenLastCalledWith(0));
    // "Add all 0" is not an offer.
    expect(screen.queryByRole("button", { name: /Add all/ })).not.toBeInTheDocument();
  });

  // @rule R37
  // @rule R13
  it("raises the Broad mandate flag once every token and every pool is in", async () => {
    const universe = pools(2);
    searchAnswers(universe);
    let draft = draftOn();
    for (const token of catalog
      .tokensFor(draft.networks, draft.protocols)
      .filter((entry) => entry.priced)) {
      const next = addToken(draft, token, catalog);
      if (!isBlocked(next)) draft = next;
    }

    renderStep({ ...draft, pools: universe });

    expect(
      await screen.findByText("This strategy will carry a Broad mandate flag"),
    ).toBeInTheDocument();
  });

  /**
   * [F5] The universe is an answer about the mandate it was measured over, and nothing else.
   *
   * Adding a pool can pull a token in (R32), and the universe is "the pools holding at least one of
   * your tokens", so that Add changes the question. The step used to republish the count it had
   * measured over the OLD tokens, which is smaller than the new universe: `draft.pools.length`
   * reached it, every priced token was now in, and the Broad-mandate flag an investor reads before
   * depositing went up on a mandate that could still add nine more pools.
   */
  // @rule R13
  it("does not raise the flag on a count measured before an Add widened the universe", async () => {
    const start = withEveryTokenBut(draftOn(), "ARB");
    const held = pool({ id: "weth-usdc" });
    const pulls = pool({ id: "weth-arb", token0: side(WETH, "WETH"), token1: side(ARB, "ARB") });
    const widened = pool({ id: "arb-usdc", token0: side(ARB, "ARB"), token1: side(USDC, "USDC") });
    const reads = heldRounds();
    const view = renderControlled(start);

    reads.settle([held, pulls]);
    expect(await screen.findByText("2 pools with at least one of your tokens")).toBeInTheDocument();
    await waitFor(() => expect(view.onUniverseCount).toHaveBeenLastCalledWith(2));

    // The shell's write, with the real reducer: ARB comes in, so the stored count expires.
    const afterAdd = afterAdding({ ...start, poolUniverseCount: 2 }, [held, pulls]);
    expect(afterAdd.poolUniverseCount).toBeNull();
    view.onUniverseCount.mockClear();
    view.show(afterAdd);

    // The re-measure is in flight, so the size of the universe is simply not known. Unknown raises
    // no flag, and publishes nothing: the shell persists what it is told.
    await waitFor(() => expect(screen.getByText("Loading pools…")).toBeInTheDocument());
    expect(
      screen.queryByText("This strategy will carry a Broad mandate flag"),
    ).not.toBeInTheDocument();
    expect(view.onUniverseCount).not.toHaveBeenCalled();

    reads.settle([held, pulls, widened]);

    // The new token brought a third pool with it, and two of three is not every pool.
    await waitFor(() => expect(view.onUniverseCount).toHaveBeenLastCalledWith(3));
    expect(
      screen.queryByText("This strategy will carry a Broad mandate flag"),
    ).not.toBeInTheDocument();
  });

  /**
   * [F5] A measurement that failed measured nothing, so it leaves the universe unknown.
   *
   * The catch deliberately keeps the pools of the last successful read, which is right for the list
   * and wrong for the count: that read was about a mandate with one token fewer.
   */
  // @rule R13
  it("keeps the universe unknown when the re-measure fails", async () => {
    const start = withEveryTokenBut(draftOn(), "ARB");
    const held = pool({ id: "weth-usdc" });
    const pulls = pool({ id: "weth-arb", token0: side(WETH, "WETH"), token1: side(ARB, "ARB") });
    const reads = heldRounds();
    const view = renderControlled(start);

    reads.settle([held, pulls]);
    await waitFor(() => expect(view.onUniverseCount).toHaveBeenLastCalledWith(2));

    const afterAdd = afterAdding({ ...start, poolUniverseCount: 2 }, [held, pulls]);
    view.onUniverseCount.mockClear();
    view.show(afterAdd);
    reads.fail(new Error("mock: pools unavailable"));

    expect(
      await screen.findByText("Couldn't load the pools. Check your connection and try again."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("This strategy will carry a Broad mandate flag"),
    ).not.toBeInTheDocument();
    // Nor does it claim the opposite of a flag: "all of them are selected" is a count too.
    expect(screen.queryByText(/pools are selected/)).not.toBeInTheDocument();
    expect(view.onUniverseCount).not.toHaveBeenCalled();
  });

  /**
   * [F7 L2] A measurement running beside a search has its own failure code.
   *
   * `POOLS_FETCH_FAILED` is documented as the DRAWN, retryable state, and a background measurement
   * draws nothing: the manager keeps reading their search and is never offered the Try again that
   * code implies. Worse, while the universe was unknown one failed search emitted it twice, once
   * for the visible read and once for the measurement beside it, and again on every retry.
   */
  // @rule R13
  it("gives a failed background measurement its own error code", async () => {
    const start = draftOn();
    const held = pool({ id: "u-weth-usdc" });
    const pulls = pool({ id: "u-arb-usdc", token0: side(ARB, "ARB"), token1: side(USDC, "USDC") });
    const reads = heldRounds({ tokenAddress: WETH, answer: [pool({ id: "searched" })] });
    const user = userEvent.setup();
    const view = renderControlled(start);

    reads.settle([held, pulls]);
    await waitFor(() => expect(view.onUniverseCount).toHaveBeenLastCalledWith(2));

    // A token search takes over the list. WETH is not in this mandate, so its read is routed away
    // from the held rounds and the measurement can fail on its own.
    await user.type(screen.getByLabelText("Token, pair or pool address"), "WETH");
    const options = await screen.findAllByRole("option");
    await user.click(options[0] as HTMLElement);
    await waitFor(() => expect(resultCard("searched")).toBeInTheDocument());

    // The Add pulls ARB in, so the stored count expires and the measurement runs beside the search.
    view.show(afterAdding({ ...start, poolUniverseCount: 2 }, [pulls]));
    reads.fail(new Error("mock: pools unavailable"));

    await waitFor(() =>
      expect(view.onError.mock.calls).toEqual([[{ code: "POOLS_UNIVERSE_FETCH_FAILED" }]]),
    );
    // And it stays background: the search the manager asked for is still what is on screen.
    expect(resultCard("searched")).toBeInTheDocument();
    expect(
      screen.queryByText("Couldn't load the pools. Check your connection and try again."),
    ).not.toBeInTheDocument();
  });

  /**
   * [F7 L2] And the other side of that split: in the universe view one read serves the list and
   * the measurement, so a failure is ONE event, carrying the code of the state it draws.
   */
  // @rule R30
  it("emits exactly one error for the read the universe view draws", async () => {
    vi.mocked(searchMandatePools).mockRejectedValue(new Error("mock: pools unavailable"));
    const { onError } = renderStep();

    expect(
      await screen.findByText("Couldn't load the pools. Check your connection and try again."),
    ).toBeInTheDocument();
    expect(onError.mock.calls).toEqual([[{ code: "POOLS_FETCH_FAILED" }]]);
  });

  /**
   * [F5] The re-measure happens in every view, not only the one that shows the universe.
   *
   * Only a `universe` read writes the universe, so with a token search on screen the re-read used to
   * answer the SEARCH and the count stayed where it was until the manager cleared the field. The
   * measurement now runs beside the visible search, and must not replace it.
   */
  // @rule R13
  it("re-measures from a token search without disturbing the search on screen", async () => {
    const start = draftOn();
    const held = pool({ id: "u-weth-usdc" });
    const pulls = pool({ id: "u-arb-usdc", token0: side(ARB, "ARB"), token1: side(USDC, "USDC") });
    const widened = pool({
      id: "u-arb-weth",
      token0: side(ARB, "ARB"),
      token1: side(WETH, "WETH"),
    });
    const searched = pool({ id: "searched" });
    const reads = heldRounds({ tokenAddress: WETH, answer: [searched] });
    const user = userEvent.setup();
    const view = renderControlled(start);

    reads.settle([held, pulls]);
    await waitFor(() => expect(view.onUniverseCount).toHaveBeenLastCalledWith(2));

    // A token search takes over the list. WETH is not in this mandate, so the read answering it can
    // be told apart from the reads that measure the universe.
    await user.type(screen.getByLabelText("Token, pair or pool address"), "WETH");
    const options = await screen.findAllByRole("option");
    await user.click(options[0] as HTMLElement);
    await waitFor(() => expect(resultCard("searched")).toBeInTheDocument());

    const afterAdd = afterAdding({ ...start, poolUniverseCount: 2 }, [pulls]);
    expect(afterAdd.poolUniverseCount).toBeNull();
    view.onUniverseCount.mockClear();
    view.show(afterAdd);

    // The search is what the manager asked for, so it stays exactly where it was: the measurement
    // runs beside it rather than through it.
    expect(resultCard("searched")).toBeInTheDocument();

    reads.settle([held, pulls, widened]);

    await waitFor(() => expect(view.onUniverseCount).toHaveBeenLastCalledWith(3));
    expect(resultCard("searched")).toBeInTheDocument();
  });

  /**
   * [F7 L3] One read per signature, whichever view started it.
   *
   * A measurement started beside a search outlives that view by design. Returning to the universe
   * before it lands used to start a SECOND fan-out for the same mandate and throw the first answer
   * away, which is up to sixteen `/dex-pools` calls in real mode for a question already out, and
   * which contradicted the comment next to it. The read in flight is the one that answers, and when
   * the universe view is what is on screen by then, it fills the list too.
   */
  // @rule R13
  it("does not ask again when the universe view returns to a measurement in flight", async () => {
    const start = draftOn();
    const held = pool({ id: "u-weth-usdc" });
    const pulls = pool({ id: "u-arb-usdc", token0: side(ARB, "ARB"), token1: side(USDC, "USDC") });
    const widened = pool({
      id: "u-arb-weth",
      token0: side(ARB, "ARB"),
      token1: side(WETH, "WETH"),
    });
    const reads = heldRounds({ tokenAddress: WETH, answer: [pool({ id: "searched" })] });
    const user = userEvent.setup();
    const view = renderControlled(start);

    reads.settle([held, pulls]);
    await waitFor(() => expect(view.onUniverseCount).toHaveBeenLastCalledWith(2));

    await user.type(screen.getByLabelText("Token, pair or pool address"), "WETH");
    const options = await screen.findAllByRole("option");
    await user.click(options[0] as HTMLElement);
    await waitFor(() => expect(resultCard("searched")).toBeInTheDocument());

    // The Add pulls ARB in, so a measurement goes out while the search still holds the list.
    const beforeAdd = reads.asked();
    view.show(afterAdding({ ...start, poolUniverseCount: 2 }, [pulls]));
    const asked = reads.asked();
    expect(asked).toBeGreaterThan(beforeAdd);

    // Back to the universe before that measurement lands: the chip is the way out of the field.
    await user.click(screen.getByRole("button", { name: /Change$/ }));

    await waitFor(() => expect(screen.getByText("Loading pools…")).toBeInTheDocument());
    expect(reads.asked()).toBe(asked);

    reads.settle([held, pulls, widened]);

    // And the answer serves both: the count the flag divides by, and the list on screen.
    await waitFor(() => expect(view.onUniverseCount).toHaveBeenLastCalledWith(3));
    expect(resultCard("u-arb-weth")).toBeInTheDocument();
    expect(reads.asked()).toBe(asked);
  });

  /**
   * [F5] One question, one read. The measurement that is already on its way is the one that answers.
   */
  // @rule R13
  it("does not ask the universe twice when a search starts while it is in flight", async () => {
    const found = pool({ id: "u-weth-usdc" });
    const reads = heldRounds({ tokenAddress: WETH, answer: [pool({ id: "searched" })] });
    const user = userEvent.setup();
    const view = renderControlled(draftOn());

    // One read per mandate token, and this mandate has one locked deposit row. It is still out.
    expect(reads.asked()).toBe(1);

    await user.type(screen.getByLabelText("Token, pair or pool address"), "WETH");
    const options = await screen.findAllByRole("option");
    await user.click(options[0] as HTMLElement);
    await waitFor(() => expect(resultCard("searched")).toBeInTheDocument());

    reads.settle([found]);

    await waitFor(() => expect(view.onUniverseCount).toHaveBeenLastCalledWith(1));
    // The universe read plus the token search, and no second fan-out for a mandate that never
    // changed: in real mode that would be another `/dex-pools` call per mandate token.
    expect(reads.asked()).toBe(2);
  });

  /**
   * [F5] And the other direction: a pool whose two tokens were already in the mandate changes
   * nothing the universe was measured over, so the count stands and the flag it earns is raised.
   *
   * Without this, "re-measure when anything moves" would re-read on every Add and leave the flag
   * unreachable for as long as a read was in flight.
   */
  // @rule R13
  it("keeps the count when an Add pulled no token in, and raises the flag it earns", async () => {
    const held = pool({ id: "weth-usdc" });
    const chosen = pool({ id: "weth-arb", token0: side(WETH, "WETH"), token1: side(ARB, "ARB") });
    const start = { ...withEveryToken(draftOn()), pools: [chosen], poolUniverseCount: 2 };
    const reads = heldRounds();
    const view = renderControlled(start);

    reads.settle([held, chosen]);
    expect(await screen.findByText("1 pool with at least one of your tokens")).toBeInTheDocument();
    // The draft already carries the number, so there is nothing to tell it.
    expect(view.onUniverseCount).not.toHaveBeenCalled();
    const asked = reads.asked();

    const afterAdd = afterAdding(start, [held]);
    expect(afterAdd.poolUniverseCount).toBe(2);
    view.show(afterAdd);

    // Both halves of R13 are true now, and the count that proves it was never thrown away.
    expect(
      await screen.findByText("This strategy will carry a Broad mandate flag"),
    ).toBeInTheDocument();
    expect(reads.asked()).toBe(asked);
  });

  // @rule R30
  it("renders the step's own refusal and nobody else's", async () => {
    searchAnswers(pools(1));
    const { rerender } = renderStep(draftOn(), {
      block: { step: "pools", reason: "nothing_selected", rowId: null },
    });

    expect(await screen.findByText("Pick at least one to continue.")).toBeInTheDocument();

    rerender(
      <PoolsStep
        draft={draftOn()}
        catalog={catalog}
        update={vi.fn()}
        block={{ step: "tokens", reason: "no_slots", rowId: null }}
        onBlocked={vi.fn()}
      />,
    );
    expect(screen.queryByText("Pick at least one to continue.")).not.toBeInTheDocument();
  });
});
