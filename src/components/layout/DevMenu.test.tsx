/**
 * @id PP-CORE-CMP-024
 * @name DevMenu — tests (feature-flags panel)
 *
 * Behaviour: the Dev menu exposes a live feature-flag panel — toggling a flag flips its switch and
 * surfaces an "override" tag + a Reset control, and Reset restores the env defaults. (The
 * Manager-mode toggle and the modal-state testers are exercised via AppShell.test.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDevOverridesForTests } from "@/lib/features/devOverrides";
import { renderWithProviders, screen, userEvent } from "../../../tests/utils/renderWithProviders";
import { DevMenu } from "./DevMenu";

describe("DevMenu — feature flags panel", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetDevOverridesForTests();
  });
  afterEach(() => {
    localStorage.clear();
    __resetDevOverridesForTests();
  });

  async function openMenu() {
    renderWithProviders(<DevMenu managerMode={false} onManagerModeChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { expanded: false }));
  }

  it("toggles a feature flag live and exposes an override + Reset", async () => {
    await openMenu();
    expect(screen.getByText("Feature flags")).toBeInTheDocument();

    const cards = screen.getByRole("switch", { name: "Cards feature flag" });
    expect(cards).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();

    await userEvent.click(cards);

    expect(screen.getByRole("switch", { name: "Cards feature flag" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("override")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
  });

  it("Reset clears overrides back to the env defaults", async () => {
    await openMenu();
    await userEvent.click(screen.getByRole("switch", { name: "Cards feature flag" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(screen.getByRole("switch", { name: "Cards feature flag" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});
