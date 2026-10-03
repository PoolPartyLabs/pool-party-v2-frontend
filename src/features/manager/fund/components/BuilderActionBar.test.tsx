/**
 * @id PP-MGR-CMP-040
 * @name BuilderActionBar tests
 * @implements-rules-version v1 (POO-2122 rules v1)
 * @analytics-events none, the bar reports a press and the shell decides what it meant
 *
 * [R5]: the labels name the steps either side, the first step has no Back, the last one offers the
 * next PHASE rather than the next step, and the bar is sticky so both buttons survive a long page.
 */
import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../tests/utils/renderWithProviders";
import { BuilderActionBar } from "./BuilderActionBar";

describe("BuilderActionBar", () => {
  // @rule R5
  it("[R5] names the step on either side of the current one", () => {
    renderWithProviders(
      <BuilderActionBar previous="networks" next="tokens" onBack={vi.fn()} onNext={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "Back: Networks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next: Tokens" })).toBeInTheDocument();
  });

  // @rule R5
  it("[R5] has no Back on the first step", () => {
    renderWithProviders(
      <BuilderActionBar previous={null} next="protocols" onBack={vi.fn()} onNext={vi.fn()} />,
    );

    expect(screen.queryByRole("button", { name: /^Back:/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next: Protocols" })).toBeInTheDocument();
  });

  // @rule R5
  it("[R5] offers the next PHASE on the last step, not a step", () => {
    renderWithProviders(
      <BuilderActionBar previous="pools" next={null} onBack={vi.fn()} onNext={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "Next: Build strategy" })).toBeInTheDocument();
  });

  // @rule R5
  it("[R5] reports both presses", async () => {
    const onBack = vi.fn();
    const onNext = vi.fn();
    renderWithProviders(
      <BuilderActionBar previous="tokens" next="limits" onBack={onBack} onNext={onNext} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Back: Tokens" }));
    await userEvent.click(screen.getByRole("button", { name: "Next: Limits" }));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  // @rule R5
  it("[R5] sticks to the bottom of the content column", () => {
    const { container } = renderWithProviders(
      <BuilderActionBar previous="networks" next="tokens" onBack={vi.fn()} onNext={vi.fn()} />,
    );

    // The rule is positional, so the assertion is too: a bar that scrolls away takes Next with it.
    const bar = container.querySelector("[data-builder-action-bar]");
    expect(bar).not.toBeNull();
    expect(bar?.className).toContain("sticky");
    expect(bar?.className).toContain("bottom-0");
  });

  // @rule R6
  it("[R6] Next is never disabled: the shell answers the press with a reason", () => {
    renderWithProviders(
      <BuilderActionBar previous="tokens" next="limits" onBack={vi.fn()} onNext={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "Next: Limits" })).toBeEnabled();
  });
});
