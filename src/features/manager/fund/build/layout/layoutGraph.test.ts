/**
 * @id PP-MGR-LIB-023
 * @name layoutGraph rule tests
 * @implements-rules-version v1 (POO-2153 rules v1)
 * @analytics-events none, a pure geometry module: nothing here is rendered or tracked.
 *
 * One test (or one table) per rule of the layout, tagged with its handoff id. The exact coordinates
 * of the reference canvases live in `layoutGraph.oracles.test.ts`; this file proves the RULES hold
 * for every fixture and under edits:
 *
 * - C1 purity and determinism, C21 no per-case numbers (a scan of the source);
 * - C2 spine, C3 groups, C9 entry and exit points, C10 and C11 return paths and levels;
 * - C16 template placement, C17 ports from `portSlotsOf`, C20 symmetry of a spoke;
 * - C18 and A5 (property test over every chain of every fixture: an insert or a remove moves the
 *   other chains and groups by one uniform dx only, and dx changes only when Idle output and Income
 *   decide the leftmost content), with the Build state 5 case explicit;
 * - A3 spacing, ST9 a new spoke, D10 a hub with no chain beside a spoke;
 * - L3 to L6 and L10 on every fixture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUILD_CANVAS_FIXTURES,
  type BuildCanvasFixture,
  buildState5,
  canvasA,
  canvasB,
  canvasC,
  canvasD,
  hubEmptyWithSpoke,
  newSpokeNoChain,
  workedExample2,
} from "@/mocks/data/buildCanvasFixtures";
import * as planRules from "../plan/planRules";
import type { GraphLayout, LayoutChain, LayoutInput, LayoutStep, Rect } from "./graphTypes";
import { LAYOUT } from "./layoutConstants";
import { layoutGraph } from "./layoutGraph";
import { horizontalRuns, nodeRects, verticalsAt } from "./layoutTestKit";

const real = vi.hoisted(() => ({
  portSlotsOf: null as null | typeof import("../plan/planRules").portSlotsOf,
}));

vi.mock("../plan/planRules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../plan/planRules")>();
  real.portSlotsOf = actual.portSlotsOf;
  return { ...actual, portSlotsOf: vi.fn(actual.portSlotsOf) };
});

beforeEach(() => {
  const spy = vi.mocked(planRules.portSlotsOf);
  spy.mockClear();
  if (real.portSlotsOf) spy.mockImplementation(real.portSlotsOf);
});

const EN = { startHereWidth: 420 };
const FIXTURES = Object.entries(BUILD_CANVAS_FIXTURES) as Array<[string, BuildCanvasFixture]>;
const WITH_CHAINS = FIXTURES.filter(([, f]) => chainsOf(f.input).length > 0);

function chainsOf(input: LayoutInput): Array<{ chain: LayoutChain; network: string }> {
  return [
    ...input.hub.chains.map((chain) => ({ chain, network: input.hubNetwork })),
    ...input.spokes.flatMap((s) => s.chains.map((chain) => ({ chain, network: s.network }))),
  ];
}

function right(r: Rect): number {
  return r.x + r.w;
}

function bottom(r: Rect): number {
  return r.y + r.h;
}

function centreX(r: Rect): number {
  return r.x + r.w / 2;
}

function spine(layout: GraphLayout, role: string): Rect {
  const node = layout.spine.find((n) => n.role === role);
  if (!node) throw new Error(`no ${role}`);
  return node.rect;
}

function blockRect(layout: GraphLayout, id: string): Rect {
  const node = layout.blocks.find((b) => b.id === id);
  if (!node) throw new Error(`no block ${id}`);
  return node.rect;
}

function hubCircle(layout: GraphLayout): Rect {
  const t = layout.templates.find(
    (n) => n.target.kind === "addProtocol" && n.target.network === "arbitrum",
  );
  if (!t) throw new Error("no hub circle");
  return t.rect;
}

function circleOf(layout: GraphLayout, network: string): Rect {
  const t = layout.templates.find(
    (n) => n.target.kind === "addProtocol" && n.target.network === network,
  );
  if (!t) throw new Error(`no circle on ${network}`);
  return t.rect;
}

function netbox(layout: GraphLayout): Rect {
  const t = layout.templates.find((n) => n.target.kind === "addNetwork");
  if (!t) throw new Error("no Add network box");
  return t.rect;
}

/** Every box the graph size covers. */
function contentRects(layout: GraphLayout): Rect[] {
  return [
    ...layout.spine.map((n) => n.rect),
    ...layout.blocks.map((n) => n.rect),
    ...layout.bridges.map((n) => n.rect),
    ...layout.groups.map((n) => n.rect),
    ...layout.templates.map((n) => n.rect),
    ...(layout.emptyCaptions ? [layout.emptyCaptions.startHere] : []),
  ];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// C1, C21: pure, deterministic, one rule set
// ---------------------------------------------------------------------------

describe("[C1] a pure function of the plan", () => {
  // @rule C1
  it.each(FIXTURES)("[C1] gives deep-equal output for equal input (%s)", (_name, fixture) => {
    const a = layoutGraph(fixture.input, EN);
    const b = layoutGraph(structuredClone(fixture.input), { ...EN });
    expect(b).toEqual(a);
    expect(b).not.toBe(a);
  });

  // @rule C1
  it.each(FIXTURES)("[C1] never mutates its input (%s)", (_name, fixture) => {
    const frozen = deepFreeze(structuredClone(fixture.input));
    expect(() => layoutGraph(frozen, EN)).not.toThrow();
  });

  // @rule C1
  it("[C1] uses no DOM, no React, no clock and no randomness", () => {
    const dir = join(__dirname);
    for (const file of [
      "graphTypes.ts",
      "layoutConstants.ts",
      "layoutGraph.ts",
      "toLayoutInput.ts",
    ]) {
      const code = stripComments(readFileSync(join(dir, file), "utf8"));
      expect(code, file).not.toMatch(
        /from\s+"react|document\.|window\.|Math\.random|Date\b|performance\./,
      );
    }
  });

  // @rule C21
  it("[C21] carries no per-case number: every distance comes from LAYOUT", () => {
    const code = stripComments(readFileSync(join(__dirname, "layoutGraph.ts"), "utf8"));
    const numbers = [...code.matchAll(/(?<![\w.])\d+(?:\.\d+)?(?![\w.])/g)].map((m) =>
      Number(m[0]),
    );
    expect(numbers.filter((n) => n !== 0 && n !== 1 && n !== 2)).toEqual([]);
  });
});

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// ---------------------------------------------------------------------------
// C2, C3: spine and groups
// ---------------------------------------------------------------------------

describe("[C2] the spine", () => {
  // @rule C2
  it.each(FIXTURES)("[C2] is always there, Deposit and Withdraw locked (%s)", (_name, fixture) => {
    const layout = layoutGraph(fixture.input, EN);
    const income = chainsOf(fixture.input).some(({ chain }) =>
      chain.steps.some((s) => s.kind === "collectFees"),
    );
    expect(layout.spine.map((n) => n.role)).toEqual(
      income
        ? ["deposit", "idleInput", "idleOutput", "income", "withdraw"]
        : ["deposit", "idleInput", "idleOutput", "withdraw"],
    );
    expect(layout.spine.filter((n) => n.locked).map((n) => n.role)).toEqual([
      "deposit",
      "withdraw",
    ]);
    for (const n of layout.spine)
      expect([n.rect.w, n.rect.h]).toEqual([LAYOUT.SPINE_W, LAYOUT.CARD_H]);
  });

  // @rule C2 @rule C20
  it.each(FIXTURES)("[C20] centres Deposit, Idle input and Withdraw on the spine (%s)", (_n, f) => {
    const layout = layoutGraph(f.input, EN);
    for (const role of ["deposit", "idleInput", "withdraw"]) {
      expect(centreX(spine(layout, role))).toBe(layout.spineCentreX);
    }
  });
});

describe("[C3] hub chains have no box, one group per spoke", () => {
  // @rule C3
  it.each(FIXTURES)("[C3] draws exactly one group per spoke, in order (%s)", (_name, fixture) => {
    const layout = layoutGraph(fixture.input, EN);
    expect(layout.groups.map((g) => g.network)).toEqual(fixture.input.spokes.map((s) => s.network));
    expect(layout.bridges.map((b) => b.network)).toEqual(
      fixture.input.spokes.map((s) => s.network),
    );
    expect(layout.groups.map((g) => g.hasChains)).toEqual(
      fixture.input.spokes.map((s) => s.chains.length > 0),
    );
  });

  // @rule C3 @rule C5
  it("[C3] keeps every hub block outside every group, every spoke block inside its own", () => {
    const layout = layoutGraph(canvasA.input, EN);
    for (const block of layout.blocks) {
      const inside = layout.groups.filter(
        (g) =>
          block.rect.x >= g.rect.x &&
          right(block.rect) <= right(g.rect) &&
          block.rect.y >= g.rect.y &&
          bottom(block.rect) <= bottom(g.rect),
      );
      if (block.network === "arbitrum") expect(inside).toEqual([]);
      else expect(inside.map((g) => g.network)).toEqual([block.network]);
    }
  });
});

// ---------------------------------------------------------------------------
// C9, C10, C11: edges and return paths
// ---------------------------------------------------------------------------

describe("[C9] lines enter at the top centre and leave at the bottom centre", () => {
  // @rule C9 @rule A3
  it.each(
    WITH_CHAINS,
  )("[C9] links each block to the next with 24 at the chain centre (%s)", (_n, f) => {
    const layout = layoutGraph(f.input, EN);
    for (const { chain } of chainsOf(f.input)) {
      chain.steps.slice(1).forEach((step, i) => {
        const above = blockRect(layout, chain.steps[i]?.id ?? "");
        const below = blockRect(layout, step.id);
        expect(centreX(above)).toBe(centreX(below));
        expect(below.y - bottom(above)).toBe(LAYOUT.LINK);
        expect(verticalsAt(layout, "structural", centreX(above))).toContainEqual([
          bottom(above),
          below.y,
        ]);
      });
    }
  });

  // @rule C9 @rule C10 @rule A3
  it.each(WITH_CHAINS)("[C9] leaves a Collect fees as a pair, 12 each side (%s)", (_n, f) => {
    const layout = layoutGraph(f.input, EN);
    for (const { chain } of chainsOf(f.input)) {
      const last = chain.steps[chain.steps.length - 1];
      if (!last) continue;
      const rect = blockRect(layout, last.id);
      const c = centreX(rect);
      if (last.kind === "collectFees") {
        expect(verticalsAt(layout, "principal", c - LAYOUT.PAIR)[0]?.[0]).toBe(bottom(rect));
        expect(verticalsAt(layout, "income", c + LAYOUT.PAIR)[0]?.[0]).toBe(bottom(rect));
        expect(verticalsAt(layout, "principal", c)).toEqual([]);
      } else {
        expect(verticalsAt(layout, "principal", c)[0]?.[0]).toBe(bottom(rect));
      }
    }
  });
});

describe("[C10] every chain returns; [C11] the return levels", () => {
  // @rule C10
  it.each(FIXTURES)("[C10] has income lines iff a Collect fees exists (%s)", (_name, fixture) => {
    const layout = layoutGraph(fixture.input, EN);
    const fees = chainsOf(fixture.input).some(({ chain }) =>
      chain.steps.some((s) => s.kind === "collectFees"),
    );
    expect(layout.edges.some((e) => e.kind === "income")).toBe(fees);
    expect(layout.spine.some((n) => n.role === "income")).toBe(fees);
  });

  // @rule C10 @rule L5
  it.each(
    WITH_CHAINS,
  )("[L5] runs the principal line 24 under the deepest content (%s)", (_n, f) => {
    const layout = layoutGraph(f.input, EN);
    const lasts = chainsOf(f.input).map(({ chain }) =>
      bottom(blockRect(layout, chain.steps[chain.steps.length - 1]?.id ?? "")),
    );
    const circles = layout.templates
      .filter((t) => t.target.kind === "addProtocol")
      .map((t) => bottom(t.rect));
    const deepest = Math.max(...lasts, ...circles);
    expect(horizontalRuns(layout, "principal", deepest + LAYOUT.LINK).length).toBeGreaterThan(0);
  });

  // @rule C11
  it("[C11] turns both lines at one level for a single chain ending in Collect fees", () => {
    const layout = layoutGraph(buildState5.input, EN);
    expect(horizontalRuns(layout, "principal", 430)).toEqual([[142, 176]]);
    expect(horizontalRuns(layout, "income", 430)).toEqual([[200, 410]]);
    expect(spine(layout, "idleOutput").y).toBe(430 + LAYOUT.LINK);
  });

  // @rule C11
  it("[C11] runs the income line 24 under the principal with more than one chain", () => {
    for (const fixture of [canvasA, canvasC, workedExample2]) {
      const layout = layoutGraph(fixture.input, EN);
      const principalY = layout.edges.find((e) => e.id === "principal:line")?.points[0]?.y ?? 0;
      const incomeY = layout.edges.find((e) => e.id === "income:line")?.points[0]?.y ?? 0;
      expect(incomeY - principalY).toBe(LAYOUT.LINK);
      expect(spine(layout, "idleOutput").y).toBe(incomeY - LAYOUT.LINE_W / 2 + LAYOUT.LINK);
    }
  });

  // @rule C10 @rule L5
  it("[L5] centres Idle output and Income 134 each side of the spine, the merge 24 under", () => {
    const layout = layoutGraph(canvasA.input, EN);
    const c = layout.spineCentreX;
    expect(centreX(spine(layout, "idleOutput"))).toBe(c - LAYOUT.OUTPUT_OFFSET);
    expect(centreX(spine(layout, "income"))).toBe(c + LAYOUT.OUTPUT_OFFSET);
    const mergeY = bottom(spine(layout, "idleOutput")) + LAYOUT.LINK;
    expect(horizontalRuns(layout, "structural", mergeY)).toEqual([
      [c - LAYOUT.OUTPUT_OFFSET, c + LAYOUT.OUTPUT_OFFSET],
    ]);
    expect(spine(layout, "withdraw").y).toBe(mergeY + LAYOUT.LINK);
  });

  // @rule L5
  it("[L5] without income, centres Idle output on the spine and links it 24 to Withdraw", () => {
    const layout = layoutGraph(canvasB.input, EN);
    expect(centreX(spine(layout, "idleOutput"))).toBe(layout.spineCentreX);
    expect(spine(layout, "withdraw").y).toBe(bottom(spine(layout, "idleOutput")) + LAYOUT.LINK);
  });

  // @rule L5
  it("[L5] with no chain anywhere, draws no return line and starts Idle output 48 under", () => {
    const input: LayoutInput = {
      hubNetwork: "arbitrum",
      hub: { chains: [] },
      spokes: [{ network: "robinhood", sharePct: 0, chains: [] }],
    };
    const layout = layoutGraph(input, EN);
    expect(layout.edges.some((e) => e.kind === "principal" || e.kind === "income")).toBe(false);
    expect(layout.emptyCaptions).toBeNull();
    const deepest = bottom(circleOf(layout, "robinhood"));
    expect(spine(layout, "idleOutput").y).toBe(deepest + LAYOUT.EMPTY_OUTPUT_GAP);
  });

  // @rule L5
  it("[L5] counts an empty spoke's circle as content when finding the deepest", () => {
    const layout = layoutGraph(newSpokeNoChain.input, EN);
    const deepest = bottom(circleOf(layout, "robinhood"));
    expect(deepest).toBe(LAYOUT.INNER_ROW_TOP + LAYOUT.CIRCLE);
    expect(horizontalRuns(layout, "principal", deepest + LAYOUT.LINK).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// C16, C17, C20, ST9, D10: templates, ports, symmetry
// ---------------------------------------------------------------------------

describe("[C16] template placement", () => {
  // @rule C16 @rule L6
  it("[C16] centres the empty canvas templates 60 each side of the spine", () => {
    const layout = layoutGraph(canvasD.input, EN);
    expect(centreX(hubCircle(layout))).toBe(layout.spineCentreX - LAYOUT.EMPTY_TEMPLATE_OFFSET);
    expect(centreX(netbox(layout))).toBe(layout.spineCentreX + LAYOUT.EMPTY_TEMPLATE_OFFSET);
  });

  // @rule C16 @rule L3
  it.each(WITH_CHAINS)("[C16] puts a row's circle 32 after its last chain (%s)", (_n, f) => {
    const layout = layoutGraph(f.input, EN);
    const rows = [
      { network: f.input.hubNetwork, chains: f.input.hub.chains },
      ...f.input.spokes.map((s) => ({ network: s.network, chains: s.chains })),
    ];
    for (const row of rows) {
      const last = row.chains[row.chains.length - 1];
      if (!last) continue;
      const lastRight = Math.max(...last.steps.map((s) => right(blockRect(layout, s.id))));
      expect(circleOf(layout, row.network).x - lastRight).toBe(LAYOUT.SIBLING);
    }
  });

  // @rule C16 @rule ST9 @rule C20
  it("[ST9] centres a new spoke's Bridge and circle, the group 176 wide inside its padding", () => {
    const layout = layoutGraph(newSpokeNoChain.input, EN);
    const group = layout.groups.find((g) => g.network === "robinhood");
    const bridge = layout.bridges.find((b) => b.network === "robinhood");
    if (!group || !bridge) throw new Error("no spoke");
    expect(group.rect.w).toBe(LAYOUT.CARD_W + LAYOUT.GROUP_PAD * 2);
    expect(group.hasChains).toBe(false);
    expect(centreX(bridge.rect)).toBe(centreX(group.rect));
    expect(centreX(circleOf(layout, "robinhood"))).toBe(centreX(group.rect));
    expect(circleOf(layout, "robinhood").y).toBe(LAYOUT.INNER_ROW_TOP);
    expect(bottom(group.rect)).toBe(LAYOUT.INNER_ROW_TOP + LAYOUT.CIRCLE + LAYOUT.GROUP_PAD);
  });

  // @rule D10
  it("[D10] puts the hub circle at the row's left end when the hub has no chain", () => {
    const layout = layoutGraph(hubEmptyWithSpoke.input, EN);
    expect(hubCircle(layout).x).toBe(LAYOUT.CANVAS_PAD);
    const group = layout.groups[0];
    expect(group?.rect.x).toBe(right(hubCircle(layout)) + LAYOUT.GROUP_GAP);
  });
});

describe("[C17] ports come from portSlotsOf", () => {
  // @rule C17
  it("[C17] asks portSlotsOf once per chain and places what it answers, never re-derived", () => {
    vi.mocked(planRules.portSlotsOf).mockImplementation((steps) =>
      steps.map((_s, index) => ({ index, top: index === 0, bottom: false })),
    );
    const layout = layoutGraph(canvasC.input, EN);
    expect(planRules.portSlotsOf).toHaveBeenCalledTimes(canvasC.input.hub.chains.length);
    expect(layout.ports.map((p) => [p.target.side, p.target.blockId])).toEqual([
      ["before", "c-pool-swap"],
      ["before", "c-supply-supply"],
    ]);
  });

  // @rule C17
  it("[C17] centres a top port on the card's top edge and a bottom port on its bottom edge", () => {
    const layout = layoutGraph(canvasB.input, EN);
    for (const port of layout.ports) {
      const rect = blockRect(layout, port.target.blockId);
      expect(port.center.x).toBe(centreX(rect));
      expect(port.center.y).toBe(port.target.side === "before" ? rect.y : bottom(rect));
    }
  });

  // @rule C17
  it("[C17] gives an empty block no port", () => {
    const layout = layoutGraph(BUILD_CANVAS_FIXTURES.buildState3.input, EN);
    expect(layout.ports).toEqual([]);
  });
});

describe("[C20] a spoke is symmetric about its own centre", () => {
  // @rule C20
  it.each([
    canvasA,
    canvasB,
    workedExample2,
  ])("[C20] centres Bridge, stub and label on the box", (fixture) => {
    const layout = layoutGraph(fixture.input, EN);
    for (const group of layout.groups) {
      const c = centreX(group.rect);
      const bridge = layout.bridges.find((b) => b.network === group.network);
      expect(bridge && centreX(bridge.rect)).toBe(c);
      expect(verticalsAt(layout, "structural", c)).toContainEqual([LAYOUT.BUS_Y, LAYOUT.ROW_TOP]);
      const label = layout.shareLabels.find(
        (l) => l.target.chainId === null && l.target.network === group.network,
      );
      expect(label?.center).toEqual({ x: c, y: LAYOUT.SPOKE_LABEL_Y });
      expect(label?.edgeId).toBe(`stub:spoke:${group.network}`);
      expect(group.chipAnchor).toEqual({ x: group.rect.x + LAYOUT.CHIP_INSET, y: group.rect.y });
    }
  });
});

// ---------------------------------------------------------------------------
// C8: share labels
// ---------------------------------------------------------------------------

describe("[C8] share labels", () => {
  // @rule C8
  it.each(WITH_CHAINS)("[C8] puts one label above each chain and each Bridge (%s)", (_n, f) => {
    const layout = layoutGraph(f.input, EN);
    const chains = chainsOf(f.input);
    expect(layout.shareLabels).toHaveLength(chains.length + f.input.spokes.length);
    for (const { chain, network } of chains) {
      const label = layout.shareLabels.find((l) => l.target.chainId === chain.id);
      const first = chain.steps[0];
      const feeds = chain.steps.find((s) => s.family === "position");
      expect(label?.pct).toBe(chain.sharePct);
      expect(label?.target).toEqual({
        kind: "shareLabel",
        chainId: chain.id,
        network,
        feedsBlockId: feeds?.id ?? null,
      });
      expect(label?.edgeId).toBe(`stub:chain:${chain.id}`);
      expect(label?.center.x).toBe(centreX(blockRect(layout, first?.id ?? "")));
      expect(label?.center.y).toBe(
        network === f.input.hubNetwork ? LAYOUT.HUB_LABEL_Y : LAYOUT.INNER_LABEL_Y,
      );
    }
  });

  // @rule C8 @rule L10
  it("[L10] names an edge that exists for every label", () => {
    const layout = layoutGraph(canvasA.input, EN);
    const ids = new Set(layout.edges.map((e) => e.id));
    for (const label of layout.shareLabels) expect(ids.has(label.edgeId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C18, A5: insert pushes, never rearranges
// ---------------------------------------------------------------------------

const MANAGER_SWAP: LayoutStep = {
  id: "edit-swap",
  family: "flow",
  kind: "swap",
  auto: false,
  configured: true,
};
const SUPPLY: LayoutStep = {
  id: "edit-supply",
  family: "position",
  kind: "aaveSupply",
  auto: false,
  configured: true,
};
const FEES: LayoutStep = {
  id: "edit-fees",
  family: "flow",
  kind: "collectFees",
  auto: false,
  configured: true,
};

function editChain(
  input: LayoutInput,
  chainId: string,
  edit: (steps: LayoutStep[]) => LayoutStep[],
): LayoutInput {
  const next = structuredClone(input);
  for (const chain of [...next.hub.chains, ...next.spokes.flatMap((s) => s.chains)]) {
    if (chain.id === chainId) chain.steps = edit(chain.steps);
  }
  return next;
}

function shifted(r: Rect, dx: number): Rect {
  return { ...r, x: r.x - dx };
}

/** C18 and A5, checked between two layouts that differ by one edit inside `chainId`. */
function expectOnlyChainMoved(
  before: GraphLayout,
  after: GraphLayout,
  chainId: string,
  network: string,
) {
  const dx = hubCircle(after).x - hubCircle(before).x;
  const otherBlocks = (l: GraphLayout) => l.blocks.filter((b) => b.chainId !== chainId);
  expect(otherBlocks(after).map((b) => shifted(b.rect, dx))).toEqual(
    otherBlocks(before).map((b) => b.rect),
  );
  for (const g of before.groups) {
    const a = after.groups.find((x) => x.network === g.network);
    if (!a) throw new Error("group lost");
    if (g.network === network) {
      expect([a.rect.x - dx, a.rect.y, a.rect.w]).toEqual([g.rect.x, g.rect.y, g.rect.w]);
    } else {
      expect(shifted(a.rect, dx)).toEqual(g.rect);
    }
  }
  expect(after.bridges.map((b) => shifted(b.rect, dx))).toEqual(before.bridges.map((b) => b.rect));
  expect(after.templates.map((t) => shifted(t.rect, dx))).toEqual(
    before.templates.map((t) => t.rect),
  );
  const otherLabels = (l: GraphLayout) =>
    l.shareLabels.filter((s) => s.target.chainId !== chainId).map((s) => s.center);
  expect(otherLabels(after).map((p) => ({ ...p, x: p.x - dx }))).toEqual(otherLabels(before));
  const others = new Set(otherBlocks(before).map((b) => b.id));
  const otherPorts = (l: GraphLayout) =>
    l.ports
      .filter((p) => others.has(p.target.blockId))
      .map((p) => ({ ...p.center, id: p.target.blockId }));
  expect(otherPorts(after).map((p) => ({ ...p, x: p.x - dx }))).toEqual(otherPorts(before));
  if (dx !== 0) {
    // A5: dx changes only when Idle output and Income decide the leftmost content.
    const leftmost = Math.min(spine(before, "idleOutput").x, spine(after, "idleOutput").x);
    expect(leftmost).toBe(LAYOUT.CANVAS_PAD);
  }
  return dx;
}

describe("[C18] inserting pushes, never rearranges; removing closes the gap", () => {
  const cases: Array<[string, string, string, string, number]> = [];
  for (const [name, fixture] of WITH_CHAINS) {
    for (const { chain, network } of chainsOf(fixture.input)) {
      for (let i = 0; i <= chain.steps.length; i += 1) {
        cases.push([name, chain.id, network, "insert", i]);
      }
      if (chain.steps.length > 1) {
        for (let i = 0; i < chain.steps.length; i += 1)
          cases.push([name, chain.id, network, "remove", i]);
      }
      cases.push([name, chain.id, network, "fees", chain.steps.length]);
    }
  }

  // @rule C18 @rule A5
  it.each(
    cases,
  )("[A5] %s: %s on %s, %s at %i, moves only that chain", (name, chainId, network, op, i) => {
    const fixture = BUILD_CANVAS_FIXTURES[name as keyof typeof BUILD_CANVAS_FIXTURES];
    const before = layoutGraph(fixture.input, EN);
    for (const step of op === "insert" ? [MANAGER_SWAP, SUPPLY] : [FEES]) {
      const input =
        op === "remove"
          ? editChain(fixture.input, chainId, (s) => s.filter((_x, k) => k !== i))
          : editChain(fixture.input, chainId, (s) => [...s.slice(0, i), step, ...s.slice(i)]);
      const after = layoutGraph(input, EN);
      expectOnlyChainMoved(before, after, chainId, network);
      expectOnlyChainMoved(after, before, chainId, network);
      if (op === "remove") break;
    }
  });

  // @rule C18
  it("[C18] puts the inserted block at its slot and pushes the rest of the chain down", () => {
    const before = layoutGraph(canvasC.input, EN);
    const input = editChain(canvasC.input, "c-pool", (s) => [
      ...s.slice(0, 1),
      MANAGER_SWAP,
      ...s.slice(1),
    ]);
    const after = layoutGraph(input, EN);
    const push = LAYOUT.PILL_H + LAYOUT.LINK;
    expect(blockRect(after, "c-pool-swap")).toEqual(blockRect(before, "c-pool-swap"));
    expect(blockRect(after, "edit-swap").y).toBe(
      bottom(blockRect(before, "c-pool-swap")) + LAYOUT.LINK,
    );
    expect(blockRect(after, "c-pool-pool").y).toBe(blockRect(before, "c-pool-pool").y + push);
    expect(blockRect(after, "c-pool-fees").y).toBe(blockRect(before, "c-pool-fees").y + push);
    expect(spine(after, "withdraw").y).toBe(spine(before, "withdraw").y + push);
  });

  // @rule C18 @rule A5 @rule L4
  it("[A5] Build state 5: adding a Collect fees to a one-chain graph shifts everything by 76", () => {
    const chain = buildState5.input.hub.chains[0];
    if (!chain) throw new Error("fixture changed");
    const withoutFees = editChain(buildState5.input, chain.id, (s) =>
      s.filter((x) => x.kind !== "collectFees"),
    );
    const before = layoutGraph(withoutFees, EN);
    const after = layoutGraph(buildState5.input, EN);
    const dx = expectOnlyChainMoved(before, after, chain.id, "arbitrum");
    expect(dx).toBe(76);
    expect(blockRect(before, "s5-swap").x).toBe(LAYOUT.CANVAS_PAD);
    expect(blockRect(after, "s5-swap").x).toBe(100);
    expect(spine(after, "idleOutput").x).toBe(LAYOUT.CANVAS_PAD);
  });
});

// ---------------------------------------------------------------------------
// A3, L3, L4, L10 on every fixture
// ---------------------------------------------------------------------------

describe("[A3] one spacing rule set", () => {
  // @rule A3
  it.each(
    FIXTURES,
  )("[A3] keeps cards 176 x 62 and pills 176 x 26, configured or not (%s)", (_n, f) => {
    const layout = layoutGraph(f.input, EN);
    for (const b of layout.blocks) {
      expect([b.rect.w, b.rect.h]).toEqual(
        b.family === "position" ? [LAYOUT.CARD_W, LAYOUT.CARD_H] : [LAYOUT.PILL_W, LAYOUT.PILL_H],
      );
    }
    for (const b of layout.bridges)
      expect([b.rect.w, b.rect.h]).toEqual([LAYOUT.PILL_W, LAYOUT.PILL_H]);
  });

  // @rule A3
  it.each(WITH_CHAINS)("[A3] hangs every first block 48 under its bus (%s)", (_n, f) => {
    const layout = layoutGraph(f.input, EN);
    for (const { chain, network } of chainsOf(f.input)) {
      const first = blockRect(layout, chain.steps[0]?.id ?? "");
      const bus = network === f.input.hubNetwork ? LAYOUT.BUS_Y : LAYOUT.INNER_BUS_Y;
      expect(first.y - bus).toBe(LAYOUT.STUB);
      expect(verticalsAt(layout, "structural", centreX(first))).toContainEqual([bus, first.y]);
    }
  });

  // @rule A3
  it("[A3] keeps group borders 40 apart, and 40 from the hub circle and the Add network box", () => {
    const layout = layoutGraph(canvasA.input, EN);
    const [base, robinhood] = layout.groups;
    if (!base || !robinhood) throw new Error("fixture changed");
    expect(base.rect.x - right(hubCircle(layout))).toBe(LAYOUT.GROUP_GAP);
    expect(robinhood.rect.x - right(base.rect)).toBe(LAYOUT.GROUP_GAP);
    expect(netbox(layout).x - right(robinhood.rect)).toBe(LAYOUT.GROUP_GAP);
  });

  // @rule A3 @rule L3
  it("[L3] keeps sibling chains 32 apart and a group's content 16 inside its border", () => {
    const layout = layoutGraph(canvasA.input, EN);
    const group = layout.groups.find((g) => g.network === "base");
    if (!group) throw new Error("fixture changed");
    expect(blockRect(layout, "a-base-1-swap").x - group.rect.x).toBe(LAYOUT.GROUP_PAD);
    expect(right(group.rect) - right(circleOf(layout, "base"))).toBe(LAYOUT.GROUP_PAD);
    expect(blockRect(layout, "a-base-2-swap").x - right(blockRect(layout, "a-base-1-swap"))).toBe(
      LAYOUT.SIBLING,
    );
    const lowest = Math.max(
      ...layout.blocks.filter((b) => b.network === "base").map((b) => bottom(b.rect)),
    );
    expect(bottom(group.rect) - lowest).toBe(LAYOUT.GROUP_PAD);
  });
});

describe("[L3] [L4] [L10] on every fixture", () => {
  // @rule L3
  it.each(
    WITH_CHAINS,
  )("[L3] centres the spine on the row, (left + Add network right) / 2 (%s)", (_n, f) => {
    const layout = layoutGraph(f.input, EN);
    const rowLeft = Math.min(
      hubCircle(layout).x,
      ...f.input.hub.chains.map((c) => blockRect(layout, c.steps[0]?.id ?? "").x),
    );
    expect(layout.spineCentreX).toBe(
      Math.max((rowLeft + right(netbox(layout))) / 2, rowLeft + LAYOUT.SPINE_W / 2),
    );
  });

  // @rule L3
  it.each(
    FIXTURES,
  )("[L3] runs the Idle input bus from the leftmost to the rightmost stub (%s)", (_n, f) => {
    const layout = layoutGraph(f.input, EN);
    const stubs = layout.edges
      .filter(
        (e) => e.points.every((p) => p.x === e.points[0]?.x) && e.points[0]?.y === LAYOUT.BUS_Y,
      )
      .map((e) => e.points[0]?.x ?? 0);
    const xs = [...stubs, layout.spineCentreX];
    expect(horizontalRuns(layout, "structural", LAYOUT.BUS_Y)).toEqual([
      [Math.min(...xs), Math.max(...xs)],
    ]);
  });

  // @rule L4 @rule L5
  it.each(
    FIXTURES,
  )("[L4] sits the leftmost content at 24 and the graph 24 around it (%s)", (_n, f) => {
    const layout = layoutGraph(f.input, EN);
    const rects = contentRects(layout);
    expect(Math.min(...rects.map((r) => r.x))).toBe(LAYOUT.CANVAS_PAD);
    expect(Math.min(...rects.map((r) => r.y))).toBe(LAYOUT.CANVAS_PAD);
    expect(layout.width).toBe(Math.max(...rects.map(right)) + LAYOUT.CANVAS_PAD);
    expect(layout.height).toBe(Math.max(...rects.map(bottom)) + LAYOUT.CANVAS_PAD);
  });

  // @rule L10
  it.each(FIXTURES)("[L10] draws only single orthogonal segments with unique ids (%s)", (_n, f) => {
    const layout = layoutGraph(f.input, EN);
    expect(new Set(layout.edges.map((e) => e.id)).size).toBe(layout.edges.length);
    for (const edge of layout.edges) {
      const [a, b] = edge.points;
      expect(edge.points).toHaveLength(2);
      if (!a || !b) continue;
      expect(a.x === b.x || a.y === b.y).toBe(true);
      expect(a.x !== b.x || a.y !== b.y).toBe(true);
      // A horizontal run's centre line sits 0.75 under the handoff y (its top edge).
      if (a.y === b.y) expect(a.y - Math.floor(a.y)).toBe(LAYOUT.LINE_W / 2);
      else expect(Number.isInteger(a.x)).toBe(true);
    }
  });
});

describe("[L6] the empty canvas follows the width of the start-here sentence", () => {
  // @rule L6
  it("[L6] shifts by half the extra width: 500 wide shifts by 72", () => {
    const layout = layoutGraph(canvasD.input, { startHereWidth: 500 });
    expect(layout.spineCentreX).toBe(LAYOUT.CANVAS_PAD + 250);
    expect(layout.emptyCaptions?.startHere).toEqual({
      x: LAYOUT.CANVAS_PAD,
      y: 334,
      w: 500,
      h: 18,
    });
    expect(layout.width).toBe(500 + LAYOUT.CANVAS_PAD * 2);
  });

  // @rule L6 @rule L4
  it("[L6] lets the spine rule the left edge when the sentence is narrower than Deposit", () => {
    const layout = layoutGraph(canvasD.input, { startHereWidth: 200 });
    expect(spine(layout, "deposit").x).toBe(LAYOUT.CANVAS_PAD);
    expect(layout.spineCentreX).toBe(LAYOUT.SPINE_MIN_CENTRE);
    expect(layout.emptyCaptions?.startHere.x).toBe(LAYOUT.SPINE_MIN_CENTRE - 100);
  });

  // @rule L6
  it("[L6] keeps the same vertical rhythm whatever the width", () => {
    for (const width of [0, 200, 420, 640]) {
      const layout = layoutGraph(canvasD.input, { startHereWidth: width });
      expect(spine(layout, "idleOutput").y).toBe(400);
      expect(spine(layout, "withdraw").y).toBe(486);
      expect(layout.height).toBe(572);
    }
  });

  // @rule L6
  it("[L6] treats a width that is not a positive number as 0", () => {
    for (const width of [-10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const layout = layoutGraph(canvasD.input, { startHereWidth: width });
      expect(layout.emptyCaptions?.startHere.w).toBe(0);
    }
  });

  it("returns no empty captions once the canvas holds anything", () => {
    for (const [, f] of FIXTURES) {
      const layout = layoutGraph(f.input, EN);
      expect(layout.emptyCaptions === null).toBe(f !== canvasD);
    }
  });
});

describe("node order", () => {
  it("lists templates hub first, then each spoke, then the Add network box", () => {
    const layout = layoutGraph(canvasA.input, EN);
    expect(Object.keys(nodeRects(layout)).filter((k) => k.startsWith("add"))).toEqual([
      "addProtocol:arbitrum",
      "addProtocol:base",
      "addProtocol:robinhood",
      "addNetwork",
    ]);
  });
});
