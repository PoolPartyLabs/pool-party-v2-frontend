/**
 * @id PP-MGR-CMP-071
 * @name RangeSplitBar tests
 * @implements-rules-version v1 (POO-2284; extends POO-2189)
 * @analytics-events none (the panel shell emits)
 */
import { describe, expect, it } from "vitest";
import { PANEL_POOL_FIXTURES } from "@/mocks/data/buildPanelFixtures";
import { renderWithProviders, screen } from "../../../../../../tests/utils/renderWithProviders";
import { toPanelPoolView } from "./panelCatalogView";
import { RangeSplitBar } from "./RangeSplitBar";

const fixture = PANEL_POOL_FIXTURES[0];
if (!fixture) throw new Error("Pool fixture required");
const pool = toPanelPoolView(fixture.pool);
const split = { pct0: 72, pct1: 28, basePct: 72, quotePct: 28 };

describe("RangeSplitBar", () => {
  // @rule R4: Figma's selected band stays at 20-80% of the available track width.
  it("uses a flexible track and proportional bounds instead of a fixed 200px bar (POO-2284)", () => {
    const { container } = renderWithProviders(
      <RangeSplitBar
        base={pool.token0}
        quote={pool.token1}
        split={split}
        marker={{ position: 0.25, ratio: 0.25 }}
        fullRange={false}
      />,
    );
    const marker = container.querySelector("[data-range-marker]");
    expect(marker).toHaveStyle({ left: "35%" });
    expect(marker?.parentElement).toHaveClass("min-w-0", "flex-1");
    expect(marker?.parentElement?.querySelector(".bg-primary")).toHaveStyle({
      left: "20%",
      width: "60%",
    });
    expect(screen.getByText("72%")).toBeInTheDocument();
    expect(screen.getByText("28%")).toBeInTheDocument();
  });
  // @rule R4: the unclamped ratio lets the marker leave the band, stopping only at track ends.
  it.each([
    [-1, "0%"],
    [-0.1, "14%"],
    [0, "20%"],
    [0.5, "50%"],
    [1, "80%"],
    [1.1, "86%"],
    [2, "100%"],
  ])("places ratio %s at %s while retaining the token split (POO-2284)", (ratio, left) => {
    const { container } = renderWithProviders(
      <RangeSplitBar
        base={pool.token0}
        quote={pool.token1}
        split={split}
        marker={{ position: Math.min(1, Math.max(0, Number(ratio))), ratio: Number(ratio) }}
        fullRange={false}
      />,
    );
    expect(container.querySelector("[data-range-marker]")).toHaveStyle({ left });
    expect(screen.getByText("72%")).toBeInTheDocument();
  });
  // @rule R4/R5: Full paints the complete track with a centered marker.
  it("fills and centers the Full range at every track width (POO-2284)", () => {
    const { container } = renderWithProviders(
      <RangeSplitBar
        base={pool.token0}
        quote={pool.token1}
        split={{ pct0: 50, pct1: 50, basePct: 50, quotePct: 50 }}
        marker={{ position: 0.5, ratio: 0.5 }}
        fullRange
      />,
    );
    const marker = container.querySelector("[data-range-marker]");
    expect(marker).toHaveStyle({ left: "50%" });
    expect(marker?.parentElement?.querySelector(".bg-primary")).toHaveStyle({
      left: "0%",
      width: "100%",
    });
  });
});
