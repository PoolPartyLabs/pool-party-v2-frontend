/**
 * @id PP-MGR-CMP-070
 * @name PriceRangeField tests
 * @implements-rules-version v1 (POO-2189)
 * @analytics-events none (the panel shell emits)
 */
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import managerMessages from "@/i18n/messages/en/manager.json";
import { PANEL_POOL_FIXTURES, panelPoolAtPrice } from "@/mocks/data/buildPanelFixtures";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../../tests/utils/renderWithProviders";
import { PriceRangeField } from "./PriceRangeField";
import { type PanelPoolView, toLivePoolGrid, toPanelPoolView } from "./panelCatalogView";
import { commitBoundInput, displayBounds, type PoolRange, presetRange } from "./poolRangeMath";

const fixture = PANEL_POOL_FIXTURES[0];
if (!fixture) throw new Error("Pool fixture required");
const rawPool = fixture.pool;
const pool = toPanelPoolView(rawPool);
const candidate = presetRange(toLivePoolGrid(pool), 10);
if (!candidate) throw new Error("A priced pool fixture is required");
const initial = candidate;
function Controlled({
  start = initial,
  onChange = vi.fn(),
  selectedPool = pool,
  touchTargets = false,
}: {
  start?: PoolRange;
  onChange?: (range: PoolRange) => void;
  selectedPool?: PanelPoolView;
  touchTargets?: boolean;
}) {
  const [range, setRange] = useState(start);
  return (
    <PriceRangeField
      pool={selectedPool}
      range={range}
      touchTargets={touchTargets}
      onChange={(next) => {
        setRange(next);
        onChange(next);
      }}
    />
  );
}
describe("PriceRangeField", () => {
  // @rule POO-2284 R1: the readable numeric line is separate from 44px adjustment targets.
  it("keeps complete Min/Max values on their own line in Manage (POO-2284)", () => {
    renderWithProviders(<Controlled touchTargets />);
    for (const label of ["Min price", "Max price"]) {
      const input = screen.getByRole("textbox", { name: label });
      expect(input.parentElement?.querySelectorAll("button")).toHaveLength(0);
      expect(input).toHaveClass("w-full");
      expect(screen.getByRole("button", { name: `Increase ${label}` })).toHaveClass("min-w-11");
    }
  });
  // @rule POO-2284 R2: repeated edits retain the locale decimal and commit only on blur.
  it.each([
    "pt-BR",
    "de",
    "fr",
  ])("preserves tiny decimal input in %s instead of turning it into an integer (POO-2284)", async (locale) => {
    const tinyPool = { ...pool, price: 0.00035 };
    const tinyRange = presetRange(toLivePoolGrid(tinyPool), 20);
    if (!tinyRange) throw new Error("Tiny priced range required");
    const changed = vi.fn();
    renderWithProviders(
      <NextIntlClientProvider locale={locale} messages={{ manager: managerMessages }}>
        <Controlled start={tinyRange} selectedPool={tinyPool} onChange={changed} />
      </NextIntlClientProvider>,
    );
    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: "Min price" });
    await user.clear(input);
    await user.type(input, "0,0003");
    expect(input).toHaveValue("0,0003");
    expect(changed).not.toHaveBeenCalled();
    await user.tab();
    expect(changed).toHaveBeenLastCalledWith(
      commitBoundInput(tinyRange, toLivePoolGrid(tinyPool), "min", "0.0003"),
    );
  });
  // @rule POO-2284 R2/R3: decimal handling follows the displayed orientation, not the token order.
  it("preserves a comma decimal while typing an inverted quote (POO-2284)", async () => {
    const start = { ...initial, displayInverted: true };
    const changed = vi.fn();
    renderWithProviders(
      <NextIntlClientProvider locale="pt-BR" messages={{ manager: managerMessages }}>
        <Controlled start={start} onChange={changed} />
      </NextIntlClientProvider>,
    );
    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: "Min price" });
    await user.clear(input);
    await user.type(input, "0,00035");
    expect(input).toHaveValue("0,00035");
    await user.keyboard("{Enter}");
    expect(changed).toHaveBeenLastCalledWith(
      commitBoundInput(start, toLivePoolGrid(pool), "min", "0.00035"),
    );
  });
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
    expect(Math.abs(changed.mock.lastCall?.[0].tickLower % pool.tickSpacing)).toBe(0);
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
    const low = toPanelPoolView(panelPoolAtPrice(rawPool, 2000));
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
  it("POO-2227 offers 44px Manage touch targets while retaining the Build default", () => {
    const view = renderWithProviders(
      <PriceRangeField pool={pool} range={initial} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "±5%" })).toHaveClass("h-[29px]");
    view.rerender(<PriceRangeField pool={pool} range={initial} onChange={vi.fn()} touchTargets />);
    expect(screen.getByRole("button", { name: "±5%" })).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "Increase Min price" })).toHaveClass(
      "min-h-11",
      "min-w-11",
    );
  });
});
