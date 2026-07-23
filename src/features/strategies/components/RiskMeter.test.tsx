import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RiskMeter } from "./RiskMeter";

describe("RiskMeter", () => {
  it("labels the risk level for assistive tech", () => {
    render(<RiskMeter level={3} />);
    expect(screen.getByRole("img", { name: "Risk level 3 of 5" })).toBeInTheDocument();
  });

  it("fills exactly `level` of the five segments", () => {
    render(<RiskMeter level={2} />);
    const meter = screen.getByRole("img", { name: /risk level 2/i });
    const filled = meter.querySelectorAll(".bg-risk-2");
    expect(filled).toHaveLength(2);
  });
});
