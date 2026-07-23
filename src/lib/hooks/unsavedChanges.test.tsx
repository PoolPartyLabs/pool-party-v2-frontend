/**
 * @id PP-CORE-LIB-039 (POO-751)
 * @name unsavedChanges — tests
 *
 * The navigation guard: `guard` runs the navigation immediately when nothing is dirty ([R1]); when a
 * form registered a dirty flag it opens the confirm modal — Keep editing cancels, Leave proceeds. The
 * `beforeunload` native prompt is armed only while dirty ([R2]).
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { UnsavedChangesProvider, useNavigationGuard, useUnsavedChanges } from "./unsavedChanges";

/** A tiny consumer: registers `dirty` and exposes a guarded "go" navigation. */
function Harness({ dirty, onProceed }: { dirty: boolean; onProceed: () => void }) {
  useUnsavedChanges(dirty);
  const guard = useNavigationGuard();
  return (
    <button type="button" onClick={() => guard(onProceed)}>
      go
    </button>
  );
}

function renderHarness(dirty: boolean, onProceed: () => void) {
  return renderWithProviders(
    <UnsavedChangesProvider>
      <Harness dirty={dirty} onProceed={onProceed} />
    </UnsavedChangesProvider>,
  );
}

describe("UnsavedChangesProvider (POO-751)", () => {
  it("[R1] runs the navigation immediately when nothing is dirty", async () => {
    const user = userEvent.setup();
    const proceed = vi.fn();
    renderHarness(false, proceed);
    await user.click(screen.getByRole("button", { name: "go" }));
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("[R1] opens the confirm modal when dirty and Keep editing cancels (no navigation)", async () => {
    const user = userEvent.setup();
    const proceed = vi.fn();
    renderHarness(true, proceed);
    await user.click(screen.getByRole("button", { name: "go" }));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(proceed).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(proceed).not.toHaveBeenCalled();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("[R1] runs the navigation on Leave and closes the modal", async () => {
    const user = userEvent.setup();
    const proceed = vi.fn();
    renderHarness(true, proceed);
    await user.click(screen.getByRole("button", { name: "go" }));
    await user.click(screen.getByRole("button", { name: "Leave" }));
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("[R2] arms the native beforeunload prompt while dirty", () => {
    renderHarness(true, () => {});
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("[R2] does not arm beforeunload when clean", () => {
    renderHarness(false, () => {});
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
