import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetricTile } from "./MetricTile";

describe("MetricTile", () => {
  it("renders the label and value", () => {
    render(<MetricTile label="Total yield" value="+$612.50" />);
    expect(screen.getByText("Total yield")).toBeInTheDocument();
    expect(screen.getByText("+$612.50")).toBeInTheDocument();
  });

  it("renders an optional delta with a tone", () => {
    render(<MetricTile label="This month" value="$120.00" delta="+3.1%" deltaTone="positive" />);
    const delta = screen.getByText("+3.1%");
    expect(delta).toBeInTheDocument();
    expect(delta).toHaveClass("text-success");
  });

  it("omits the delta line when not provided", () => {
    const { container } = render(<MetricTile label="Invested" value="$3,920.00" />);
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });

  it("tones the value when valueTone is set", () => {
    render(<MetricTile label="Total yield" value="-$50.00" valueTone="negative" />);
    expect(screen.getByText("-$50.00")).toHaveClass("text-destructive");
  });
});
