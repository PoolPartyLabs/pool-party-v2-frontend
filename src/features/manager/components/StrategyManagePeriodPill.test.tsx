/**
 * @id PP-MGR-SCR-004 (POO-558)
 * @name StrategyManageView period-aware pill + no-history — tests
 * @implements-rules-version v1
 *
 * POO-558: the manage-detail AUM chart pill is period-aware (R3), tabs whose calendar window holds
 * <2 points are disabled (R4), a missing change renders no pill (R2), a missing series renders the
 * explicit no-history state (R1), and the live-TVL-vs-snapshot divergence is annotated (R5).
 */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChartPoint } from "@/components/data-display/PerformanceChart";
import { type ManagerStrategyDetail, managerStrategyDetailSchema } from "@/lib/schemas";
import { resetMockManagerState } from "@/lib/services";
import { managerStrategyDetails } from "@/mocks/data/manager";
import {
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../../tests/utils/renderWithProviders";
import { StrategyManageView } from "./StrategyManageView";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/ui/Toast", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/lib/tx/usePostWriteRefresh", () => ({ usePostWriteRefresh: () => vi.fn() }));

/** A dated ChartPoint series of `n` daily points ending 2026-06-30, value = base + i (up-trend). */
function datedPoints(n: number, base = 1000): ChartPoint[] {
  const start = Date.parse("2026-06-30") - (n - 1) * 86_400_000;
  return Array.from({ length: n }, (_, i) => ({
    value: base + i,
    label: `d${i}`,
    display: `$${base + i}`,
    date: new Date(start + i * 86_400_000).toISOString(),
  }));
}

/** Base fixture (active stable-yield) cloned, then overridden for the case under test. */
function detailWith(over: Partial<ManagerStrategyDetail>): ManagerStrategyDetail {
  const base = managerStrategyDetails.find((d) => d.id === "stable-yield");
  if (!base) throw new Error("missing stable-yield fixture");
  return { ...structuredClone(base), ...over };
}

function Harness({ initial }: { initial: ManagerStrategyDetail }) {
  const [detail, setDetail] = useState(initial);
  return <StrategyManageView detail={detail} onBack={vi.fn()} onDetailChange={setDetail} />;
}

beforeEach(() => resetMockManagerState());
afterEach(() => vi.clearAllMocks());

describe("StrategyManageView period-aware pill (POO-558)", () => {
  // @rule R3: switching the tab recomputes the pill from THAT period's calendar window, so 7D and
  // 90D read different signed percentages instead of a single hardcoded 30d figure.
  it("[R3] the pill changes with the selected period tab", async () => {
    const user = userEvent.setup();
    // 91 dated points 1000..1090 (up-trend): the 7d window rises less than the 90d window.
    const all = datedPoints(91, 1000);
    const detail = detailWith({
      aum: 1090,
      aumChangePct: undefined,
      performance: { "7d": all.slice(-8), "30d": all.slice(-31), "90d": all, all },
    });
    expect(managerStrategyDetailSchema.safeParse(detail).success).toBe(true);
    renderWithProviders(<Harness initial={detail} />);

    // Default 30D pill: (1090-1060)/1060.
    const pill30 = screen.getByTestId("aum-change-pill");
    const text30 = pill30.textContent ?? "";

    await user.click(screen.getByRole("tab", { name: "7D" }));
    const text7 = screen.getByTestId("aum-change-pill").textContent ?? "";
    // 7D window (last 8 points, 1083..1090) rises a smaller % than the 30d window.
    expect(text7).not.toEqual(text30);
    // The pill names the SELECTED window, not a fixed "30d".
    expect(text7).toMatch(/7d/i);

    await user.click(screen.getByRole("tab", { name: "90D" }));
    const text90 = screen.getByTestId("aum-change-pill").textContent ?? "";
    expect(text90).toMatch(/90d/i);
    expect(text90).not.toEqual(text7);
  });

  // @rule R4: a period whose calendar window holds <2 points is disabled (not silently plotting the
  // full history). A 5-day dated fixture disables 30D/90D; 7D and All stay live.
  it("[R4] a tab whose window holds <2 points is disabled", () => {
    const all = datedPoints(5, 1000);
    const detail = detailWith({
      aumChangePct: undefined,
      performance: { "7d": all, "30d": all, "90d": all, all },
    });
    renderWithProviders(<Harness initial={detail} />);
    expect(screen.getByRole("tab", { name: "90D" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "30D" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "7D" })).toBeEnabled();
    expect(screen.getByRole("tab", { name: "All" })).toBeEnabled();
  });

  // @rule R2: an undefined change renders NO pill node (no coerced +0.0%).
  it("[R2] renders no pill when aumChangePct is undefined and the period change is undefined", () => {
    // Date-less flat mock all-series so the period change resolves to 0 would be wrong: use a
    // <2-point (empty-ish) series so there is no computable change and no pill.
    const detail = detailWith({ aumChangePct: undefined, performance: undefined });
    renderWithProviders(<Harness initial={detail} />);
    expect(screen.queryByTestId("aum-change-pill")).toBeNull();
    // No stray "+0.0%" text.
    expect(screen.queryByText(/\+?0\.0%/)).toBeNull();
  });

  // @rule R1: a real detail with no performance series renders the explicit no-history state instead
  // of a chart or a fabricated flat line.
  it("[R1] renders the explicit no-history state when there is no series", () => {
    const detail = detailWith({ performance: undefined, aumChangePct: undefined });
    renderWithProviders(<Harness initial={detail} />);
    expect(screen.getByText(/No history yet/i)).toBeInTheDocument();
    // No chart tablist / period tabs when there is nothing to plot.
    expect(screen.queryByRole("tab", { name: "30D" })).toBeNull();
  });

  // @rule R5: the headline AUM (live pp_api TVL) and the series' last snapshot value can diverge;
  // when they do, the view annotates it so the manager isn't confused by the mismatch.
  it("[R5] annotates the live-TVL vs snapshot divergence", () => {
    const all = datedPoints(30, 1000); // last snapshot value = 1029
    const detail = detailWith({
      aum: 2000, // live TVL well above the last daily snapshot → divergence
      aumChangePct: undefined,
      performance: { "7d": all.slice(-8), "30d": all, "90d": all, all },
    });
    renderWithProviders(<Harness initial={detail} />);
    expect(screen.getByTestId("aum-snapshot-note")).toBeInTheDocument();
  });

  // @rule R5: when the live TVL matches the last snapshot (no divergence), no note is shown.
  it("[R5] shows no divergence note when live TVL matches the last snapshot", () => {
    const all = datedPoints(30, 1000); // last value = 1029
    const detail = detailWith({
      aum: 1029,
      aumChangePct: undefined,
      performance: { "7d": all.slice(-8), "30d": all, "90d": all, all },
    });
    renderWithProviders(<Harness initial={detail} />);
    expect(screen.queryByTestId("aum-snapshot-note")).toBeNull();
  });

  // @rule R3 (mock parity): a date-less mock series keeps a pill with the whole-series change and
  // every tab live (the mock fixtures never regress to no-history).
  it("[R3/R4 mock] keeps a pill and live tabs on a date-less mock series", () => {
    const detail = detailWith({ aumChangePct: 5.1 });
    renderWithProviders(<Harness initial={detail} />);
    const pill = screen.getByTestId("aum-change-pill");
    expect(within(pill).getByText(/30d/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "90D" })).toBeEnabled();
  });
});
