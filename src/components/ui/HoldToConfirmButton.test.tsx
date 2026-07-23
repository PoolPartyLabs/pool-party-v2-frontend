/**
 * @id PP-CORE-CMP-061
 * @name HoldToConfirmButton — tests
 * Behavior: a deliberate press-and-hold gate. onComplete fires only after the full hold duration;
 * releasing (or leaving) before completion resets and never fires; a fresh hold works afterwards;
 * keyboard hold (Space/Enter) mirrors pointer and ignores key-repeat; disabled is inert.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoldToConfirmButton } from "./HoldToConfirmButton";

describe("HoldToConfirmButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("fires onComplete only after the full hold duration", () => {
    const onComplete = vi.fn();
    render(
      <HoldToConfirmButton label="Hold to reveal" durationMs={3000} onComplete={onComplete} />,
    );
    const btn = screen.getByRole("button", { name: "Hold to reveal" });

    fireEvent.pointerDown(btn);
    vi.advanceTimersByTime(2999);
    expect(onComplete).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("resets and never fires when released before completion", () => {
    const onComplete = vi.fn();
    render(<HoldToConfirmButton label="Hold" durationMs={3000} onComplete={onComplete} />);
    const btn = screen.getByRole("button");

    fireEvent.pointerDown(btn);
    vi.advanceTimersByTime(1500);
    fireEvent.pointerUp(btn);
    vi.advanceTimersByTime(5000);

    expect(onComplete).not.toHaveBeenCalled();
  });

  it("resets when the pointer leaves mid-hold", () => {
    const onComplete = vi.fn();
    render(<HoldToConfirmButton label="Hold" durationMs={3000} onComplete={onComplete} />);
    const btn = screen.getByRole("button");

    fireEvent.pointerDown(btn);
    vi.advanceTimersByTime(1000);
    fireEvent.pointerLeave(btn);
    vi.advanceTimersByTime(5000);

    expect(onComplete).not.toHaveBeenCalled();
  });

  it("supports a fresh, full hold after an early release", () => {
    const onComplete = vi.fn();
    render(<HoldToConfirmButton label="Hold" durationMs={3000} onComplete={onComplete} />);
    const btn = screen.getByRole("button");

    fireEvent.pointerDown(btn);
    vi.advanceTimersByTime(1000);
    fireEvent.pointerUp(btn);

    fireEvent.pointerDown(btn);
    vi.advanceTimersByTime(3000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("holds via keyboard (Space) and resets on key up", () => {
    const onComplete = vi.fn();
    render(<HoldToConfirmButton label="Hold" durationMs={3000} onComplete={onComplete} />);
    const btn = screen.getByRole("button");

    fireEvent.keyDown(btn, { key: " " });
    vi.advanceTimersByTime(1000);
    fireEvent.keyUp(btn, { key: " " });
    vi.advanceTimersByTime(5000);
    expect(onComplete).not.toHaveBeenCalled();

    fireEvent.keyDown(btn, { key: " " });
    vi.advanceTimersByTime(3000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("does not restart the timer on key repeat", () => {
    const onComplete = vi.fn();
    render(<HoldToConfirmButton label="Hold" durationMs={3000} onComplete={onComplete} />);
    const btn = screen.getByRole("button");

    fireEvent.keyDown(btn, { key: " " });
    vi.advanceTimersByTime(2000);
    // Auto-repeat keydown while already holding must not reset the countdown.
    fireEvent.keyDown(btn, { key: " ", repeat: true });
    vi.advanceTimersByTime(1000);

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("is inert when disabled", () => {
    const onComplete = vi.fn();
    render(<HoldToConfirmButton label="Hold" durationMs={3000} onComplete={onComplete} disabled />);
    const btn = screen.getByRole("button");

    fireEvent.pointerDown(btn);
    vi.advanceTimersByTime(5000);
    expect(onComplete).not.toHaveBeenCalled();
    expect(btn).toBeDisabled();
  });

  it("cancels an in-flight hold when it becomes disabled mid-press", () => {
    const onComplete = vi.fn();
    const { rerender } = render(
      <HoldToConfirmButton label="Hold" durationMs={3000} onComplete={onComplete} />,
    );
    const btn = screen.getByRole("button");

    fireEvent.pointerDown(btn);
    vi.advanceTimersByTime(1000);
    // The control is disabled while a hold is already running.
    rerender(
      <HoldToConfirmButton label="Hold" durationMs={3000} onComplete={onComplete} disabled />,
    );
    vi.advanceTimersByTime(5000);

    expect(onComplete).not.toHaveBeenCalled();
  });
});
