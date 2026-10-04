/**
 * @id PP-MGR-CMP-070
 * @name PriceRangeField tests
 * @implements-rules-version v1 (POO-2189)
 * @analytics-events none (the panel shell emits)
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { PANEL_POOL_FIXTURES, panelPoolAtPrice } from "@/mocks/data/buildPanelFixtures";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../../tests/utils/renderWithProviders";
import { PriceRangeField } from "./PriceRangeField";
import { toLivePoolGrid, toPanelPoolView } from "./panelCatalogView";
import { displayBounds, type PoolRange, presetRange } from "./poolRangeMath";

const pool = toPanelPoolView(PANEL_POOL_FIXTURES[0].pool);
const initial = presetRange(toLivePoolGrid(pool), 10)!;
function Controlled({
  start = initial,
  onChange = vi.fn(),
}: {
  start?: PoolRange;
  onChange?: (range: PoolRange) => void;
}) {
  const [range, setRange] = useState(start);
  return (
    <PriceRangeField
      pool={pool}
      range={range}
      onChange={(next) => {
        setRange(next);
        onChange(next);
      }}
    />
  );
}
describe("PriceRangeField", () => {
  it("[R4] snaps presets, steps one usable tick and makes Full inert", async () => {
    const changed = vi.fn();
    renderWithProviders(<Controlled onChange={changed} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "±5%" }));
    expect(changed.mock.lastCall?.[0]).toEqual(presetRange(toLivePoolGrid(pool), 5));
    const lower = changed.mock.lastCall?.[0].tickLower;
    await user.click(screen.getByRole("button", { name: "Increase Min price" }));
    expect(changed.mock.lastCall?.[0].tickLower).toBe(lower + pool.tickSpacing);
    expect(screen.getByRole("button", { name: "±5%" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "Full" }));
    expect(screen.getByRole("textbox", { name: "Min price" })).toHaveValue("0");
    expect(screen.getByRole("textbox", { name: "Max price" })).toHaveValue("∞");
    expect(screen.getByRole("button", { name: "Increase Min price" })).toBeDisabled();
    expect(screen.getByText(/always in range/)).toBeInTheDocument();
  });
  it("[R4] refuses the step that would make the range narrower than two spacings", () => {
    renderWithProviders(
      <Controlled start={{ ...initial, tickUpper: initial.tickLower + 2 * pool.tickSpacing }} />,
    );
    expect(screen.getByRole("button", { name: "Increase Min price" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decrease Max price" })).toBeDisabled();
  });
  it("[R4] keeps untouched rounded text on blur and commits typing only on blur", async () => {
    const changed = vi.fn();
    renderWithProviders(<Controlled onChange={changed} />);
    const user = userEvent.setup();
    const field = screen.getByRole("textbox", { name: "Min price" });
    await user.click(field);
    await user.tab();
    expect(changed).not.toHaveBeenCalled();
    await user.click(field);
    await user.clear(field);
    await user.type(field, "2600");
    expect(changed).not.toHaveBeenCalled();
    await user.tab();
    expect(changed.mock.lastCall?.[0].tickLower % pool.tickSpacing).toBe(0);
  });
  it("[R5] inverts the quote while preserving canonical ticks", async () => {
    const changed = vi.fn();
    renderWithProviders(<Controlled onChange={changed} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "USDC per WETH" }));
    expect(changed.mock.lastCall?.[0]).toEqual({ ...initial, displayInverted: true });
    expect(screen.getByRole("button", { name: "WETH per USDC" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Min price" }).parentElement).not.toHaveTextContent(
      "$",
    );
  });
  it("[R6] names the canonical one-token position and swaps below/above on inversion", () => {
    const low = toPanelPoolView(panelPoolAtPrice(PANEL_POOL_FIXTURES[0].pool, 2000));
    const { rerender } = renderWithProviders(
      <PriceRangeField pool={low} range={initial} onChange={vi.fn()} />,
    );
    expect(screen.getByText(/below your range/)).toBeInTheDocument();
    expect(screen.getByText(/starts 100% in WETH/)).toBeInTheDocument();
    rerender(
      <PriceRangeField
        pool={low}
        range={{ ...initial, displayInverted: true }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/above your range/)).toBeInTheDocument();
    expect(screen.getByText(/starts 100% in WETH/)).toBeInTheDocument();
  });
  it("[R6] includes bounds and shows 100% without the out-of-range sentence", () => {
    const bound = displayBounds(initial, toLivePoolGrid(pool)).min;
    renderWithProviders(
      <PriceRangeField pool={{ ...pool, price: bound }} range={initial} onChange={vi.fn()} />,
    );
    expect(screen.getByText(/· in range/)).toBeInTheDocument();
    expect(screen.queryByText(/position starts/)).not.toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
