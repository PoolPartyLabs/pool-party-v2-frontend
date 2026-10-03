/**
 * @id PP-MGR-CMP-028
 * @name MandateSubStepHeader tests
 * @implements-rules-version v1 (POO-2122 rules v1)
 * @analytics-events none, navigating a reached step is reported by the shell as a step view
 *
 * [R3] the collapsed line, the two ways it expands and the one way it stays open; [R4] which step
 * titles are navigation and which are only text; the 4-segment variant when Pools is skipped (R29).
 */
import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../tests/utils/renderWithProviders";
import { MandateSubStepHeader } from "./MandateSubStepHeader";

const FIVE = ["networks", "protocols", "tokens", "pools", "limits"] as const;

describe("MandateSubStepHeader", () => {
  // @rule R3
  it("[R3] collapsed: the overline, the title and what comes next, on one line", () => {
    renderWithProviders(
      <MandateSubStepHeader
        steps={FIVE}
        current="networks"
        passed={[]}
        reachable={["networks"]}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByText("MANDATE · STEP 1 OF 5")).toBeInTheDocument();
    expect(screen.getByText("Networks")).toBeInTheDocument();
    expect(screen.getByText("Next: Protocols")).toBeInTheDocument();
    // The subtitle belongs to the expanded state; collapsed is one line.
    expect(
      screen.queryByText(/Pick the networks this strategy can operate on/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show the mandate steps" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  // @rule R3
  it("[R3] a click expands it in place and the label flips to the collapse one", async () => {
    renderWithProviders(
      <MandateSubStepHeader
        steps={FIVE}
        current="networks"
        passed={[]}
        reachable={["networks"]}
        onNavigate={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Show the mandate steps" }));

    expect(
      screen.getByText(
        "Pick the networks this strategy can operate on. Arbitrum is always the hub.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide the mandate steps" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  // @rule R3
  it("[R3] hover expands and leaving collapses again", async () => {
    const { container } = renderWithProviders(
      <MandateSubStepHeader
        steps={FIVE}
        current="protocols"
        passed={["networks"]}
        reachable={["networks", "protocols"]}
        onNavigate={vi.fn()}
      />,
    );
    const header = container.querySelector("[data-mandate-substep]") as HTMLElement;

    await userEvent.hover(header);
    expect(screen.getByText(/Pick the protocols this strategy can use/)).toBeInTheDocument();

    await userEvent.unhover(header);
    expect(screen.queryByText(/Pick the protocols this strategy can use/)).not.toBeInTheDocument();
  });

  // @rule R3
  it("[R3] a click PINS it open, so leaving with the mouse does not close it", async () => {
    const { container } = renderWithProviders(
      <MandateSubStepHeader
        steps={FIVE}
        current="protocols"
        passed={["networks"]}
        reachable={["networks", "protocols"]}
        onNavigate={vi.fn()}
      />,
    );
    const header = container.querySelector("[data-mandate-substep]") as HTMLElement;

    await userEvent.click(screen.getByRole("button", { name: "Show the mandate steps" }));
    await userEvent.unhover(header);

    expect(screen.getByText(/Pick the protocols this strategy can use/)).toBeInTheDocument();
  });

  // @rule R3
  it("[R3] the last step points at the next PHASE", () => {
    renderWithProviders(
      <MandateSubStepHeader
        steps={FIVE}
        current="limits"
        passed={["networks", "protocols", "tokens", "pools"]}
        reachable={["networks", "protocols", "tokens", "pools", "limits"]}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByText("Next: Build strategy")).toBeInTheDocument();
  });

  // @rule R4
  it("[R4] expanded: a reached step is navigation, the current one is not", async () => {
    const onNavigate = vi.fn();
    renderWithProviders(
      <MandateSubStepHeader
        steps={FIVE}
        current="tokens"
        passed={["networks", "protocols"]}
        reachable={["networks", "protocols", "tokens"]}
        onNavigate={onNavigate}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Show the mandate steps" }));
    await userEvent.click(screen.getByRole("button", { name: "Networks" }));

    expect(onNavigate).toHaveBeenCalledWith("networks");
    // The current step is text, not a link back to where the user already is.
    expect(screen.queryByRole("button", { name: "Tokens" })).not.toBeInTheDocument();
  });

  // @rule R4
  it("[R4] expanded: an unreached step is inert and says so", async () => {
    const onNavigate = vi.fn();
    renderWithProviders(
      <MandateSubStepHeader
        steps={FIVE}
        current="networks"
        passed={[]}
        reachable={["networks"]}
        onNavigate={onNavigate}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Show the mandate steps" }));
    const limits = screen.getByText("Limits");

    expect(limits).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(limits);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  // @rule R29
  it("[R29] counts only the visible steps, so a skipped Pools reads OF 4", async () => {
    const { container } = renderWithProviders(
      <MandateSubStepHeader
        steps={["networks", "protocols", "tokens", "limits"]}
        current="limits"
        passed={["networks", "protocols", "tokens"]}
        reachable={["networks", "protocols", "tokens", "limits"]}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByText("MANDATE · STEP 4 OF 4")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-mandate-segment]")).toHaveLength(4);

    // Expanded, the skipped step has no label either: the bar shows the mandate this draft has.
    await userEvent.click(screen.getByRole("button", { name: "Show the mandate steps" }));
    expect(screen.queryByText("Pools")).not.toBeInTheDocument();
  });

  // @rule R3
  it("[R3] the bar has one segment per visible step, filled up to the current one", () => {
    const { container } = renderWithProviders(
      <MandateSubStepHeader
        steps={FIVE}
        current="tokens"
        passed={["networks", "protocols"]}
        reachable={["networks", "protocols", "tokens"]}
        onNavigate={vi.fn()}
      />,
    );

    const segments = container.querySelectorAll("[data-mandate-segment]");
    expect(segments).toHaveLength(5);
    expect(
      [...segments].filter((s) => s.getAttribute("data-mandate-segment") === "filled"),
    ).toHaveLength(3);
  });
});
