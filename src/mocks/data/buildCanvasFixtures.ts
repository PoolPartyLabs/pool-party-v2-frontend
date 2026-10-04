/**
 * @id PP-MGR-MCK-004
 * @name buildCanvasFixtures
 * @implements-rules-version v1 (POO-2153 rules v1)
 * @analytics-events none, a data fixture: nothing here is rendered on its own or tracked.
 *
 * PP-MOCK. The reference canvases of the Build canvas handoff (v1.2) as layout inputs, plus the
 * states the handoff names but does not draw. They are the oracles of the layout function
 * (PP-MGR-LIB-023, `layoutGraph.oracles.test.ts`) and the data of the graph stories (S6).
 *
 * Each fixture is a {@link LayoutInput}, NOT a `BuildPlan`: networks are plain strings, so the
 * reference canvases keep Base and Polygon, which the mandate no longer offers (coordinator default
 * D15). They are never validated against a mandate and never reach a draft. There is no sample data
 * in real mode: these exist for tests and Storybook only.
 *
 * Plan structures (prerequisite task PT-1), read on 2026-10-03 from the Figma file
 * `jjOf5DL9uVEB7WBR9nGb4A` (Drafts page, section "Strategy Builder · fund contracts"), after the
 * Swap · auto redraw:
 *
 * - canvas A, frame 8099:2757 (graph 8219:2481): hub chains 15% [Swap · auto, WETH / USDC,
 *   Collect fees], 15% [Supply USDC, Swap · auto, WBTC / USDC, Collect fees], 10% [Swap · auto,
 *   Supply WETH, Borrow USDC]; spoke Base 35% with 15% [Swap · auto, cbBTC / USDC, Collect fees],
 *   10% [Swap · auto, WETH / USDC, Collect fees], 10% [Supply USDC]; spoke Robinhood Chain 25% with
 *   15% [Swap · auto, WETH / USDG, Collect fees], 10% [Swap · auto, WBTC / USDG, Collect fees].
 * - canvas B, frame 8119:2723 (graph 8207:2481): hub chains 30% [Supply USDC], 10% [Swap · auto,
 *   Supply WETH]; spoke Base 35% with 35% [Supply USDC]; spoke Polygon 25% with 25% [Supply USDC].
 * - canvas C, frame 8119:2921 (graph 8220:2481): worked example 1 of the handoff.
 * - canvas D, frame 8119:3062 (graph 8172:2110): the empty canvas.
 * - Build state 3, frame 8130:4133 (graph 8130:4749): one hub chain 0% [Swap · auto, empty pool].
 * - Build state 5, frame 8145:2061 (graph 8145:2689, drawn at 90%): one hub chain 60% [Swap · auto,
 *   WETH / USDC, Collect fees].
 *
 * Not drawn, built from the rules: worked example 2 (computed in the handoff), a new spoke with no
 * chain (ST9) and a hub with no chain beside a spoke (open point 10, default D10). Their
 * `figmaNode` is null.
 *
 * `content` maps every block id to what the card or pill prints, as plain data: S6's stories map
 * it onto the pieces' own content type, so this file imports nothing from `build/pieces/*`.
 */
import type {
  LayoutChain,
  LayoutInput,
  LayoutStep,
} from "@/features/manager/fund/build/layout/graphTypes";

/** What a fixture block prints. Plain data, mapped by the stories (S6) onto the pieces' types. */
export interface BlockContentFixture {
  title: string;
  caption: string;
  icon: string;
  state: "default" | "empty" | "invalid" | "comingSoon";
  selected?: boolean;
}

export interface BuildCanvasFixture {
  input: LayoutInput;
  /** Every block id of `input`, cards and pills. */
  content: Record<string, BlockContentFixture>;
  /** The Figma frame the fixture was read from (file `jjOf5DL9uVEB7WBR9nGb4A`); null if not drawn. */
  figmaNode: string | null;
}

/** The Figma file every `figmaNode` belongs to. */
export const BUILD_CANVAS_FIGMA_FILE = "jjOf5DL9uVEB7WBR9nGb4A";

const HUB = "arbitrum";

// ---------------------------------------------------------------------------
// Builders: a step and its printed content in one call, so they cannot drift apart.
// ---------------------------------------------------------------------------

type Entry = { step: LayoutStep; content: BlockContentFixture };

function swapAuto(id: string): Entry {
  return {
    step: { id, family: "flow", kind: "swap", auto: true, configured: true },
    content: { title: "Swap · auto", caption: "", icon: "swap", state: "default" },
  };
}

function collectFees(id: string): Entry {
  return {
    step: { id, family: "flow", kind: "collectFees", auto: false, configured: true },
    content: { title: "Collect fees", caption: "", icon: "coins", state: "default" },
  };
}

function pool(id: string, pair: string, fee: string): Entry {
  return {
    step: { id, family: "position", kind: "uniswapV4Pool", auto: false, configured: true },
    content: { title: pair, caption: `Uniswap v4 · ${fee}`, icon: "layers", state: "default" },
  };
}

function emptyPool(id: string): Entry {
  return {
    step: { id, family: "position", kind: "uniswapV4Pool", auto: false, configured: false },
    content: {
      title: "Uniswap v4",
      caption: "Pick a pool",
      icon: "layers",
      state: "empty",
      selected: true,
    },
  };
}

function supply(id: string, symbol: string, caption = "Aave v3"): Entry {
  return {
    step: { id, family: "position", kind: "aaveSupply", auto: false, configured: true },
    content: { title: `Supply ${symbol}`, caption, icon: "bank", state: "default" },
  };
}

function borrow(id: string, symbol: string): Entry {
  return {
    step: { id, family: "position", kind: "aaveBorrow", auto: false, configured: true },
    content: { title: `Borrow ${symbol}`, caption: "Aave v3", icon: "bank", state: "default" },
  };
}

interface ChainSpec {
  id: string;
  sharePct: number;
  entries: Entry[];
}

interface SpokeSpec {
  network: string;
  sharePct: number;
  chains: ChainSpec[];
}

function toChain(spec: ChainSpec): LayoutChain {
  return { id: spec.id, sharePct: spec.sharePct, steps: spec.entries.map((e) => e.step) };
}

function fixture(
  hub: ChainSpec[],
  spokes: SpokeSpec[],
  figmaNode: string | null,
): BuildCanvasFixture {
  const content: Record<string, BlockContentFixture> = {};
  for (const chain of [...hub, ...spokes.flatMap((s) => s.chains)]) {
    for (const entry of chain.entries) content[entry.step.id] = entry.content;
  }
  return {
    input: {
      hubNetwork: HUB,
      hub: { chains: hub.map(toChain) },
      spokes: spokes.map((s) => ({
        network: s.network,
        sharePct: s.sharePct,
        chains: s.chains.map(toChain),
      })),
    },
    content,
    figmaNode,
  };
}

// ---------------------------------------------------------------------------
// Reference canvases (drawn at 100% zoom: the measurement source)
// ---------------------------------------------------------------------------

/** Canvas A, complex: 3 networks, 10 positions, two return levels. 2080 x 772 as a plan. */
export const canvasA: BuildCanvasFixture = fixture(
  [
    {
      id: "a-hub-1",
      sharePct: 15,
      entries: [
        swapAuto("a-hub-1-swap"),
        pool("a-hub-1-pool", "WETH / USDC", "0.05%"),
        collectFees("a-hub-1-fees"),
      ],
    },
    {
      id: "a-hub-2",
      sharePct: 15,
      entries: [
        supply("a-hub-2-supply", "USDC"),
        swapAuto("a-hub-2-swap"),
        pool("a-hub-2-pool", "WBTC / USDC", "0.30%"),
        collectFees("a-hub-2-fees"),
      ],
    },
    {
      id: "a-hub-3",
      sharePct: 10,
      entries: [
        swapAuto("a-hub-3-swap"),
        supply("a-hub-3-supply", "WETH"),
        borrow("a-hub-3-borrow", "USDC"),
      ],
    },
  ],
  [
    {
      network: "base",
      sharePct: 35,
      chains: [
        {
          id: "a-base-1",
          sharePct: 15,
          entries: [
            swapAuto("a-base-1-swap"),
            pool("a-base-1-pool", "cbBTC / USDC", "0.05%"),
            collectFees("a-base-1-fees"),
          ],
        },
        {
          id: "a-base-2",
          sharePct: 10,
          entries: [
            swapAuto("a-base-2-swap"),
            pool("a-base-2-pool", "WETH / USDC", "0.05%"),
            collectFees("a-base-2-fees"),
          ],
        },
        {
          id: "a-base-3",
          sharePct: 10,
          entries: [supply("a-base-3-supply", "USDC", "Aave v3 · Base")],
        },
      ],
    },
    {
      network: "robinhood",
      sharePct: 25,
      chains: [
        {
          id: "a-rh-1",
          sharePct: 15,
          entries: [
            swapAuto("a-rh-1-swap"),
            pool("a-rh-1-pool", "WETH / USDG", "0.05%"),
            collectFees("a-rh-1-fees"),
          ],
        },
        {
          id: "a-rh-2",
          sharePct: 10,
          entries: [
            swapAuto("a-rh-2-swap"),
            pool("a-rh-2-pool", "WBTC / USDG", "0.30%"),
            collectFees("a-rh-2-fees"),
          ],
        },
      ],
    },
  ],
  "8099:2757",
);

/** Canvas B, intermediate: Aave on three networks, no pool, so no Income (fees). */
export const canvasB: BuildCanvasFixture = fixture(
  [
    { id: "b-hub-1", sharePct: 30, entries: [supply("b-hub-1-supply", "USDC")] },
    {
      id: "b-hub-2",
      sharePct: 10,
      entries: [swapAuto("b-hub-2-swap"), supply("b-hub-2-supply", "WETH")],
    },
  ],
  [
    {
      network: "base",
      sharePct: 35,
      chains: [
        {
          id: "b-base-1",
          sharePct: 35,
          entries: [supply("b-base-1-supply", "USDC", "Aave v3 · Base")],
        },
      ],
    },
    {
      network: "polygon",
      sharePct: 25,
      chains: [
        {
          id: "b-polygon-1",
          sharePct: 25,
          entries: [supply("b-polygon-1-supply", "USDC", "Aave v3 · Polygon")],
        },
      ],
    },
  ],
  "8119:2723",
);

/** Canvas C, simple: worked example 1 of the handoff. 608 x 674. */
export const canvasC: BuildCanvasFixture = fixture(
  [
    {
      id: "c-pool",
      sharePct: 60,
      entries: [
        swapAuto("c-pool-swap"),
        pool("c-pool-pool", "WETH / USDC", "0.05%"),
        collectFees("c-pool-fees"),
      ],
    },
    { id: "c-supply", sharePct: 40, entries: [supply("c-supply-supply", "USDC")] },
  ],
  [],
  "8119:2921",
);

/** Canvas D, empty: templates only. 468 x 572 with the English start-here sentence (420 wide). */
export const canvasD: BuildCanvasFixture = fixture([], [], "8119:3062");

// ---------------------------------------------------------------------------
// Build states (the same graph embedded in the Build step)
// ---------------------------------------------------------------------------

/** Build state 3: a pool block just added, empty and selected. */
export const buildState3: BuildCanvasFixture = fixture(
  [{ id: "s3-chain", sharePct: 0, entries: [swapAuto("s3-swap"), emptyPool("s3-pool")] }],
  [],
  "8130:4133",
);

/** Build state 5: one configured chain ending in Collect fees, a single return level (C11). */
export const buildState5: BuildCanvasFixture = fixture(
  [
    {
      id: "s5-chain",
      sharePct: 60,
      entries: [
        swapAuto("s5-swap"),
        pool("s5-pool", "WETH / USDC", "0.05%"),
        collectFees("s5-fees"),
      ],
    },
  ],
  [],
  "8145:2061",
);

// ---------------------------------------------------------------------------
// Not drawn: built from the rules
// ---------------------------------------------------------------------------

/** Worked example 2 of the handoff (computed from the rules): one hub chain and one spoke. */
export const workedExample2: BuildCanvasFixture = fixture(
  [
    {
      id: "we2-hub",
      sharePct: 40,
      entries: [
        swapAuto("we2-hub-swap"),
        pool("we2-hub-pool", "WETH / USDC", "0.05%"),
        collectFees("we2-hub-fees"),
      ],
    },
  ],
  [
    {
      network: "base",
      sharePct: 35,
      chains: [
        {
          id: "we2-base-a",
          sharePct: 20,
          entries: [
            swapAuto("we2-base-a-swap"),
            pool("we2-base-a-pool", "WETH / USDC", "0.05%"),
            collectFees("we2-base-a-fees"),
          ],
        },
        {
          id: "we2-base-b",
          sharePct: 15,
          entries: [supply("we2-base-b-supply", "USDC", "Aave v3 · Base")],
        },
      ],
    },
  ],
  null,
);

/** ST9: a network just added, so its spoke has its Bridge and a centred circle but no chain. */
export const newSpokeNoChain: BuildCanvasFixture = fixture(
  [
    {
      id: "nsp-hub",
      sharePct: 60,
      entries: [swapAuto("nsp-hub-swap"), pool("nsp-hub-pool", "WETH / USDC", "0.05%")],
    },
  ],
  [{ network: "robinhood", sharePct: 0, chains: [] }],
  null,
);

/** Open point 10, default D10: no hub chain, one spoke. The hub circle sits at the row's left end. */
export const hubEmptyWithSpoke: BuildCanvasFixture = fixture(
  [],
  [
    {
      network: "robinhood",
      sharePct: 40,
      chains: [
        {
          id: "hes-rh",
          sharePct: 40,
          entries: [swapAuto("hes-rh-swap"), pool("hes-rh-pool", "WETH / USDG", "0.05%")],
        },
      ],
    },
  ],
  null,
);

/** Every fixture by name, for tests and stories that sweep them all. */
export const BUILD_CANVAS_FIXTURES = {
  canvasA,
  canvasB,
  canvasC,
  canvasD,
  workedExample2,
  buildState3,
  buildState5,
  newSpokeNoChain,
  hubEmptyWithSpoke,
} as const satisfies Record<string, BuildCanvasFixture>;

export type BuildCanvasFixtureName = keyof typeof BUILD_CANVAS_FIXTURES;
