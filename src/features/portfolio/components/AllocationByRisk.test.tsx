import { describe, expect, it } from "vitest";
import { renderWithProviders, screen } from "../../../../tests/utils/renderWithProviders";
import { AllocationByRisk } from "./AllocationByRisk";

describe("AllocationByRisk", () => {
  it("renders a legend entry for every risk band with its share", () => {
    renderWithProviders(
      <AllocationByRisk
        allocation={[
          { level: 2, value: 50 },
          { level: 3, value: 30 },
          { level: 4, value: 20 },
        ]}
      />,
    );
    // POO-555 R7: the aria-label is translated (portfolio.allocationByRisk), not hardcoded English.
    expect(screen.getByRole("img", { name: "Allocation by risk" })).toBeInTheDocument();
    expect(screen.getByText("Very conservative")).toBeInTheDocument();
    expect(screen.getByText("Conservative")).toBeInTheDocument();
    expect(screen.getByText("Moderate")).toBeInTheDocument();
    expect(screen.getByText("Aggressive")).toBeInTheDocument();
    expect(screen.getByText("Very aggressive")).toBeInTheDocument();
    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText("30.0%")).toBeInTheDocument();
    expect(screen.getByText("20.0%")).toBeInTheDocument();
  });

  it("renders absent and zero-value bands at 0%", () => {
    renderWithProviders(
      <AllocationByRisk
        allocation={[
          { level: 1, value: 0 },
          { level: 3, value: 100 },
        ]}
      />,
    );
    // Levels 1 (explicit zero), 2, 4 and 5 (absent) all render at 0%.
    expect(screen.getByText("Very conservative")).toBeInTheDocument();
    expect(screen.getByText("Very aggressive")).toBeInTheDocument();
    expect(screen.getByText("100.0%")).toBeInTheDocument();
    expect(screen.getAllByText("0.0%")).toHaveLength(4);
  });

  it("renders all five bands at 0% for an empty portfolio", () => {
    renderWithProviders(<AllocationByRisk allocation={[]} />);
    expect(screen.getAllByText("0.0%")).toHaveLength(5);
  });
});
