/**
 * @id PP-MGR-CMP-085
 * @name ManageCanvas tests
 * @implements-rules-version v2 (POO-2226)
 * @analytics-events none, read-only graph tests.
 */
import { describe, expect, it, vi } from "vitest";
import { mockFund } from "@/mocks/data/v2Funds";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../tests/utils/renderWithProviders";
import { ManageCanvas } from "./ManageCanvas";
import { normalizeManageModel } from "./manageModel";

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
        (n) => n.parentElement?.style.width === "160px" && n.parentElement.style.height === "136px",
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
    expect(cash.parentElement?.style.width).toBe("160px");
    expect(cash.parentElement?.style.height).toBe("136px");
  }
});
