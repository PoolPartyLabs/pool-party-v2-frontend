/**
 * @id PP-MGR-CMP-085
 * @name ManageCanvas tests
 * @implements-rules-version v2 (POO-2270, POO-2271; extends POO-2226)
 * @analytics-events none, read-only graph tests.
 */
import { describe, expect, it, vi } from "vitest";
import { mockFund } from "@/mocks/data/v2Funds";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import { ManageCanvas } from "./ManageCanvas";
import { available, normalizeManageModel } from "./manageModel";

describe("POO-2270/2271 v2 canvas", () => {
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
  it("highlights every visible leg of one principal route while siblings retain resting colors", () => {
    renderWithProviders(
      <ManageCanvas model={normalizeManageModel(mockFund)} selectedId={null} onSelect={vi.fn()} />,
    );
    const hit = [...document.querySelectorAll<SVGElement>("[data-edge-hit]")].find(
      (node) =>
        node.dataset.edgeHit?.startsWith("principal:position:") &&
        node.dataset.edgeHit?.includes(":4663:"),
    );
    if (!hit) throw new Error("principal hit missing");
    fireEvent.pointerEnter(hit);
    const highlighted = document.querySelectorAll("[data-manage-route-highlight]");
    expect(highlighted).toHaveLength(2);
    expect([...highlighted].every((node) => node.getAttribute("data-edge-tone") === "muted")).toBe(
      true,
    );
    expect(
      document.querySelector("[data-manage-route-highlight][data-connection-id^='transfer:']"),
    ).toBeNull();
    expect(
      [...document.querySelectorAll("[data-edge-tone='income']")].every(
        (node) => !node.hasAttribute("data-manage-route-highlight"),
      ),
    ).toBe(true);
    fireEvent.pointerLeave(hit);
    expect(document.querySelectorAll("[data-manage-route-highlight]")).toHaveLength(0);
    const feeHit = [...document.querySelectorAll<SVGElement>("[data-edge-hit]")].find((node) =>
      node.dataset.edgeHit?.startsWith("conversion:"),
    );
    if (!feeHit) throw new Error("fee hit missing");
    fireEvent.pointerEnter(feeHit);
    expect(document.querySelectorAll("[data-manage-route-highlight]")).toHaveLength(4);
    expect(
      [...document.querySelectorAll("[data-manage-route-highlight]")].every(
        (node) => node.getAttribute("data-edge-tone") === "income",
      ),
    ).toBe(true);
    fireEvent.pointerLeave(feeHit);
    const inboundHit = document.querySelector<SVGElement>("[data-edge-hit='bridge:idle:4663']");
    if (!inboundHit) throw new Error("inbound hit missing");
    fireEvent.pointerEnter(inboundHit);
    expect(
      [...document.querySelectorAll("[data-manage-route-highlight]")].map((node) =>
        node.getAttribute("data-connection-id"),
      ),
    ).toEqual(["spoke:allocation:4663", "bridge:idle:4663"]);
  });
  it("measures unscaled natural content and preserves viewport when only selection changes", () => {
    const callbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: ResizeObserverCallback) {
          callbacks.push(cb);
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    const model = normalizeManageModel(mockFund);
    const view = renderWithProviders(
      <ManageCanvas model={model} selectedId={null} onSelect={vi.fn()} />,
    );
    const content = document.querySelector<HTMLElement>("[data-manage-measure='withdrawal']");
    if (!content || !callbacks.length) throw new Error("measurement missing");
    const transform = document.querySelector<HTMLElement>("[data-canvas-layer]")?.style.transform;
    act(() =>
      callbacks.forEach((callback) => {
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
    expect(document.querySelector<HTMLElement>("[data-canvas-layer]")?.style.transform).toBe(
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
    expect(document.querySelector<HTMLElement>("[data-canvas-layer]")?.style.transform).toBe(
      transform,
    );
    act(() =>
      callbacks.forEach((callback) => {
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
    vi.unstubAllGlobals();
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
