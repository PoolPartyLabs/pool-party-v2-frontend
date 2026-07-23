/**
 * @id PP-DASH-CMP-005
 * @name EarningSteps.test
 * @implements-rules-version v2
 * Behavioral specs for the EarningSteps tracker: every step's copy renders, a done step shows a
 * check instead of its number, active/upcoming steps show their number, and the heading is optional
 * [R8/R9].
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type EarningStep, EarningSteps } from "./EarningSteps";

const steps: EarningStep[] = [
  { number: 1, state: "done", title: "Add funds", body: "Done · $1,250 added" },
  { number: 2, state: "active", title: "Pick a strategy", body: "Curated and risk-rated for you" },
  { number: 3, state: "upcoming", title: "Earn", body: "Track your yield every day" },
];

describe("EarningSteps", () => {
  it("renders every step's title and body", () => {
    render(<EarningSteps steps={steps} />);
    for (const step of steps) {
      expect(screen.getByText(step.title)).toBeInTheDocument();
      expect(screen.getByText(step.body)).toBeInTheDocument();
    }
  });

  it("marks a done step with a check icon instead of its number", () => {
    render(<EarningSteps steps={steps} />);
    const [firstItem] = screen.getAllByRole("listitem");
    if (!firstItem) throw new Error("expected at least one step");
    // The done step swaps its digit for a check (svg).
    expect(within(firstItem).queryByText("1")).toBeNull();
    expect(firstItem.querySelector("svg")).not.toBeNull();
  });

  it("shows the number for active and upcoming steps", () => {
    render(<EarningSteps steps={steps} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders the optional heading when provided", () => {
    render(<EarningSteps steps={steps} heading="Your path to earning" />);
    expect(screen.getByText("Your path to earning")).toBeInTheDocument();
  });

  it("omits the heading when not provided", () => {
    render(<EarningSteps steps={steps} />);
    expect(screen.queryByText("Your path to earning")).toBeNull();
  });
});
