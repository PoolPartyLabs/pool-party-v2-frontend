import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type ChartPoint, PerformanceChart } from "./PerformanceChart";

const series: ChartPoint[] = [
  { value: 100, label: "Mon", display: "$100" },
  { value: 140, label: "Tue", display: "$140" },
  { value: 120, label: "Wed", display: "$120" },
];

describe("PerformanceChart", () => {
  it("renders an accessible svg with line + area paths", () => {
    const { container } = render(<PerformanceChart data={series} ariaLabel="Portfolio value" />);
    expect(screen.getByRole("img", { name: "Portfolio value" })).toBeInTheDocument();
    expect(container.querySelectorAll("path")).toHaveLength(2);
  });

  it("renders nothing for a degenerate series", () => {
    const { container } = render(<PerformanceChart data={[{ value: 100, label: "Mon" }]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("centers a flat series instead of gluing it to the bottom (POO-323)", () => {
    const flat: ChartPoint[] = [
      { value: 50, label: "Mon" },
      { value: 50, label: "Tue" },
      { value: 50, label: "Wed" },
    ];
    const { container } = render(<PerformanceChart data={flat} ariaLabel="x" />);
    // [0] = area fill, [1] = the value line. Every plotted y should be the vertical center
    // (80 in the 160-tall viewBox), not the bottom (~156) as before the domain-padding fix.
    const line = container.querySelectorAll("path")[1] as SVGPathElement;
    const ys = [...(line.getAttribute("d") ?? "").matchAll(/[ML]\s*[\d.]+,([\d.]+)/g)].map((m) =>
      Number(m[1]),
    );
    expect(ys.length).toBe(3);
    for (const y of ys) expect(y).toBeCloseTo(80, 1);
  });

  it("shows a tooltip with the hovered point's label and value, and clears on leave", () => {
    const { container } = render(<PerformanceChart data={series} ariaLabel="x" />);
    const wrap = container.firstChild as HTMLElement;
    // jsdom has no layout, so stub the box the pointer maths reads.
    vi.spyOn(wrap, "getBoundingClientRect").mockReturnValue({
      width: 300,
      height: 160,
      left: 0,
      top: 0,
      right: 300,
      bottom: 160,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    // Far right of the 300px-wide box → the last point ("Wed" / $120).
    fireEvent.pointerMove(wrap, { clientX: 300 });
    expect(screen.getByText("Wed")).toBeInTheDocument();
    expect(screen.getByText("$120")).toBeInTheDocument();

    fireEvent.pointerLeave(wrap);
    expect(screen.queryByText("Wed")).not.toBeInTheDocument();
  });
});
