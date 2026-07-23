/**
 * @id PP-CORE-HOK-013
 * @name maskValue tests
 * @implements-rules-version v1
 *
 * The ephemeral provider (manager) starts masked and never persists; the persisted provider
 * (portfolio/home) starts visible, toggles, and remembers the choice in localStorage. With no
 * provider, values stay visible and toggle is a safe no-op.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EphemeralMaskProvider, PersistedMaskProvider, useMaskValue } from "./maskValue";

const KEY = "pp.test.hideValues";

function Probe() {
  const { masked, toggle } = useMaskValue();
  return (
    <div>
      <span data-testid="state">{masked ? "masked" : "visible"}</span>
      <button type="button" onClick={toggle}>
        toggle
      </button>
    </div>
  );
}

afterEach(() => {
  window.localStorage.clear();
});

describe("useMaskValue", () => {
  it("defaults to visible with a no-op toggle when no provider is present", () => {
    render(<Probe />);
    expect(screen.getByTestId("state")).toHaveTextContent("visible");
    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("state")).toHaveTextContent("visible");
  });
});

describe("EphemeralMaskProvider", () => {
  it("starts masked (covered by default) and toggles to visible", () => {
    render(
      <EphemeralMaskProvider>
        <Probe />
      </EphemeralMaskProvider>,
    );
    expect(screen.getByTestId("state")).toHaveTextContent("masked");
    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("state")).toHaveTextContent("visible");
  });

  it("never persists its state to localStorage", () => {
    render(
      <EphemeralMaskProvider>
        <Probe />
      </EphemeralMaskProvider>,
    );
    fireEvent.click(screen.getByText("toggle"));
    expect(window.localStorage.length).toBe(0);
  });
});

describe("PersistedMaskProvider", () => {
  it("starts visible (open by default) and toggles to masked", () => {
    render(
      <PersistedMaskProvider persistKey={KEY}>
        <Probe />
      </PersistedMaskProvider>,
    );
    expect(screen.getByTestId("state")).toHaveTextContent("visible");
    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("state")).toHaveTextContent("masked");
  });

  it("persists the chosen preference under the given key", () => {
    render(
      <PersistedMaskProvider persistKey={KEY}>
        <Probe />
      </PersistedMaskProvider>,
    );
    fireEvent.click(screen.getByText("toggle"));
    expect(window.localStorage.getItem(KEY)).toBe("true");
  });

  it("restores a previously stored preference", () => {
    window.localStorage.setItem(KEY, "true");
    render(
      <PersistedMaskProvider persistKey={KEY}>
        <Probe />
      </PersistedMaskProvider>,
    );
    expect(screen.getByTestId("state")).toHaveTextContent("masked");
  });
});
