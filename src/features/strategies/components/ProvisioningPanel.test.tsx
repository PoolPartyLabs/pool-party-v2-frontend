/**
 * @id PP-CORE-CMP-046
 * @name ProvisioningPanel — tests
 * @implements-rules-version v1
 * Variant-agnostic plan render (multi + gas-only), execution → resume (onDone), cancel, the in-flight
 * lock, and the cleared-custom-gas regression. Uses fireEvent for the flow (see CollectModal.test).
 */
import { describe, expect, it, vi } from "vitest";
import { SCENARIOS } from "@/lib/provisioning";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { ProvisioningPanel } from "./ProvisioningPanel";

function noop() {}

/** Immediate real-seam steps so the flow settles without the 900ms mock delay. */
const immediateSteps = (plan: { steps: { type: string; key: string }[] }) =>
  plan.steps
    .filter((s) => s.type !== "op")
    .map((s) => ({ key: s.key, run: async () => ({ txHash: `0x${s.key}` }) }));

describe("ProvisioningPanel", () => {
  it("renders the multi plan (op label + steps + inline gas selector)", () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridgeGas}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByRole("heading", { name: "Almost there" })).toBeInTheDocument();
    expect(screen.getByText("Move to Arbitrum")).toBeInTheDocument();
    expect(screen.getByText("Invest in Stable Yield")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$10.00" })).toBeInTheDocument();
    // @rule POO-807 R1: the plan view carries the visible mock-mode indicator (mock-plan figures).
    expect(screen.getByTestId("mock-badge")).toHaveTextContent("MOCK");
  });

  it("is variant-agnostic: renders a gas-only plan too", () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.gasOnly}
        opLabel="Withdraw from Stable Yield"
        onDone={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByRole("heading", { name: "One quick step" })).toBeInTheDocument();
    expect(screen.getByText("Add gas")).toBeInTheDocument();
  });

  it("runs the execution then resumes the op (onDone) on success", async () => {
    const onDone = vi.fn();
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcOnly}
        opLabel="Invest in Stable Yield"
        onDone={onDone}
        onCancel={noop}
        buildPlanSteps={immediateSteps}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm & continue" }));
    expect(screen.getByText("Setting up your funds")).toBeInTheDocument();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("returns to the host (onCancel) when cancelled", () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcOnly}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("keeps the gas step + disables the CTA when the custom gas is cleared", () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridgeGas}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByLabelText("Custom gas amount")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm & continue" })).toBeDisabled();
  });

  it("reports the in-flight lock while provisioning runs", () => {
    const onLockChange = vi.fn();
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcOnly}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        onLockChange={onLockChange}
        buildPlanSteps={immediateSteps}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm & continue" }));
    expect(onLockChange).toHaveBeenCalledWith(true);
  });
});
