/**
 * @id PP-STR-CMP-027
 * @name StickyActionFooter — tests
 * @implements-rules-version v1 (POO-1525 rules v1)
 *
 * POO-1525 [M3.3]/[M3.5]/[M3.6]: the one wrapper every phase's terminal CTA goes through so the
 * pin/border/background/safe-area rules exist in ONE place rather than three (`ProvisioningPanel`
 * inline, `FundingSourceSelector`, `GasTopUpBody`) that could drift.
 */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StickyActionFooter } from "./StickyActionFooter";

/** A scroll ancestor the component is mounted inside, metrics stubbed the way jsdom requires. */
function renderInScrollContainer(
  children: React.ReactNode,
  metrics: { scrollHeight: number; clientHeight: number; scrollTop: number },
) {
  const scrollEl = document.createElement("div");
  scrollEl.style.overflowY = "auto";
  document.body.appendChild(scrollEl);
  Object.defineProperty(scrollEl, "scrollHeight", {
    value: metrics.scrollHeight,
    configurable: true,
  });
  Object.defineProperty(scrollEl, "clientHeight", {
    value: metrics.clientHeight,
    configurable: true,
  });
  Object.defineProperty(scrollEl, "scrollTop", {
    value: metrics.scrollTop,
    configurable: true,
    writable: true,
  });
  render(children, { container: scrollEl });
  return scrollEl;
}

describe("StickyActionFooter", () => {
  it("[M3.3] renders its children, pinned below sm and back in normal flow at sm and up", () => {
    render(
      <StickyActionFooter>
        <button type="button">Confirm and start</button>
      </StickyActionFooter>,
    );

    expect(screen.getByRole("button", { name: "Confirm and start" })).toBeInTheDocument();
    const footer = screen.getByTestId("provisioning-sticky-footer");
    expect(footer).toHaveClass("sticky");
    expect(footer).toHaveClass("bottom-0");
    expect(footer).toHaveClass("sm:static");
  });

  // @rule M3.5 — the background and the top border are the baseline, present regardless of scroll
  // position: the footer must stay opaque, since it visually floats over content that scrolls
  // underneath it whenever it is genuinely stuck.
  it("[M3.5] always carries a background and a top border", () => {
    render(<StickyActionFooter>content</StickyActionFooter>);

    const footer = screen.getByTestId("provisioning-sticky-footer");
    expect(footer).toHaveClass("bg-surface");
    expect(footer).toHaveClass("border-t");
    expect(footer).toHaveClass("border-border");
  });

  // @rule M3.6, live since POO-1523 landed `viewportFit: "cover"` (PR #854): the inset is real on
  // notched iOS now, and the class belongs on the footer because that is whose background must
  // reach the notch.
  it("[M3.6] reserves the bottom safe-area inset on itself, not the sheet root", () => {
    render(<StickyActionFooter>content</StickyActionFooter>);

    expect(screen.getByTestId("provisioning-sticky-footer")).toHaveClass(
      "pb-[max(1rem,env(safe-area-inset-bottom))]",
    );
  });

  it("[M3.5] carries no shadow while the scroll container has nothing left below the fold", () => {
    const scrollEl = renderInScrollContainer(<StickyActionFooter>content</StickyActionFooter>, {
      scrollHeight: 500,
      clientHeight: 500,
      scrollTop: 0,
    });

    expect(screen.getByTestId("provisioning-sticky-footer")).toHaveAttribute("data-stuck", "false");
    scrollEl.remove();
  });

  it("[M3.5] shows the shadow while content remains below the fold, and clears it once scrolled to the end", () => {
    const scrollEl = renderInScrollContainer(<StickyActionFooter>content</StickyActionFooter>, {
      scrollHeight: 1000,
      clientHeight: 500,
      scrollTop: 0,
    });
    const footer = screen.getByTestId("provisioning-sticky-footer");
    expect(footer).toHaveAttribute("data-stuck", "true");
    expect(footer.className).toMatch(/shadow-/);

    act(() => {
      Object.defineProperty(scrollEl, "scrollTop", { value: 500, configurable: true });
      scrollEl.dispatchEvent(new Event("scroll"));
    });

    expect(footer).toHaveAttribute("data-stuck", "false");
    scrollEl.remove();
  });

  it("merges a caller-supplied className rather than replacing the built-in ones", () => {
    render(<StickyActionFooter className="mt-2">content</StickyActionFooter>);

    const footer = screen.getByTestId("provisioning-sticky-footer");
    expect(footer).toHaveClass("mt-2");
    expect(footer).toHaveClass("sticky");
  });
});
