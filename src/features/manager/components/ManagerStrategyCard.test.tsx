/**
 * @id PP-MGR-CMP-015 (POO-559)
 * @name ManagerStrategyCard tests
 * @implements-rules-version v1
 *
 * The card's spark + 30d-fee rendering under POO-559:
 * - [R2] a not-measured spark (uncovered / <2-point pool) hides the Sparkline rather than drawing a
 *   flat 2-point line the viewer would read as a real zero-movement 30d trend; a measured spark shows.
 * - [R4] fees30d is a mock placeholder (no windowable source yet, POO-369), so a $0 figure renders as
 *   a neutral dash, never an affirmative measured "$0.00".
 * - [R5] the shown spark's tone follows the real first-vs-last direction.
 */
import { describe, expect, it, vi } from "vitest";
import type { ManagerStrategy } from "@/lib/schemas";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { ManagerStrategyCard } from "./ManagerStrategyCard";

function strategy(over: Partial<ManagerStrategy> = {}): ManagerStrategy {
  return {
    id: "s1",
    name: "Stable Yield",
    initials: "SY",
    riskLevel: 2,
    category: "Stablecoin yield",
    aum: 120_000,
    investors: 42,
    flows30d: 0,
    apy: 8.4,
    fees30d: 1840,
    spark: [100, 110, 120],
    inRange: true,
    status: "active",
    ...over,
  };
}

/** The Sparkline is the only aria-hidden svg carrying a polyline. */
function sparklineSvg(container: HTMLElement): SVGSVGElement | null {
  return container.querySelector("svg[aria-hidden='true'] polyline")?.closest("svg") ?? null;
}

describe("ManagerStrategyCard", () => {
  // @rule R2
  it("[R2] hides the sparkline when the spark is a not-measured placeholder", () => {
    const { container } = renderWithProviders(
      <ManagerStrategyCard
        strategy={strategy({ spark: [120_000, 120_000], sparkMeasured: false })}
        onManage={vi.fn()}
      />,
    );
    expect(sparklineSvg(container)).toBeNull();
  });

  // @rule R2
  it("[R2] shows the sparkline when the spark is a real measured series", () => {
    const { container } = renderWithProviders(
      <ManagerStrategyCard
        strategy={strategy({ spark: [100, 130, 160], sparkMeasured: true })}
        onManage={vi.fn()}
      />,
    );
    expect(sparklineSvg(container)).not.toBeNull();
  });

  // @rule R2
  it("[R2] shows the sparkline for a mock row (sparkMeasured absent = measured)", () => {
    // Mock rows carry real spark shapes without the flag; absent must not be treated as not-measured.
    const { container } = renderWithProviders(
      <ManagerStrategyCard strategy={strategy({ spark: [10, 12, 15] })} onManage={vi.fn()} />,
    );
    expect(sparklineSvg(container)).not.toBeNull();
  });

  // @rule R4
  it("[R4] renders a $0 30d-fee placeholder as a neutral dash, not an affirmative $0.00", () => {
    renderWithProviders(
      <ManagerStrategyCard strategy={strategy({ fees30d: 0 })} onManage={vi.fn()} />,
    );
    expect(screen.getByText("Fees · 30d")).toBeInTheDocument();
    // The placeholder reads as "no measured figure", never a measured zero.
    expect(screen.queryByText("$0.00")).toBeNull();
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  // @rule R4
  it("[R4] renders a real non-zero 30d fee as money (unchanged)", () => {
    renderWithProviders(
      <ManagerStrategyCard strategy={strategy({ fees30d: 1840 })} onManage={vi.fn()} />,
    );
    expect(screen.getByText("$1,840.00")).toBeInTheDocument();
  });

  // @rule R5
  it("[R5] tints a rising measured spark up (success)", () => {
    const { container } = renderWithProviders(
      <ManagerStrategyCard
        strategy={strategy({ spark: [100, 140, 180], sparkMeasured: true })}
        onManage={vi.fn()}
      />,
    );
    expect(sparklineSvg(container)?.getAttribute("class")).toContain("text-success");
  });

  // @rule R5
  it("[R5] tints a falling measured spark down (destructive)", () => {
    const { container } = renderWithProviders(
      <ManagerStrategyCard
        strategy={strategy({ spark: [180, 140, 100], sparkMeasured: true })}
        onManage={vi.fn()}
      />,
    );
    expect(sparklineSvg(container)?.getAttribute("class")).toContain("text-destructive");
  });

  // @rule POO-753 R2: a CLOSED strategy opens read-only — its whole card is clickable and the action
  // reads "View" (not "Manage").
  it("[R2 POO-753] opens a closed strategy from a whole-card click and labels the action 'View'", async () => {
    const user = userEvent.setup();
    const onManage = vi.fn();
    const { container } = renderWithProviders(
      <ManagerStrategyCard
        strategy={strategy({ id: "closed-1", status: "closed" })}
        onManage={onManage}
      />,
    );
    expect(screen.getByRole("button", { name: "View" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage" })).toBeNull();
    // Clicking anywhere on the card opens the read-only detail.
    await user.click(container.querySelector("article") as HTMLElement);
    expect(onManage).toHaveBeenCalledWith("closed-1");
  });

  // @rule POO-753 R2: clicking the View button opens ONCE (stopPropagation prevents the card
  // onClick from also firing).
  it("[R2 POO-753] opens once when the View button is clicked (no double-fire)", async () => {
    const user = userEvent.setup();
    const onManage = vi.fn();
    renderWithProviders(
      <ManagerStrategyCard
        strategy={strategy({ id: "closed-1", status: "closed" })}
        onManage={onManage}
      />,
    );
    await user.click(screen.getByRole("button", { name: "View" }));
    expect(onManage).toHaveBeenCalledTimes(1);
    expect(onManage).toHaveBeenCalledWith("closed-1");
  });

  // @rule POO-753 R2: clicking an interactive descendant (the APY tooltip trigger) on a closed card
  // does its own thing and must NOT trigger the whole-card navigation.
  it("[R2 POO-753] clicking the APY tooltip on a closed card does not navigate", async () => {
    const user = userEvent.setup();
    const onManage = vi.fn();
    renderWithProviders(
      <ManagerStrategyCard
        strategy={strategy({ id: "closed-1", status: "closed" })}
        onManage={onManage}
      />,
    );
    const tooltipTrigger = screen.getByText("Net APR").closest("button") as HTMLElement;
    await user.click(tooltipTrigger);
    expect(onManage).not.toHaveBeenCalled();
  });

  // @rule POO-753 R2: an active/paused card keeps "Manage" and is NOT clickable outside its button.
  it("[R2 POO-753] an active card keeps 'Manage' and only opens from its button", async () => {
    const user = userEvent.setup();
    const onManage = vi.fn();
    const { container } = renderWithProviders(
      <ManagerStrategyCard
        strategy={strategy({ id: "active-1", status: "active" })}
        onManage={onManage}
      />,
    );
    expect(screen.getByRole("button", { name: "Manage" })).toBeInTheDocument();
    // A click on the card body (not the button) does nothing for a non-closed card.
    await user.click(container.querySelector("article") as HTMLElement);
    expect(onManage).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Manage" }));
    expect(onManage).toHaveBeenCalledWith("active-1");
  });
});
