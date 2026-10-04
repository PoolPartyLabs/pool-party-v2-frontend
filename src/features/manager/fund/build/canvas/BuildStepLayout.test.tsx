/**
 * @id PP-MGR-CMP-045
 * @name BuildStepLayout tests
 * @implements-rules-version v1 (POO-2152 rules v1)
 * @analytics-events none, the layout reports presses through its props; the Build screen
 *   (PP-MGR-SCR-002, S7) owns every event
 *
 * The frame of the Build step (handoff v1.2 [AN2], [AN3], [AN4]): the heading and subtitle, the
 * three-column grid (palette, canvas, panel) and the sticky Back / Next bar, with the same markup
 * contract as the Mandate's bar (`data-builder-action-bar`) without importing it.
 */
import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../../tests/utils/renderWithProviders";
import { BuildStepLayout } from "./BuildStepLayout";

function renderLayout(notice?: React.ReactNode) {
  const onBack = vi.fn();
  const onNext = vi.fn();
  const view = renderWithProviders(
    <BuildStepLayout
      palette={<div data-testid="palette" />}
      canvas={<div data-testid="canvas" />}
      panel={<div data-testid="panel" />}
      onBack={onBack}
      onNext={onNext}
      notice={notice}
    />,
  );
  return { ...view, onBack, onNext };
}

function bar(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>("[data-builder-action-bar]");
  if (!element) throw new Error("no action bar");
  return element;
}

describe("BuildStepLayout: heading", () => {
  // @rule AN2
  it("[AN2] titles the step and explains it under the title", () => {
    renderLayout();

    expect(screen.getByRole("heading", { name: "Build your strategy" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Assemble the strategy from blocks. Drag one in, then configure it on the right. Blocks only use what the mandate allows.",
      ),
    ).toBeInTheDocument();
  });

  // @rule AN2
  it("[AN2] the title is the H3 style, 4 over the subtitle, then 24 to the grid", () => {
    const { container } = renderLayout();

    const heading = screen.getByRole("heading", { name: "Build your strategy" });
    // H2 in the outline (under the shell's H1), drawn in the app's Heading/H3 style.
    expect(heading.tagName).toBe("H2");
    expect(heading.className).toContain("text-xl");
    expect(heading.className).toContain("font-semibold");
    expect(heading.parentElement?.className).toContain("gap-1");
    expect(container.querySelector("[data-build-step]")?.className).toContain("gap-6");
  });
});

describe("BuildStepLayout: grid", () => {
  // @rule AN3
  it("[AN3] lays palette, canvas and panel in a 220 / flexible / 360 grid, gap 24, 640 high", () => {
    const { container } = renderLayout();

    const grid = container.querySelector<HTMLElement>("[data-build-grid]");
    expect(grid).not.toBeNull();
    for (const token of ["grid", "grid-cols-[220px_minmax(0,1fr)_360px]", "gap-6", "h-[640px]"]) {
      expect(grid?.className).toContain(token);
    }
    const columns = Array.from(grid?.children ?? []);
    expect(columns).toHaveLength(3);
    expect(columns[0]).toContainElement(screen.getByTestId("palette"));
    expect(columns[1]).toContainElement(screen.getByTestId("canvas"));
    expect(columns[2]).toContainElement(screen.getByTestId("panel"));
  });

  // @rule AN3
  it("[AN3] the panel column is top aligned and hugs its content; the canvas column can shrink", () => {
    const { container } = renderLayout();

    const columns = Array.from(container.querySelector("[data-build-grid]")?.children ?? []);
    expect(columns[2]?.className).toContain("self-start");
    expect(columns[1]?.className).toContain("min-w-0");
  });
});

describe("BuildStepLayout: the sticky bar", () => {
  // @rule AN4
  it("[AN4] keeps the Mandate bar's markup contract: sticky at the bottom of the column", () => {
    const { container } = renderLayout();

    expect(bar(container).className).toContain("sticky");
    expect(bar(container).className).toContain("bottom-0");
  });

  // @rule AN4
  it("[AN4] Back: Mandate is a ghost button on the left, Next: Review the primary on the right", () => {
    const { container } = renderLayout();

    const back = screen.getByRole("button", { name: "Back: Mandate" });
    const next = screen.getByRole("button", { name: "Next: Review" });
    expect(back.className).toContain("bg-transparent");
    expect(next.className).toContain("bg-primary");
    const order = Array.from(bar(container).querySelectorAll("button"));
    expect(order).toEqual([back, next]);
  });

  // @rule AN4
  it("[AN4] reports both presses", async () => {
    const { onBack, onNext } = renderLayout();

    await userEvent.click(screen.getByRole("button", { name: "Back: Mandate" }));
    await userEvent.click(screen.getByRole("button", { name: "Next: Review" }));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  // @rule AN4
  it("[AN4] Next: Review is never disabled, even with a notice up", () => {
    renderLayout("Add a block before Review.");

    expect(screen.getByRole("button", { name: "Next: Review" })).toBeEnabled();
  });

  // @rule AN4
  it("[AN4] shows no notice by default", () => {
    renderLayout();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // @rule AN4
  it("[AN4] shows an optional notice inline in the bar, before Next", () => {
    const { container } = renderLayout("Add a block before Review.");

    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("Add a block before Review.");
    expect(bar(container)).toContainElement(notice);
    const next = screen.getByRole("button", { name: "Next: Review" });
    // The notice precedes Next in reading order.
    expect(notice.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
