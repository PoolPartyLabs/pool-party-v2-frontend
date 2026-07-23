/**
 * @id PP-REW-CMP-010
 * @name TierProgressBar.test
 * Behavior: the marker + fill sit within the active tier's segment (POO-761 R1), the fill never
 * exceeds the marker, every tier up to the active one is highlighted (R5), and one divider per
 * inter-tier boundary is drawn (R3).
 */
import { describe, expect, it } from "vitest";
import { renderWithProviders, screen } from "../../../../tests/utils/renderWithProviders";
import { TierProgressBar } from "./TierProgressBar";

const TIERS = ["Paddler", "Swimmer", "Diver", "Wave Rider", "Party Captain"] as const;

describe("TierProgressBar", () => {
  it("positions the marker within the active tier segment — (activeIndex + progress/100) * 20", () => {
    // Swimmer (index 1) at 68% → (1 + 0.68) * 20 = 33.6% — inside the Swimmer slice, NOT at 68%.
    const { container } = renderWithProviders(
      <TierProgressBar progressPct={68} activeIndex={1} tiers={TIERS} youLabel="You" />,
    );
    const fill = container.querySelector(".from-primary") as HTMLElement;
    expect(fill).toHaveStyle({ width: "33.6%" });
    // The "You" caption sits at the marker position.
    expect(screen.getByText("You")).toHaveStyle({ left: "33.6%" });
    // The duck marker sits at the same position AND is vertically centered ON the track line (POO-761).
    const duck = container.querySelector('img[src="/brand/duck-head.png"]') as HTMLElement;
    expect(duck).toHaveStyle({ left: "33.6%" });
    expect(duck.className).toContain("top-1/2");
    expect(duck.className).toContain("-translate-y-1/2");
  });

  it("keeps the marker on the track at 0% (floor) while the fill is empty", () => {
    const { container } = renderWithProviders(
      <TierProgressBar progressPct={0} activeIndex={0} tiers={TIERS} youLabel="You" />,
    );
    expect(container.querySelector(".from-primary")).toHaveStyle({ width: "0%" });
    expect(screen.getByText("You")).toHaveStyle({ left: "5%" });
  });

  it("highlights every tier up to and including the active one", () => {
    renderWithProviders(
      <TierProgressBar progressPct={20} activeIndex={1} tiers={TIERS} youLabel="You" />,
    );
    expect(screen.getByText("Paddler").className).toContain("text-primary");
    expect(screen.getByText("Swimmer").className).toContain("text-primary");
    expect(screen.getByText("Diver").className).toContain("text-muted-foreground");
    expect(screen.getByText("Party Captain").className).toContain("text-muted-foreground");
  });

  it("draws one divider per inter-tier boundary (tiers - 1)", () => {
    const { container } = renderWithProviders(
      <TierProgressBar progressPct={10} activeIndex={2} tiers={TIERS} youLabel="You" />,
    );
    expect(container.querySelectorAll(".border-r")).toHaveLength(TIERS.length - 1);
  });
});
