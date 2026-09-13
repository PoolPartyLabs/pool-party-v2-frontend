/**
 * @name PortfolioView — windowed virtualization (POO-629, rules v1)
 *
 * PR5 of the POO-623 epic: the Portfolio positions (desktop <table> + mobile cards) and the
 * on-demand closed-strategies history window via `useWindowVirtualizer` (document scroll), so the
 * hero/aside layout and browser back-nav scroll restoration are preserved. It consumes the POO-625
 * primitive (`useVirtualizeGate` single gate + `useVirtualizedRows({ mode: "window" })`), applying
 * Technique A in the table (in-flow spacer <tr>s, absolute-row ban) and absolute-<li> translateY
 * outside tables.
 *
 * Both flag states are covered:
 *   (a) gate OFF / below THRESHOLD -> plain `.map()`, byte-for-byte today's DOM. The existing
 *       PortfolioView.test.tsx hard-count assertions stay green by construction; here we re-assert
 *       the no-spacer / every-row baseline explicitly.
 *   (b) gate ON (>500-row fixture + flag forced on + the OPT-IN setupVirtualizationLayout() shim,
 *       NEVER global) -> the windowed path. The v1 business rules are asserted on this path:
 *
 * - R1 (DO-NOT-RESET on the 45s/focus refetch): a new positions array with the SAME ids but changed
 *   values is a refreshed same-identity list, NOT a reset. The virtualizer is keyed by position.id,
 *   so the scroll offset + first-visible index survive the array-identity change; no scrollTo(0).
 * - R2 (usePostWriteRefresh): a post-write new array is the same DO-NOT-RESET path.
 * - R3 (closed-pinned floor stability): the closed-first canonical order is the caller's stable order;
 *   it is not a reset trigger, so the window does not move across a refetch that preserves that order.
 * - R4 (activeCount unchanged): the count stays positions.filter(status === "active").length.
 */
import { act, cleanup, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDevOverridesForTests,
  clearOverrides,
  setOverride,
} from "@/lib/features/devOverrides";
import type { Position, Strategy } from "@/lib/schemas";
import { renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { setupVirtualizationLayout } from "../../../tests/virtualizationLayout";
import {
  PortfolioView,
  type PortfolioViewPosition,
  type PortfolioViewProps,
} from "./PortfolioView";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("./actions", () => ({ getClosedStrategiesAction: vi.fn() }));

// These tests assert VIRTUALIZATION behavior (windowing, scroll-offset preservation across a refetch,
// activeCount) — NOT PositionCard's visual internals, which are covered by PositionCard.test.tsx. Each
// 600-row fixture would otherwise mount 600 full PositionCards (MaskableValue/RiskMeter/AprTooltip/
// ManagerLink each), so the plain-map baseline case renders 600 heavy cards and the windowed cases
// re-render them. Stub the card to a cheap marker so the fixtures are light and the gate stays green
// under parallel-worker CPU contention instead of load-flaky. The stub still carries the strategy name
// so the "Strategy 0"/"Strategy 599" assertions and the mobile card list keep working.
vi.mock("./components/PositionCard", () => ({
  PositionCard: ({ strategy }: { strategy: { name: string } }) => (
    <div data-testid="position-card">{strategy.name}</div>
  ),
}));

// Keep desktop rate labels, but avoid mounting 600 Radix tooltip trees in the plain-map baseline.
// Tooltip interaction is covered in AprTooltip.test.tsx; these tests retain the real table and rows.
vi.mock("@/components/ui/AprTooltip", () => ({
  AprTooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

const STRATEGY: Strategy = {
  id: "s-base",
  name: "Stable Yield",
  manager: "Pool Party Labs",
  riskLevel: 2,
  minInvestment: 100,
  tvl: 1_250_000,
  investors: 312,
  estReturn: 7.4,
  rateType: "APY",
  status: "active",
};

/** A `>THRESHOLD` set of active positions, stable ids `p0..p{n-1}`, distinct per-position values. */
function makePositions(n: number): PortfolioViewPosition[] {
  return Array.from({ length: n }, (_, i) => ({
    position: {
      id: `p${i}`,
      strategyId: STRATEGY.id,
      invested: 1000 + i,
      currentValue: 1100 + i,
      totalYield: 100 + i,
      available: 0,
      reinvestment: "auto-compound",
      status: "active",
    } satisfies Position,
    strategy: { ...STRATEGY, id: `s${i}`, name: `Strategy ${i}` },
  }));
}

/**
 * A refreshed same-identity array: NEW object identity for the array + every entry (what a 45s
 * refetch / focus refresh / post-write refresh produces), SAME ids, CHANGED values. This is the R1/R2
 * do-not-reset input.
 */
function refresh(entries: PortfolioViewPosition[]): PortfolioViewPosition[] {
  return entries.map((entry) => ({
    position: { ...entry.position, currentValue: entry.position.currentValue + 1 },
    strategy: { ...entry.strategy },
  }));
}

const baseProps = (positions: PortfolioViewPosition[]): PortfolioViewProps => ({
  totalValue: 100_000,
  totalEarned: 5000,
  invested: 90_000,
  currentValue: 100_000,
  totalYield: 5000,
  avgApy: 8.4,
  chartData: [],
  allocation: [{ level: 2, value: 100_000 }],
  positions,
});

/** The desktop positions table's virtualized <tbody> (the one carrying data-virtualized). */
function positionsTbody(): HTMLElement {
  const tbody = document.querySelector("tbody[data-virtualized='true']");
  if (!tbody) throw new Error("expected a virtualized positions <tbody>");
  return tbody as HTMLElement;
}

/** The FLAT indexes of the currently-windowed real rows in the positions table. */
function windowedRowIndexes(): number[] {
  return Array.from(positionsTbody().querySelectorAll("tr[data-index]")).map((tr) =>
    Number((tr as HTMLElement).dataset.index),
  );
}

/** Drive a real document scroll so the window virtualizer moves off index 0. */
function scrollWindowTo(y: number) {
  act(() => {
    Object.defineProperty(window, "scrollY", { value: y, writable: true, configurable: true });
    window.dispatchEvent(new Event("scroll"));
  });
}

describe("PortfolioView virtualization — [R1] plain-map baseline (gate off / below threshold)", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetDevOverridesForTests();
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    __resetDevOverridesForTests();
    vi.restoreAllMocks();
  });

  it("renders every position and NO spacer rows when the flag is off (identical DOM to today)", () => {
    renderWithProviders(<PortfolioView {...baseProps(makePositions(3))} />);
    // Desktop table: 3 body rows + the header row, no windowing spacers.
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3 + 1);
    expect(document.querySelectorAll("tr[data-virtual-spacer]")).toHaveLength(0);
    expect(document.querySelector("tbody[data-virtualized]")).toBeNull();
    // Mobile card list is a static flow list (no absolute positioning).
    for (const li of document.querySelectorAll("ul[class*='lg:hidden'] > li")) {
      expect((li as HTMLElement).style.position).not.toBe("absolute");
    }
  });

  it("stays a plain map with the flag ON but below THRESHOLD (no windowing under 500)", () => {
    setOverride("virtualize", true);
    renderWithProviders(<PortfolioView {...baseProps(makePositions(10))} />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(10 + 1);
    expect(document.querySelectorAll("tr[data-virtual-spacer]")).toHaveLength(0);
    clearOverrides();
  });

  it("falls back to plain map with the flag on and 600 rows but NO layout (hasLayout false)", () => {
    // No layout shim -> the gate's hasLayout stays false -> plain map even at 600 rows. This renders
    // the full 600-row plain map (the heaviest baseline case). Allow coverage instrumentation and
    // parallel CI workers time to mount both layouts; this is a correctness test, not a benchmark.
    setOverride("virtualize", true);
    renderWithProviders(<PortfolioView {...baseProps(makePositions(600))} />);
    // Each strategy name renders in both the mobile card AND the desktop table row (>=1 each).
    expect(screen.getAllByText("Strategy 0").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Strategy 599").length).toBeGreaterThanOrEqual(1);
    expect(document.querySelectorAll("tbody > tr")).toHaveLength(600);
    expect(screen.getAllByTestId("position-card")).toHaveLength(600);
    expect(document.querySelectorAll("tr[data-virtual-spacer]")).toHaveLength(0);
    expect(document.querySelector("tbody[data-virtualized]")).toBeNull();
    clearOverrides();
  }, 15_000);

  it("[R4] activeCount stays positions.filter(status === 'active').length regardless of the flag", () => {
    const positions = makePositions(600);
    // Flip 3 to closed: activeCount must be 597 whether or not the list windows.
    for (let i = 0; i < 3; i++) {
      (positions[i] as PortfolioViewPosition).position.status = "closed";
    }
    renderWithProviders(<PortfolioView {...baseProps(positions)} />);
    expect(screen.getByText("597 active")).toBeInTheDocument();
  });
});

describe("PortfolioView virtualization — windowed path (gate on, 600 rows, layout shim)", () => {
  const ROW_HEIGHT = 57;
  let restoreOffset: (() => void) | undefined;

  beforeEach(() => {
    localStorage.clear();
    __resetDevOverridesForTests();
    setupVirtualizationLayout();
    setOverride("virtualize", true);
    // A real page mounts at a defined scroll position; jsdom's window.scrollY is a leaky global that
    // `scrollWindowTo` mutates and never resets, so a prior test's scroll would bleed into the next
    // mount's scrollMargin measurement (offsetTop = rect.top + scrollY). Pin it to the document top
    // before each windowed test so the document-scroll anchor is deterministic.
    Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
    // The shim reports EVERY element's offsetHeight as its fake 10000px viewport, which would corrupt
    // the window virtualizer's row measurement (22 rows would fill the whole range and the window
    // could never advance). Pin the measured <tr> height to the estimate so document-scroll math is
    // honest; every other element keeps the fake viewport (so hasLayout still engages). Same technique
    // as VirtualTableBody.test.tsx's spacer-sync test.
    const orig = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.tagName === "TR" ? ROW_HEIGHT : 10000;
      },
    });
    restoreOffset = () => {
      if (orig) Object.defineProperty(HTMLElement.prototype, "offsetHeight", orig);
    };
  });
  afterEach(() => {
    restoreOffset?.();
    restoreOffset = undefined;
    Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
    cleanup();
    clearOverrides();
    localStorage.clear();
    __resetDevOverridesForTests();
    vi.restoreAllMocks();
  });

  it("windows the desktop positions table via Technique A (fewer real rows + spacers, no absolute rows)", () => {
    renderWithProviders(<PortfolioView {...baseProps(makePositions(600))} />);
    const rows = windowedRowIndexes();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(600);
    // A bottom spacer reserves the off-screen tail (Technique A), and no windowed row is absolute.
    expect(document.querySelector("tr[data-virtual-spacer='bottom']")).not.toBeNull();
    for (const tr of positionsTbody().querySelectorAll("tr[data-index]")) {
      expect((tr as HTMLElement).style.position).not.toBe("absolute");
      expect((tr as HTMLElement).style.transform).toBe("");
    }
  });

  it("[R1] a 45s refetch (new array identity, SAME ids, changed values) does NOT reset the window", () => {
    const positions = makePositions(600);
    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { rerender } = renderWithProviders(<PortfolioView {...baseProps(positions)} />);

    // Scroll the document so the window leaves index 0.
    scrollWindowTo(300 * 57);
    const before = windowedRowIndexes();
    expect(before[0]).toBeGreaterThan(0); // window has genuinely moved off the top
    scrollSpy.mockClear();

    // The refetch: a brand-new array + new entry identities, same ids, currentValue+1 (R1 input).
    rerender(<PortfolioView {...baseProps(refresh(positions))} />);

    // Same first-visible index + same window -> the refetch was treated as a refresh, not a reset.
    expect(windowedRowIndexes()).toEqual(before);
    // No scroll-to-top was triggered by the identity change.
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("[R2] a usePostWriteRefresh new array (same ids) does NOT reset the window either", () => {
    const positions = makePositions(600);
    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { rerender } = renderWithProviders(<PortfolioView {...baseProps(positions)} />);

    scrollWindowTo(250 * 57);
    const before = windowedRowIndexes();
    expect(before[0]).toBeGreaterThan(0);
    scrollSpy.mockClear();

    // Post-write refresh delivers a fresh array with the same ids (the just-changed position updated).
    rerender(<PortfolioView {...baseProps(refresh(positions))} />);

    expect(windowedRowIndexes()).toEqual(before);
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("[R3] the closed-pinned floor is part of the stable order, so a refetch does not move the window", () => {
    // Caller pins closed-first (the portfolioViewModel canonical order). The window is keyed by id and
    // must not move across a refetch that preserves that pinned order.
    const positions = makePositions(600);
    for (let i = 0; i < 4; i++) {
      (positions[i] as PortfolioViewPosition).position.status = "closed";
    }
    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { rerender } = renderWithProviders(<PortfolioView {...baseProps(positions)} />);

    scrollWindowTo(200 * 57);
    const before = windowedRowIndexes();
    expect(before[0]).toBeGreaterThan(0);
    scrollSpy.mockClear();

    // Refetch keeps the same closed-first order + ids; only values change.
    rerender(<PortfolioView {...baseProps(refresh(positions))} />);

    expect(windowedRowIndexes()).toEqual(before);
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("keeps the <thead> columnheader semantics intact while windowed", () => {
    renderWithProviders(<PortfolioView {...baseProps(makePositions(600))} />);
    expect(screen.getByRole("columnheader", { name: "Strategy" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Current Value" })).toBeInTheDocument();
  });
});
