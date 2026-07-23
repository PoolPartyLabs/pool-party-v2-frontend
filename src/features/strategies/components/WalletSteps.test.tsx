/**
 * @id PP-CORE-MOD-006
 * @name WalletSteps.test
 * Behavior (POO-295): renders every signing step under the "Continue in your wallet" cue with the
 * first step active ("Step 1 of N" + the why helper); the helper toggles its explanation; the
 * active step walks forward over time and rests on the last one.
 */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { WalletSteps } from "./WalletSteps";

const STEPS = [
  { key: "approve", label: "Approve USDC" },
  { key: "confirm", label: "Confirm deposit" },
];

describe("WalletSteps", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // @rule POO-807 R1: the pending phase carries the visible mock-mode indicator (real-mode absence
  // is guarded in the MockBadge unit test; tests run in mock mode).
  it("[POO-807] shows the MOCK badge in the wallet-handoff heading (mock mode)", () => {
    renderWithProviders(<WalletSteps steps={STEPS} />);
    expect(screen.getByTestId("mock-badge")).toHaveTextContent("MOCK");
  });

  it("renders the steps under the wallet cue with the first one active", () => {
    renderWithProviders(<WalletSteps steps={STEPS} />);
    expect(screen.getByText("Continue in your wallet")).toBeInTheDocument();
    expect(screen.getByText("Approve USDC")).toBeInTheDocument();
    expect(screen.getByText("Confirm deposit")).toBeInTheDocument();
    // First step active → "Step 1 of 2" + the helper link.
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What am I signing?" })).toBeInTheDocument();
  });

  it("toggles the why-signatures explanation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WalletSteps steps={STEPS} />);
    const why = screen.getByRole("button", { name: "What am I signing?" });
    expect(why).toHaveAttribute("aria-expanded", "false");
    await user.click(why);
    expect(why).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Signatures prove you authorize this action/)).toBeInTheDocument();
  });

  it("names and explains the specific signature when the step carries `why`", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <WalletSteps
        steps={[
          {
            key: "approve",
            label: "Approve USDC",
            why: { name: "Token approval", body: "Lets the contract move your USDC." },
          },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "What am I signing?" }));
    expect(screen.getByText("Token approval")).toBeInTheDocument();
    expect(screen.getByText(/Lets the contract move your USDC/)).toBeInTheDocument();
  });

  it("walks the active step forward and rests on the last", () => {
    vi.useFakeTimers();
    try {
      renderWithProviders(<WalletSteps steps={STEPS} stepMs={500} />);
      expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(600);
      });
      // Advanced to the last step; it stays there (the host modal settles + unmounts us).
      expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("handles a single-step transaction", () => {
    renderWithProviders(<WalletSteps steps={[{ key: "confirm", label: "Confirm collection" }]} />);
    expect(screen.getByText("Confirm collection")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 1")).toBeInTheDocument();
  });

  it("is controlled by activeStep and ignores the mock timer", () => {
    vi.useFakeTimers();
    try {
      renderWithProviders(<WalletSteps steps={STEPS} activeStep={1} stepMs={100} />);
      expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      // The internal timer is off in controlled mode. The host owns progress.
      expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps an out-of-range activeStep to the last step", () => {
    renderWithProviders(<WalletSteps steps={STEPS} activeStep={99} />);
    expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();
  });

  it("marks the active step with aria-current for screen readers", () => {
    renderWithProviders(<WalletSteps steps={STEPS} activeStep={0} />);
    expect(screen.getByText("Approve USDC").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Confirm deposit").closest("li")).not.toHaveAttribute("aria-current");
  });

  it("renders a skipped sublabel when a step is marked skipped via statuses", () => {
    renderWithProviders(
      <WalletSteps steps={STEPS} activeStep={1} statuses={["skipped", "active"]} />,
    );
    expect(screen.getByText("Already approved")).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();
  });

  it("shows a truncated tx hash on a done step", () => {
    renderWithProviders(
      <WalletSteps
        steps={STEPS}
        activeStep={1}
        statuses={["done", "active"]}
        txHashes={["0x1234567890abcdef1234", undefined]}
      />,
    );
    expect(screen.getByText("0x1234…1234")).toBeInTheDocument();
  });

  it("drives the error state from statuses (tinted label, no aria-current)", () => {
    renderWithProviders(<WalletSteps steps={STEPS} activeStep={0} statuses={["error", "idle"]} />);
    expect(screen.getByText("Approve USDC")).toHaveClass("text-destructive");
    expect(screen.getByText("Approve USDC").closest("li")).not.toHaveAttribute("aria-current");
    // No step is active, so the "Step X of Y" cue is absent.
    expect(screen.queryByText(/^Step \d+ of \d+$/)).not.toBeInTheDocument();
  });
});
