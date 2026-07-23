/**
 * @id PP-CORE-MOD-009
 * @name WalletSignModal.test
 * Behavior (POO-295): renders the title + optional summary + the variable wallet-step progress
 * resolved from the spec, with the first step active and no in-modal CTA.
 */
import { describe, expect, it } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { WalletSignModal } from "./WalletSignModal";

describe("WalletSignModal", () => {
  it("renders the title, summary and the resolved steps with the first one active", () => {
    renderWithProviders(
      <WalletSignModal
        open
        onOpenChange={() => {}}
        title="Confirming your deposit"
        summary={<p>2.5 USDC</p>}
        spec={{ approvals: ["USDC"], confirm: "invest" }}
        stepMs={1_000_000}
      />,
    );
    expect(screen.getByText("Confirming your deposit")).toBeInTheDocument();
    expect(screen.getByText("2.5 USDC")).toBeInTheDocument();
    expect(screen.getByText("Continue in your wallet")).toBeInTheDocument();
    expect(screen.getByText("Approve USDC")).toBeInTheDocument();
    expect(screen.getByText("Confirm deposit")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
  });

  it("adapts the step count to the spec (approve ×2 + permit + confirm = 4 for add liquidity)", () => {
    renderWithProviders(
      <WalletSignModal
        open
        onOpenChange={() => {}}
        title="Adding liquidity"
        spec={{ approvals: ["USDC", "WETH"], permit2: true, confirm: "addLiquidity" }}
        stepMs={1_000_000}
      />,
    );
    expect(screen.getByText("Approve USDC")).toBeInTheDocument();
    expect(screen.getByText("Approve WETH")).toBeInTheDocument();
    expect(screen.getByText("Sign permit in your wallet")).toBeInTheDocument();
    expect(screen.getByText("Confirm add liquidity")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
  });

  it("renders a single confirm step for a collect (no extra steps)", () => {
    renderWithProviders(
      <WalletSignModal
        open
        onOpenChange={() => {}}
        title="Collecting fees"
        spec={{ confirm: "collect" }}
      />,
    );
    expect(screen.getByText("Confirm collection")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 1")).toBeInTheDocument();
  });

  it("forwards a controlled activeStep to the stepper", () => {
    renderWithProviders(
      <WalletSignModal
        open
        onOpenChange={() => {}}
        title="Adding liquidity"
        spec={{ approvals: ["USDC", "WETH"], permit2: true, confirm: "addLiquidity" }}
        activeStep={2}
      />,
    );
    // Host put us on step 3 of 4 (the permit), not the default first step.
    expect(screen.getByText("Step 3 of 4")).toBeInTheDocument();
    expect(screen.getByText("Sign permit in your wallet").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
  });

  it("explains the active signature by name + body when the disclosure is opened", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <WalletSignModal
        open
        onOpenChange={() => {}}
        title="Confirming your deposit"
        spec={{ approvals: ["USDC"], confirm: "invest" }}
        stepMs={1_000_000}
      />,
    );
    // First step (approve USDC) is active; its "Why?" names the Token approval and interpolates USDC.
    await user.click(screen.getByRole("button", { name: "What am I signing?" }));
    expect(screen.getByText("Token approval")).toBeInTheDocument();
    expect(screen.getByText(/Lets Pool Party move your USDC/)).toBeInTheDocument();
  });
});
