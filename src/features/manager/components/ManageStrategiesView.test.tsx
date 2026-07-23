/**
 * @id PP-MGR-SCR-003
 * @name ManageStrategiesView.test
 * Behavior (POO-180): all strategies render as cards with KPIs + status chips; the status pills
 * filter the list (with a per-filter empty state); the out-of-range strategy carries the
 * "Rebalance suggested" flag; Manage bubbles the strategy id; the overflow menu is disabled.
 *
 * POO-669 [R1/R2/R3] + POO-752 [R1]: the list is a client-side "Load more" reveal over the
 * client-filtered subset — first 6, +6 per click (POO-752: a 6-card page fills the 2-up grid) — and a
 * status-filter change RESETS the reveal to the first page (POO-626). POO-752 [R2] adds a metric sort
 * (default AUM desc, resets per visit) that reorders the filtered subset BEFORE the reveal and PRESERVES
 * the revealed count (a same-subset reorder never resets the reveal).
 */
import { describe, expect, it, vi } from "vitest";
import type { ManagerStrategy } from "@/lib/schemas";
import { managerStrategies } from "@/mocks/data/manager";
import {
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../../tests/utils/renderWithProviders";
import { ManageStrategiesView } from "./ManageStrategiesView";

// A large, single-status book so the reveal has more than one page to walk. Derived from a mock row
// so every field is schema-valid; only id/name vary.
const seed = managerStrategies[0] as ManagerStrategy;
function makeActive(n: number): ManagerStrategy[] {
  return Array.from({ length: n }, (_, i) => ({
    ...seed,
    id: `active-${i}`,
    name: `Active ${i}`,
    status: "active" as const,
  }));
}
function makeMixed(nActive: number, nPaused: number): ManagerStrategy[] {
  const active = makeActive(nActive);
  const paused = Array.from({ length: nPaused }, (_, i) => ({
    ...seed,
    id: `paused-${i}`,
    name: `Paused ${i}`,
    status: "paused" as const,
  }));
  return [...active, ...paused];
}
// Active strategies with distinct AUM (name encodes the AUM) so a sort produces a visible order.
function makeByAum(aums: number[]): ManagerStrategy[] {
  return aums.map((aum) => ({
    ...seed,
    id: `aum-${aum}`,
    name: `Aum ${aum}`,
    status: "active" as const,
    aum,
  }));
}
/** The card headings (h3) in DOM order — i.e. the revealed order. */
function cardOrder(): (string | null)[] {
  return screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
}

describe("ManageStrategiesView", () => {
  it("renders every strategy with its KPIs and status chip under the All filter", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ManageStrategiesView strategies={managerStrategies} onManage={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Managed strategies" })).toBeInTheDocument();
    // POO-752 [R1]: the 6-row mock book fits in one 6-card page under All — no "Load more" needed.
    await user.click(screen.getByRole("button", { name: "All" }));
    for (const name of [
      "Stable Yield",
      "Yield Plus",
      "Momentum",
      "ETH Range",
      "BTC Weekender",
      "Stable Plus",
    ]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    // KPI labels render once per revealed card. Scope to the list so the "Sort by" dropdown trigger
    // (which also shows the selected metric label, e.g. "AUM") is not counted.
    const list = screen.getByRole("list", { name: "Managed strategies" });
    expect(within(list).getAllByText("AUM")).toHaveLength(managerStrategies.length);
    expect(within(list).getAllByText("Fees · 30d")).toHaveLength(managerStrategies.length);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  // @rule POO-508 R1: with at least one active strategy the list opens filtered on Active.
  it("opens on the Active filter when the manager has active strategies", () => {
    renderWithProviders(<ManageStrategiesView strategies={managerStrategies} onManage={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Active", pressed: true })).toBeInTheDocument();
    // A paused strategy is not on the default view.
    expect(screen.queryByRole("heading", { name: "ETH Range" })).toBeNull();
  });

  // @rule POO-508 R2: with zero active strategies the default falls back to All (never an empty
  // list while closed/paused strategies exist).
  it("falls back to the All filter when there are no active strategies", () => {
    const noActive = managerStrategies.filter((strategy) => strategy.status !== "active");
    renderWithProviders(<ManageStrategiesView strategies={noActive} onManage={vi.fn()} />);
    expect(screen.getByRole("button", { name: "All", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ETH Range" })).toBeInTheDocument();
  });

  it("flags only the out-of-range active strategy with 'Rebalance suggested' (R5)", () => {
    renderWithProviders(<ManageStrategiesView strategies={managerStrategies} onManage={vi.fn()} />);
    expect(screen.getAllByText("Rebalance suggested")).toHaveLength(1);
  });

  it("reveals the manager's AUM by default and hides it via the eye (POO-322 / 2026-06-30)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ManageStrategiesView strategies={managerStrategies} onManage={vi.fn()} />);
    // Values are REVEALED by default now (eye open); 30d fees (earnings) and the APY % also visible.
    expect(screen.queryByText("••••")).toBeNull();
    // The eye hides the AUM — one masked cell per revealed card. Under All the 6-row book fits one
    // 6-card page (POO-752 [R1]), so hide directly: one masked cell per strategy.
    await user.click(screen.getByRole("button", { name: "All" }));
    await user.click(screen.getByRole("button", { name: "Hide values" }));
    expect(screen.getAllByText("••••").length).toBe(managerStrategies.length);
  });

  it("filters by status from the pills (R3)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ManageStrategiesView strategies={managerStrategies} onManage={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Paused", pressed: false }));
    expect(screen.getByRole("heading", { name: "ETH Range" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Stable Yield" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Drafts" }));
    expect(screen.getByRole("heading", { name: "Stable Plus" })).toBeInTheDocument();
  });

  it("shows a per-filter empty state when nothing matches (R4)", async () => {
    const user = userEvent.setup();
    const onlyActive = managerStrategies.filter((strategy) => strategy.status === "active");
    renderWithProviders(<ManageStrategiesView strategies={onlyActive} onManage={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Closed" }));
    expect(screen.getByText("No closed strategies.")).toBeInTheDocument();
  });

  it("bubbles the strategy id from Manage", async () => {
    const user = userEvent.setup();
    const onManage = vi.fn();
    renderWithProviders(
      <ManageStrategiesView strategies={managerStrategies} onManage={onManage} />,
    );
    await user.click(screen.getAllByRole("button", { name: "Manage" })[0] as HTMLElement);
    // Default sort is AUM desc, so the first card is the highest-AUM active strategy.
    expect(onManage).toHaveBeenCalledTimes(1);
    expect(typeof onManage.mock.calls[0]?.[0]).toBe("string");
  });

  // POO-669 [R1] + POO-752 [R1] client-side reveal (6 per page) on the Manage list.
  describe("Load more reveal (POO-669 [R1] / POO-752 [R1])", () => {
    // @rule R1 — the filtered subset renders its first 6 rows, with a "Load more" that reveals +6.
    it("shows the first 6 rows with a Load more button, and reveals +6 per click", async () => {
      const user = userEvent.setup();
      // 12 active → opens on Active → first page of 6, Load more present.
      renderWithProviders(<ManageStrategiesView strategies={makeActive(12)} onManage={vi.fn()} />);
      expect(screen.getAllByRole("listitem")).toHaveLength(6);
      // One reveal exhausts the 12 rows (6 + 6), and Load more disappears.
      await user.click(screen.getByRole("button", { name: "Load more" }));
      expect(screen.getAllByRole("listitem")).toHaveLength(12);
      expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    });

    // @rule R1 — a short subset (< one page) shows every row and NO Load more.
    it("shows no Load more when the filtered subset fits in one page", () => {
      renderWithProviders(<ManageStrategiesView strategies={makeActive(4)} onManage={vi.fn()} />);
      expect(screen.getAllByRole("listitem")).toHaveLength(4);
      expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    });

    it("shows no Load more at exactly one page (6 rows)", () => {
      renderWithProviders(<ManageStrategiesView strategies={makeActive(6)} onManage={vi.fn()} />);
      expect(screen.getAllByRole("listitem")).toHaveLength(6);
      expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    });

    // @rule R2 — the reveal counts the CLIENT-filtered subset, and a status-filter change RESETS the
    // reveal back to the first page (POO-626 reset-on-filter): a manager deep into the Active list who
    // switches to Paused sees the first 6 paused rows, never a carried-over larger window.
    it("resets the reveal to 6 when the status filter changes (R2)", async () => {
      const user = userEvent.setup();
      // 12 active + 9 paused. Opens on Active.
      renderWithProviders(
        <ManageStrategiesView strategies={makeMixed(12, 9)} onManage={vi.fn()} />,
      );
      // Reveal the whole Active list (6 + 6 = 12).
      await user.click(screen.getByRole("button", { name: "Load more" }));
      expect(screen.getAllByRole("listitem")).toHaveLength(12);
      // Switch to Paused: a genuinely different subset → reveal RESETS to the first 6.
      await user.click(screen.getByRole("button", { name: "Paused", pressed: false }));
      const paused = screen.getAllByRole("listitem");
      expect(paused).toHaveLength(6);
      // ...and the first rows are paused rows (the head of the new subset), not carried Active rows.
      expect(screen.getByRole("heading", { name: "Paused 0" })).toBeInTheDocument();
      // Load more is present again for the 9-row paused subset.
      expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
    });

    // @rule DO-NOT-RESET — a same-set re-render (a 45s/focus/router.refresh refetch that yields the
    // same subset) under a STABLE filter keeps the revealed count (POO-628). Re-rendering with a NEW
    // array of the same content must not snap the reveal back.
    it("preserves the revealed count on a same-set refetch (DO-NOT-RESET, POO-628)", async () => {
      const user = userEvent.setup();
      const { rerender } = renderWithProviders(
        <ManageStrategiesView strategies={makeActive(12)} onManage={vi.fn()} />,
      );
      await user.click(screen.getByRole("button", { name: "Load more" }));
      expect(screen.getAllByRole("listitem")).toHaveLength(12);
      // A refetch: a brand-new array instance, same 12 active rows, same (Active) filter.
      rerender(<ManageStrategiesView strategies={makeActive(12)} onManage={vi.fn()} />);
      expect(screen.getAllByRole("listitem")).toHaveLength(12);
    });
  });

  // POO-752 [R2]: metric sort over the filtered subset.
  describe("metric sort (POO-752 [R2])", () => {
    it("orders by AUM descending by default", () => {
      renderWithProviders(
        <ManageStrategiesView strategies={makeByAum([100, 300, 200])} onManage={vi.fn()} />,
      );
      expect(cardOrder()).toEqual(["Aum 300", "Aum 200", "Aum 100"]);
    });

    it("flips to ascending via the direction toggle", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <ManageStrategiesView strategies={makeByAum([100, 300, 200])} onManage={vi.fn()} />,
      );
      // The toggle's accessible name carries the sort context + current direction (desc by default).
      await user.click(screen.getByRole("button", { name: "Sort by: Descending" }));
      expect(cardOrder()).toEqual(["Aum 100", "Aum 200", "Aum 300"]);
    });

    it("preserves the revealed count when the sort changes (does not reset the reveal)", async () => {
      const user = userEvent.setup();
      // 12 active (page 6) → reveal all 12, then reorder: the same subset must keep the reveal.
      renderWithProviders(<ManageStrategiesView strategies={makeActive(12)} onManage={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: "Load more" }));
      expect(screen.getAllByRole("listitem")).toHaveLength(12);
      await user.click(screen.getByRole("button", { name: "Sort by: Descending" }));
      // The reveal survives the reorder (sort is not part of the reset key)...
      expect(screen.getAllByRole("listitem")).toHaveLength(12);
      // ...and the sort state actually flipped (proving the toggle isn't inert).
      expect(screen.getByRole("button", { name: "Sort by: Ascending" })).toBeInTheDocument();
    });
  });
});
