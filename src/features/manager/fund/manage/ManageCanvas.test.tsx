/**
 * @id PP-MGR-CMP-085
 * @name ManageCanvas tests
 * @implements-rules-version v2 (POO-2274, POO-2270, POO-2271; extends POO-2226)
 * @analytics-events none, read-only graph tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockFund } from "@/mocks/data/v2Funds";
import {
  act,
  cleanup,
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import { ManageCanvas } from "./ManageCanvas";
import { layoutManageGraph } from "./manageLayout";
import { available, normalizeManageModel } from "./manageModel";

/** jsdom has no layout. Supply the real engine with only its declared node/handle dimensions. */
const engineSize = (element: HTMLElement) => ({
  width: Number.parseFloat(element.style.width) || 0,
  height: Number.parseFloat(element.style.height || element.style.minHeight) || 0,
});
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "DOMMatrixReadOnly",
    class {
      m22 = 1;
    },
  );
  for (const axis of ["Width", "Height"] as const) {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, `offset${axis}`)?.get;
    vi.spyOn(HTMLElement.prototype, `offset${axis}`, "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.matches(".react-flow__node, .react-flow__handle"))
        return engineSize(this)[axis === "Width" ? "width" : "height"];
      return original?.call(this) ?? 0;
    });
  }
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (!this.matches(".react-flow__node, .react-flow__handle")) return originalRect.call(this);
    const node = this.closest<HTMLElement>(".react-flow__node");
    const dimensions = engineSize(this);
    const size = node ? engineSize(node) : dimensions;
    const translation = node?.style.transform.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
    let x = Number(translation?.[1] ?? 0),
      y = Number(translation?.[2] ?? 0);
    if (this.matches(".react-flow__handle")) {
      const coordinate = (value: string, side: number) =>
        Number.parseFloat(value) * (value.endsWith("%") ? side / 100 : 1) || 0;
      x += coordinate(this.style.left, size.width);
      y += coordinate(this.style.top, size.height);
      const side = this.dataset.handlepos;
      x -=
        side === "right"
          ? dimensions.width
          : side === "top" || side === "bottom"
            ? dimensions.width / 2
            : 0;
      y -=
        side === "bottom"
          ? dimensions.height
          : side === "left" || side === "right"
            ? dimensions.height / 2
            : 0;
    }
    return DOMRect.fromRect({ x, y, ...dimensions });
  });
});
afterEach(async () => {
  cleanup();
  // Drain engine internals scheduled on RAF before removing jsdom API shims.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("POO-2270/2271 v2 canvas", () => {
  // @rule POO-2302 R2/R4/R5: the production Manage host mounts declared ports in one engine.
  it("mounts the shared engine with financial handles on the existing cards", () => {
    const model = normalizeManageModel(mockFund);
    renderWithProviders(<ManageCanvas model={model} selectedId={null} onSelect={vi.fn()} />);
    expect(document.querySelector("[data-canvas-viewport]")).toHaveAttribute(
      "data-canvas-engine",
      "react-flow",
    );
    expect(document.querySelector("[data-canvas-layer]")).toBeNull();
    const layout = layoutManageGraph(model);
    expect(document.querySelectorAll("[data-manage-position]")).toHaveLength(
      model.positions.length,
    );
    for (const port of layout.semantic.ports) {
      const handle = document.querySelector(`[data-financial-port='${port.id}']`);
      expect(handle?.closest("[data-financial-node]")).toHaveAttribute(
        "data-financial-node",
        port.nodeId,
      );
      expect(handle).not.toHaveClass("connectablestart");
      expect(handle).not.toHaveClass("connectableend");
    }
    for (const node of document.querySelectorAll(".react-flow__node")) {
      expect(node).not.toHaveClass("draggable");
      expect(node).not.toHaveClass("selectable");
    }
  });

  it("[POO-2272 R1/R4] keeps canonical Hub chrome outside the moving graph and applies locks by role", async () => {
    const model = normalizeManageModel(mockFund);
    renderWithProviders(<ManageCanvas model={model} selectedId={null} onSelect={vi.fn()} />);
    const badge = document.querySelector<HTMLElement>("[data-manage-hub]");
    if (!badge) throw new Error("Hub overlay missing");
    expect(badge).toHaveTextContent("Hub");
    expect(badge).toHaveTextContent(model.chains.find((chain) => chain.hub)?.name ?? "missing");
    expect(badge).not.toHaveTextContent("Fixed");
    expect(badge.closest("[data-canvas-layer]")).toBeNull();
    expect(badge.closest("[data-canvas-overlay]")).not.toBeNull();
    const graph = document.querySelector<HTMLElement>(".react-flow__viewport");
    const original = graph?.style.transform;
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(graph?.style.transform).not.toBe(original);
    expect(badge.style.transform).toBe("");
    for (const id of [`idle:${model.hubChainId}`, "withdrawal", "income"]) {
      const lock = document.querySelector(`[data-manage-node='${id}'] [data-manage-lock]`);
      expect(lock).toHaveAttribute("width", "14");
      expect(lock).toHaveAttribute("aria-hidden", "true");
    }
    for (const chain of model.chains.filter((chain) => !chain.hub)) {
      expect(
        document.querySelector(`[data-manage-node='idle:${chain.chainId}'] [data-manage-lock]`),
      ).toBeNull();
      const chip = document.querySelector(
        `[data-financial-node='decoration:chip:group:${chain.chainId}'] [data-network-chip]`,
      );
      expect(chip?.className).toContain("min-h-8");
      expect(chip?.querySelector("img")).toHaveAttribute("width", "20");
    }
    const flowNodes = [...document.querySelectorAll<HTMLElement>("[data-flow-pill]")];
    for (const pill of flowNodes) {
      const isCollect = pill.textContent?.includes("Collect fees");
      const lock = pill.querySelector("[data-flow-lock]");
      if (isCollect) expect(lock).toBeNull();
      else expect(lock).toHaveAttribute("width", "12");
    }
  });

  it("shows compact native cash without an internal network label and keeps USD independent", () => {
    const model = normalizeManageModel(mockFund);
    const chain = model.chains[0];
    const native = chain?.cash[0];
    if (!chain || !native) throw new Error("native missing");
    const exact = {
      chainId: chain.chainId,
      address: null,
      symbol: native.symbol,
      decimals: native.decimals,
      raw: "25000000000000000",
      decimal: "0.025",
    };
    chain.cash = [
      {
        ...native,
        amount: available(exact, "test-native"),
        valueUsd: available("75", "test-price"),
      },
    ];
    const view = renderWithProviders(
      <ManageCanvas model={model} selectedId={null} onSelect={vi.fn()} />,
    );
    const cash = document.querySelector<HTMLElement>(`[data-manage-cash="${chain.chainId}"]`);
    if (!cash) throw new Error("cash missing");
    expect(cash.closest<HTMLElement>("[data-manage-node]")?.style.width).toBe("144px");
    expect(cash.closest<HTMLElement>("[data-manage-node]")?.style.height).toBe("96px");
    expect(within(cash).getByRole("heading", { name: "Operating cash" })).toHaveClass("text-sm");
    expect(cash).not.toHaveTextContent(chain.name);
    expect(cash).toHaveTextContent("0.025");
    expect(cash).toHaveTextContent("$75.00");
    const unpriced = {
      ...model,
      chains: model.chains.map((item) =>
        item.chainId === chain.chainId
          ? { ...item, cash: [{ ...native, amount: available(exact, "test-native") }] }
          : item,
      ),
    };
    view.rerender(<ManageCanvas model={unpriced} selectedId={null} onSelect={vi.fn()} />);
    expect(cash).toHaveTextContent("0.025");
    expect(cash).not.toHaveTextContent("$75.00");
    expect(cash.querySelector("[data-cash-usd]")).toHaveClass("min-h-[18px]");
    const stalePrice = {
      ...unpriced,
      chains: unpriced.chains.map((item) =>
        item.chainId === chain.chainId
          ? {
              ...item,
              cash: [
                {
                  ...native,
                  amount: available(exact, "test-native"),
                  valueUsd: { status: "unavailable" as const, reason: "stale-price" },
                },
              ],
            }
          : item,
      ),
    };
    view.rerender(<ManageCanvas model={stalePrice} selectedId={null} onSelect={vi.fn()} />);
    expect(cash).toHaveTextContent("0.025");
    expect(cash).not.toHaveTextContent("$75.00");
    const zero = {
      ...unpriced,
      chains: unpriced.chains.map((item) =>
        item.chainId === chain.chainId
          ? {
              ...item,
              cash: [
                {
                  ...native,
                  amount: available({ ...exact, raw: "0", decimal: "0" }, "test-native"),
                },
              ],
            }
          : item,
      ),
    };
    view.rerender(<ManageCanvas model={zero} selectedId={null} onSelect={vi.fn()} />);
    expect(cash.querySelector("[title='0 ETH']")).toBeInTheDocument();
    const missing = {
      ...zero,
      chains: zero.chains.map((item) =>
        item.chainId === chain.chainId
          ? {
              ...item,
              cash: [
                { ...native, valueUsd: { status: "unavailable" as const, reason: "stale_price" } },
              ],
            }
          : item,
      ),
    };
    view.rerender(<ManageCanvas model={missing} selectedId={null} onSelect={vi.fn()} />);
    expect(cash).toHaveTextContent("Not available");
    expect(cash.querySelector("[title='0 ETH']")).toBeNull();
  });
  // @rule R2: USD requires a known native quantity and a separate available valuation.
  it("hides independently available USD when native is unavailable and retains confirmed zero", () => {
    const model = normalizeManageModel(mockFund);
    const chain = model.chains[0];
    const native = chain?.cash[0];
    if (!chain || !native) throw new Error("native missing");
    chain.cash = [{ ...native, valueUsd: available("75", "test-price") }];
    const view = renderWithProviders(
      <ManageCanvas model={model} selectedId={null} onSelect={vi.fn()} />,
    );
    const cash = document.querySelector<HTMLElement>(`[data-manage-cash="${chain.chainId}"]`);
    if (!cash) throw new Error("cash missing");
    expect(cash).toHaveTextContent("Not available");
    expect(cash).not.toHaveTextContent("$75.00");
    const zero = {
      ...model,
      chains: model.chains.map((item) =>
        item.chainId === chain.chainId
          ? {
              ...item,
              cash: [
                {
                  ...native,
                  amount: available(
                    {
                      chainId: chain.chainId,
                      address: null,
                      symbol: native.symbol,
                      decimals: native.decimals,
                      raw: "0",
                      decimal: "0",
                    },
                    "confirmed-native",
                  ),
                  valueUsd: available("0", "test-price"),
                },
              ],
            }
          : item,
      ),
    };
    view.rerender(<ManageCanvas model={zero} selectedId={null} onSelect={vi.fn()} />);
    expect(cash.querySelector("[title='0 ETH']")).toBeInTheDocument();
    expect(cash).toHaveTextContent("$0.00");
    const stale = {
      ...model,
      chains: model.chains.map((item) =>
        item.chainId === chain.chainId
          ? {
              ...item,
              cash: [
                {
                  ...native,
                  amount: { status: "unavailable" as const, reason: "stale-native" },
                  valueUsd: available("75", "test-price"),
                },
              ],
            }
          : item,
      ),
    };
    view.rerender(<ManageCanvas model={stale} selectedId={null} onSelect={vi.fn()} />);
    expect(cash).toHaveTextContent("Not available");
    expect(cash).not.toHaveTextContent("$75.00");
  });
  it("highlights every visible leg of one principal route while siblings retain resting colors", async () => {
    renderWithProviders(
      <ManageCanvas model={normalizeManageModel(mockFund)} selectedId={null} onSelect={vi.fn()} />,
    );
    await waitFor(() =>
      expect(document.querySelectorAll("[data-edge-hit]").length).toBeGreaterThan(0),
    );
    const hit = [...document.querySelectorAll<SVGElement>("[data-edge-hit]")].find(
      (node) =>
        node.dataset.edgeHit?.startsWith("principal:position:") &&
        node.dataset.edgeHit?.includes(":4663:"),
    );
    if (!hit) throw new Error("principal hit missing");
    fireEvent.pointerEnter(hit);
    const highlighted = document.querySelectorAll("[data-edge-id][data-highlighted]");
    expect(highlighted).toHaveLength(2);
    expect([...highlighted].every((node) => node.getAttribute("data-edge-tone") === "muted")).toBe(
      true,
    );
    expect(
      document.querySelector("[data-edge-id][data-highlighted][data-connection-id^='transfer:']"),
    ).toBeNull();
    expect(
      [...document.querySelectorAll("[data-edge-tone='income']")].every(
        (node) => !node.hasAttribute("data-highlighted"),
      ),
    ).toBe(true);
    fireEvent.pointerLeave(hit);
    expect(document.querySelectorAll("[data-edge-id][data-highlighted]")).toHaveLength(0);
    const feeHit = [...document.querySelectorAll<SVGElement>("[data-edge-hit]")].find((node) =>
      node.dataset.edgeHit?.startsWith("conversion:"),
    );
    if (!feeHit) throw new Error("fee hit missing");
    fireEvent.pointerEnter(feeHit);
    expect(document.querySelectorAll("[data-edge-id][data-highlighted]")).toHaveLength(4);
    expect(
      [...document.querySelectorAll("[data-edge-id][data-highlighted]")].every(
        (node) => node.getAttribute("data-edge-tone") === "income",
      ),
    ).toBe(true);
    fireEvent.pointerLeave(feeHit);
    const inboundHit = document.querySelector<SVGElement>("[data-edge-hit='bridge:idle:4663']");
    if (!inboundHit) throw new Error("inbound hit missing");
    fireEvent.pointerEnter(inboundHit);
    expect(
      [...document.querySelectorAll("[data-edge-id][data-highlighted]")].map((node) =>
        node.getAttribute("data-connection-id"),
      ),
    ).toEqual(["spoke:allocation:4663", "bridge:idle:4663"]);
  });
  // @rule POO-2302 R3: the painted card surface owns the measured minimum, not an empty wrapper.
  it.each([null, "75"])("fills painted surfaces with withdrawal coverage %s", (coverage) => {
    const model = normalizeManageModel(mockFund);
    renderWithProviders(
      <ManageCanvas
        model={{
          ...model,
          withdrawal: {
            ...model.withdrawal,
            coveragePct:
              coverage === null
                ? { status: "unavailable", reason: "no-coverage-observation" }
                : available(coverage, "test-coverage"),
          },
        }}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    for (const [id, minimum] of [
      ["withdrawal", "168px"],
      ["income", "102px"],
      [`idle:${model.hubChainId}`, "104px"],
      [`cash:${model.hubChainId}`, "96px"],
    ]) {
      const root = document.querySelector<HTMLElement>(`[data-manage-node='${id}']`);
      const surface = root?.querySelector<HTMLElement>("[data-manage-surface]");
      expect(surface?.style.minHeight).toBe(minimum);
      expect(surface?.querySelector("[data-piece-stroke]")).not.toBeNull();
    }
  });

  it("measures unscaled natural content and preserves viewport when only selection changes", () => {
    const callbacks: ResizeObserverCallback[] = [];
    const targets = new Map<ResizeObserverCallback, Set<Element>>();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: ResizeObserverCallback) {
          callbacks.push(cb);
          this.targets = new Set();
          targets.set(cb, this.targets);
        }
        targets: Set<Element>;
        observe(target: Element) {
          this.targets.add(target);
        }
        disconnect() {
          this.targets.clear();
        }
        unobserve(target: Element) {
          this.targets.delete(target);
        }
      },
    );
    const model = normalizeManageModel(mockFund);
    const view = renderWithProviders(
      <ManageCanvas model={model} selectedId={null} onSelect={vi.fn()} />,
    );
    const content = document.querySelector<HTMLElement>(
      "[data-manage-measure='withdrawal'] [data-manage-natural]",
    );
    if (!content || !callbacks.length) throw new Error("measurement missing");
    const transform = document.querySelector<HTMLElement>(".react-flow__viewport")?.style.transform;
    act(() =>
      callbacks
        .filter((callback) => targets.get(callback)?.has(content))
        .forEach((callback) => {
          callback(
            [
              {
                target: content,
                borderBoxSize: [{ inlineSize: 236, blockSize: 240 }],
              } as unknown as ResizeObserverEntry,
            ],
            {} as ResizeObserver,
          );
        }),
    );
    const box = document.querySelector<HTMLElement>("[data-manage-node='withdrawal']");
    expect(box?.style.height).toBe("240px");
    const positions = () =>
      [...document.querySelectorAll<HTMLElement>("[data-manage-node]")].map((node) =>
        node.getAttribute("style"),
      );
    const before = positions();
    view.rerender(
      <ManageCanvas model={model} selectedId={model.positions[0]?.id ?? null} onSelect={vi.fn()} />,
    );
    expect(positions()).toEqual(before);
    expect(document.querySelector<HTMLElement>(".react-flow__viewport")?.style.transform).toBe(
      transform,
    );
    const originalCard = document.querySelector("[data-manage-position]");
    const polled = {
      ...model,
      positions: model.positions.map((position) => ({ ...position })),
      chains: model.chains.map((chain) => ({ ...chain, positions: [...chain.positions] })),
    };
    view.rerender(
      <ManageCanvas
        model={polled}
        selectedId={model.positions[0]?.id ?? null}
        onSelect={vi.fn()}
      />,
    );
    expect(positions()).toEqual(before);
    expect(document.querySelector("[data-manage-position]")).toBe(originalCard);
    expect(document.querySelector<HTMLElement>(".react-flow__viewport")?.style.transform).toBe(
      transform,
    );
    act(() =>
      callbacks
        .filter((callback) => targets.get(callback)?.has(content))
        .forEach((callback) => {
          callback(
            [
              {
                target: content,
                borderBoxSize: [{ inlineSize: 236, blockSize: 168 }],
              } as unknown as ResizeObserverEntry,
            ],
            {} as ResizeObserver,
          );
        }),
    );
    expect(box?.style.height).toBe("168px");
  });

  // @rule POO-2302 R3/R4: the observed content must not inherit the last resolved card height.
  it("shrinks a previously expanded card from its natural content without unlocking the painted floor", () => {
    const callbacks: ResizeObserverCallback[] = [];
    const targets = new Map<ResizeObserverCallback, Set<Element>>();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback);
          this.targets = new Set();
          targets.set(callback, this.targets);
        }
        targets: Set<Element>;
        observe(target: Element) {
          this.targets.add(target);
        }
        unobserve(target: Element) {
          this.targets.delete(target);
        }
        disconnect() {
          this.targets.clear();
        }
      },
    );
    const model = normalizeManageModel(mockFund);
    renderWithProviders(<ManageCanvas model={model} selectedId={null} onSelect={vi.fn()} />);
    const outer = document.querySelector<HTMLElement>("[data-manage-measure='withdrawal']");
    const surface = outer?.querySelector<HTMLElement>("[data-manage-surface]");
    if (!outer || !surface) throw new Error("withdrawal card missing");
    const natural = outer.querySelector<HTMLElement>("[data-manage-natural]") ?? outer;
    let contentHeight = 240;
    // Model browser layout: an observed resolved box cannot report less than its own minimum.
    const actualHeight = () =>
      Math.max(contentHeight, Number.parseFloat(natural.style.minHeight) || 0);
    Object.defineProperties(natural, {
      clientHeight: { configurable: true, get: actualHeight },
      scrollHeight: { configurable: true, get: actualHeight },
      clientWidth: { configurable: true, value: 236 },
      scrollWidth: { configurable: true, value: 236 },
    });
    const observe = () =>
      act(() =>
        callbacks
          .filter((callback) => targets.get(callback)?.has(natural))
          .forEach((callback) => {
            callback(
              [
                {
                  target: natural,
                  borderBoxSize: [{ inlineSize: 236, blockSize: actualHeight() }],
                } as unknown as ResizeObserverEntry,
              ],
              {} as ResizeObserver,
            );
          }),
      );
    observe();
    expect(surface.style.minHeight).toBe("240px");
    contentHeight = 168;
    observe();
    expect(surface.style.minHeight).toBe("168px");
  });

  // @rule POO-2302 R3/R4: polling shorter content must also shrink a previously expanded width.
  it("shrinks a wide card after its token content becomes short without moving the viewport", () => {
    const observers: Array<{ callback: ResizeObserverCallback; targets: Set<Element> }> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        targets = new Set<Element>();
        constructor(callback: ResizeObserverCallback) {
          observers.push({ callback, targets: this.targets });
        }
        observe(target: Element) {
          this.targets.add(target);
        }
        unobserve(target: Element) {
          this.targets.delete(target);
        }
        disconnect() {
          this.targets.clear();
        }
      },
    );
    const sourceModel = normalizeManageModel(mockFund);
    const model = {
      ...sourceModel,
      withdrawal: {
        ...sourceModel.withdrawal,
        requested: available(
          {
            chainId: sourceModel.hubChainId,
            address: null,
            symbol: "LONG_WITHDRAWAL_TOKEN",
            decimals: 6,
            raw: "1000000",
            decimal: "1",
          },
          "test.snapshot",
        ),
      },
    };
    const view = renderWithProviders(
      <ManageCanvas model={model} selectedId={null} onSelect={vi.fn()} />,
    );
    const card = document.querySelector<HTMLElement>("[data-manage-node='withdrawal']");
    const natural = card?.querySelector<HTMLElement>("[data-manage-natural]");
    if (!card || !natural) throw new Error("withdrawal content missing");
    const transform = document.querySelector<HTMLElement>(".react-flow__viewport")?.style.transform;
    // Model w-full: absent an intrinsic measurement constraint, content inherits the resolved card.
    const contentWidth = () => Number.parseFloat(natural.style.width || card.style.width);
    Object.defineProperties(natural, {
      clientWidth: { configurable: true, get: contentWidth },
      scrollWidth: {
        configurable: true,
        get: () =>
          Math.max(
            contentWidth(),
            natural.textContent?.includes("LONG_WITHDRAWAL_TOKEN") ? 320 : 100,
          ),
      },
      clientHeight: { configurable: true, value: 168 },
      scrollHeight: { configurable: true, value: 168 },
    });
    const notify = () =>
      act(() => {
        for (const observer of observers.filter(({ targets }) => targets.has(natural)))
          observer.callback(
            [
              {
                target: natural,
                borderBoxSize: [{ inlineSize: contentWidth(), blockSize: 168 }],
              } as unknown as ResizeObserverEntry,
            ],
            {} as ResizeObserver,
          );
      });
    notify();
    expect(card.style.width).toBe("320px");
    // Polling changes content without changing the stretched border box, so no observer fires.
    view.rerender(
      <ManageCanvas
        model={{
          ...model,
          withdrawal: {
            ...model.withdrawal,
            requested:
              model.withdrawal.requested.status === "available"
                ? available(
                    { ...model.withdrawal.requested.value, symbol: "USDC" },
                    "test.snapshot",
                  )
                : model.withdrawal.requested,
          },
        }}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(card.style.width).toBe("236px");
    expect(natural.style.width).toBe("");
    expect(document.querySelector<HTMLElement>(".react-flow__viewport")?.style.transform).toBe(
      transform,
    );
  });
});

describe("Manage canvas", () => {
  it("[R3,R4] selects a live position by identity and shows quantities, USD and no creation controls", async () => {
    const model = normalizeManageModel(mockFund);
    const select = vi.fn();
    renderWithProviders(<ManageCanvas model={model} selectedId={null} onSelect={select} />);
    const cards = document.querySelectorAll<HTMLElement>("[data-manage-position]");
    expect(cards).toHaveLength(2);
    await userEvent.click(cards[1] as HTMLElement);
    expect(select).toHaveBeenCalledWith(model.positions[1]?.id);
    expect(screen.getByText("$400,000.00")).toBeInTheDocument();
    expect(screen.getByText("75 WETH")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add|Remove|Insert|Save|Next/i }),
    ).not.toBeInTheDocument();
  });
  it("[R4,R5] selection keeps node geometry and all cash boxes fixed", () => {
    const model = normalizeManageModel(mockFund);
    const view = renderWithProviders(
      <ManageCanvas model={model} selectedId={null} onSelect={vi.fn()} />,
    );
    const boxes = () =>
      [...document.querySelectorAll<HTMLElement>("[data-manage-node]")].map((n) => [
        n.dataset.manageNode,
        n.getAttribute("style"),
      ]);
    const initial = boxes();
    view.rerender(
      <ManageCanvas model={model} selectedId={model.positions[1]?.id ?? null} onSelect={vi.fn()} />,
    );
    expect(boxes()).toEqual(initial);
    const cash = document.querySelectorAll<HTMLElement>("[data-manage-cash]");
    expect(cash).toHaveLength(2);
    expect(
      [...cash].every(
        (n) =>
          n.closest<HTMLElement>("[data-manage-node]")?.style.width === "144px" &&
          n.closest<HTMLElement>("[data-manage-node]")?.style.height === "96px",
      ),
    ).toBe(true);
    expect([...cash].every((n) => n.textContent?.includes("Not available"))).toBe(true);
  });
  it("POO-2232 [R4,R5] shows live range text and a fixed decorative marker, never on Aave", () => {
    const model = normalizeManageModel(mockFund);
    const view = renderWithProviders(
      <ManageCanvas model={model} selectedId={null} onSelect={vi.fn()} />,
    );
    expect(screen.getByText("In range")).toBeInTheDocument();
    const status = document.querySelector("[data-manage-range]");
    const bar = status?.querySelector("svg");
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(bar).toHaveAttribute("width", "148");
    expect(bar).toHaveAttribute("height", "10");
    expect(bar?.querySelector("[data-range-marker]")).toHaveAttribute("x", "73");
    expect(document.querySelectorAll("[data-manage-range]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-manage-position]")[1]).toHaveAccessibleDescription(
      "In range",
    );
    const current = mockFund.positionsSummary?.positions[1];
    if (!current?.uniswap) throw new Error("liquidity fixture");
    const out = normalizeManageModel({
      ...mockFund,
      positionsSummary: {
        protocolVersion: "v2",
        positions: [{ ...current, uniswap: { ...current.uniswap, inRange: false } }],
      },
    });
    view.rerender(
      <ManageCanvas model={out} selectedId={out.positions[0]?.id ?? null} onSelect={vi.fn()} />,
    );
    expect(screen.getByText("Out of range")).toBeInTheDocument();
    expect(screen.queryByText("In range")).not.toBeInTheDocument();
    expect(document.querySelector("[data-range-track]")).toHaveAttribute("width", "148");
    expect(document.querySelector("[data-manage-range]")).toHaveClass("text-destructive");
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    const unavailable = normalizeManageModel({
      ...mockFund,
      positionsSummary: { protocolVersion: "v2", positions: [{ ...current, uniswap: null }] },
    });
    view.rerender(<ManageCanvas model={unavailable} selectedId={null} onSelect={vi.fn()} />);
    expect(document.querySelector("[data-manage-range]")).toHaveTextContent("Not available");
    expect(document.querySelector("[data-manage-range]")).not.toHaveClass("text-success");
  });
});

// @rule R1,R2: The renderer does not expose stable cash even from an older mixed model.
it("POO-2246 [R1,R2] renders only native cash from a mixed model at the unchanged size", () => {
  const model = normalizeManageModel(mockFund);
  for (const chain of model.chains) chain.cash.push(chain.idle);
  renderWithProviders(<ManageCanvas model={model} selectedId={null} onSelect={vi.fn()} />);
  for (const cash of document.querySelectorAll<HTMLElement>("[data-manage-cash]")) {
    expect(cash).toHaveTextContent("ETH");
    expect(cash).not.toHaveTextContent("USDC");
    expect(cash).not.toHaveTextContent("USDG");
    expect(cash.closest<HTMLElement>("[data-manage-node]")?.style.width).toBe("144px");
    expect(cash.closest<HTMLElement>("[data-manage-node]")?.style.height).toBe("96px");
  }
});

// @rule POO-2274 R1/R3/R6: every actual graph node, including structural/derived nodes, is inspectable.
it("offers exactly one native selection button on every actual node and keeps groups decorative", async () => {
  const model = normalizeManageModel(mockFund);
  const select = vi.fn();
  renderWithProviders(<ManageCanvas model={model} selectedId={null} onSelect={select} />);
  const nodes = [...document.querySelectorAll<HTMLElement>("[data-manage-node]")];
  for (const node of nodes) {
    const buttons = node.querySelectorAll<HTMLButtonElement>("button");
    if (node.dataset.manageNode?.startsWith("group:")) {
      expect(buttons).toHaveLength(0);
      continue;
    }
    expect(buttons, node.dataset.manageNode).toHaveLength(1);
    const button = buttons[0];
    expect(button?.querySelector("button")).toBeNull();
    await userEvent.click(button as HTMLButtonElement);
    const expected = node.dataset.manageNode?.startsWith("position:")
      ? node.dataset.manageNode.slice("position:".length)
      : node.dataset.manageNode;
    expect(select).toHaveBeenLastCalledWith(expected);
  }
});

it("keyboard activation reports inspection intent for structural and flow nodes", async () => {
  const model = normalizeManageModel(mockFund);
  const select = vi.fn();
  renderWithProviders(<ManageCanvas model={model} selectedId={null} onSelect={select} />);
  for (const id of [
    "deposit",
    `cash:${model.hubChainId}`,
    "withdrawal",
    "income",
    "withdraw",
    `collect:${model.positions[1]?.id}`,
    "bridge:4663",
  ]) {
    const button = document.querySelector<HTMLButtonElement>(`[data-manage-node="${id}"] button`);
    if (!button) throw new Error(`missing ${id} inspection button`);
    button.focus();
    await userEvent.keyboard("{Enter}");
    expect(select).toHaveBeenLastCalledWith(id, true);
  }
});
