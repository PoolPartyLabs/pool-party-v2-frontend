/**
 * @id PP-MGR-CMP-018
 * @name ActivityCard.test
 * Behavior: the recent-activity card lists events (type label + USD-at-time + date), shows the empty
 * state when there is none, and shows a "coming soon" body when `comingSoon` is set — real mode has
 * no activity feed yet (POO-737 R2 / POO-380), so the parent flags it there.
 */
import { describe, expect, it } from "vitest";
import type { ManagerActivityEvent } from "@/lib/schemas";
import { renderWithProviders, screen } from "../../../../tests/utils/renderWithProviders";
import { ActivityCard } from "./ActivityCard";

const events: ManagerActivityEvent[] = [
  {
    id: "e1",
    type: "deposit",
    tokenAmount: 1.5,
    tokenSymbol: "ETH",
    usdValueAtTime: 4200,
    timestamp: 1719792000000,
  },
];

describe("ActivityCard", () => {
  it("renders the event list with its type label and USD-at-time", () => {
    renderWithProviders(<ActivityCard activity={events} />);
    expect(screen.getByText("Deposit")).toBeInTheDocument();
    expect(screen.getByText("$4,200.00")).toBeInTheDocument();
  });

  it("shows the empty state when there is no activity", () => {
    renderWithProviders(<ActivityCard activity={[]} />);
    expect(screen.getByText("No activity yet.")).toBeInTheDocument();
  });

  // @rule POO-737 R2: coming-soon takes precedence over both the list and the empty state, so real
  // mode never shows a misleading "No activity yet." while the feed does not exist.
  it("shows a 'coming soon' body when comingSoon is set, even with events present", () => {
    renderWithProviders(<ActivityCard activity={events} comingSoon />);
    expect(screen.getByText("Coming soon.")).toBeInTheDocument();
    expect(screen.queryByText("Deposit")).toBeNull();
    expect(screen.queryByText("No activity yet.")).toBeNull();
  });
});
