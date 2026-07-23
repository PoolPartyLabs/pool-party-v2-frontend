/**
 * @name WindowedList — document-scroll offset (scrollMargin) wiring
 *
 * Regression (POO-629): the document-scroll windowers sit BELOW the hero/aside/KPI sections, so their
 * `offsetTop` is non-zero. `useWindowVirtualizer` observes the RAW `window.scrollY`, so a list that
 * ignores its offset computes the wrong visible slice in a real browser (the range is shifted by
 * offsetTop once it exceeds the overscan band). jsdom reports offsetTop as 0, so a DOM-only assertion
 * cannot catch it; instead these tests pin the seam directly:
 *
 *   1. the component MEASURES its container's document offset and feeds it as `scrollMargin`, and
 *   2. it SUBTRACTS `virtualizer.options.scrollMargin` when placing rows (top spacer / translateY),
 *      so a row's on-screen position is local to the list, not shifted by the margin.
 *
 * We mock `useVirtualizedRows` so we can (a) capture the `scrollMargin` the component passes and
 * (b) hand back virtual items whose `.start` already carries the margin (as virtual-core does once
 * the option is set) and assert the component removes it again.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VirtualizedRows } from "@/lib/virtualization/useVirtualizedRows";
import { WindowedCardList, WindowedTableBody } from "./WindowedList";

// Force the gate ON so the windowed branch renders (the plain-map branch never touches scrollMargin).
vi.mock("@/lib/virtualization/useVirtualizeGate", () => ({
  useVirtualizeGate: () => ({ enabled: true, containerRef: () => {} }),
}));

const OFFSET_TOP = 800;
const ROW_HEIGHT = 57;

/** Captures the last options `useVirtualizedRows` was called with, so we can read `scrollMargin`. */
let lastOptions: { scrollMargin?: number } | null = null;

/**
 * A fake `useVirtualizedRows` that yields three rows starting at index 5, each `.start` carrying the
 * margin the caller passed (mirroring virtual-core once `scrollMargin` is set). `getTotalSize()` is
 * the pure list height (margin already removed, as virtual-core does).
 */
vi.mock("@/lib/virtualization/useVirtualizedRows", () => ({
  useVirtualizedRows: (opts: { scrollMargin?: number; items: readonly unknown[] }) => {
    lastOptions = opts;
    const margin = opts.scrollMargin ?? 0;
    const total = opts.items.length;
    const firstIndex = 5;
    const virtualItems = [firstIndex, firstIndex + 1, firstIndex + 2].map((index) => ({
      index,
      key: index,
      start: index * ROW_HEIGHT + margin,
      end: (index + 1) * ROW_HEIGHT + margin,
      size: ROW_HEIGHT,
      lane: 0,
    }));
    return {
      virtualizer: {
        options: { scrollMargin: margin },
        measureElement: () => {},
      },
      setScrollElement: () => {},
      getVirtualItems: () => virtualItems,
      getTotalSize: () => total * ROW_HEIGHT,
      scrollToIndex: () => {},
      laneCount: 1,
      rows: [],
    } as unknown as VirtualizedRows<unknown>;
  },
}));

/** A container whose document offset (`rect.top + scrollY`) is OFFSET_TOP, so the component measures it. */
function withOffsetTop<E extends HTMLElement>(el: E | null): void {
  if (!el) return;
  el.getBoundingClientRect = () =>
    ({
      top: OFFSET_TOP,
      bottom: 0,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
      x: 0,
      y: OFFSET_TOP,
    }) as DOMRect;
}

const items = Array.from({ length: 600 }, (_, i) => ({ id: `p${i}` }));

afterEach(() => {
  cleanup();
  lastOptions = null;
  vi.restoreAllMocks();
});

describe("WindowedTableBody — document offset (scrollMargin)", () => {
  it("feeds its container offsetTop as scrollMargin and subtracts it from the top spacer height", () => {
    // Patch the container ref so its measured document offset is OFFSET_TOP.
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      (tag: string, opts?: ElementCreationOptions) => {
        const el = originalCreateElement(tag, opts);
        if (tag === "tbody") withOffsetTop(el);
        return el;
      },
    );

    const { container } = render(
      <table>
        <WindowedTableBody
          items={items}
          colSpan={2}
          getRowKey={(item) => (item as { id: string }).id}
          estimateSize={ROW_HEIGHT}
          renderRow={() => (
            <>
              <td>a</td>
              <td>b</td>
            </>
          )}
        />
      </table>,
    );

    // 1. The component measured the container offset and passed it as scrollMargin.
    expect(lastOptions?.scrollMargin).toBe(OFFSET_TOP);

    // 2. The top spacer is the LOCAL offset (firstIndex * rowHeight), NOT first.start (which carries
    //    the +OFFSET_TOP margin). A component that forwarded first.start raw would over-pad by 800px.
    const topSpacer = container.querySelector("tr[data-virtual-spacer='top'] > td") as HTMLElement;
    expect(topSpacer).not.toBeNull();
    expect(Number.parseFloat(topSpacer.style.height)).toBe(5 * ROW_HEIGHT);
  });
});

// POO-668 R5: the paged Load-more supersedes windowing, so the Portfolio lists pass `disabled` to
// force the plain-map baseline even though the gate mock above forces `enabled: true`. These assert
// the disable wins over the gate.
describe("WindowedTableBody / WindowedCardList — disabled forces the plain-map baseline (POO-668 R5)", () => {
  it("[R5] renders every row + NO spacers when disabled, even with the gate forced on", () => {
    const { container } = render(
      <table>
        <WindowedTableBody
          items={items}
          colSpan={2}
          disabled
          getRowKey={(item) => (item as { id: string }).id}
          estimateSize={ROW_HEIGHT}
          renderRow={(item) => (
            <>
              <td>{(item as { id: string }).id}</td>
              <td>b</td>
            </>
          )}
        />
      </table>,
    );
    // Every one of the 600 rows renders, and there are no windowing spacer rows or the marker attr.
    expect(container.querySelectorAll("tbody > tr")).toHaveLength(600);
    expect(container.querySelectorAll("tr[data-virtual-spacer]")).toHaveLength(0);
    expect(container.querySelector("tbody[data-virtualized]")).toBeNull();
  });

  it("[R5] renders every card as static flow (no absolute positioning) when disabled", () => {
    const { container } = render(
      <WindowedCardList
        items={items}
        disabled
        getItemKey={(item) => (item as { id: string }).id}
        estimateSize={ROW_HEIGHT}
        renderItem={(item) => <span>{(item as { id: string }).id}</span>}
      />,
    );
    const lis = container.querySelectorAll("ul > li");
    expect(lis).toHaveLength(600);
    for (const li of lis) {
      expect((li as HTMLElement).style.position).not.toBe("absolute");
    }
  });
});

describe("WindowedCardList — document offset (scrollMargin)", () => {
  it("feeds its <ul> offsetTop as scrollMargin and subtracts it from each card's translateY", () => {
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      (tag: string, opts?: ElementCreationOptions) => {
        const el = originalCreateElement(tag, opts);
        if (tag === "ul") withOffsetTop(el);
        return el;
      },
    );

    const { container } = render(
      <WindowedCardList
        items={items}
        getItemKey={(item) => (item as { id: string }).id}
        estimateSize={ROW_HEIGHT}
        renderItem={(item) => <span>{(item as { id: string }).id}</span>}
      />,
    );

    expect(lastOptions?.scrollMargin).toBe(OFFSET_TOP);

    // The first windowed card (index 5) must translate to its LOCAL position (5 * rowHeight), not
    // 5 * rowHeight + OFFSET_TOP. Reading the raw start would push every card 800px too low.
    const firstCard = container.querySelector("li[data-index='5']") as HTMLElement;
    expect(firstCard).not.toBeNull();
    expect(firstCard.style.transform).toBe(`translateY(${5 * ROW_HEIGHT}px)`);
  });
});
