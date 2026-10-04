/**
 * @id PP-MGR-SCR-002
 * @name BuildScreen tests
 * @implements-rules-version v1 (POO-2157 rules v1)
 * @analytics-events none, the names are ASSERTED here rather than emitted; a test is never an
 *   emitter, so a screen cannot count as instrumented by being tested
 *
 * The Build canvas inside the fund builder (slice S7, POO-2157), driven the way a manager reaches
 * and uses it: through the REAL shell (`FundStrategyBuilderScreen`), the real draft store and the
 * real canvas, with a completed mandate resumed on `?phase=build`. Only the router, the analytics
 * sink, the toast and the Pools step's data adapter are stand-ins.
 *
 * What is proven here, by rule (handoff v1.2 ids, plan section 2 for AN, AE, G, HU, ST):
 * - [G2, AN1, D23] the canvas replaces the landing inside the unchanged shell, at full width;
 * - [I1, I2, I3, I4, I5, I6, I7, I10] add from a menu and from the palette, insert at a port,
 *   select, remove (through the panel's confirm since POO-2187), Delete, add and remove a network;
 * - [POO-2187, P3 to P10] the configuration panel live in the right column: Use, the draft, Apply
 *   changes and Discard, the notice on every way out and the way out completed after it, the
 *   Allocation's ceiling, the remove confirm, and the Edit mandate links that bring Build back
 *   with the same block selected. The registry is given the panel's FIXTURE pool body, because the
 *   real Uniswap v4 body is another slice;
 * - [AN4, D19] Next: Review's ordered refusals and their notices, never disabled;
 * - [HU3] every way out of the step asks the selection guard;
 * - [C6, A4] the Edit mandate links and the walk back to Build;
 * - [A8, D16] the plan survives Back, Save & exit and a reopen from the Console;
 * - [I8, I9] the canvas opens at fit and reveals the new block after a change;
 * - [ST11], the leave guard, the unreadable plan (D18), and the five event classes (AE1 to AE6).
 */
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import { MandateDraftsList } from "../components/MandateDraftsList";
import { buildMandateCatalog } from "../mandateCatalog";
import {
  addPool,
  createEmptyDraft,
  isBlocked,
  type MandateDraft,
  type MandatePoolRef,
  REQUIRED_PROTOCOLS,
  tokenKey,
  withProtocols,
} from "../mandateDraft";
import { getDraft, MANDATE_DRAFTS_KEY, upsertDraft } from "../mandateDraftStore";
import type { SelectionGuard, UseBlockSelectionResult } from "./blocks/useBlockSelection";
import { computeFit } from "./canvas/viewportMath";
import type { BuildPlan, PositionBlock, Step } from "./plan/buildPlan";
import { makeTestDraft } from "./plan/planTestKit";

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/manager/new",
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => nav.params }));

const analytics = vi.hoisted(() => ({ track: vi.fn(), trackFailure: vi.fn() }));
vi.mock("@/lib/analytics/useAnalytics", () => ({ useAnalytics: () => analytics }));

vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ flags: {}, isEnabled: () => false }),
}));

const toasts = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { error: vi.fn() });
  return { toast };
});
vi.mock("@/components/ui/Toast", () => ({ toast: toasts.toast }));

/** The Pools step's adapter, for the walk back through the Mandate (see the shell's tests). */
const poolSource = vi.hoisted(() => ({
  searchMandatePools: vi.fn(),
  findMandatePoolByAddress: vi.fn(),
}));
vi.mock("../mandatePoolSource", () => poolSource);

/**
 * The REAL selection hook, captured. No guard is registered in this batch (the panel batch brings
 * one), so the HU3 cases register a vetoing guard on the screen's own selection through this.
 */
const selectionSpy = vi.hoisted(() => ({ current: null as UseBlockSelectionResult | null }));

/** The panel's fixture pool body in the registry: the real Uniswap v4 body is its own slice. */
vi.mock("./panel/panelBodies", async (importOriginal) => {
  const real = await importOriginal<typeof import("./panel/panelBodies")>();
  const { fixturePoolBody } = await import("./panel/panelFixtures");
  return { ...real, PANEL_BODIES: { uniswapV4Pool: fixturePoolBody } };
});
vi.mock("./blocks/useBlockSelection", async (importOriginal) => {
  const real = await importOriginal<typeof import("./blocks/useBlockSelection")>();
  return {
    ...real,
    useBlockSelection: (initial?: string | null) => {
      const selection = real.useBlockSelection(initial);
      selectionSpy.current = selection;
      return selection;
    },
  };
});

import { FundStrategyBuilderScreen } from "../FundStrategyBuilderScreen";

const COMPLETED_AT = "2026-10-02T00:00:00.000Z";
const SAVED_AT = "2026-10-01T00:00:00.000Z";
const POOL_ID = "arb-weth-usdc-30";

/** Every event of one name the screen pushed, oldest first. */
function emitted(event: string): Record<string, unknown>[] {
  return analytics.track.mock.calls
    .filter((call) => call[0] === event)
    .map((call) => (call[1] ?? {}) as Record<string, unknown>);
}

/** A hub Uniswap v4 WETH / USDC pool, as the Pools step's adapter returns one. */
function arbPool(): MandatePoolRef {
  return {
    id: POOL_ID,
    address: "0xc6962004f452be9203591991d15f6b388e09e8d0",
    network: "arbitrum",
    protocol: "uniswap-v4",
    token0: {
      address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
      symbol: "WETH",
      name: "Wrapped Ether",
      logoUrl: null,
    },
    token1: {
      address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
      symbol: "USDC",
      name: "USD Coin",
      logoUrl: null,
    },
    feeBps: 30,
    feeTier: 3000,
    tvlUsd: 145_000_000,
    aprPct: 11.1,
    tierSharePct: null,
    hasHook: false,
  };
}

/**
 * A closed mandate on the hub: Uniswap v4 with one pool and every cap answered, so walking forward
 * through the five steps completes it again (built through the reducers, as the shell's tests do).
 */
function hubMandate(id: string): MandateDraft {
  const catalog = buildMandateCatalog();
  const base = withProtocols(createEmptyDraft(SAVED_AT, id), [...REQUIRED_PROTOCOLS, "uniswap-v4"]);
  const added = addPool(base, arbPool(), catalog);
  if (isBlocked(added)) throw new Error(`fixture: the pool was refused, ${added.blocked.reason}`);
  const weth = added.tokens.find((token) => !token.locked);
  if (!weth) throw new Error("fixture: the pool brought no token in");
  return {
    ...added,
    name: "ETH and BTC on Arbitrum",
    savedAt: SAVED_AT,
    passedSteps: ["networks", "protocols", "tokens", "pools", "limits"],
    lastStep: "limits",
    completedAt: COMPLETED_AT,
    caps: {
      networks: {},
      protocols: { "uniswap-v4": { noCap: true, pct: 0 } },
      tokens: { [tokenKey(weth)]: { noCap: true, pct: 0 } },
    },
  };
}

/** The two-network mandate of the plan test kit (Arbitrum and Robinhood Chain), closed. */
function twoNetworkMandate(id: string): MandateDraft {
  return { ...makeTestDraft(), id, savedAt: SAVED_AT, completedAt: COMPLETED_AT };
}

function autoSwap(id: string): Step {
  return { id, family: "flow", kind: "swap", auto: true };
}

/** A pool block, configured with every field the panels write (POO-2184) unless told otherwise. */
function pool(id: string, poolId: string | null, complete = true): PositionBlock {
  if (poolId === null) return { id, family: "position", kind: "uniswapV4Pool", config: null };
  const range = {
    tickLower: -199_380,
    tickUpper: -195_360,
    fullRange: false,
    displayInverted: false,
  };
  return {
    id,
    family: "position",
    kind: "uniswapV4Pool",
    config: complete ? { poolId, ...range, slippagePct: 2 } : { poolId },
  };
}

/** One hub chain at `pct`: [Swap · auto, the WETH / USDC pool], configured unless told otherwise. */
function poolPlan(pct = 60, poolId: string | null = POOL_ID): BuildPlan {
  return {
    version: 1,
    hub: {
      chains: [{ id: "c1", sharePct: pct, steps: [autoSwap("c1-swap"), pool("c1-pool", poolId)] }],
    },
    spokes: [],
  };
}

/** Store a closed mandate with a plan, last saved in Build, and point the deep link at it. */
function seedBuild(draft: MandateDraft, plan?: BuildPlan): void {
  const stored = upsertDraft({ ...draft, lastPhase: "build", ...(plan ? { plan } : {}) });
  if (!stored) throw new Error("fixture: seed write failed");
  nav.params = new URLSearchParams(`draft=${draft.id}&step=limits&phase=build`);
}

/** Render the shell and wait for the Build step. */
async function openBuild() {
  const view = renderWithProviders(<FundStrategyBuilderScreen />);
  await screen.findByRole("heading", { name: "Build your strategy" });
  return view;
}

/** Add a Uniswap v4 position from the hub's Add protocol menu. */
async function addPoolFromMenu() {
  await userEvent.click(screen.getByRole("button", { name: "Add protocol on Arbitrum" }));
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Uniswap v4 Liquidity position" }),
  );
}

/** The card of a block, by the start of its accessible name. */
function card(name: RegExp): HTMLElement {
  return screen.getByRole("button", { name });
}

/** The rendered graph (cards, pills, templates), apart from the palette and the panel. */
function graph(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[data-build-graph]");
  if (!element) throw new Error("no graph");
  return element;
}

/** The graph layer's transform: translate(x, y) scale(s). */
function view(): { x: number; y: number; scale: number } {
  const layer = document.querySelector<HTMLElement>("[data-canvas-layer]");
  const match = layer?.style.transform.match(
    /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/,
  );
  if (!match) throw new Error(`no transform on the layer: ${layer?.style.transform}`);
  return { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) };
}

/** The graph-px box of a card, from its positioned wrapper. */
function boxOf(element: HTMLElement): { x: number; y: number; w: number; h: number } {
  const wrapper = element.closest<HTMLElement>("[data-graph-node]");
  if (!wrapper) throw new Error("no positioned wrapper");
  return {
    x: Number.parseFloat(wrapper.style.left),
    y: Number.parseFloat(wrapper.style.top),
    w: Number.parseFloat(wrapper.style.width),
    h: Number.parseFloat(wrapper.style.height),
  };
}

const CANVAS = { width: 600, height: 640 };

/** jsdom lays nothing out: give the canvas box a size so fit and reveal have something to do. */
function measureCanvas(): void {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (!this.hasAttribute("data-canvas-viewport")) return original.call(this);
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: CANVAS.width,
      height: CANVAS.height,
      right: CANVAS.width,
      bottom: CANVAS.height,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

/** Whether a graph box is inside the canvas under the current view. */
function inView(box: { x: number; y: number; w: number; h: number }): boolean {
  const { x, y, scale } = view();
  const left = box.x * scale + x;
  const top = box.y * scale + y;
  return (
    left >= 0 &&
    top >= 0 &&
    left + box.w * scale <= CANVAS.width &&
    top + box.h * scale <= CANVAS.height
  );
}

/** Drag the canvas background far to the left, so the graph leaves the view. */
function panAway(): void {
  const canvas = document.querySelector<HTMLElement>("[data-canvas-viewport]");
  if (!canvas) throw new Error("no canvas");
  fireEvent.pointerDown(canvas, { button: 0, pointerId: 7, clientX: 500, clientY: 300 });
  fireEvent.pointerMove(canvas, { pointerId: 7, clientX: -2500, clientY: 300 });
  fireEvent.pointerUp(canvas, { pointerId: 7, clientX: -2500, clientY: 300 });
}

/** A guard that refuses every change, as the panel will while it holds unapplied changes. */
function vetoing(): { allowChange: (next: string | null) => boolean; onRefused: Mock<() => void> } {
  return { allowChange: () => false, onRefused: vi.fn<() => void>() };
}

function registerGuard(guard: SelectionGuard): void {
  const selection = selectionSpy.current;
  if (!selection) throw new Error("the Build screen has not mounted its selection");
  act(() => {
    selection.registerGuard(guard);
  });
}

beforeEach(() => {
  nav.push.mockClear();
  nav.replace.mockClear();
  nav.params = new URLSearchParams();
  analytics.track.mockClear();
  toasts.toast.mockClear();
  toasts.toast.error.mockClear();
  poolSource.searchMandatePools.mockReset();
  poolSource.searchMandatePools.mockResolvedValue([]);
  poolSource.findMandatePoolByAddress.mockReset();
  poolSource.findMandatePoolByAddress.mockResolvedValue({ pool: null, foundOn: null });
  selectionSpy.current = null;
  window.localStorage.clear();
  vi.stubGlobal("scrollTo", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("BuildScreen: the canvas replaces the Build landing (G2, AN1, D23, AE1)", () => {
  it("[G2, AN1] mounts the canvas inside the unchanged shell, with Build current", async () => {
    // @rule G2
    // @rule AN1
    seedBuild(hubMandate("d-mount"));
    await openBuild();

    expect(screen.getByRole("heading", { name: "Create new strategy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save & exit" })).toBeInTheDocument();
    // The V1 stepper, unchanged: only an EARLIER phase is a control, so Mandate is a button and
    // Review is not.
    expect(screen.getByRole("button", { name: "Mandate" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Review/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("build-palette")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Configure block" })).toBeInTheDocument();
    expect(screen.getByText("Nothing selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back: Mandate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next: Review" })).toBeEnabled();
    // The landing is gone, and so is its summary.
    expect(screen.queryByText(/The Build canvas for the fund contracts is in design/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Your mandate" })).toBeNull();
    expect(screen.queryByText(/MANDATE · STEP/)).toBeNull();
  });

  it("[D23] takes the full content width", async () => {
    // @rule D23
    seedBuild(hubMandate("d-width"));
    await openBuild();
    const section = screen.getByRole("heading", { name: "Create new strategy" }).closest("section");
    expect(section?.className).not.toMatch(/max-w-/);
  });

  it("[AE1] reports the view once, with what the plan held, and no Mandate step view", async () => {
    // @rule AE1
    seedBuild(hubMandate("d-view"), poolPlan());
    await openBuild();
    await waitFor(() =>
      expect(emitted("builder_build_viewed")).toEqual([{ blocks_count: 1, spokes_count: 0 }]),
    );
    expect(emitted("builder_mandate_step_viewed")).toHaveLength(0);
    expect(emitted("builder_build_landing_viewed")).toHaveLength(0);
    // A plan this build reads is no error.
    expect(emitted("builder_build_error")).toHaveLength(0);
  });

  it("[I8] opens at fit", async () => {
    // @rule I8
    measureCanvas();
    seedBuild(hubMandate("d-fit"), poolPlan());
    await openBuild();
    const layer = document.querySelector<HTMLElement>("[data-canvas-layer]");
    const graph = {
      width: Number.parseFloat(layer?.style.width ?? "0"),
      height: Number.parseFloat(layer?.style.height ?? "0"),
    };
    await waitFor(() => expect(view()).toEqual(computeFit(CANVAS, graph)));
  });
});

describe("BuildScreen: building the plan (I1 to I7, I10, AE2 to AE6)", () => {
  it("[I1, G6, AE2] adds a position from the Add protocol menu, empty and selected", async () => {
    // @rule I1
    // @rule G6
    // @rule AE2
    seedBuild(hubMandate("d-add"));
    await openBuild();

    await addPoolFromMenu();

    const added = card(/^Uniswap v4 · no pool yet/);
    expect(added).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Liquidity position · no pool yet")).toBeInTheDocument();
    expect(emitted("builder_build_started")).toHaveLength(1);
    expect(emitted("builder_block_added")).toEqual([
      { block_kind: "uniswapV4Pool", network: "arbitrum", via: "template" },
    ]);
    // The first block of an empty plan starts the phase; the order says so.
    const names = analytics.track.mock.calls.map((call) => call[0]);
    expect(names.indexOf("builder_build_started")).toBeLessThan(
      names.indexOf("builder_block_added"),
    );
  });

  // Review F10 of PR #41: the latch, not the empty plan, decides. A plan emptied and filled again in
  // the same visit does not start the phase twice.
  it("[AE1] starts the phase once per visit, even when the plan is emptied and filled again", async () => {
    // @rule AE1
    seedBuild(hubMandate("d-started-once"));
    await openBuild();

    await addPoolFromMenu();
    await userEvent.click(card(/^Uniswap v4 · no pool yet/));
    await userEvent.keyboard("{Delete}");
    // DP11: Delete asks first; an empty block's confirm says only "Remove this block?".
    expect(await screen.findByText("Remove this block?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove block" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Uniswap v4 · no pool yet/ })).toBeNull(),
    );
    await addPoolFromMenu();

    expect(emitted("builder_build_started")).toHaveLength(1);
    expect(emitted("builder_block_added")).toHaveLength(2);
  });

  it("[I3, AE2] adds a position dropped from the palette onto the Add protocol circle", async () => {
    // @rule I3
    // @rule AE2
    seedBuild(hubMandate("d-drop"));
    await openBuild();
    const circle = document.querySelector('[data-graph-target="addProtocol:arbitrum"]');
    if (!circle) throw new Error("no Add protocol circle");
    const row = document.querySelector<HTMLElement>('[data-palette-item="uniswapV4Pool"]');
    if (!row) throw new Error("no palette row");
    // jsdom has no hit testing: the drop point is the circle.
    const original = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => circle);
    try {
      fireEvent.pointerDown(row, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 400, clientY: 300 });
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 400, clientY: 300 });

      expect(await screen.findByRole("button", { name: /^Uniswap v4 · no pool yet/ })).toBeTruthy();
      expect(emitted("builder_block_added")).toEqual([
        { block_kind: "uniswapV4Pool", network: "arbitrum", via: "palette" },
      ]);
    } finally {
      document.elementFromPoint = original;
    }
  });

  it("[I4, AE4] inserts Collect fees through the port under a pool", async () => {
    // @rule I4
    // @rule AE4
    seedBuild(hubMandate("d-port"), poolPlan());
    await openBuild();

    await userEvent.click(
      screen.getByRole("button", { name: "Insert a flow block: Collect fees" }),
    );
    const menu = await screen.findByRole("menu", { name: "After WETH / USDC" });
    await userEvent.click(within(menu).getByRole("menuitem", { name: /^Collect fees/ }));

    // The pill on the canvas, and the Income (fees) block it creates (C10).
    expect(await within(graph()).findByText("Collect fees")).toBeInTheDocument();
    expect(within(graph()).getByText("Income (fees)")).toBeInTheDocument();
    expect(emitted("builder_flow_block_inserted")).toEqual([
      { block_kind: "collectFees", slot: "after" },
    ]);
    // A flow block is not a first block: nothing starts.
    expect(emitted("builder_build_started")).toHaveLength(0);
  });

  it("[I5, I6, P10, AE5] selects a card, asks before removing it, then removes its cascade", async () => {
    // @rule I5
    // @rule I6
    // @rule P10
    // @rule DP11
    // @rule AE5
    seedBuild(hubMandate("d-remove"), poolPlan());
    await openBuild();

    await userEvent.click(card(/^WETH \/ USDC/));
    expect(card(/^WETH \/ USDC/)).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Remove block" }));

    // Remove always asks, and says what goes with the block: nothing is removed yet.
    expect(screen.getByText("Remove WETH / USDC?")).toBeInTheDocument();
    expect(
      screen.getByText("Its 60% goes back to Idle input. Its Swap · auto step is removed with it."),
    ).toBeInTheDocument();
    expect(card(/^WETH \/ USDC/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Remove block" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: /^WETH \/ USDC/ })).toBeNull());
    expect(screen.getByText("Nothing selected")).toBeInTheDocument();
    expect(emitted("builder_block_removed")).toEqual([
      { block_kind: "uniswapV4Pool", cascade_count: 1 },
    ]);
    // DP11: the Undo toast is gone with the confirm that replaced it.
    expect(toasts.toast).not.toHaveBeenCalled();
  });

  it("[P10] Cancel keeps the block, its share and the selection", async () => {
    // @rule P10
    seedBuild(hubMandate("d-remove-cancel"), poolPlan());
    await openBuild();
    await userEvent.click(card(/^WETH \/ USDC/));
    await userEvent.click(screen.getByRole("button", { name: "Remove block" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Remove WETH / USDC?")).toBeNull();
    expect(card(/^WETH \/ USDC/)).toHaveAttribute("aria-pressed", "true");
    expect(emitted("builder_block_removed")).toEqual([]);
  });

  it("[I10, DP11] Delete opens the confirm of the selected card, and the confirm removes it", async () => {
    // @rule I10
    // @rule DP11
    seedBuild(hubMandate("d-delete"), poolPlan());
    await openBuild();

    await userEvent.click(card(/^WETH \/ USDC/));
    await userEvent.keyboard("{Delete}");

    expect(await screen.findByText("Remove WETH / USDC?")).toBeInTheDocument();
    expect(card(/^WETH \/ USDC/)).toBeInTheDocument();
    expect(emitted("builder_block_removed")).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Remove block" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^WETH \/ USDC/ })).toBeNull());
    expect(emitted("builder_block_removed")).toEqual([
      { block_kind: "uniswapV4Pool", cascade_count: 1 },
    ]);
  });

  it("[I2, I7, AE3] adds a network from the Add network menu, then removes it from its chip", async () => {
    // @rule I2
    // @rule I7
    // @rule AE3
    seedBuild(twoNetworkMandate("d-net"));
    await openBuild();

    await userEvent.click(screen.getByRole("button", { name: "Add network" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /^Robinhood Chain/ }));

    expect(
      await screen.findByRole("button", { name: "Add protocol on Robinhood Chain" }),
    ).toBeInTheDocument();
    expect(emitted("builder_network_added")).toEqual([{ network: "robinhood" }]);

    await userEvent.click(screen.getByRole("button", { name: "Remove Robinhood Chain" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Add protocol on Robinhood Chain" })).toBeNull(),
    );
    expect(emitted("builder_network_removed")).toEqual([{ network: "robinhood" }]);
  });

  it("[AE6] reports a gesture the canvas refuses, with the plan's own reason", async () => {
    // @rule AE6
    // A hub-only mandate: the Add network box stays, and pressing it is a refusal (D4).
    seedBuild(hubMandate("d-none-left"));
    await openBuild();

    await userEvent.click(screen.getByRole("button", { name: "Add network" }));

    expect(emitted("builder_build_blocked")).toEqual([{ block_reason: "no_network_left" }]);
  });
});

/** The configured pool chain, plus a chain holding a coming-soon Pendle block. */
function comingSoonPlan(): BuildPlan {
  const pendle: PositionBlock = { id: "soon", family: "position", kind: "pendle", config: null };
  const plan = poolPlan();
  plan.hub.chains.push({ id: "c2", sharePct: 0, steps: [pendle] });
  return plan;
}

/** Each Next: Review refusal: the plan, the notice it shows and the reason it reports. */
const REFUSALS: Array<[string, BuildPlan | undefined, string, string]> = [
  ["an empty plan", undefined, "Add a block before Review.", "review_empty_plan"],
  [
    "a block no longer in the mandate",
    poolPlan(60, "a-pool-the-mandate-dropped"),
    "Remove the blocks that are no longer in your mandate, or edit the mandate.",
    "review_invalid_block",
  ],
  [
    "a coming-soon block",
    comingSoonPlan(),
    "Remove the blocks that are coming soon.",
    "review_coming_soon_block",
  ],
  [
    "an empty block",
    poolPlan(60, null),
    "Configure every block before Review.",
    "review_empty_block",
  ],
  [
    "shares over the capital",
    poolPlan(120),
    "The shares add up to more than the capital above them.",
    "review_over_share",
  ],
  [
    "a pool picked but not finished",
    {
      version: 1,
      hub: {
        chains: [
          { id: "c1", sharePct: 60, steps: [autoSwap("c1-swap"), pool("c1-pool", POOL_ID, false)] },
        ],
      },
      spokes: [],
    },
    "Set a price range and a max slippage for every pool before Review.",
    "review_incomplete_block",
  ],
  [
    "a block with no share",
    poolPlan(0),
    "Give every block a share above 0%, or remove it.",
    "review_zero_share",
  ],
  [
    "a plan that passes every check",
    poolPlan(),
    "Review is not available yet.",
    "review_unavailable",
  ],
];

describe("BuildScreen: Next: Review (AN4, D19, AE6)", () => {
  it.each(
    REFUSALS,
  )("[AN4, D19] refuses %s with its own notice and reason", async (_label, plan, notice, reason) => {
    // @rule AN4
    // @rule D19
    // @rule AE6
    seedBuild(hubMandate("d-next"), plan);
    await openBuild();
    const next = screen.getByRole("button", { name: "Next: Review" });
    expect(next).toBeEnabled();

    await userEvent.click(next);

    expect(screen.getByRole("alert")).toHaveTextContent(notice);
    expect(emitted("builder_build_blocked")).toEqual([{ block_reason: reason }]);
    // Never leaves the step in this batch.
    expect(screen.getByRole("heading", { name: "Build your strategy" })).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("[AN4] the notice goes as soon as the plan changes", async () => {
    // @rule AN4
    seedBuild(hubMandate("d-notice"));
    await openBuild();
    await userEvent.click(screen.getByRole("button", { name: "Next: Review" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add a block before Review.");

    await addPoolFromMenu();

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("[AN4, I9] brings the first offending block into view", async () => {
    // @rule AN4
    // @rule I9
    measureCanvas();
    seedBuild(hubMandate("d-reveal-next"), poolPlan(60, null));
    await openBuild();
    panAway();
    const empty = card(/^Uniswap v4 · no pool yet/);
    expect(inView(boxOf(empty))).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Next: Review" }));

    await waitFor(() => expect(inView(boxOf(card(/^Uniswap v4 · no pool yet/)))).toBe(true));
  });
});

describe("BuildScreen: every way out asks the selection guard (HU3)", () => {
  async function guarded() {
    seedBuild(hubMandate("d-guard"), poolPlan());
    await openBuild();
    const guard = vetoing();
    registerGuard(guard);
    return guard;
  }

  it("[HU3] Back: Mandate", async () => {
    // @rule HU3
    const guard = await guarded();
    await userEvent.click(screen.getByRole("button", { name: "Back: Mandate" }));
    expect(guard.onRefused).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Build your strategy" })).toBeInTheDocument();
  });

  it("[HU3] the phase stepper's Mandate pill", async () => {
    // @rule HU3
    const guard = await guarded();
    await userEvent.click(screen.getByRole("button", { name: "Mandate" }));
    expect(guard.onRefused).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Build your strategy" })).toBeInTheDocument();
  });

  it("[HU3] Save & exit", async () => {
    // @rule HU3
    const guard = await guarded();
    await userEvent.click(screen.getByRole("button", { name: "Save & exit" }));
    expect(guard.onRefused).toHaveBeenCalledTimes(1);
    expect(nav.push).not.toHaveBeenCalled();
    expect(emitted("builder_draft_saved")).toHaveLength(0);
  });

  it("[HU3] both Edit mandate links", async () => {
    // @rule HU3
    const guard = await guarded();
    await userEvent.click(screen.getByRole("button", { name: "Add protocol on Arbitrum" }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Edit mandate · Protocols" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Add network" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit mandate · Networks" }));
    expect(guard.onRefused).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "Build your strategy" })).toBeInTheDocument();
  });

  it("[HU3] Next: Review, where it would leave the step", async () => {
    // @rule HU3
    const guard = await guarded();
    await userEvent.click(screen.getByRole("button", { name: "Next: Review" }));
    expect(guard.onRefused).toHaveBeenCalledTimes(1);
    // The guard answered; nothing else did.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(emitted("builder_build_blocked")).toHaveLength(0);
  });
});

/** Two hub chains on the one pool: c1 at 60%, c2 at 20%. */
function twoPoolPlan(): BuildPlan {
  return {
    version: 1,
    hub: {
      chains: [
        { id: "c1", sharePct: 60, steps: [autoSwap("c1-swap"), pool("c1-pool", POOL_ID)] },
        { id: "c2", sharePct: 20, steps: [autoSwap("c2-swap"), pool("c2-pool", POOL_ID)] },
      ],
    },
    spokes: [],
  };
}

/** The Configure block region. */
function panelRegion(): HTMLElement {
  return screen.getByRole("region", { name: "Configure block" });
}

/** Select the 60% card and move its Allocation one step down: changes not applied. */
async function dirtyFirstCard(): Promise<void> {
  await userEvent.click(card(/^WETH \/ USDC, .*60% of the capital/));
  const slider = within(panelRegion()).getByRole("slider", { name: "Allocation" });
  act(() => slider.focus());
  await userEvent.keyboard("{ArrowLeft}");
  expect(slider).toHaveAttribute("aria-valuenow", "55");
  expect(within(panelRegion()).getByText("Changes not applied")).toBeInTheDocument();
}

/** A press on the canvas background that does not pan (I5). */
function clickBackground(): void {
  const canvas = document.querySelector<HTMLElement>("[data-canvas-viewport]");
  if (!canvas) throw new Error("no canvas");
  fireEvent.pointerDown(canvas, { button: 0, pointerId: 9, clientX: 20, clientY: 20 });
  fireEvent.pointerUp(canvas, { pointerId: 9, clientX: 20, clientY: 20 });
}

/** Every way out of a block or of the step (P6): how to take it, and how to see it was taken. */
const EXITS: Array<[string, () => Promise<void>, () => Promise<void>]> = [
  [
    "another block",
    async () => userEvent.click(card(/^WETH \/ USDC, .*20% of the capital/)),
    async () =>
      expect(card(/^WETH \/ USDC, .*20% of the capital/)).toHaveAttribute("aria-pressed", "true"),
  ],
  [
    "the canvas background",
    async () => clickBackground(),
    async () => expect(await within(panelRegion()).findByText("Nothing selected")).toBeVisible(),
  ],
  [
    "an Edit mandate link",
    async () => {
      await userEvent.click(screen.getByRole("button", { name: "Add protocol on Arbitrum" }));
      await userEvent.click(
        await screen.findByRole("menuitem", { name: "Edit mandate · Protocols" }),
      );
    },
    async () => expect(await screen.findByText("MANDATE · STEP 2 OF 5")).toBeInTheDocument(),
  ],
  [
    "Back: Mandate",
    async () => userEvent.click(screen.getByRole("button", { name: "Back: Mandate" })),
    async () => expect(await screen.findByText("MANDATE · STEP 5 OF 5")).toBeInTheDocument(),
  ],
  [
    "Next: Review",
    async () => userEvent.click(screen.getByRole("button", { name: "Next: Review" })),
    async () => expect(await screen.findByText("Review is not available yet.")).toBeInTheDocument(),
  ],
  [
    "Save & exit",
    async () => userEvent.click(screen.getByRole("button", { name: "Save & exit" })),
    async () => waitFor(() => expect(nav.push).toHaveBeenCalledWith("/manager")),
  ],
  [
    "the stepper's Mandate pill",
    async () => userEvent.click(screen.getByRole("button", { name: "Mandate" })),
    async () => expect(await screen.findByText("MANDATE · STEP 5 OF 5")).toBeInTheDocument(),
  ],
];

describe("BuildScreen: the configuration panel (POO-2187, P3 to P10)", () => {
  it("[P7, DP1] Use writes the pool with its defaults at 0%, and the panel opens configured", async () => {
    // @rule P7
    // @rule DP1
    seedBuild(hubMandate("d-use"), poolPlan(0, null));
    await openBuild();
    await userEvent.click(card(/^Uniswap v4 · no pool yet/));
    const region = panelRegion();
    expect(within(region).getByText("Pools in your mandate ·")).toBeInTheDocument();

    await userEvent.click(within(region).getByRole("button", { name: "Use WETH / USDC" }));

    expect(await within(region).findByText("All changes applied")).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Apply changes" })).toBeDisabled();
    // The card shows the pool at once, at 0% of the capital (DP1).
    expect(card(/^WETH \/ USDC, .*, 0% of the capital/)).toBeInTheDocument();
    expect(emitted("builder_block_configured")).toEqual([
      { block_kind: "uniswapV4Pool", network: "arbitrum" },
    ]);
  });

  it("[P3, P5] an edit changes nothing on the canvas until Apply changes", async () => {
    // @rule P3
    // @rule P5
    seedBuild(hubMandate("d-apply"), twoPoolPlan());
    await openBuild();
    await dirtyFirstCard();
    // The canvas still shows the applied share.
    expect(card(/^WETH \/ USDC, .*60% of the capital/)).toBeInTheDocument();
    await userEvent.click(within(panelRegion()).getByRole("button", { name: "Apply changes" }));

    expect(await within(panelRegion()).findByText("All changes applied")).toBeInTheDocument();
    expect(card(/^WETH \/ USDC, .*55% of the capital/)).toBeInTheDocument();
    expect(emitted("builder_block_applied")).toEqual([
      { block_kind: "uniswapV4Pool", fields_changed: "allocation" },
    ]);
  });

  it("[P5] Discard restores the applied values", async () => {
    // @rule P5
    seedBuild(hubMandate("d-discard"), twoPoolPlan());
    await openBuild();
    await dirtyFirstCard();
    await userEvent.click(within(panelRegion()).getByRole("button", { name: "Discard" }));
    expect(within(panelRegion()).getByRole("slider", { name: "Allocation" })).toHaveAttribute(
      "aria-valuenow",
      "60",
    );
    expect(within(panelRegion()).getByText("All changes applied")).toBeInTheDocument();
    expect(emitted("builder_block_discarded")).toEqual([{ block_kind: "uniswapV4Pool" }]);
  });

  it.each(
    EXITS,
  )("[P6] leaving through %s keeps the step and shows the notice; Apply changes then leaves", async (_name, leave, left) => {
    // @rule P6
    seedBuild(hubMandate("d-p6-apply"), twoPoolPlan());
    await openBuild();
    await dirtyFirstCard();

    await leave();

    const notice = within(panelRegion()).getByRole("alert");
    expect(notice).toHaveTextContent("Changes not applied");
    expect(notice).toHaveTextContent("Apply or discard the changes before you move");
    expect(notice).toHaveFocus();
    expect(card(/^WETH \/ USDC, .*60% of the capital/)).toHaveAttribute("aria-pressed", "true");
    expect(emitted("builder_block_leave_blocked")).toEqual([{ block_kind: "uniswapV4Pool" }]);
    expect(nav.push).not.toHaveBeenCalled();

    await userEvent.click(within(panelRegion()).getByRole("button", { name: "Apply changes" }));

    await left();
    expect(emitted("builder_block_applied")).toEqual([
      { block_kind: "uniswapV4Pool", fields_changed: "allocation" },
    ]);
  });

  it.each(
    EXITS.filter(([name]) => name === "another block" || name === "Back: Mandate"),
  )("[P6] leaving through %s, then Discard changes, restores and leaves", async (_name, leave, left) => {
    // @rule P6
    seedBuild(hubMandate("d-p6-discard"), twoPoolPlan());
    await openBuild();
    await dirtyFirstCard();
    await leave();
    await userEvent.click(within(panelRegion()).getByRole("button", { name: "Discard changes" }));
    await left();
    expect(emitted("builder_block_discarded")).toEqual([{ block_kind: "uniswapV4Pool" }]);
  });

  it("[P8, P9] the Allocation stops at the mandate cap and says so, with the Limits link", async () => {
    // @rule P8
    // @rule P9
    const mandate = hubMandate("d-cap");
    seedBuild(
      {
        ...mandate,
        caps: { ...mandate.caps, protocols: { "uniswap-v4": { noCap: false, pct: 70 } } },
      },
      poolPlan(60),
    );
    await openBuild();
    await userEvent.click(card(/^WETH \/ USDC/));
    const slider = within(panelRegion()).getByRole("slider", { name: "Allocation" });
    expect(slider).toHaveAttribute("aria-valuemax", "70");
    act(() => slider.focus());
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");

    expect(slider).toHaveAttribute("aria-valuenow", "70");
    expect(
      within(panelRegion()).getByText("Maximum reached. Your mandate caps Uniswap v4 at 70%."),
    ).toBeInTheDocument();
    expect(emitted("builder_block_limit_hit")).toEqual([
      { block_kind: "uniswapV4Pool", limit: "mandate_cap" },
    ]);
    // Apply first: the link is a way out, and the panel would hold it otherwise.
    await userEvent.click(within(panelRegion()).getByRole("button", { name: "Apply changes" }));
    await userEvent.click(
      within(panelRegion()).getByRole("button", { name: "Edit mandate · Limits" }),
    );
    expect(await screen.findByText("MANDATE · STEP 5 OF 5")).toBeInTheDocument();
  });

  it("[finding 19] an Edit mandate link brings Build back with the same block selected", async () => {
    // @rule C6
    // @rule P1
    seedBuild(hubMandate("d-return"), poolPlan(0, null));
    await openBuild();
    await userEvent.click(card(/^Uniswap v4 · no pool yet/));
    await userEvent.click(
      within(panelRegion()).getByRole("button", { name: "Edit mandate · Pools" }),
    );

    expect(await screen.findByText("MANDATE · STEP 4 OF 5")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Next: Limits" }));
    await userEvent.click(await screen.findByRole("button", { name: "Next: Build strategy" }));

    await screen.findByRole("heading", { name: "Build your strategy" });
    expect(card(/^Uniswap v4 · no pool yet/)).toHaveAttribute("aria-pressed", "true");
    expect(within(panelRegion()).getByText("Pools in your mandate ·")).toBeInTheDocument();
  });
});

describe("BuildScreen: Edit mandate and the way back (C6, A4)", () => {
  it("[C6, A4] Edit mandate · Protocols opens step 2, and walking forward returns to Build intact", async () => {
    // @rule C6
    // @rule A4
    seedBuild(hubMandate("d-edit-protocols"), poolPlan());
    await openBuild();

    await userEvent.click(screen.getByRole("button", { name: "Add protocol on Arbitrum" }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Edit mandate · Protocols" }),
    );

    expect(await screen.findByText("MANDATE · STEP 2 OF 5")).toBeInTheDocument();
    for (const next of ["Next: Tokens", "Next: Pools", "Next: Limits"]) {
      await userEvent.click(await screen.findByRole("button", { name: next }));
    }
    await userEvent.click(await screen.findByRole("button", { name: "Next: Build strategy" }));

    await screen.findByRole("heading", { name: "Build your strategy" });
    expect(card(/^WETH \/ USDC/)).toBeInTheDocument();
    expect(getDraft("d-edit-protocols")?.plan).toEqual(poolPlan());
  });

  it("[C6] Edit mandate · Networks opens step 1 with the plan in the draft", async () => {
    // @rule C6
    seedBuild(hubMandate("d-edit-networks"), poolPlan());
    await openBuild();

    await userEvent.click(screen.getByRole("button", { name: "Add network" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit mandate · Networks" }));

    expect(await screen.findByText("MANDATE · STEP 1 OF 5")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save & exit" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/manager"));
    expect(getDraft("d-edit-networks")?.plan).toEqual(poolPlan());
    // Saved from the Mandate phase, so it resumes there (D16).
    expect(getDraft("d-edit-networks")?.lastPhase).toBe("mandate");
  });
});

describe("BuildScreen: the plan survives (A8, D16)", () => {
  /** Press Open on the Console's Drafts card and follow where it pushes. */
  async function openFromConsole(): Promise<URLSearchParams> {
    nav.push.mockClear();
    const console = renderWithProviders(<MandateDraftsList />);
    await userEvent.click(await screen.findByRole("button", { name: /^Open/ }));
    const href = String(nav.push.mock.calls[0]?.[0] ?? "");
    console.unmount();
    return new URLSearchParams(href.split("?")[1] ?? "");
  }

  it("[A8, D16] Build, Save & exit, then the Console Open lands on Build with the plan", async () => {
    // @rule A8
    // @rule D16
    seedBuild(hubMandate("d-round-build"));
    const first = await openBuild();
    await addPoolFromMenu();
    await userEvent.click(screen.getByRole("button", { name: "Save & exit" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/manager"));
    first.unmount();

    const stored = getDraft("d-round-build");
    expect(stored?.lastPhase).toBe("build");
    expect(stored?.plan?.hub.chains).toHaveLength(1);

    nav.params = await openFromConsole();
    expect(nav.params.get("phase")).toBe("build");
    renderWithProviders(<FundStrategyBuilderScreen />);

    expect(await screen.findByRole("heading", { name: "Build your strategy" })).toBeInTheDocument();
    expect(card(/^Uniswap v4 · no pool yet/)).toBeInTheDocument();
  });

  it("[A8, D16] Build, Back, Save & exit, then the Console Open lands on the Mandate step", async () => {
    // @rule A8
    // @rule D16
    seedBuild(hubMandate("d-round-back"), poolPlan());
    const first = await openBuild();
    await userEvent.click(screen.getByRole("button", { name: "Back: Mandate" }));
    await screen.findByText("MANDATE · STEP 5 OF 5");
    await userEvent.click(screen.getByRole("button", { name: "Save & exit" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/manager"));
    first.unmount();

    const stored = getDraft("d-round-back");
    expect(stored?.lastPhase).toBe("mandate");
    expect(stored?.plan).toEqual(poolPlan());

    nav.params = await openFromConsole();
    expect(nav.params.get("phase")).toBeNull();
    renderWithProviders(<FundStrategyBuilderScreen />);

    expect(await screen.findByText("MANDATE · STEP 5 OF 5")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Build your strategy" })).toBeNull();
  });

  it("[A8] the plan survives Back to Mandate and the way forward again", async () => {
    // @rule A8
    seedBuild(hubMandate("d-round-trip"), poolPlan());
    await openBuild();
    await userEvent.click(screen.getByRole("button", { name: "Back: Mandate" }));
    await userEvent.click(await screen.findByRole("button", { name: "Next: Build strategy" }));

    await screen.findByRole("heading", { name: "Build your strategy" });
    expect(card(/^WETH \/ USDC/)).toBeInTheDocument();
  });
});

/** Whether the browser's leave prompt is armed: a cancelable `beforeunload` gets prevented. */
function beforeUnloadPrevented(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("BuildScreen: leaving (leave guard, AE abandonment and error)", () => {
  it("[Leave guard, AE] without plan edits: no prompt, and the abandonment says nothing was lost", async () => {
    // @rule AE1
    seedBuild(hubMandate("d-leave-clean"), poolPlan());
    const rendered = await openBuild();
    expect(beforeUnloadPrevented()).toBe(false);

    rendered.unmount();

    expect(emitted("builder_build_abandoned")).toEqual([{ draft_saved: true, blocks_count: 1 }]);
    expect(emitted("builder_mandate_abandoned")).toHaveLength(0);
  });

  it("[Leave guard, AE] a plan edit arms the prompt, and the abandonment says it was lost", async () => {
    // @rule AE1
    seedBuild(hubMandate("d-leave-dirty"));
    const rendered = await openBuild();
    await addPoolFromMenu();
    await waitFor(() => expect(beforeUnloadPrevented()).toBe(true));

    rendered.unmount();

    expect(emitted("builder_build_abandoned")).toEqual([{ draft_saved: false, blocks_count: 1 }]);
    expect(emitted("builder_mandate_abandoned")).toHaveLength(0);
  });

  /**
   * Review F3 of PR #41: after Back: Mandate the session is the Mandate's to report, and a block
   * added on the canvas and never saved is work lost, so `draft_saved` cannot say true.
   */
  it("[AE] Back: Mandate with an unsaved plan edit, then leaving, reports the work as lost", async () => {
    // @rule AE1
    seedBuild(hubMandate("d-leave-back"));
    const rendered = await openBuild();
    await addPoolFromMenu();
    await userEvent.click(screen.getByRole("button", { name: "Back: Mandate" }));
    await screen.findByText("MANDATE · STEP 5 OF 5");

    rendered.unmount();

    expect(emitted("builder_mandate_abandoned")).toEqual([{ step: "limits", draft_saved: false }]);
    expect(emitted("builder_build_abandoned")).toHaveLength(0);
  });

  it("[AE] Save & exit from Build is not an abandonment", async () => {
    // @rule AE1
    seedBuild(hubMandate("d-leave-saved"));
    const rendered = await openBuild();
    await addPoolFromMenu();
    await userEvent.click(screen.getByRole("button", { name: "Save & exit" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/manager"));

    rendered.unmount();

    expect(emitted("builder_build_abandoned")).toHaveLength(0);
    expect(toasts.toast).toHaveBeenCalledWith("Draft saved");
  });

  it("[AE] a save that fails from Build is a Build error, and the manager stays", async () => {
    // @rule AE1
    seedBuild(hubMandate("d-leave-fail"));
    await openBuild();
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
      clear: () => {},
    });

    await userEvent.click(screen.getByRole("button", { name: "Save & exit" }));

    await waitFor(() =>
      expect(emitted("builder_build_error")).toEqual([
        { error_code: "DRAFT_SAVE_FAILED", error_origin: "app" },
      ]),
    );
    expect(emitted("builder_mandate_error")).toHaveLength(0);
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Build your strategy" })).toBeInTheDocument();
  });
});

describe("BuildScreen: loading and an unreadable plan (ST11, D18)", () => {
  it("[ST11] an unknown draft id opens a fresh mandate, even with phase=build", async () => {
    // @rule ST11
    nav.params = new URLSearchParams("draft=d-missing&step=limits&phase=build");
    renderWithProviders(<FundStrategyBuilderScreen />);

    expect(await screen.findByText("MANDATE · STEP 1 OF 4")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Build your strategy" })).toBeNull();
  });

  it("[D18] says the stored plan cannot be opened, and never overwrites it unless a new plan is made", async () => {
    // @rule D18
    const unreadable = { version: 99, hub: { chains: [] }, spokes: [] };
    seedBuild(hubMandate("d-unreadable"), unreadable as unknown as BuildPlan);
    expect(getDraft("d-unreadable")?.planUnreadable).toBe(true);
    await openBuild();

    expect(screen.getByRole("status")).toHaveTextContent(
      "This draft holds a plan this version of the app cannot open.",
    );
    // The empty canvas, never a guess at the plan.
    expect(screen.getByText(/Start here: add a protocol on Arbitrum/)).toBeInTheDocument();
    // [AE] Stored data this screen cannot use is an error of ours, reported once per visit (review
    // F11 of PR #41).
    await waitFor(() =>
      expect(emitted("builder_build_error")).toEqual([
        { error_code: "PLAN_UNREADABLE", error_origin: "app" },
      ]),
    );

    await userEvent.click(screen.getByRole("button", { name: "Save & exit" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/manager"));

    const raw = JSON.parse(window.localStorage.getItem(MANDATE_DRAFTS_KEY) ?? "{}");
    expect(raw.drafts["d-unreadable"].plan).toEqual(unreadable);
  });

  /**
   * Review F1 of PR #41: add a block, remove it, Save & exit used to write an EMPTY version 1 plan
   * over the one this build could not read, with no notice on screen and no leave prompt. An empty
   * plan is not a plan the manager made, so the stored one has to survive it.
   */
  it("[D18] add then remove leaves the unreadable stored plan in place, and keeps saying so", async () => {
    // @rule D18
    const unreadable = { version: 99, hub: { chains: [] }, spokes: [] };
    seedBuild(hubMandate("d-unreadable-undo"), unreadable as unknown as BuildPlan);
    await openBuild();

    await addPoolFromMenu();
    // A plan with a block in it: a save would replace the stored one, so the notice still says it
    // and the leave prompt is armed.
    expect(screen.getByRole("status")).toHaveTextContent(
      "This draft holds a plan this version of the app cannot open.",
    );
    await waitFor(() => expect(beforeUnloadPrevented()).toBe(true));

    await userEvent.click(card(/^Uniswap v4 · no pool yet/));
    await userEvent.keyboard("{Delete}");
    // DP11: Delete asks first; an empty block's confirm says only "Remove this block?".
    expect(await screen.findByText("Remove this block?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove block" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Uniswap v4 · no pool yet/ })).toBeNull(),
    );

    // Empty again: nothing to save, so no prompt, and the notice stays.
    await waitFor(() => expect(beforeUnloadPrevented()).toBe(false));
    expect(screen.getByRole("status")).toHaveTextContent(
      "This draft holds a plan this version of the app cannot open.",
    );

    await userEvent.click(screen.getByRole("button", { name: "Save & exit" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/manager"));

    const raw = JSON.parse(window.localStorage.getItem(MANDATE_DRAFTS_KEY) ?? "{}");
    expect(raw.drafts["d-unreadable-undo"].plan).toEqual(unreadable);
  });

  it("[D18] a plan with a block replaces the unreadable one when saved, and the notice goes", async () => {
    // @rule D18
    const unreadable = { version: 99, hub: { chains: [] }, spokes: [] };
    seedBuild(hubMandate("d-unreadable-new"), unreadable as unknown as BuildPlan);
    await openBuild();

    await addPoolFromMenu();
    await userEvent.click(screen.getByRole("button", { name: "Save & exit" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/manager"));

    const raw = JSON.parse(window.localStorage.getItem(MANDATE_DRAFTS_KEY) ?? "{}");
    expect(raw.drafts["d-unreadable-new"].plan.version).toBe(1);
    expect(raw.drafts["d-unreadable-new"].plan.hub.chains).toHaveLength(1);
    expect(getDraft("d-unreadable-new")?.planUnreadable).toBeUndefined();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("BuildScreen: the view follows the change (I9)", () => {
  it("[I9] reveals the block just added, even when the view was moved away", async () => {
    // @rule I9
    measureCanvas();
    seedBuild(hubMandate("d-reveal-add"));
    await openBuild();
    panAway();

    await addPoolFromMenu();

    await waitFor(() => expect(inView(boxOf(card(/^Uniswap v4 · no pool yet/)))).toBe(true));
  });

  // Review F10 of PR #41: a flow block is never selected, so the reveal follows the new block itself.
  it("[I9] reveals a flow block inserted at a port, even when the view was moved away", async () => {
    // @rule I9
    measureCanvas();
    seedBuild(hubMandate("d-reveal-insert"), poolPlan());
    await openBuild();
    panAway();

    await userEvent.click(
      screen.getByRole("button", { name: "Insert a flow block: Collect fees" }),
    );
    const menu = await screen.findByRole("menu", { name: "After WETH / USDC" });
    await userEvent.click(within(menu).getByRole("menuitem", { name: /^Collect fees/ }));

    const pill = await within(graph()).findByText("Collect fees");
    await waitFor(() => expect(inView(boxOf(pill))).toBe(true));
  });
});
