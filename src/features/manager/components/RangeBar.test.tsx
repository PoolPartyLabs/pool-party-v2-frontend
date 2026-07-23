/**
 * @id PP-MGR-CMP-024
 * @name RangeBar.test
 * Behavior: one active band + needle by default; an extra dimmer band when a prev range is given;
 * warning treatment when the current price is out of the active range.
 */
import { describe, expect, it } from "vitest";
import { renderWithProviders, screen } from "../../../../tests/utils/renderWithProviders";
import { RangeBar } from "./RangeBar";

describe("RangeBar", () => {
  it("renders the active band + needle (no prev range)", () => {
    renderWithProviders(<RangeBar min={90} max={110} current={100} inRange />);
    const bar = screen.getByTestId("range-bar");
    expect(bar.children).toHaveLength(2); // active band + needle, no prev band
    expect(bar.firstElementChild?.className).toContain("bg-success/30");
  });

  it("adds a dimmer prev band when prevMin/prevMax are given", () => {
    renderWithProviders(
      <RangeBar min={95} max={105} current={100} inRange prevMin={80} prevMax={120} />,
    );
    const bar = screen.getByTestId("range-bar");
    expect(bar.children).toHaveLength(3); // prev band + active band + needle
    expect(bar.firstElementChild?.className).toContain("bg-muted-foreground/20");
  });

  it("uses the warning treatment when the current price is out of range", () => {
    renderWithProviders(<RangeBar min={90} max={110} current={130} inRange={false} />);
    const bar = screen.getByTestId("range-bar");
    expect(bar.firstElementChild?.className).toContain("bg-warning/30");
  });
});
