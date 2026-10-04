/**
 * @id PP-MGR-CMP-064
 * @name AllocationSlider tests
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, a presentational control under test
 *
 * The Allocation field (handoff P8, P9): stops every 5 and at a ceiling that is not a multiple of
 * 5, the keyboard, the ceiling drawn (its tick, the dimmed part), the reason sentence only at the
 * ceiling, its link only for a mandate cap, and `onReachCeiling` only on the way up.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AllocationSlider, stepDown, stepUp, stopAt } from "./AllocationSlider";

const COPY = { label: "Allocation", help: "Of the strategy's capital.", helpLabel: "More about" };

function Controlled(props: {
  start: number;
  ceiling: number;
  sentence?: string | null;
  link?: { prompt: string; label: string; onClick(): void } | null;
  onReachCeiling?(): void;
}) {
  const [value, setValue] = useState(props.start);
  return (
    <AllocationSlider
      value={value}
      ceiling={props.ceiling}
      onChange={setValue}
      onReachCeiling={props.onReachCeiling}
      copy={COPY}
      ceilingSentence={props.sentence ?? null}
      ceilingLink={props.link ?? null}
    />
  );
}

describe("allocation stops (P8, P9)", () => {
  it("[P9] steps by 5, and a ceiling off the grid is a stop of its own", () => {
    // @rule P8
    // @rule P9
    expect(stepUp(40, 100)).toBe(45);
    expect(stepUp(45, 47)).toBe(47);
    expect(stepUp(47, 47)).toBe(47);
    expect(stepDown(47, 47)).toBe(45);
    expect(stepDown(45, 47)).toBe(40);
    expect(stepDown(0, 47)).toBe(0);
    // A value above a ceiling that moved under it comes down to the ceiling first.
    expect(stepDown(60, 47)).toBe(47);
    expect(stopAt(48.9, 100)).toBe(50);
    expect(stopAt(90, 47)).toBe(47);
    expect(stopAt(-5, 47)).toBe(0);
  });
});

describe("AllocationSlider (P8, P9)", () => {
  it("[P9] is a slider named by its label, moved one step by the arrows", async () => {
    // @rule P9
    render(<Controlled start={40} ceiling={100} />);
    const slider = screen.getByRole("slider", { name: "Allocation" });
    expect(slider).toHaveAttribute("aria-valuenow", "40");
    expect(slider).toHaveAttribute("aria-valuetext", "40%");
    slider.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(slider).toHaveAttribute("aria-valuenow", "45");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(slider).toHaveAttribute("aria-valuenow", "35");
    await userEvent.keyboard("{End}");
    expect(slider).toHaveAttribute("aria-valuenow", "100");
    await userEvent.keyboard("{Home}");
    expect(slider).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("[P9] draws 19 step ticks, and under 100 the ceiling's tick and the dimmed part", () => {
    // @rule P9
    const { container } = render(<Controlled start={40} ceiling={70} />);
    expect(container.querySelectorAll("[data-allocation-tick]")).toHaveLength(19);
    expect(container.querySelector("[data-allocation-ceiling]")).toHaveAttribute(
      "data-allocation-ceiling",
      "70",
    );
    expect(container.querySelector("[data-allocation-dimmed]")).not.toBeNull();
    const beyond = container.querySelector('[data-allocation-tick="75"]');
    expect(beyond?.className).toMatch(/opacity-50/);
    const within = container.querySelector('[data-allocation-tick="65"]');
    expect(within?.className).not.toMatch(/opacity-50/);
  });

  it("[P8] draws no ceiling at 100", () => {
    // @rule P8
    const { container } = render(<Controlled start={40} ceiling={100} />);
    expect(container.querySelector("[data-allocation-ceiling]")).toBeNull();
    expect(container.querySelector("[data-allocation-dimmed]")).toBeNull();
  });

  it("[P8, P4] never passes the ceiling, says why at it, and links a mandate cap to Limits", async () => {
    // @rule P8
    // @rule P4
    const onClick = vi.fn();
    const onReachCeiling = vi.fn();
    render(
      <Controlled
        start={60}
        ceiling={70}
        sentence="Maximum reached. Your mandate caps Uniswap v4 at 70%."
        link={{ prompt: "Need more?", label: "Edit mandate · Limits", onClick }}
        onReachCeiling={onReachCeiling}
      />,
    );
    const slider = screen.getByRole("slider", { name: "Allocation" });
    expect(screen.queryByText(/Maximum reached/)).toBeNull();
    slider.focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(slider).toHaveAttribute("aria-valuenow", "70");
    expect(onReachCeiling).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Maximum reached. Your mandate caps Uniswap v4 at 70%."),
    ).toBeInTheDocument();
    expect(screen.getByText("Need more?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit mandate · Limits" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("[P8] the strategy's room has no link", async () => {
    // @rule P8
    render(
      <Controlled
        start={45}
        ceiling={45}
        sentence="Maximum reached. The other blocks under Idle input already take 55%."
      />,
    );
    expect(
      screen.getByText("Maximum reached. The other blocks under Idle input already take 55%."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit mandate/ })).toBeNull();
  });

  it("[P8] a ceiling off the grid is reached with the arrows, and its stop is kept", async () => {
    // @rule P8
    render(<Controlled start={40} ceiling={47} />);
    const slider = screen.getByRole("slider", { name: "Allocation" });
    slider.focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(slider).toHaveAttribute("aria-valuenow", "47");
    await userEvent.keyboard("{ArrowLeft}");
    expect(slider).toHaveAttribute("aria-valuenow", "45");
  });

  it("[L4] a right click does not move it, and reaching the ceiling twice before a render reports once", () => {
    // @rule P9
    const onReachCeiling = vi.fn();
    const onChange = vi.fn();
    render(
      <AllocationSlider
        value={40}
        ceiling={70}
        onChange={onChange}
        onReachCeiling={onReachCeiling}
        copy={COPY}
        ceilingSentence={null}
        ceilingLink={null}
      />,
    );
    const slider = screen.getByRole("slider", { name: "Allocation" });
    slider.getBoundingClientRect = () =>
      ({ left: 0, width: 200, top: 0, height: 14, right: 200, bottom: 14 }) as DOMRect;
    fireEvent.pointerDown(slider, { pointerId: 1, button: 2, clientX: 120 });
    expect(onChange).not.toHaveBeenCalled();
    // The value prop never changes here: two moves to the ceiling before any render.
    fireEvent.pointerDown(slider, { pointerId: 1, button: 0, clientX: 150 });
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 190 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onReachCeiling).toHaveBeenCalledTimes(1);
  });

  it("[P9] a press on the track lands on the nearest stop, never past the ceiling", () => {
    // @rule P9
    render(<Controlled start={0} ceiling={70} />);
    const slider = screen.getByRole("slider", { name: "Allocation" });
    slider.getBoundingClientRect = () =>
      ({ left: 0, width: 200, top: 0, height: 14, right: 200, bottom: 14 }) as DOMRect;
    fireEvent.pointerDown(slider, { pointerId: 1, clientX: 61 });
    expect(slider).toHaveAttribute("aria-valuenow", "30");
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 190 });
    expect(slider).toHaveAttribute("aria-valuenow", "70");
    fireEvent.pointerUp(slider, { pointerId: 1, clientX: 190 });
  });
});
