/**
 * @name VirtualTableBody — tests
 *
 * Technique A (ADR-0001 rule 1) inside a real <table>: two in-flow spacer <tr>s reserve the off-
 * screen pixels, the windowed real rows stay in table flow. The absolute-row technique is BANNED in
 * tables (rule 2).
 *
 * - Gate OFF / below threshold → plain `.map()`: every row present, NO spacer rows (identical DOM to
 *   today, [R1]).
 * - Gate ON + 600 rows + layout shim → windowed: fewer real rows than items, spacer rows present and
 *   height-synced ([R4]), never any absolutely-positioned row (rule 2), focus row stays mounted when
 *   scrolled out ([R2]).
 */
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDevOverridesForTests,
  clearOverrides,
  setOverride,
} from "@/lib/features/devOverrides";
import { setupVirtualizationLayout } from "../../../tests/virtualizationLayout";
import { VirtualTableBody } from "./VirtualTableBody";

const ROW_HEIGHT = 57;

interface Row {
  id: string;
  label: string;
}
function makeRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: `r${i}`, label: `Row ${i}` }));
}

/** Render a full, valid <table> whose <tbody> is the VirtualTableBody under test. */
function renderTable(rows: Row[], focusedIndex: number | null = null) {
  return render(
    <div style={{ overflow: "auto", height: 400 }}>
      <table>
        <thead>
          <tr>
            <th scope="col">ID</th>
            <th scope="col">Label</th>
          </tr>
        </thead>
        <VirtualTableBody
          items={rows}
          colSpan={2}
          estimateSize={ROW_HEIGHT}
          getRowKey={(row) => row.id}
          focusedIndex={focusedIndex}
          renderRow={(row) => (
            <>
              <td>{row.id}</td>
              <td>{row.label}</td>
            </>
          )}
        />
      </table>
    </div>,
  );
}

describe("VirtualTableBody", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetDevOverridesForTests();
  });
  afterEach(() => {
    localStorage.clear();
    __resetDevOverridesForTests();
    vi.restoreAllMocks();
  });

  describe("[R1] plain-map fallback (gate off / below threshold)", () => {
    it("renders EVERY row and NO spacer rows when the flag is off", () => {
      renderTable(makeRows(20));
      // All 20 labels present.
      for (let i = 0; i < 20; i++) {
        expect(screen.getByText(`Row ${i}`)).toBeInTheDocument();
      }
      // No spacer rows in the plain-map baseline.
      expect(document.querySelectorAll("tr[data-virtual-spacer]")).toHaveLength(0);
    });

    it("renders every row even with the flag ON but below THRESHOLD (identical DOM)", () => {
      setOverride("virtualize", true);
      renderTable(makeRows(20));
      expect(screen.getAllByRole("row")).toHaveLength(20 + 1); // +1 header row
      expect(document.querySelectorAll("tr[data-virtual-spacer]")).toHaveLength(0);
      clearOverrides();
    });

    it("falls back to plain map when the flag is on and count is high but there is NO layout", () => {
      // No layout shim → hasLayout false → plain map even at 600 rows ([R1] correctness guarantee).
      setOverride("virtualize", true);
      renderTable(makeRows(600));
      expect(screen.getByText("Row 0")).toBeInTheDocument();
      expect(screen.getByText("Row 599")).toBeInTheDocument();
      expect(document.querySelectorAll("tr[data-virtual-spacer]")).toHaveLength(0);
      clearOverrides();
    });
  });

  describe("windowed (gate on, 600 rows, layout shim)", () => {
    beforeEach(() => {
      setupVirtualizationLayout();
      setOverride("virtualize", true);
    });
    afterEach(() => {
      clearOverrides();
    });

    it("renders FEWER real rows than items, with a bottom spacer reserving the rest", () => {
      renderTable(makeRows(600));
      // At scroll-top the window starts at index 0, so only the BOTTOM spacer exists (top pad 0).
      const spacers = document.querySelectorAll("tr[data-virtual-spacer]");
      expect(spacers.length).toBeGreaterThanOrEqual(1);
      expect(document.querySelector("tr[data-virtual-spacer='bottom']")).not.toBeNull();
      const dataRows = document.querySelectorAll("tr[data-index]");
      expect(dataRows.length).toBeGreaterThan(0);
      expect(dataRows.length).toBeLessThan(600);
    });

    it("[R4] reserves the off-screen tail on first paint via a large non-negative bottom spacer", () => {
      renderTable(makeRows(600));
      // At scroll-top the tail below the window is reserved by the bottom spacer, so back-nav scroll
      // restoration lands on a tall document. (Exact total = count*rowHeight is asserted in the
      // useVirtualizedRows hook test, where rows are not measured to the jsdom shim's fake height.)
      const bottomCell = document.querySelector(
        "tr[data-virtual-spacer='bottom'] td",
      ) as HTMLElement;
      const bottomHeight = Number.parseFloat(bottomCell.style.height);
      expect(bottomHeight).toBeGreaterThan(0);
      // No top spacer at scroll-top (window starts at index 0, top pad 0).
      expect(document.querySelector("tr[data-virtual-spacer='top']")).toBeNull();
    });

    it("[R4] the top spacer height equals firstVisibleIndex * rowHeight once scrolled down (spacer sync)", () => {
      // The layout shim reports EVERY element's offsetHeight as its fake 10000px viewport, so measured
      // rows would corrupt the scroll math and the window would never leave index 0 — making the
      // spacer-sync assertion vacuous (no top spacer ever appears). Pin the measured <tr> height to the
      // estimate so scroll math is honest and a genuine top spacer is produced, then assert it exactly.
      const origOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get(this: HTMLElement) {
          return this.tagName === "TR" ? ROW_HEIGHT : 10000;
        },
      });
      try {
        renderTable(makeRows(600));
        const scrollBox = document.querySelector("div[style*='overflow']") as HTMLElement;
        // Drive a real scroll so the window moves off index 0 and a top spacer appears.
        act(() => {
          Object.defineProperty(scrollBox, "scrollTop", {
            value: 300 * ROW_HEIGHT,
            writable: true,
          });
          scrollBox.dispatchEvent(new Event("scroll"));
        });
        // The window MUST have moved off index 0 — otherwise the spacer-sync check is meaningless.
        const firstIndex = Number(
          (document.querySelector("tr[data-index]") as HTMLElement).dataset.index,
        );
        expect(firstIndex).toBeGreaterThan(0);
        const topSpacerCell = document.querySelector(
          "tr[data-virtual-spacer='top'] td",
        ) as HTMLElement;
        expect(topSpacerCell).not.toBeNull();
        const topHeight = Number.parseFloat(topSpacerCell.style.height);
        expect(topHeight).toBe(firstIndex * ROW_HEIGHT);
        expect(topHeight).toBeGreaterThanOrEqual(0);
        // Bottom spacer never emits a negative height ([R4] clamp).
        const bottomCell = document.querySelector(
          "tr[data-virtual-spacer='bottom'] td",
        ) as HTMLElement;
        expect(bottomCell).not.toBeNull();
        expect(Number.parseFloat(bottomCell.style.height)).toBeGreaterThanOrEqual(0);
      } finally {
        if (origOffset) Object.defineProperty(HTMLElement.prototype, "offsetHeight", origOffset);
      }
    });

    it("rule 2: NO windowed row is absolutely positioned (absolute-row ban in tables)", () => {
      renderTable(makeRows(600));
      for (const row of document.querySelectorAll("tr[data-index]")) {
        expect((row as HTMLElement).style.position).not.toBe("absolute");
        expect((row as HTMLElement).style.transform).toBe("");
      }
    });

    it("keeps the <thead> scope=col header semantics intact", () => {
      renderTable(makeRows(600));
      expect(screen.getByRole("columnheader", { name: "ID" })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Label" })).toBeInTheDocument();
    });

    it("[R2] the focused row stays mounted even when it is scrolled out of the window", () => {
      const focused = 590;
      renderTable(makeRows(600), focused);
      const focusedRow = document.querySelector(`tr[data-index='${focused}']`);
      expect(focusedRow).not.toBeNull();
      expect(within(focusedRow as HTMLElement).getByText("Row 590")).toBeInTheDocument();
    });

    it("[R4] contiguous window (scroll-top, no far pin) emits ONLY top+bottom spacers (byte-identical)", () => {
      // Backward-compat guard for the per-gap refactor: with no pin the window is contiguous, so the
      // segment model must degrade to exactly the previous single top/bottom pad — at most one 'top' and
      // one 'bottom' spacer, NEVER an inter-segment 'gap-N' spacer. This is the DOM the other Wave B
      // windowed tests (627/628/629 contiguous windows) depend on not changing.
      renderTable(makeRows(600));
      expect(document.querySelectorAll("tr[data-virtual-spacer^='gap-']")).toHaveLength(0);
      // At scroll-top only the bottom pad exists; whatever spacers there are, they are top/bottom only.
      for (const spacer of document.querySelectorAll("tr[data-virtual-spacer]")) {
        const key = (spacer as HTMLElement).dataset.virtualSpacer;
        expect(key === "top" || key === "bottom").toBe(true);
      }
    });

    it("[R4] a far focus pin makes the window non-contiguous and per-gap spacers reserve the full height", () => {
      // Regression for the single-pad Technique-A bug on a NON-contiguous window. The [R2] pin force-
      // includes row 0 while the natural window sits far below, so `virtualItems` is [0, ...far block].
      // A top/bottom-only model would reserve topPad = first.start = 0 and DROP the huge gap between
      // row 0 and the visible block, collapsing the <tbody>. Per-gap spacers must reserve it: every
      // spacer height + every mounted 57px row must sum to the full list height.
      const origOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get(this: HTMLElement) {
          return this.tagName === "TR" ? ROW_HEIGHT : 10000;
        },
      });
      try {
        renderTable(makeRows(600), 0);
        const scrollBox = document.querySelector("div[style*='overflow']") as HTMLElement;
        // Scroll far down in honest 57px-row coordinates so the natural window is nowhere near row 0.
        act(() => {
          Object.defineProperty(scrollBox, "scrollTop", {
            value: 580 * ROW_HEIGHT,
            writable: true,
          });
          scrollBox.dispatchEvent(new Event("scroll"));
        });

        const mounted = Array.from(document.querySelectorAll("tr[data-index]")) as HTMLElement[];
        const indexes = mounted.map((r) => Number(r.dataset.index));
        // Non-contiguity confirmed: row 0 pinned, natural window far below → an inter-segment gap.
        expect(indexes).toContain(0);
        expect(Math.min(...indexes.filter((i) => i !== 0))).toBeGreaterThan(50);
        expect(document.querySelector("tr[data-virtual-spacer='gap-0']")).not.toBeNull();

        // Reserved height = every spacer <td> height + every mounted 57px row. Must equal the full
        // list height. A collapsed table (missing the inter-segment gap) would fall far short.
        const spacerPx = Array.from(document.querySelectorAll("tr[data-virtual-spacer] td")).reduce(
          (sum, td) => sum + Number.parseFloat((td as HTMLElement).style.height || "0"),
          0,
        );
        expect(spacerPx + mounted.length * ROW_HEIGHT).toBe(600 * ROW_HEIGHT);
      } finally {
        if (origOffset) Object.defineProperty(HTMLElement.prototype, "offsetHeight", origOffset);
      }
    });
  });
});
