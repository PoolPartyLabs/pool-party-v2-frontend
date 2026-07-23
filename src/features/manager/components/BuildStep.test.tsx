/**
 * @id PP-MGR-CMP-019
 * @name BuildStep.test
 * Behavior (POO-278): the canvas renders the fixed V1 flow with the pool node pre-selected; the
 * config is THE range editor (tick steppers + LIVE in/out-of-range status + the live-rederived
 * risk/category card — both moved here from the Mandate step); Apply commits the range to the
 * canvas and Next hands the updated selection up; the pool node can't be removed (one pool per
 * strategy).
 */
import { describe, expect, it, vi } from "vitest";
import { priceToNearestUsableTick, tickToPrice } from "@/lib/manager/tickPrice";
import { uniswapPools } from "@/mocks/data/pools";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { deriveMandate } from "../lib/deriveMandate";
import { BuildStep } from "./BuildStep";
import type { MandateResult } from "./MandateStep";

// POO-861 R4: the mono-asset proximity warning renders in real mode only, so exercise BuildStep with
// isMockMode forced false. It only gates that warning path; every other assertion here is mode-agnostic
// (their ranges are in-range or far from the price, so no warning appears).
vi.mock("@/lib/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services")>()),
  isMockMode: false,
}));

// base-eth-usdc-5: currentPrice 3050.
const pool = uniswapPools[0];

function makeMandate(): MandateResult {
  if (!pool) throw new Error("expected at least one mock pool");
  return {
    selection: {
      name: "My Strategy",
      description: "",
      logoUrl: null,
      network: pool.network,
      query: "",
      poolId: pool.id,
      full: false,
      activePreset: 10,
      minPrice: "2745",
      maxPrice: "3355",
    },
    pool,
    derived: deriveMandate(pool, 10),
    rangeWidthPct: 10,
  };
}

// POO-877/881/900: a real-mode stable pool (USDC/USDT, decimals known) - the grid where the
// display-string round-trip used to freeze / loop the ± steppers and where the input-level clamp runs.
// Defaults to tickSpacing 1 (0.01%); pass feeBps 5 for the spacing-10 variant (POO-900 R6 fixtures).
function makeStableMandate(
  over: { minPrice?: string; maxPrice?: string; feeBps?: number } = {},
): MandateResult {
  const base = makeMandate();
  const stablePool = {
    ...base.pool,
    token0: "USDC",
    token1: "USDT",
    currentPrice: 1,
    feeBps: over.feeBps ?? 1,
    decimals0: 6,
    decimals1: 6,
  };
  return {
    ...base,
    pool: stablePool,
    derived: deriveMandate(stablePool, 10),
    selection: {
      ...base.selection,
      minPrice: over.minPrice ?? "0.999",
      maxPrice: over.maxPrice ?? "1.001",
      activePreset: null,
    },
  };
}

/** The tick the displayed bound sits on (round resolver, POO-877) for the spacing-1 stable grid. */
function shownTick(input: HTMLInputElement, feeBps = 1): number {
  return priceToNearestUsableTick(Number.parseFloat(input.value), 6, 6, feeBps);
}

describe("BuildStep", () => {
  it("renders the fixed flow with the pool node selected and an in-range status", () => {
    renderWithProviders(<BuildStep mandate={makeMandate()} onBack={vi.fn()} onNext={vi.fn()} />);
    // Canvas nodes (the pool node is titled by its pair).
    expect(screen.getByRole("button", { name: /ETH\/USDC/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ETH\/USDC/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Pool config is open: fee tier group + locked allocation + apply.
    expect(screen.getByRole("group", { name: "Fee tier" })).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply changes" })).toBeDisabled();
    // 2745 <= 3050 <= 3355 → in range (current + canvas mirror).
    expect(screen.getAllByText("In range").length).toBeGreaterThanOrEqual(2);
  });

  it("recomputes the status live, applies the range and hands it to Next", async () => {
    const onNext = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<BuildStep mandate={makeMandate()} onBack={vi.fn()} onNext={onNext} />);

    // Push the range above the current price → out of range (direction is no longer surfaced, POO-337).
    const min = screen.getByLabelText("Min price");
    await user.clear(min);
    await user.type(min, "3200");
    const max = screen.getByLabelText("Max price");
    await user.clear(max);
    await user.type(max, "3600");
    expect(screen.getByText("Out of range")).toBeInTheDocument();

    // Apply commits the draft to the canvas node…
    const apply = screen.getByRole("button", { name: "Apply changes" });
    expect(apply).toBeEnabled();
    await user.click(apply);
    expect(screen.getAllByText("Out of range").length).toBeGreaterThanOrEqual(2);

    // …and Next hands the updated selection upward.
    await user.click(screen.getByRole("button", { name: "Next: Review" }));
    // Typed bounds snap onto the pool's usable-tick grid (POO-278), so Next gets the snapped values.
    expect(onNext).toHaveBeenCalledWith(
      expect.objectContaining({ minPrice: "3199.96", maxPrice: "3600.72", full: false }),
    );
  });

  it("keeps unapplied edits out of Next and explains the immovable pool node", async () => {
    const onNext = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<BuildStep mandate={makeMandate()} onBack={vi.fn()} onNext={onNext} />);

    const min = screen.getByLabelText("Min price");
    await user.clear(min);
    // A VALID unapplied edit (2900 < max 3355, wide enough) so Next stays enabled (POO-860); the point
    // is that without Apply, Next still carries the original committed range, not this edit.
    await user.type(min, "2900");
    // No Apply → Next carries the original range.
    await user.click(screen.getByRole("button", { name: "Next: Review" }));
    expect(onNext).toHaveBeenCalledWith(
      expect.objectContaining({ minPrice: "2745", maxPrice: "3355" }),
    );
    // One pool per strategy in V1 → the node can't be removed.
    expect(screen.getByRole("button", { name: "Remove node" })).toBeDisabled();
  });

  it("derives risk/category live in the config and nudges bounds by tick steps", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BuildStep mandate={makeMandate()} onBack={vi.fn()} onNext={vi.fn()} />);

    // The "Calculated automatically" card moved here from Mandate: ETH/USDC ±10% → Blue-chip LP.
    expect(screen.getByText("Calculated automatically")).toBeInTheDocument();
    expect(screen.getByText("Blue-chip LP")).toBeInTheDocument();

    // 0.05% pool → 10-tick spacing → one usable-tick step up from 2745 lands on 2748.75.
    await user.click(screen.getByRole("button", { name: "Increase min price" }));
    expect(screen.getByLabelText("Min price")).toHaveValue("2748.75");

    // Full range keeps the card and explains itself.
    await user.click(screen.getByRole("button", { name: "Full" }));
    expect(screen.getByText(/Full range: earns across all prices/)).toBeInTheDocument();
    expect(screen.getByText("Calculated automatically")).toBeInTheDocument();
  });

  it("nudges sub-dollar pair bounds visibly (tick step survives rounding)", async () => {
    const user = userEvent.setup();
    // A low-priced pair (e.g. ETH/cbBTC ≈ 0.0269): one 0.05% tick-spacing nudge is ~0.0000269,
    // which 4-decimal rounding would swallow — the bug. Precision must adapt so the bound moves.
    const base = makeMandate();
    const lowPool = { ...base.pool, currentPrice: 0.0269 };
    const mandate: MandateResult = {
      ...base,
      pool: lowPool,
      derived: deriveMandate(lowPool, 10),
      selection: { ...base.selection, minPrice: "0.0242", maxPrice: "0.0296", activePreset: 10 },
    };
    renderWithProviders(<BuildStep mandate={mandate} onBack={vi.fn()} onNext={vi.fn()} />);

    const min = screen.getByLabelText("Min price");
    expect(min).toHaveValue("0.0242");
    await user.click(screen.getByRole("button", { name: "Increase min price" }));
    // One usable-tick step up from 0.0242 → 0.0242189 (changed, not rounded back to 0.0242).
    expect(screen.getByLabelText("Min price")).toHaveValue("0.0242189");
  });

  // @rule POO-770 hardening: even if the Mandate seed arrives degenerate ("0"/"0") for a low-price
  // pool, BuildStep recomputes the range from the active preset on mount, so the inputs never open at
  // 0 (which would otherwise hand an invalid range straight to Review).
  it("recomputes a degenerate seed from the active preset on mount (POO-770)", () => {
    const base = makeMandate();
    const lowPool = { ...base.pool, currentPrice: 0.0000158394, decimals0: 6, decimals1: 8 };
    const mandate: MandateResult = {
      ...base,
      pool: lowPool,
      derived: deriveMandate(lowPool, 10),
      selection: { ...base.selection, minPrice: "0", maxPrice: "0", activePreset: 10, full: false },
    };
    renderWithProviders(<BuildStep mandate={mandate} onBack={vi.fn()} onNext={vi.fn()} />);

    const min = screen.getByLabelText("Min price") as HTMLInputElement;
    const max = screen.getByLabelText("Max price") as HTMLInputElement;
    expect(Number.parseFloat(min.value)).toBeGreaterThan(0);
    expect(Number.parseFloat(max.value)).toBeGreaterThan(Number.parseFloat(min.value));
  });

  // @rule POO-860 R1: an inverted range (max < min) shows an inline error and blocks Apply + Next,
  // instead of silently passing to Review (where Launch was only quietly disabled before).
  it("[POO-860 R1] blocks an inverted range (max < min) with an inline error", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BuildStep mandate={makeMandate()} onBack={vi.fn()} onNext={vi.fn()} />);

    const max = screen.getByLabelText("Max price");
    await user.clear(max);
    await user.type(max, "2700"); // below the seed min of 2745
    expect(screen.getByText("Max must be at least 2 ticks above min.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next: Review" })).toBeDisabled();
  });

  // @rule POO-860 R2: a range narrower than the 2-tick minimum is rejected up front, and the CTA
  // re-enables once the band is widened past two usable-tick spacings.
  it("[POO-860 R2] blocks a sub-2-tick range and re-enables once widened", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BuildStep mandate={makeMandate()} onBack={vi.fn()} onNext={vi.fn()} />);

    const min = screen.getByLabelText("Min price");
    const max = screen.getByLabelText("Max price");
    // ~1 usable tick apart on the 0.05% grid (spacing 10, current 3050) → too tight.
    await user.clear(min);
    await user.type(min, "3050");
    await user.clear(max);
    await user.type(max, "3053");
    expect(screen.getByText("Max must be at least 2 ticks above min.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next: Review" })).toBeDisabled();

    // Widen well past two spacings → valid again.
    await user.clear(max);
    await user.type(max, "3200");
    expect(screen.queryByText("Max must be at least 2 ticks above min.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next: Review" })).toBeEnabled();
  });

  // @rule POO-861 R4: a single-sided range sitting within a few ticks of the current price shows a
  // non-blocking warning (both tokens may be needed after a small move); an in-range band does not.
  it("[POO-861 R4] warns for a single-sided range close to the price, not for an in-range one", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BuildStep mandate={makeMandate()} onBack={vi.fn()} onNext={vi.fn()} />);
    const warningRe = /A small move may require both tokens/;
    // Seeded 2745..3355 straddles the price 3050 → two-sided → no warning.
    expect(screen.queryByText(warningRe)).toBeNull();
    // Move the range just above the price (single-sided, ~1 tick away on the 0.05% grid) → warn.
    const min = screen.getByLabelText("Min price");
    const max = screen.getByLabelText("Max price");
    await user.clear(min);
    await user.type(min, "3053");
    await user.clear(max);
    await user.type(max, "3200");
    expect(screen.getByText(warningRe)).toBeInTheDocument();
  });

  // @rule POO-877 R1 — on a tickSpacing-1 pool (USDC/USDT 0.01%) the ± stepper moves the underlying
  // tick, so every click strictly changes the shown price. The old display-string round-trip froze it
  // (a fixed point on rounded-down tick prices) after a click or two.
  it("[POO-877 R1] does not lock the ± stepper on a tickSpacing-1 pool", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <BuildStep mandate={makeStableMandate()} onBack={vi.fn()} onNext={vi.fn()} />,
    );
    const min = screen.getByLabelText("Min price") as HTMLInputElement;
    const up = screen.getByRole("button", { name: "Increase min price" });
    const down = screen.getByRole("button", { name: "Decrease min price" });

    const readings = [Number.parseFloat(min.value)];
    for (let i = 0; i < 4; i++) {
      await user.click(up);
      readings.push(Number.parseFloat(min.value));
    }
    for (let i = 1; i < readings.length; i++) {
      expect(readings[i]).toBeGreaterThan(readings[i - 1] as number); // strictly rising, never frozen
    }
    // …and back down: strictly falling each click.
    let prev = Number.parseFloat(min.value);
    for (let i = 0; i < 3; i++) {
      await user.click(down);
      const next = Number.parseFloat(min.value);
      expect(next).toBeLessThan(prev);
      prev = next;
    }
  });

  // @rule POO-881 R5 + POO-900 R2 - typing a min that violates the minimum width and blurring snaps
  // the field to the exactly-2-tick-spacings boundary against the max (the minimum allowed), so the
  // inline error clears and Next re-enables.
  it("[POO-900 R2] snaps a blurred violating min to exactly 2 spacings below max", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <BuildStep mandate={makeStableMandate()} onBack={vi.fn()} onNext={vi.fn()} />,
    );
    const min = screen.getByLabelText("Min price") as HTMLInputElement;
    const max = screen.getByLabelText("Max price") as HTMLInputElement;

    await user.clear(min);
    await user.type(min, "9999"); // way above max → inverted
    await user.click(max); // blur min → snapBound clamps it
    expect(Number.parseFloat(min.value)).toBeLessThan(Number.parseFloat(max.value));
    // POO-900 R2: the snap lands on the TICK exactly 2 spacings below the max ("1.001" → tick 10).
    expect(shownTick(min)).toBe(8);
    expect(shownTick(max) - shownTick(min)).toBe(2);
    expect(screen.queryByText("Max must be at least 2 ticks above min.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next: Review" })).toBeEnabled();
  });

  // @rule POO-881 R6 + POO-900 R1 - the ± stepper hard-stops AT the 2-spacing minimum: repeatedly
  // nudging min up walks to exactly 2 spacings below max and the narrowing button disables there
  // (no 3-tick sawtooth loop past the boundary).
  it("[POO-900 R1] hard-stops the min stepper at exactly 2 spacings and disables it", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <BuildStep
        mandate={makeStableMandate({ minPrice: "0.9998", maxPrice: "1.0002" })}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    const min = screen.getByLabelText("Min price") as HTMLInputElement;
    const max = screen.getByLabelText("Max price") as HTMLInputElement;
    const up = screen.getByRole("button", { name: "Increase min price" });
    // Push min up far more than the band is wide - it must stop dead at the minimum width.
    for (let i = 0; i < 8; i++) await user.click(up);
    expect(Number.parseFloat(min.value)).toBeLessThan(Number.parseFloat(max.value));
    expect(shownTick(max) - shownTick(min)).toBe(2);
    expect(up).toBeDisabled();
    expect(screen.queryByText("Max must be at least 2 ticks above min.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next: Review" })).toBeEnabled();
  });

  // @rule POO-900 R7 - narrowing is MONOTONIC: over N presses the min bound never moves away from the
  // max (the regression lock on the loop: the clamp used to pin back at 3 spacings after rejecting a
  // 1-spacing step, so the displayed bound cycled between 3 ticks).
  it("[POO-900 R7] repeated narrowing presses never move min back down (loop regression)", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <BuildStep
        mandate={makeStableMandate({ minPrice: "0.9998", maxPrice: "1.0002" })}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    const min = screen.getByLabelText("Min price") as HTMLInputElement;
    const up = screen.getByRole("button", { name: "Increase min price" });
    let prev = Number.parseFloat(min.value);
    for (let i = 0; i < 10; i++) {
      await user.click(up);
      const next = Number.parseFloat(min.value);
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
  });

  // @rule POO-900 R1/R5 - at exactly 2 tick-spacings the NARROWING steppers (increase min / decrease
  // max) are disabled while the WIDENING ones stay enabled, on the spacing-1 grid…
  it("[POO-900 R1/R5] disables only the narrowing steppers at the 2-spacing minimum (spacing 1)", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <BuildStep
        mandate={makeStableMandate({
          minPrice: String(tickToPrice(-1, 6, 6)),
          maxPrice: String(tickToPrice(1, 6, 6)),
        })}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Increase min price" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decrease max price" })).toBeDisabled();
    const widenMin = screen.getByRole("button", { name: "Decrease min price" });
    expect(widenMin).toBeEnabled();
    expect(screen.getByRole("button", { name: "Increase max price" })).toBeEnabled();
    // Widening one step re-enables narrowing (width 3 > minimum).
    await user.click(widenMin);
    expect(screen.getByRole("button", { name: "Increase min price" })).toBeEnabled();
  });

  // …and on the spacing-10 grid (0.05%), where the same boundary sits 10 ticks per spacing apart.
  it("[POO-900 R1/R5] disables only the narrowing steppers at the 2-spacing minimum (spacing 10)", () => {
    renderWithProviders(
      <BuildStep
        mandate={makeStableMandate({
          feeBps: 5,
          minPrice: String(tickToPrice(-10, 6, 6)),
          maxPrice: String(tickToPrice(10, 6, 6)),
        })}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Increase min price" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decrease max price" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decrease min price" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Increase max price" })).toBeEnabled();
  });

  // @rule POO-900 R6 - orientation parity: inverting the display flips side AND direction, so the
  // narrowing pair is still (displayed min +, displayed max −) and stays disabled at the minimum.
  it("[POO-900 R6] keeps the narrowing steppers disabled at the minimum when inverted", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <BuildStep
        mandate={makeStableMandate({
          minPrice: String(tickToPrice(-1, 6, 6)),
          maxPrice: String(tickToPrice(1, 6, 6)),
        })}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Invert price orientation" }));
    expect(screen.getByRole("button", { name: "Increase min price" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decrease max price" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decrease min price" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Increase max price" })).toBeEnabled();
  });

  it("shows info-only config for the non-pool nodes", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BuildStep mandate={makeMandate()} onBack={vi.fn()} onNext={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Deposit/ }));
    expect(screen.getByText(/Investors enter with USDC/)).toBeInTheDocument();
  });

  it("flips the displayed price orientation but keeps the range handed to Next canonical", async () => {
    const onNext = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<BuildStep mandate={makeMandate()} onBack={vi.fn()} onNext={onNext} />);

    // Canonical orientation by default — the pool node reads ETH/USDC.
    expect(screen.getByRole("button", { name: /ETH\/USDC/ })).toBeInTheDocument();

    // Flip orientation: the pair label inverts (its aria-label keeps the toggle out of the pair query).
    const invert = screen.getByRole("button", { name: "Invert price orientation" });
    expect(invert).toHaveAttribute("aria-pressed", "false");
    await user.click(invert);
    expect(invert).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /USDC\/ETH/ })).toBeInTheDocument();

    // Next still hands the CANONICAL range up (≈ the original 2745–3355), so the create-pool DTO is
    // unchanged by a view-only flip.
    await user.click(screen.getByRole("button", { name: "Next: Review" }));
    expect(onNext).toHaveBeenCalledTimes(1);
    const arg = onNext.mock.calls.at(0)?.[0];
    if (!arg) throw new Error("expected onNext to be called with the selection");
    expect(Number.parseFloat(arg.minPrice)).toBeCloseTo(2745, 0);
    expect(Number.parseFloat(arg.maxPrice)).toBeCloseTo(3355, 0);
    // …but the chosen orientation rides along (display-only) so Review can echo it back.
    expect(arg.displayInverted).toBe(true);
  });

  // @rule POO-525 R3 — the locked "Coming soon" 0.5% slippage input is gone from the pool config:
  // the Review step's settings gear is now the single slippage control for create-pool.
  it("[POO-525 R3] renders no slippage input in the pool config panel", () => {
    renderWithProviders(<BuildStep mandate={makeMandate()} onBack={vi.fn()} onNext={vi.fn()} />);
    expect(screen.queryByText("Max slippage")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("0.5%")).not.toBeInTheDocument();
  });

  // @rule R8 (POO-501 / decision Q6): the Build step's TokenSplitBar resolves the major-token logos
  // via resolveTokenLogo(symbol, network), so ETH/USDC render even on the mock pool (whose synthetic
  // addresses don't resolve via findToken). The composition legend carries the two committed logos.
  it("resolves major-token logos in the composition split (R8)", () => {
    const { container } = renderWithProviders(
      <BuildStep mandate={makeMandate()} onBack={vi.fn()} onNext={vi.fn()} />,
    );
    const srcs = Array.from(container.querySelectorAll("img")).map((n) => n.getAttribute("src"));
    expect(srcs).toContain("/tokens/eth.png");
    expect(srcs).toContain("/tokens/usdc.png");
  });
});
