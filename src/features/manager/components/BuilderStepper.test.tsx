/**
 * @name BuilderStepper.test
 * Behavior (POO-335): completed (earlier) steps are clickable to navigate back; the active step
 * and not-yet-reached steps are not interactive — forward jumps stay gated behind each step's Next.
 */
import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { BuilderStepper } from "./BuilderStepper";

describe("BuilderStepper", () => {
  it("makes completed steps clickable and reports the target (back-navigation)", async () => {
    const user = userEvent.setup();
    const onStepClick = vi.fn();
    renderWithProviders(<BuilderStepper active="review" onStepClick={onStepClick} />);
    // On Review, the two earlier steps are buttons; the active step is not.
    await user.click(screen.getByRole("button", { name: "Mandate" }));
    expect(onStepClick).toHaveBeenLastCalledWith("mandate");
    await user.click(screen.getByRole("button", { name: "Build" }));
    expect(onStepClick).toHaveBeenLastCalledWith("build");
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
  });

  it("exposes no clickable steps on the first step (nothing earlier to go back to)", () => {
    renderWithProviders(<BuilderStepper active="mandate" onStepClick={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is inert when no onStepClick is provided", () => {
    renderWithProviders(<BuilderStepper active="review" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
