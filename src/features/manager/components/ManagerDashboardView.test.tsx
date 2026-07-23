/**
 * @id PP-MGR-SCR-001 · PP-CORE-LIB-049 (POO-991)
 * @name ManagerDashboardView.test
 * Behavior: renders the AUM hero, KPI tiles, and only the ACTIVE strategy rows (POO-553; paused/
 * closed/draft are filtered out); the "Create new strategy" CTA routes to the builder; strategy
 * names open the manage detail and the Strategies tab switches the console view.
 *
 * POO-669 [R1/R3]: the "Your strategies" list (both the mobile cards and the desktop table) is a
 * client-side "Load more" reveal (first 5, +5 per click) over the active-strategy list. This replaces
 * the POO-627 windowing on this list (R3): the VirtualCardList/VirtualTableBody wiring and its gate/
 * threshold/layout-shim tests are gone here; the shared primitives + their own tests stay intact.
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManagerStrategy } from "@/lib/schemas";
import { formatUsd } from "@/lib/utils/format";
import { DEV_MANAGER_ADDRESS, managerDashboard, managerStrategies } from "@/mocks/data/manager";
import {
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
  within,
} from "../../../../tests/utils/renderWithProviders";
import { ManagerDashboardView } from "./ManagerDashboardView";

// POO-553: the Overview lists ACTIVE strategies only. The fixture has 3 active (Stable Yield / Yield
// Plus / Momentum) and 3 non-active (paused / closed / draft). 3 <= one reveal page (5), so the
// default fixture shows every active row with no "Load more".
const activeCount = managerStrategies.filter((strategy) => strategy.status === "active").length;

// POO-669: a large ACTIVE-strategy book so the reveal has more than one page to walk. Derived from
// the first mock active strategy so every field is schema-valid; only id/name/initials vary per row.
const seedActive = managerStrategies.find((s) => s.status === "active") as ManagerStrategy;
function makeManyActive(n: number): ManagerStrategy[] {
  return Array.from({ length: n }, (_, i) => ({
    ...seedActive,
    id: `virt-strategy-${i}`,
    name: `Virt Strategy ${i}`,
    initials: `V${i % 10}`,
    status: "active" as const,
  }));
}

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// Pin the greeting to "morning" so the time-of-day bucket is deterministic in CI (the real
// hour-to-bucket mapping is covered by timeOfDay.test.ts).
vi.mock("@/lib/utils/timeOfDay", () => ({ timeOfDay: () => "morning" }));
// POO-655 / POO-659: the "Share your strategies" invite link prefers the manager's own identity
// (handle, else dashboard.address), and only falls back to the CONNECTED wallet when the dashboard
// carries neither. Mock the wallet so that last-resort fallback is deterministic.
const authAddress = vi.hoisted(() => "0x3655C34c9A1BA3Ab523EC72f6C39549F6fCA3F77");
vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({ address: authAddress, isLoading: false }),
}));

// POO-901 [R1]: the invite link is referral-aware (useReferral is module-cached shared state; the
// mock program starts code-less). Pin the code per test so the surface is deterministic.
const referral = vi.hoisted(() => ({ code: null as string | null }));
vi.mock("@/features/rewards/useReferral", () => ({
  useReferral: () => ({ program: { code: referral.code }, createCode: vi.fn() }),
}));

afterEach(() => {
  push.mockClear();
  referral.code = null;
});

function renderView(dashboard = managerDashboard, strategies = managerStrategies) {
  const onManageStrategy = vi.fn();
  renderWithProviders(
    <ManagerDashboardView
      dashboard={dashboard}
      strategies={strategies}
      onManageStrategy={onManageStrategy}
    />,
  );
  return { onManageStrategy };
}

describe("ManagerDashboardView", () => {
  it("shows the AUM change pill with an explicit 30d affix (POO-555 R3)", () => {
    renderView();
    expect(screen.getByText("4.2% · 30d")).toBeInTheDocument();
  });

  it("hides the AUM change pill when there is no plottable series (POO-555 R2)", () => {
    renderView({ ...managerDashboard, chart: [] });
    expect(screen.queryByText("4.2% · 30d")).not.toBeInTheDocument();
  });

  // POO-736 R1: the AUM hero carries the snapshot-divergence note (headline = live pool value; chart =
  // daily snapshot) whenever there is a plottable series, mirroring the manage detail.
  const snapshotNote =
    "Shown AUM is the live pool value; the chart tracks the daily snapshot, so the two can differ slightly.";
  it("[POO-736 R1] shows the AUM snapshot-divergence note when a chart series exists", () => {
    renderView();
    expect(screen.getByText(snapshotNote)).toBeInTheDocument();
  });

  it("[POO-736 R1] hides the snapshot note when there is no plottable series", () => {
    renderView({ ...managerDashboard, chart: [] });
    expect(screen.queryByText(snapshotNote)).toBeNull();
  });

  // POO-650: the Entry/Exit fee rows (both $0.00 today) are hidden until the official referral
  // program (POO-651); the Performance fees row + the all-time total stay.
  it("[POO-650] hides the Entry/Exit fee rows and keeps Performance fees", () => {
    renderView();
    expect(screen.getByText("Performance fees")).toBeInTheDocument();
    expect(screen.queryByText("Entry fees")).toBeNull();
    expect(screen.queryByText("Exit fees")).toBeNull();
  });

  it("shares the invite link via the clipboard fallback when native share is unavailable (POO-342)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    // Force the copy fallback by removing the native share API.
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    renderView();
    // POO-742 R2: the CTA label is now "Share profile link" (was "Share invite link").
    fireEvent.click(screen.getByRole("button", { name: "Share profile link" }));
    // POO-659: the seeded manager has no handle but carries dashboard.address, so the invite link
    // resolves to /m/<dashboard.address> (the authoritative manager identity), NOT the connected wallet.
    expect(writeText).toHaveBeenCalledWith(`https://app.pool-party.xyz/m/${DEV_MANAGER_ADDRESS}`);
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
  });

  // POO-742 R2: the button label on THIS card reads "Share profile link" (scoped key
  // manager.dashboard.share.cta), not "Share invite link". manager.profile.share is unchanged.
  it("[POO-742 R2] the share CTA reads 'Share profile link'", () => {
    renderView();
    expect(screen.getByRole("button", { name: "Share profile link" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share invite link" })).toBeNull();
  });

  // POO-655 / POO-659: when the manager HAS claimed a handle, the invite link uses it (over the
  // dashboard address and the connected wallet).
  it("[POO-655] the invite link uses the handle when the manager has one", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    renderView({ ...managerDashboard, handle: "delta-desk" });
    fireEvent.click(screen.getByRole("button", { name: "Share profile link" }));
    expect(writeText).toHaveBeenCalledWith("https://app.pool-party.xyz/m/delta-desk");
  });

  // POO-659: for the unfilled, neutralized dev manager (empty handle, dashboard.address set) the invite
  // link resolves to /m/<dashboard.address> — the authoritative manager identity — in mock AND real
  // mode, never a broken /m/ and never the connected wallet while a dashboard address exists.
  it("[POO-659] the invite link uses the dashboard address when the handle is empty", () => {
    renderView({ ...managerDashboard, handle: "", address: DEV_MANAGER_ADDRESS });
    // POO-901 [R4]: the copy field displays the FULL absolute URL (what it copies).
    expect(
      screen.getByText(`https://app.pool-party.xyz/m/${DEV_MANAGER_ADDRESS}`),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(`https://app.pool-party.xyz/m/${authAddress}`),
    ).not.toBeInTheDocument();
  });

  // POO-655 / POO-659: with NEITHER a handle NOR a dashboard address, the invite link falls back to the
  // connected wallet (identity=address), never a broken `app.pool-party.xyz/m/`.
  it("[POO-655] falls back to the connected wallet address when handle and dashboard address are absent", () => {
    renderView({ ...managerDashboard, handle: "", address: undefined });
    expect(screen.getByText(`https://app.pool-party.xyz/m/${authAddress}`)).toBeInTheDocument();
  });

  // POO-901 [R1]: once the manager has created a referral code, the displayed + copied + shared
  // invite URL is the profile URL with ?ref=<code> appended (the SAME resolved URL everywhere [R5]).
  it("[POO-901 R1] appends ?ref=<code> to the displayed + shared invite link when a code exists", async () => {
    referral.code = "MARIA2026";
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    renderView({ ...managerDashboard, handle: "delta-desk" });
    expect(
      screen.getByText("https://app.pool-party.xyz/m/delta-desk?ref=MARIA2026"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Share profile link" }));
    expect(writeText).toHaveBeenCalledWith("https://app.pool-party.xyz/m/delta-desk?ref=MARIA2026");
  });

  // POO-901 [R1]: no code (or the program still loading) → the plain URL; the surface upgrades IN
  // PLACE when the shared referral state resolves with a code (same mounted view, no navigation).
  it("[POO-901 R1] keeps the plain URL without a code and upgrades in place when it resolves", () => {
    const onManageStrategy = vi.fn();
    const dashboard = { ...managerDashboard, handle: "delta-desk" };
    const view = renderWithProviders(
      <ManagerDashboardView
        dashboard={dashboard}
        strategies={managerStrategies}
        onManageStrategy={onManageStrategy}
      />,
    );
    expect(screen.getByText("https://app.pool-party.xyz/m/delta-desk")).toBeInTheDocument();
    referral.code = "MARIA2026";
    view.rerender(
      <ManagerDashboardView
        dashboard={dashboard}
        strategies={managerStrategies}
        onManageStrategy={onManageStrategy}
      />,
    );
    expect(
      screen.getByText("https://app.pool-party.xyz/m/delta-desk?ref=MARIA2026"),
    ).toBeInTheDocument();
    expect(screen.queryByText("https://app.pool-party.xyz/m/delta-desk")).toBeNull();
  });

  // POO-901 [R4]: the link is a copy FIELD (ReferralField pattern): a copy button that writes the
  // full current URL (?ref= included), flips to a copied confirmation, keeps emitting
  // reward_referral_shared ([R5]), and coexists with the untouched ShareInviteButton.
  it("[POO-901 R4] the invite-link field copies the full current URL and confirms", async () => {
    referral.code = "MARIA2026";
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    window.dataLayer = [];
    renderView({ ...managerDashboard, handle: "delta-desk" });
    fireEvent.click(screen.getByRole("button", { name: "Copy invite link" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "https://app.pool-party.xyz/m/delta-desk?ref=MARIA2026",
      ),
    );
    // The copied confirmation state (the button's accessible name flips).
    expect(await screen.findByRole("button", { name: "Link copied" })).toBeInTheDocument();
    // [R5] the rewards copy affordance keeps emitting reward_referral_shared.
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "reward_referral_shared" }),
    );
    // [R4] the existing ShareInviteButton stays alongside the field.
    expect(screen.getByRole("button", { name: "Share profile link" })).toBeInTheDocument();
  });

  it("renders the AUM hero, KPIs, and only the ACTIVE strategy rows (POO-553)", async () => {
    const user = userEvent.setup();
    renderView();
    // Manager values are REVEALED by default now (eye open, murilo 2026-06-30); the eye hides them.
    expect(screen.getByText("$392,480.00")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide values" }));
    expect(screen.queryByText("$392,480.00")).toBeNull();
    expect(screen.getByText("Yield generated")).toBeInTheDocument();
    expect(screen.getByText("Avg APR")).toBeInTheDocument();
    // POO-553: only ACTIVE strategies render (both layouts); paused/closed/draft rows are filtered out.
    for (const name of ["Stable Yield", "Yield Plus", "Momentum"]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
    for (const name of ["ETH Range", "BTC Weekender", "Stable Plus"]) {
      expect(screen.queryByText(name)).toBeNull();
    }
    // With no non-active rows, their status chips are gone too.
    expect(screen.queryByText("Paused")).toBeNull();
    expect(screen.queryByText("Closed")).toBeNull();
    expect(screen.queryByText("Draft")).toBeNull();
  });

  // The greeting + create CTA + tabs moved to the shared ConsoleShell (POO-451); that chrome is
  // covered at the console level in ManagerScreens.test.
  it("opens the manage detail from a strategy name", async () => {
    const user = userEvent.setup();
    const { onManageStrategy } = renderView();
    await user.click(screen.getAllByRole("button", { name: "Stable Yield" })[0] as HTMLElement);
    expect(onManageStrategy).toHaveBeenCalledWith("stable-yield");
  });

  // POO-486: every row carries an explicit Manage button (mobile cards + desktop table) that opens
  // the same manage detail as the name.
  it("opens the manage detail from a per-row Manage button", async () => {
    const user = userEvent.setup();
    const { onManageStrategy } = renderView();
    const manageButtons = screen.getAllByRole("button", { name: "Manage" });
    // Both breakpoints render in jsdom, so there is one per row per layout: the mobile cards come
    // first in DOM order (one per strategy), then the desktop table rows (one per strategy). Below
    // THRESHOLD both layouts render the plain `.map()` baseline (POO-627 [R1]/ADR-0001 rule 4), so
    // this hard count is byte-identical to before the virtualization wiring.
    expect(manageButtons).toHaveLength(activeCount * 2);
    // The first in DOM order is the first strategy's (Stable Yield) mobile card.
    await user.click(manageButtons[0] as HTMLElement);
    expect(onManageStrategy).toHaveBeenCalledWith("stable-yield");

    // @rule R1 — the DESKTOP table row's Manage button fires the same handler with the same id.
    // Scope to the table so this is unambiguous regardless of the mobile-vs-desktop DOM order.
    const table = screen.getByRole("table");
    const desktopManageButtons = within(table).getAllByRole("button", {
      name: "Manage",
    });
    expect(desktopManageButtons).toHaveLength(activeCount);
    onManageStrategy.mockClear();
    await user.click(desktopManageButtons[0] as HTMLElement);
    expect(onManageStrategy).toHaveBeenCalledWith("stable-yield");
    // Cross-check the flat DOM-order index for the first desktop button matches the table-scoped one.
    // The mobile cards precede the desktop table in mobile-first source order, so the first table
    // button sits at flat index `activeCount`. Scoped `within(table)` above so this stays correct
    // even now that BOTH layouts consume the shared primitive (POO-627; the mandate's re-scope).
    expect(manageButtons[activeCount]).toBe(desktopManageButtons[0]);
  });

  // @rule R2 — the honest mock keeps a weekly-active delta (4.2), so the delta line renders.
  it("[POO-560 R2] renders the weekly-active delta when activeWoWPct is a number (mock)", () => {
    renderView();
    expect(screen.getByText("▲ +4.2% vs last week")).toBeInTheDocument();
  });

  // @rule R1 — real mode has no weekly-active source, so activeWoWPct is null and no delta renders.
  it("[POO-560 R1] renders no weekly-active delta when activeWoWPct is null (real)", () => {
    renderView({ ...managerDashboard, activeWoWPct: null });
    expect(screen.queryByText(/vs last week/)).toBeNull();
    // No fabricated positive "+0%" tone either.
    expect(screen.queryByText(/▲ \+0%/)).toBeNull();
  });

  // [POO-743 rules-v2] The investor KPIs are split into two truthful tiles: "Active investors" (the
  // on-chain current count) and "Total investors" (the monotonic all-time count). Supersedes the
  // POO-560 R3 single mislabeled tile; never "Active today", never the old "Total investors (all time)".
  it("[POO-743] labels the two investor tiles truthfully (Active investors + Total investors)", () => {
    renderView({ ...managerDashboard, activeWoWPct: null });
    expect(screen.getByText("Active investors")).toBeInTheDocument();
    expect(screen.getByText("Total investors")).toBeInTheDocument();
    expect(screen.queryByText("Active today")).toBeNull();
    expect(screen.queryByText("Total investors (all time)")).toBeNull();
  });

  // PP-CORE-LIB-049 (POO-991) [R3]: net inflows + earnings (total + performance) have no on-chain Σ,
  // so a null value renders the honest "Not available yet" affordance, never a fabricated $0.00; a
  // non-null value renders the formatted USD.
  describe("[POO-991 R3] honest-null net inflows + earnings", () => {
    it("renders 'Not available yet' for a null net-inflows figure, never $0.00 net inflows", () => {
      renderView({ ...managerDashboard, netInflows30d: null });
      expect(screen.getByText("Not available yet")).toBeInTheDocument();
      // No fabricated "$0.00 net inflows · 30d" caption.
      expect(screen.queryByText(/net inflows/)).toBeNull();
    });

    it("renders the formatted signed USD when net inflows is a number", () => {
      renderView({ ...managerDashboard, netInflows30d: 8200 });
      // The mock fixture's net inflows is 8200 → "+$8,200.00 net inflows · 30d".
      expect(screen.getByText(/net inflows/)).toBeInTheDocument();
    });

    it("renders 'Not available yet' for null earnings (total + performance), never $0.00", () => {
      renderView({
        ...managerDashboard,
        earnings: { totalUsd: null, performanceUsd: null, entryUsd: 0, exitUsd: 0 },
      });
      // Both the big total and the performance row read the unavailable copy (2 instances).
      expect(screen.getAllByText("Not available yet")).toHaveLength(2);
    });

    it("renders the formatted earnings USD when the values are numbers", () => {
      renderView({
        ...managerDashboard,
        earnings: { totalUsd: 700, performanceUsd: 700, entryUsd: 0, exitUsd: 0 },
      });
      // The total + the performance row both format 700 → "$700.00".
      expect(screen.getAllByText("$700.00")).toHaveLength(2);
      expect(screen.queryByText("Not available yet")).toBeNull();
    });
  });

  // POO-669 [R1]: the mobile card `<ul>` keeps its `flex flex-col gap-2` inter-card spacing (the
  // reveal renders a plain sliced `.map()` over this <ul>). jsdom can't measure the 8px gap, so pin
  // the class contract.
  it("[R1] keeps the mobile card gap (flex flex-col gap-2)", () => {
    renderView();
    // The mobile list is the <ul> labelled with the "Your strategies" section name.
    const mobileList = screen.getByRole("list", { name: "Your strategies" });
    expect(mobileList).toHaveClass("flex", "flex-col", "gap-2");
  });

  it("uses a fixed table layout so masking the values never reflows the columns", async () => {
    const user = userEvent.setup();
    renderView();
    expect(screen.getByRole("table")).toHaveClass("table-fixed");
    // The eye masks ONLY the $ balances (AUM). They're REVEALED by default now (eye open); clicking
    // the eye covers them. Percentages, counts and earnings stay visible (POO-322).
    expect(screen.queryByText("••••")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Hide values" }));
    expect(screen.getAllByText("••••").length).toBeGreaterThan(0);
  });

  // POO-669 [R1/R3]: the "Your strategies" list is a client-side reveal (first 5, +5 per click) that
  // REPLACES the POO-627 windowing on this list. The reveal is shared across BOTH layouts (mobile
  // cards + desktop table) by one count, so "Load more" grows both together; the KPI aggregates read
  // `dashboard.*`, decoupled from the row list, so the reveal never touches the tiles.
  describe("Load more reveal (POO-669 [R1])", () => {
    // The small default fixture (3 active) fits in one page: every active row shows, no Load more.
    it("shows every active row with no Load more when the active list fits one page", () => {
      renderView();
      // 3 active rows per layout (mobile cards + desktop table) — no reveal button.
      expect(screen.getAllByRole("listitem")).toHaveLength(activeCount);
      expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    });

    // @rule R1 — a large active book renders the first 5 in BOTH layouts with a Load more; each click
    // reveals +5 in both. The mobile <ul> is the listitem source; the desktop table Manage buttons
    // count the desktop rows, so both layouts grow together off the one shared reveal count.
    it("reveals the first 5 in both layouts and grows +5 per Load more click", async () => {
      const user = userEvent.setup();
      renderView(managerDashboard, makeManyActive(12));
      const table = screen.getByRole("table");
      // First page: 5 mobile cards + 5 desktop rows.
      expect(screen.getAllByRole("listitem")).toHaveLength(5);
      expect(within(table).getAllByRole("button", { name: "Manage" })).toHaveLength(5);
      // One reveal: +5 in both layouts.
      await user.click(screen.getByRole("button", { name: "Load more" }));
      expect(screen.getAllByRole("listitem")).toHaveLength(10);
      expect(within(table).getAllByRole("button", { name: "Manage" })).toHaveLength(10);
      // Second reveal exhausts the 12 rows (10 + 5 clamps to 12) and Load more disappears.
      await user.click(screen.getByRole("button", { name: "Load more" }));
      expect(screen.getAllByRole("listitem")).toHaveLength(12);
      expect(within(table).getAllByRole("button", { name: "Manage" })).toHaveLength(12);
      expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
      // The head and (once fully revealed) tail rows are both present — nothing dropped.
      expect(screen.getAllByText("Virt Strategy 0").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Virt Strategy 11").length).toBeGreaterThan(0);
    });

    // @rule R1 — the KPI tiles + AUM hero read `dashboard.*`, decoupled from the revealed row slice:
    // with a 600-row active book only the first 5 rows render, but the aggregates stay full-book.
    it("keeps the AUM hero + KPI aggregates at the full-book values regardless of the revealed slice", () => {
      renderView(managerDashboard, makeManyActive(600));
      // Only the first page of the 600 rows is revealed...
      expect(screen.getAllByRole("listitem")).toHaveLength(5);
      // ...but the AUM hero (dashboard.aum) + the KPI tiles are the full-book aggregates, never a sum
      // of the revealed rows.
      expect(screen.getByText(formatUsd(managerDashboard.aum))).toBeInTheDocument();
      expect(screen.getByText(formatUsd(managerDashboard.yieldGenerated))).toBeInTheDocument();
      expect(screen.getByText("Yield generated")).toBeInTheDocument();
      expect(screen.getByText("Avg APR")).toBeInTheDocument();
    });

    // @rule DO-NOT-RESET (POO-628) — the Overview has no status filter, so the reveal count is pure
    // component state: a same-set 45s/focus/router.refresh refetch (a new array, same content) keeps
    // the revealed count. Re-rendering must not snap the reveal back to 5.
    it("preserves the revealed count on a same-set refetch (DO-NOT-RESET, POO-628)", async () => {
      const user = userEvent.setup();
      const onManageStrategy = vi.fn();
      const { rerender } = renderWithProviders(
        <ManagerDashboardView
          dashboard={managerDashboard}
          strategies={makeManyActive(12)}
          onManageStrategy={onManageStrategy}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Load more" }));
      expect(screen.getAllByRole("listitem")).toHaveLength(10);
      // A refetch: a brand-new array instance with the same 12 active rows.
      rerender(
        <ManagerDashboardView
          dashboard={managerDashboard}
          strategies={makeManyActive(12)}
          onManageStrategy={onManageStrategy}
        />,
      );
      expect(screen.getAllByRole("listitem")).toHaveLength(10);
    });
  });
});
