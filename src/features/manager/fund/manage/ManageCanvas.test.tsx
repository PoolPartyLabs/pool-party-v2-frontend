/**
 * @id PP-MGR-CMP-085
 * @name ManageCanvas tests
 * @implements-rules-version v1 (POO-2226)
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
});
