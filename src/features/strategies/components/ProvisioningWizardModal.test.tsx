/**
 * @id PP-CORE-MOD-011
 * @name ProvisioningWizardModal — tests
 * @implements-rules-version v2
 * Plan state (assembled rows + op label + inline gas selector), the pending handoff, and a successful
 * run handing back to the host (onDone + close). Uses fireEvent for the flow (see CollectModal.test).
 * POO-523: the settings gear (Max slippage 0.5/1/2 default 2% + deadline), slippage threading into
 * the plan input, and reset-on-close.
 */
import { describe, expect, it, vi } from "vitest";
import { type ProvisioningPlan, SCENARIOS } from "@/lib/provisioning";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { ProvisioningWizardModal } from "./ProvisioningWizardModal";

vi.mock("./settle", () => ({
  settleOutcome: vi.fn(() => "success"),
  settleTxError: vi.fn(() => ({ code: "-32603", message: "execution reverted: mock" })),
  settleTxHash: vi.fn(() => "0xMOCK00000000000000000000000000000000MOCK"),
}));

function noop() {}

describe("ProvisioningWizardModal", () => {
  it("renders the assembled plan with the op label, the steps, and the inline gas selector", () => {
    renderWithProviders(
      <ProvisioningWizardModal
        open
        onOpenChange={noop}
        input={SCENARIOS.usdcBridgeGas}
        opLabel="Invest in Stable Yield"
      />,
    );
    expect(screen.getByRole("heading", { name: "Almost there" })).toBeInTheDocument();
    expect(screen.getByText("Buy USDC")).toBeInTheDocument();
    expect(screen.getByText("Move to Arbitrum")).toBeInTheDocument();
    expect(screen.getByText("Invest in Stable Yield")).toBeInTheDocument();
    // Inline gas selector (gas step present).
    expect(screen.getByRole("button", { name: "$10.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm & continue" })).toBeEnabled();
  });

  it("keeps the gas step + disables the CTA when the custom gas is cleared (no silent drop)", () => {
    renderWithProviders(
      <ProvisioningWizardModal
        open
        onOpenChange={noop}
        input={SCENARIOS.usdcBridgeGas}
        opLabel="Invest in Stable Yield"
      />,
    );
    // Switch to Custom with an empty amount (invalid): the gas step must NOT drop and the CTA must
    // disable, instead of silently losing the top-up (regression caught in review).
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByLabelText("Custom gas amount")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm & continue" })).toBeDisabled();
  });

  it("enters the execution handoff when the CTA is clicked", () => {
    renderWithProviders(
      <ProvisioningWizardModal
        open
        onOpenChange={noop}
        input={SCENARIOS.usdcBridgeGas}
        opLabel="Invest in Stable Yield"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm & continue" }));
    expect(screen.getByText("Continue in your wallet")).toBeInTheDocument();
    expect(screen.getByText("Setting up your funds")).toBeInTheDocument();
  });

  it("hands back to the host (onDone + close) once provisioning succeeds", async () => {
    const onDone = vi.fn();
    const onOpenChange = vi.fn();
    // Immediate real-seam steps so the flow settles without the mock delay.
    const buildPlanSteps = (plan: { steps: { type: string; key: string }[] }) =>
      plan.steps
        .filter((s) => s.type !== "op")
        .map((s) => ({ key: s.key, run: async () => ({ txHash: `0x${s.key}` }) }));
    renderWithProviders(
      <ProvisioningWizardModal
        open
        onOpenChange={onOpenChange}
        input={SCENARIOS.usdcOnly}
        opLabel="Invest in Stable Yield"
        buildPlanSteps={buildPlanSteps}
        onDone={onDone}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm & continue" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // @rule POO-523 R1 — the gear opens the shared settings with Max slippage (0.5/1/2) defaulting
  // to 2%; deadline renders whatever the shared dialog on main renders (standard props).
  it("renders the settings gear and opens the dialog with the 2% default highlighted", () => {
    renderWithProviders(
      <ProvisioningWizardModal
        open
        onOpenChange={noop}
        input={SCENARIOS.usdcOnly}
        opLabel="Invest in Stable Yield"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    expect(screen.getByText("Max slippage")).toBeInTheDocument();
    expect(screen.getByText("Transaction deadline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2%" })).toHaveClass("border-primary");
    expect(screen.getByRole("button", { name: "0.5%" })).not.toHaveClass("border-primary");
  });

  // @rule POO-523 R2 — the chosen slippage threads into the plan input, so the plan handed to the
  // build seam (buildPlanSteps / the POO-414 rail) carries it.
  it("threads the chosen slippage into the plan passed to the build seam", () => {
    const seen: Array<number | undefined> = [];
    const buildPlanSteps = (plan: ProvisioningPlan) => {
      seen.push(plan.slippagePct);
      return plan.steps
        .filter((s) => s.type !== "op")
        .map((s) => ({ key: s.key, run: async () => ({ txHash: `0x${s.key}` }) }));
    };
    renderWithProviders(
      <ProvisioningWizardModal
        open
        onOpenChange={noop}
        input={SCENARIOS.usdcOnly}
        opLabel="Invest in Stable Yield"
        buildPlanSteps={buildPlanSteps}
      />,
    );
    // The default rides along from the first plan.
    expect(seen.at(-1)).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "0.5%" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(seen.at(-1)).toBe(0.5);
  });

  // @rule POO-523 R3 — closing the sheet resets the slippage to the 2% default (POO-513 policy).
  it("resets the slippage to the 2% default when the sheet closes", async () => {
    renderWithProviders(
      <ProvisioningWizardModal
        open
        onOpenChange={noop}
        input={SCENARIOS.usdcOnly}
        opLabel="Invest in Stable Yield"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "0.5%" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // The close reset lands after a beat (150ms); reopen the gear and wait for the default.
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "2%" })).toHaveClass("border-primary"),
    );
    expect(screen.getByRole("button", { name: "0.5%" })).not.toHaveClass("border-primary");
  });
});
