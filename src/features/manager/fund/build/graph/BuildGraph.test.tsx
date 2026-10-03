/**
 * @id PP-MGR-CMP-059
 * @name BuildGraph tests
 * @implements-rules-version v1 (POO-2156 rules v1)
 * @analytics-events none, a controlled renderer: activations leave through `onTarget` and the Build
 *   screen (PP-MGR-SCR-002, S7) owns every event.
 *
 * The graph renderer of the Build canvas (handoff v1.2 [L7], [C19], [BB8], [I9], [I10], [L6], [BB6],
 * [I3], [I5], [C15], [C17], D6, D13, D26), rendered from the reference canvases of
 * `buildCanvasFixtures.ts`, which are its oracles: every node the layout returns is on screen once,
 * at the layout's position and size, with the piece and the state the handoff prescribes, and every
 * edge is drawn. jsdom lays nothing out, so a position is the inline style the renderer wrote.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILD_CANVAS_FIXTURES,
  type BuildCanvasFixture,
  buildState3,
  canvasA,
  canvasC,
  canvasD,
  newSpokeNoChain,
} from "@/mocks/data/buildCanvasFixtures";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../../../../tests/utils/renderWithProviders";
import { CanvasViewport } from "../canvas/CanvasViewport";
import {
  CANVAS_INTERACTIVE_ATTR,
  CANVAS_LAYER_ATTR,
  isCanvasBackground,
} from "../canvas/useCanvasViewport";
import { type GraphLayout, type GraphTarget, targetKey } from "../layout/graphTypes";
import { layoutGraph } from "../layout/layoutGraph";
import type { BlockContent } from "../pieces/pieceTypes";
import { BuildGraph, type BuildGraphProps } from "./BuildGraph";
import { fixtureGraphProps } from "./graphFixtureKit";
import { formatShare, GRAPH_LAYER } from "./graphModel";

type FixtureName = keyof typeof BUILD_CANVAS_FIXTURES;
const FIXTURE_NAMES = Object.keys(BUILD_CANVAS_FIXTURES) as FixtureName[];

const NO_KEYS: ReadonlySet<string> = new Set();
const layerAttr = { [CANVAS_LAYER_ATTR]: "" };

function propsFor(
  fixture: BuildCanvasFixture,
  overrides: Partial<BuildGraphProps> = {},
): BuildGraphProps {
  return {
    ...fixtureGraphProps(fixture),
    activeTargetKeys: NO_KEYS,
    onTarget: vi.fn(),
    ...overrides,
  };
}

/** Renders the graph inside a stand-in graph layer, as the viewport would hold it. */
function renderGraph(fixture: BuildCanvasFixture, overrides: Partial<BuildGraphProps> = {}) {
  const props = propsFor(fixture, overrides);
  const utils = renderWithProviders(
    <div data-testid="canvas">
      <div {...layerAttr}>
        <BuildGraph {...props} />
      </div>
    </div>,
  );
  return { ...utils, props };
}

/** The positioned wrapper of a node, by its key. */
function node(key: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>("[data-graph-node]")].filter(
    (element) => element.getAttribute("data-graph-node") === key,
  );
  if (found.length !== 1) throw new Error(`${found.length} nodes with key ${key}`);
  return found[0] as HTMLElement;
}

function px(value: number): string {
  return `${value}px`;
}

/** Asserts a wrapper sits at a box: left, top, width, height in graph px. */
function expectBox(element: HTMLElement, x: number, y: number, w: number, h: number): void {
  expect([
    element.style.left,
    element.style.top,
    element.style.width,
    element.style.height,
  ]).toEqual([px(x), px(y), px(w), px(h)]);
}

const blockKey = (blockId: string) => targetKey({ kind: "block", blockId });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(FIXTURE_NAMES)("BuildGraph on %s", (name) => {
  const fixture = BUILD_CANVAS_FIXTURES[name];
  const layout = layoutGraph(fixture.input, { startHereWidth: 420 });

  // @rule ST1
  // @rule ST5
  // @rule ST6
  // @rule ST7
  // @rule ST8
  // @rule ST9
  it("draws every node of the layout once, at its position and size, with its piece and state", () => {
    renderGraph(fixture);

    const root = document.querySelector<HTMLElement>("[data-build-graph]");
    expect([root?.style.width, root?.style.height]).toEqual([px(layout.width), px(layout.height)]);

    let expected = 0;
    for (const spine of layout.spine) {
      const element = node(`spine:${spine.role}`);
      expectBox(element, spine.rect.x, spine.rect.y, spine.rect.w, spine.rect.h);
      expect(element.querySelector("[data-spine-card]")).not.toBeNull();
      expect(
        within(element).queryAllByRole("img", { name: "Fixed: USDC on Arbitrum" }),
      ).toHaveLength(spine.locked ? 1 : 0);
      expected += 1;
    }
    for (const block of layout.blocks) {
      const element = node(blockKey(block.id));
      expectBox(element, block.rect.x, block.rect.y, block.rect.w, block.rect.h);
      const content = fixture.content[block.id];
      if (block.family === "position") {
        const card = element.querySelector("[data-card-state]");
        expect(card).toHaveAttribute("data-card-state", content?.state);
        expect(card?.hasAttribute("data-selected")).toBe(content?.selected === true);
      } else {
        expect(element.querySelector("[data-flow-pill]")).toHaveTextContent(content?.title ?? "");
      }
      expected += 1;
    }
    for (const bridge of layout.bridges) {
      const element = node(`bridge:${bridge.network}`);
      expectBox(element, bridge.rect.x, bridge.rect.y, bridge.rect.w, bridge.rect.h);
      expect(element.querySelector("[data-flow-pill]")).toHaveTextContent("Bridge · auto");
      expected += 1;
    }
    for (const group of layout.groups) {
      const element = node(`group:${group.network}`);
      expectBox(element, group.rect.x, group.rect.y, group.rect.w, group.rect.h);
      const box = element.querySelector<HTMLElement>("[data-spoke-group]");
      expect([box?.style.width, box?.style.height]).toEqual([px(group.rect.w), px(group.rect.h)]);
      expected += 1;
    }
    for (const template of layout.templates) {
      const element = node(targetKey(template.target));
      const { x, y, w, h } = template.rect;
      expectBox(element, x, y, w, h);
      expect(element.querySelector("[data-canvas-template]")).toHaveAttribute(
        "data-canvas-template",
        template.target.kind,
      );
      expected += 1;
    }
    for (const port of layout.ports) {
      const element = node(targetKey(port.target));
      expectBox(element, port.center.x - 8, port.center.y - 8, 16, 16);
      expect(element.querySelector("[data-insert-port]")).not.toBeNull();
      expected += 1;
    }
    for (const label of layout.shareLabels) {
      const element = node(targetKey(label.target));
      expect([element.style.left, element.style.top]).toEqual([
        px(label.center.x),
        px(label.center.y),
      ]);
      expect(element.style.transform).toBe("translate(-50%, -50%)");
      expect(element.querySelector("[data-share-label]")).toHaveTextContent(formatShare(label.pct));
      expected += 1;
    }
    if (layout.emptyCaptions) expected += 3;

    expect(document.querySelectorAll("[data-graph-node]")).toHaveLength(expected);
  });

  it("draws every edge of the layout, income lines in the income tone", () => {
    renderGraph(fixture);
    const drawn = document.querySelectorAll("polyline[data-edge-id]");
    expect(drawn).toHaveLength(layout.edges.length);
    for (const edge of layout.edges) {
      const line = document.querySelector(`polyline[data-edge-id="${edge.id}"]`);
      expect(line).toHaveAttribute("data-edge-tone", edge.kind === "income" ? "income" : "muted");
    }
  });
});

describe("BuildGraph, the empty canvas", () => {
  // @rule L6
  // @rule BB6
  // @rule ST1
  it("[L6, BB6] puts the two captions and the start-here sentence at the layout's anchors", () => {
    renderGraph(canvasD);
    const captions = layoutGraph(canvasD.input, { startHereWidth: 420 }).emptyCaptions;
    if (!captions) throw new Error("no captions");

    const protocol = node("caption:addProtocol");
    expect([protocol.style.left, protocol.style.top]).toEqual([
      px(captions.addProtocol.x),
      px(captions.addProtocol.y),
    ]);
    expect(protocol.style.transform).toBe("translateX(-50%)");
    expect(protocol).toHaveTextContent("Add protocol");
    const network = node("caption:addNetwork");
    expect([network.style.left, network.style.top]).toEqual([
      px(captions.addNetwork.x),
      px(captions.addNetwork.y),
    ]);
    expect(network).toHaveTextContent("Add network");

    const sentence = node("caption:startHere");
    const { x, y, w, h } = captions.startHere;
    expectBox(sentence, x, y, w, h);
    expect(sentence).toHaveTextContent(
      "Start here: add a protocol on Arbitrum (circle), or add a network (box).",
    );
    expect(sentence.className).toContain("text-xs");
  });

  it("offers only the two templates: no card, no port, no label", () => {
    renderGraph(canvasD);
    expect(
      screen.getAllByRole("button").map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Add network", "Add protocol on Arbitrum"]);
    expect(document.querySelector("[data-card-state]")).toBeNull();
  });
});

describe("BuildGraph, stacking order", () => {
  // @rule L7
  it("[L7] paints group boxes, lines, cards and pills and templates, ports, labels and chips", () => {
    renderGraph(canvasA);
    const layerOf = (element: Element | null) => (element as HTMLElement | null)?.style.zIndex;

    const lines = document.querySelector<HTMLElement>('[data-graph-layer="lines"]');
    expect(layerOf(lines)).toBe(String(GRAPH_LAYER.lines));
    expect(lines?.querySelector("svg[data-graph-edges]")).not.toBeNull();

    const group = node("group:base");
    // A group box creates no stacking context, so its chip can be lifted above the lines.
    expect(group.style.zIndex).toBe("");
    expect(group.className).toContain("[&_[data-network-chip]]:z-[4]");

    expect(layerOf(node("spine:deposit"))).toBe(String(GRAPH_LAYER.nodes));
    expect(layerOf(node(blockKey("a-hub-1-pool")))).toBe(String(GRAPH_LAYER.nodes));
    expect(layerOf(node("bridge:base"))).toBe(String(GRAPH_LAYER.nodes));
    expect(layerOf(node(targetKey({ kind: "addNetwork" })))).toBe(String(GRAPH_LAYER.nodes));
    expect(
      layerOf(node(targetKey({ kind: "port", side: "before", blockId: "a-hub-2-supply" }))),
    ).toBe(String(GRAPH_LAYER.ports));
    expect(
      layerOf(
        node(targetKey({ kind: "shareLabel", chainId: null, network: "base", feedsBlockId: null })),
      ),
    ).toBe(String(GRAPH_LAYER.labels));
    expect(GRAPH_LAYER.groups).toBeLessThan(GRAPH_LAYER.lines);
  });

  // @rule I10
  it("[I10] hides the lines from assistive technology", () => {
    renderGraph(canvasC);
    expect(document.querySelector("svg[data-graph-edges]")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("BuildGraph, reading order", () => {
  // @rule I10
  it("[I10] reaches every focusable element top to bottom, then left to right", () => {
    renderGraph(canvasC);
    const order = [...document.querySelectorAll<HTMLElement>('button, [tabindex="0"]')].map(
      (element) => element.closest("[data-graph-node]")?.getAttribute("data-graph-node"),
    );

    expect(order).toEqual([
      "spine:deposit",
      targetKey({
        kind: "shareLabel",
        chainId: "c-pool",
        network: "arbitrum",
        feedsBlockId: "c-pool-pool",
      }),
      targetKey({
        kind: "shareLabel",
        chainId: "c-supply",
        network: "arbitrum",
        feedsBlockId: "c-supply-supply",
      }),
      targetKey({ kind: "addNetwork" }),
      targetKey({ kind: "port", side: "before", blockId: "c-supply-supply" }),
      blockKey("c-pool-swap"),
      blockKey("c-supply-supply"),
      targetKey({ kind: "addProtocol", network: "arbitrum" }),
      blockKey("c-pool-pool"),
      targetKey({ kind: "port", side: "after", blockId: "c-supply-supply" }),
      blockKey("c-pool-fees"),
      "spine:withdraw",
    ]);
  });

  // @rule I10
  it("[I10] templates, ports, cards and chain labels are buttons; Enter and Space activate them", async () => {
    const user = userEvent.setup();
    const { props } = renderGraph(canvasC);
    const port = screen.getByRole("button", { name: "Insert a flow block: Swap" });
    act(() => port.focus());
    await user.keyboard("{Enter}");
    const card = screen.getByRole("button", { name: /^Supply USDC/ });
    act(() => card.focus());
    await user.keyboard(" ");
    expect(props.onTarget).toHaveBeenNthCalledWith(
      1,
      { kind: "port", side: "before", blockId: "c-supply-supply" },
      port,
    );
    expect(props.onTarget).toHaveBeenNthCalledWith(
      2,
      { kind: "block", blockId: "c-supply-supply" },
      card,
    );
  });

  // @rule I10
  it("[I10] names each card by its place: title, caption, network and share of the capital", () => {
    renderGraph(canvasA);
    expect(
      screen.getByRole("button", {
        name: "WETH / USDC, Uniswap v4 · 0.05%, on Arbitrum, 15% of the capital",
      }),
    ).toBe(node(blockKey("a-hub-1-pool")).querySelector("button"));
    expect(
      screen.getByRole("button", {
        name: "Supply USDC, Aave v3 · Base, on Base, 10% of the capital",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Borrow USDC, Aave v3, on Arbitrum, 10% of the capital",
      }),
    ).toBeInTheDocument();
  });
});

describe("BuildGraph, tooltips", () => {
  // @rule C19
  it("[C19] names the templates by their tooltip, with the row's network", () => {
    renderGraph(canvasA);
    expect(screen.getByRole("button", { name: "Add protocol on Arbitrum" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add protocol on Base" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add protocol on Robinhood Chain" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add network" })).toBeInTheDocument();
  });

  // @rule C19
  it("[C19, D13] gives each port the tooltip of its slot: before, after a pool, a supply, a borrow", () => {
    const { unmount } = renderGraph(canvasA);
    const before = node(targetKey({ kind: "port", side: "before", blockId: "a-hub-2-supply" }));
    expect(within(before).getByRole("button")).toHaveAccessibleName("Insert a flow block: Swap");
    const afterBorrow = node(targetKey({ kind: "port", side: "after", blockId: "a-hub-3-borrow" }));
    expect(within(afterBorrow).getByRole("button")).toHaveAccessibleName(
      "Insert a flow block: Swap",
    );
    unmount();

    const second = renderGraph(canvasC);
    const afterSupply = node(
      targetKey({ kind: "port", side: "after", blockId: "c-supply-supply" }),
    );
    expect(within(afterSupply).getByRole("button")).toHaveAccessibleName(
      "Insert a block: Borrow, Swap",
    );
    second.unmount();

    renderGraph(newSpokeNoChain);
    const afterPool = node(targetKey({ kind: "port", side: "after", blockId: "nsp-hub-pool" }));
    expect(within(afterPool).getByRole("button")).toHaveAccessibleName(
      "Insert a flow block: Collect fees",
    );
  });

  // @rule C19
  it("[C19] opens a port's tooltip on keyboard focus", async () => {
    renderGraph(newSpokeNoChain);
    const port = screen.getByRole("button", { name: "Insert a flow block: Collect fees" });
    act(() => port.focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Insert a flow block: Collect fees",
    );
  });

  // @rule C19
  it("[C19, D7] the Bridge reads Bridge · auto and moves the spoke's stable, never a literal USDC", async () => {
    const user = userEvent.setup();
    renderGraph(canvasA);
    const robinhood = node("bridge:robinhood").querySelector<HTMLElement>("[data-flow-pill]");
    const base = node("bridge:base").querySelector<HTMLElement>("[data-flow-pill]");
    expect(robinhood).toHaveAccessibleDescription("Moves USDG to Robinhood Chain");
    expect(base).toHaveAccessibleDescription("Moves USDC to Base");
    if (!robinhood) throw new Error("no bridge");
    await user.hover(robinhood);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Moves USDG to Robinhood Chain");
  });

  // @rule C19
  it("[C19] passes the registry's pill copy through and describes each pill by its tooltip", () => {
    renderGraph(canvasA);
    const pill = (id: string) => node(blockKey(id)).querySelector("[data-flow-pill]");
    expect(pill("a-hub-1-swap")).toHaveAccessibleDescription(
      "The app swaps USDC into the pool tokens",
    );
    expect(pill("a-rh-1-swap")).toHaveAccessibleDescription(
      "The app swaps USDG into the pool tokens",
    );
    expect(pill("a-hub-3-swap")).toHaveAccessibleDescription("The app swaps USDC into WETH");
    expect(pill("a-hub-1-fees")).toHaveAccessibleDescription(
      "Claims the pool fees into Income (fees)",
    );
  });

  // @rule C19
  it("[C19] share labels say their share of the capital; a spoke's label explains and selects nothing", () => {
    renderGraph(canvasA);
    const hub = node(
      targetKey({
        kind: "shareLabel",
        chainId: "a-hub-1",
        network: "arbitrum",
        feedsBlockId: "a-hub-1-pool",
      }),
    );
    expect(within(hub).getByRole("button")).toHaveAccessibleName("15% of the strategy's capital");
    // Four chains take 15%: hub 1 and 2, Base 1, Robinhood Chain 1.
    expect(screen.getAllByRole("button", { name: "15% of the strategy's capital" })).toHaveLength(
      4,
    );
    const spoke = node(
      targetKey({ kind: "shareLabel", chainId: null, network: "base", feedsBlockId: null }),
    ).querySelector<HTMLElement>("[data-share-label]");
    expect(spoke?.tagName).toBe("SPAN");
    expect(spoke).toHaveAccessibleDescription("35% of the strategy's capital");
  });

  // @rule C19
  it("[C19] the locks and the network chips explain themselves", () => {
    renderGraph(canvasA);
    expect(screen.getAllByRole("img", { name: "Fixed: USDC on Arbitrum" })).toHaveLength(2);
    const chip = node("group:robinhood").querySelector<HTMLElement>("[data-network-chip]");
    expect(chip).toHaveAttribute("title", "Robinhood Chain");
    expect(chip).toHaveAccessibleDescription("Robinhood Chain");
    expect(chip).toHaveTextContent("Robinhood Chain");
  });
});

describe("BuildGraph, activations", () => {
  // @rule I3
  it("[I3] reports a template press with its target and the template as the anchor", async () => {
    const user = userEvent.setup();
    const { props } = renderGraph(canvasA);
    const circle = screen.getByRole("button", { name: "Add protocol on Base" });
    await user.click(circle);
    const box = screen.getByRole("button", { name: "Add network" });
    await user.click(box);
    expect(props.onTarget).toHaveBeenNthCalledWith(
      1,
      { kind: "addProtocol", network: "base" },
      circle,
    );
    expect(props.onTarget).toHaveBeenNthCalledWith(2, { kind: "addNetwork" }, box);
  });

  // @rule I5
  it("[I5] reports a card press and a chain label press, each with its own element as the anchor", async () => {
    const user = userEvent.setup();
    const { props } = renderGraph(canvasC);
    const card = screen.getByRole("button", { name: /^WETH \/ USDC/ });
    await user.click(card);
    const label = screen.getByRole("button", { name: "60% of the strategy's capital" });
    await user.click(label);
    expect(props.onTarget).toHaveBeenNthCalledWith(
      1,
      { kind: "block", blockId: "c-pool-pool" },
      card,
    );
    const expected: GraphTarget = {
      kind: "shareLabel",
      chainId: "c-pool",
      network: "arbitrum",
      feedsBlockId: "c-pool-pool",
    };
    expect(props.onTarget).toHaveBeenNthCalledWith(2, expected, label);
  });

  // @rule I5
  it("[I5] the spine, the pills, the Bridge and a spoke's label report nothing", async () => {
    const user = userEvent.setup();
    const { props } = renderGraph(canvasA);
    await user.click(screen.getByText("Deposit"));
    await user.click(within(node(blockKey("a-hub-1-swap"))).getByText("Swap · auto"));
    await user.click(within(node("bridge:base")).getByText("Bridge · auto"));
    const spokeLabel = node(
      targetKey({ kind: "shareLabel", chainId: null, network: "base", feedsBlockId: null }),
    ).querySelector("[data-share-label]");
    if (!spokeLabel) throw new Error("no spoke label");
    await user.click(spokeLabel);
    expect(props.onTarget).not.toHaveBeenCalled();
  });

  // @rule I7
  it("[I7, D5] offers Remove on the chip of a spoke with no chain only", async () => {
    const user = userEvent.setup();
    const onRemoveSpoke = vi.fn();
    const { unmount } = renderGraph(canvasA, { onRemoveSpoke });
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
    unmount();

    renderGraph(newSpokeNoChain, { onRemoveSpoke });
    await user.click(screen.getByRole("button", { name: "Remove Robinhood Chain" }));
    expect(onRemoveSpoke).toHaveBeenCalledWith("robinhood");
  });

  it("offers no Remove control when the screen does not handle it", () => {
    renderGraph(newSpokeNoChain);
    expect(screen.queryByRole("button", { name: "Remove Robinhood Chain" })).toBeNull();
  });
});

describe("BuildGraph, drop and background contracts", () => {
  // @rule I3
  it("[I3] every template, port, card and share label carries data-graph-target = targetKey", () => {
    const layout = layoutGraph(canvasA.input, { startHereWidth: 420 });
    renderGraph(canvasA);
    const targets: GraphTarget[] = [
      ...layout.templates.map((template) => template.target),
      ...layout.ports.map((port) => port.target),
      ...layout.shareLabels.map((label) => label.target),
      ...layout.blocks
        .filter((block) => block.family === "position")
        .map((block): GraphTarget => ({ kind: "block", blockId: block.id })),
    ];
    const marked = document.querySelectorAll("[data-graph-target]");
    expect(marked).toHaveLength(targets.length);
    for (const target of targets) {
      const element = node(targetKey(target));
      expect(element).toHaveAttribute("data-graph-target", targetKey(target));
    }
  });

  // @rule I3
  it("[I3] a drop resolves to its target from any point inside the piece", () => {
    renderGraph(canvasC);
    const plus = node(
      targetKey({ kind: "port", side: "after", blockId: "c-supply-supply" }),
    ).querySelector("svg");
    expect(plus?.closest("[data-graph-target]")).toHaveAttribute(
      "data-graph-target",
      targetKey({ kind: "port", side: "after", blockId: "c-supply-supply" }),
    );
  });

  // @rule I5
  it("[I5] interactive pieces never pan; group boxes and lines are background", () => {
    renderGraph(canvasA);
    const container = screen.getByTestId("canvas");
    for (const selector of [
      "[data-card-state]",
      "[data-flow-pill]",
      "[data-canvas-template]",
      "[data-insert-port]",
      "[data-share-label]",
      "[data-network-chip]",
      "[data-spine-card]",
    ]) {
      const element = document.querySelector(selector);
      expect(element?.closest(`[${CANVAS_INTERACTIVE_ATTR}]`)).not.toBeNull();
      expect(isCanvasBackground(element, container)).toBe(false);
    }
    const box = node("group:base").querySelector("[data-spoke-group]");
    expect(isCanvasBackground(box, container)).toBe(true);
    expect(node("group:base")).not.toHaveAttribute(CANVAS_INTERACTIVE_ATTR);
    const line = document.querySelector("polyline[data-edge-id]");
    expect(isCanvasBackground(line, container)).toBe(true);
    expect(document.querySelector("[data-canvas-layer] [data-canvas-layer]")).toBeNull();
  });

  // @rule I5
  it("[I5] inside the viewport, a card press selects and a group box press is a background click", () => {
    const onBackgroundClick = vi.fn();
    const props = propsFor(canvasA);
    renderWithProviders(
      <CanvasViewport graphSize={props.layout} onBackgroundClick={onBackgroundClick}>
        <BuildGraph {...props} />
      </CanvasViewport>,
    );
    const card = screen.getByRole("button", {
      name: /^WETH \/ USDC, Uniswap v4 · 0.05%, on Arbitrum/,
    });
    fireEvent.pointerDown(card, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.click(card);
    expect(onBackgroundClick).not.toHaveBeenCalled();
    expect(props.onTarget).toHaveBeenCalledWith({ kind: "block", blockId: "a-hub-1-pool" }, card);

    const box = node("group:base").querySelector("[data-spoke-group]") as HTMLElement;
    fireEvent.pointerDown(box, { button: 0, pointerId: 2, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(box, { pointerId: 2, clientX: 10, clientY: 10 });
    expect(onBackgroundClick).toHaveBeenCalledTimes(1);
  });
});

describe("BuildGraph, selection and active targets", () => {
  // @rule I5
  // @rule ST5
  it("[I5, ST5] gives the selected card its selected look; no other card has it", () => {
    renderGraph(canvasC, { selectedId: "c-supply-supply" });
    const selected = screen.getByRole("button", { name: /^Supply USDC/ });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(selected).toHaveAttribute("data-selected");
    expect(screen.getByRole("button", { name: /^WETH \/ USDC/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(document.querySelectorAll("[data-selected]")).toHaveLength(1);
  });

  // @rule ST5
  it("[ST5] Build state 3: the empty block just added is drawn empty and selected", () => {
    renderGraph(buildState3);
    const card = node(blockKey("s3-pool")).querySelector("[data-card-state]");
    expect(card).toHaveAttribute("data-card-state", "empty");
    expect(card).toHaveAttribute("data-selected");
    expect(card).toHaveAccessibleName("Uniswap v4, Pick a pool, on Arbitrum, 0% of the capital");
  });

  // @rule I3
  // @rule C15
  it("[I3, C15, C17] turns exactly the active templates and ports primary", () => {
    const active = new Set([
      targetKey({ kind: "addProtocol", network: "arbitrum" }),
      targetKey({ kind: "port", side: "after", blockId: "c-supply-supply" }),
    ]);
    renderGraph(canvasC, { activeTargetKeys: active });
    const lit = [...document.querySelectorAll("[data-active]")].map((element) =>
      element.closest("[data-graph-node]")?.getAttribute("data-graph-node"),
    );
    expect(lit.sort()).toEqual([...active].sort());
  });
});

describe("BuildGraph, invalid blocks and networks (D6)", () => {
  const invalid: Partial<BlockContent> = {
    caption: "No longer in your mandate",
    state: "invalid",
  };

  // @rule D6
  it("[D6] draws a block the registry marks invalid with the invalid card and says why", () => {
    const base = fixtureGraphProps(canvasC);
    renderGraph(canvasC, {
      describeBlock: (id) =>
        id === "c-supply-supply"
          ? { ...base.describeBlock(id), ...invalid }
          : base.describeBlock(id),
    });
    const card = node(blockKey("c-supply-supply")).querySelector("[data-card-state]");
    expect(card).toHaveAttribute("data-card-state", "invalid");
    expect(card).toHaveTextContent("No longer in your mandate");
    expect(card).toHaveAccessibleName(
      "Supply USDC, No longer in your mandate, on Arbitrum, 40% of the capital",
    );
  });

  // @rule D6
  it("[D6] draws a spoke whose network left the mandate as invalid, in words on its chip", () => {
    renderGraph(canvasA, { invalidNetworks: new Set(["base"]) });
    const base = node("group:base").querySelector("[data-spoke-group]");
    expect(base).toHaveAttribute("data-invalid");
    expect(
      within(node("group:base")).getByText("No longer in your mandate", { selector: ".sr-only" }),
    ).toBeInTheDocument();
    expect(node("group:robinhood").querySelector("[data-spoke-group]")).not.toHaveAttribute(
      "data-invalid",
    );
  });
});

describe("BuildGraph, hover link (BB8)", () => {
  const poolLabel = targetKey({
    kind: "shareLabel",
    chainId: "c-pool",
    network: "arbitrum",
    feedsBlockId: "c-pool-pool",
  });

  function edge(id: string): Element | null {
    return document.querySelector(`polyline[data-edge-id="${id}"]`);
  }

  // @rule BB8
  it("[BB8] hovering a share label lights its edge and itself; leaving clears both", () => {
    renderGraph(canvasC);
    const label = node(poolLabel).querySelector("[data-share-label]") as HTMLElement;
    fireEvent.pointerEnter(label);
    expect(edge("stub:chain:c-pool")).toHaveAttribute("data-highlighted");
    expect(label).toHaveAttribute("data-highlighted");
    expect(document.querySelectorAll("polyline[data-highlighted]")).toHaveLength(1);
    fireEvent.pointerLeave(label);
    expect(edge("stub:chain:c-pool")).not.toHaveAttribute("data-highlighted");
    expect(label).not.toHaveAttribute("data-highlighted");
  });

  // @rule BB8
  it("[BB8] hovering an edge lights it and its share label", () => {
    renderGraph(canvasC);
    const hit = document.querySelector('[data-edge-hit="stub:chain:c-pool"]') as Element;
    fireEvent.pointerEnter(hit);
    expect(edge("stub:chain:c-pool")).toHaveAttribute("data-highlighted");
    expect(node(poolLabel).querySelector("[data-share-label]")).toHaveAttribute("data-highlighted");
    fireEvent.pointerLeave(hit);
    expect(node(poolLabel).querySelector("[data-share-label]")).not.toHaveAttribute(
      "data-highlighted",
    );
  });

  // @rule BB8
  it("[BB8] keyboard focus on a share label lights its edge too", () => {
    renderGraph(canvasC);
    const label = screen.getByRole("button", { name: "60% of the strategy's capital" });
    act(() => label.focus());
    expect(edge("stub:chain:c-pool")).toHaveAttribute("data-highlighted");
    act(() => label.blur());
    expect(edge("stub:chain:c-pool")).not.toHaveAttribute("data-highlighted");
  });
});

describe("BuildGraph, re-flow (I9)", () => {
  const withThirdChain = {
    ...canvasC.input,
    hub: {
      chains: [
        ...canvasC.input.hub.chains,
        {
          id: "c-new",
          sharePct: 0,
          steps: [
            {
              id: "c-new-supply",
              family: "position",
              kind: "aaveSupply",
              auto: false,
              configured: false,
            },
          ],
        },
      ],
    },
  } satisfies typeof canvasC.input;

  function rerenderWith(
    layout: GraphLayout,
    rerender: (ui: React.ReactElement) => void,
    props: BuildGraphProps,
  ) {
    rerender(
      <div data-testid="canvas">
        <div {...layerAttr}>
          <BuildGraph {...props} layout={layout} />
        </div>
      </div>,
    );
  }

  // @rule I9
  it("[I9] keeps each node's element across a re-flow, keyed by its stable id, and moves it", () => {
    const base = fixtureGraphProps(canvasC);
    const props = propsFor(canvasC, {
      describeBlock: (id) =>
        id === "c-new-supply"
          ? {
              title: "Aave v3 Supply",
              caption: "Pick an asset",
              icon: "bank",
              state: "empty",
              accessibleName: "",
            }
          : base.describeBlock(id),
    });
    const { rerender } = renderGraph(canvasC, props);
    const before = node(targetKey({ kind: "addNetwork" }));
    const left = before.style.left;
    rerenderWith(layoutGraph(withThirdChain, { startHereWidth: 420 }), rerender, props);
    const after = node(targetKey({ kind: "addNetwork" }));
    expect(after).toBe(before);
    expect(after.style.left).not.toBe(left);
  });

  // @rule I9
  it("[I9] animates a moved node 150 ms ease-out", () => {
    renderGraph(canvasC);
    expect(node(targetKey({ kind: "addNetwork" })).style.transition).toBe(
      "left 150ms ease-out, top 150ms ease-out",
    );
  });

  // @rule I9
  it("[I9, D8] does not animate under reduced motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    renderGraph(canvasC);
    for (const element of document.querySelectorAll<HTMLElement>("[data-graph-node]")) {
      expect(element.style.transition).toBe("");
    }
  });

  // @rule I9
  it("[I9] zooming the viewport never draws the graph again", async () => {
    const user = userEvent.setup();
    const base = fixtureGraphProps(canvasC);
    const describeBlock = vi.fn(base.describeBlock);
    const props = propsFor(canvasC, { describeBlock });
    renderWithProviders(
      <CanvasViewport graphSize={props.layout}>
        <BuildGraph {...props} />
      </CanvasViewport>,
    );
    const calls = describeBlock.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(describeBlock).toHaveBeenCalledTimes(calls);
  });
});
