/**
 * @id PP-CORE-CMP-046
 * @name ProvisioningPanel — tests
 * @implements-rules-version v2 (POO-1037 rules v1) · v1
 * Variant-agnostic plan render (multi + gas-only), execution → resume (onDone), cancel, the in-flight
 * lock, and the cleared-custom-gas regression. Uses fireEvent for the flow (see CollectModal.test).
 *
 * POO-1037 (hackathon POO-1022): the long bridge step. A leg that settles on another chain takes
 * MINUTES, so the panel has to say how long, hold the dismissal lock for the whole wait [R5], and
 * degrade at the poll ceiling into a recoverable "still settling" state that offers NO retry [R3] —
 * a retry would re-invoke the step verbatim and re-broadcast a bridge that is already in flight.
 */
import { describe, expect, it, vi } from "vitest";
import { SCENARIOS } from "@/lib/provisioning";
import { TransactionError } from "@/lib/tx/sendTransaction";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { BRIDGE_PENDING_CODE } from "../lib/awaitBridgeSettlement";
import { ProvisioningPanel } from "./ProvisioningPanel";

function noop() {}

interface StubPlan {
  steps: { type: string; key: string }[];
}

/** Immediate real-seam steps so the flow settles without the 900ms mock delay. */
const immediateSteps = (plan: StubPlan) =>
  plan.steps
    .filter((s) => s.type !== "op")
    .map((s) => ({ key: s.key, run: async () => ({ txHash: `0x${s.key}` }) }));

/** Real-seam steps where the bridge leg never settles: the wait a real bridge imposes. */
const hangingBridgeSteps = (plan: StubPlan) =>
  plan.steps
    .filter((s) => s.type !== "op")
    .map((s) => ({
      key: s.key,
      run:
        s.type === "bridge"
          ? () => new Promise<{ txHash: string }>(() => {})
          : async () => ({ txHash: `0x${s.key}` }),
    }));

/** Real-seam steps where the bridge leg reaches the poll ceiling still un-arrived. */
const ceilingBridgeSteps = (plan: StubPlan) =>
  plan.steps
    .filter((s) => s.type !== "op")
    .map((s) => ({
      key: s.key,
      run: async () => {
        if (s.type !== "bridge") return { txHash: `0x${s.key}` };
        throw new TransactionError("Bridged funds have not arrived yet", {
          code: BRIDGE_PENDING_CODE,
          txHash: "0x9f2c1d4a6b8e0f3c5a7d9e1b2c4f6a8d0e2b4c6f8a0d2e4b6c8f0a2d4e6b8c0f",
        });
      },
    }));

describe("ProvisioningPanel", () => {
  it("renders the multi plan (op label + steps + inline gas selector)", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridgeGas}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
      />,
    );
    expect(await screen.findByRole("heading", { name: "Almost there" })).toBeInTheDocument();
    expect(screen.getByText("Move to Arbitrum")).toBeInTheDocument();
    expect(screen.getByText("Invest in Stable Yield")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$10.00" })).toBeInTheDocument();
    // @rule POO-807 R1: the plan view carries the visible mock-mode indicator (mock-plan figures).
    expect(screen.getByTestId("mock-badge")).toHaveTextContent("MOCK");
  });

  it("is variant-agnostic: renders a gas-only plan too", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.gasOnly}
        opLabel="Withdraw from Stable Yield"
        onDone={noop}
        onCancel={noop}
      />,
    );
    expect(await screen.findByRole("heading", { name: "One quick step" })).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("button", { name: "Confirm & continue" }));
    expect(screen.getByText("Setting up your funds")).toBeInTheDocument();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("returns to the host (onCancel) when cancelled", async () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcOnly}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("keeps the gas step + disables the CTA when the custom gas is cleared", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridgeGas}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Custom" }));
    expect(screen.getByLabelText("Custom gas amount")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm & continue" })).toBeDisabled();
  });

  it("reports the in-flight lock while provisioning runs", async () => {
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
    fireEvent.click(await screen.findByRole("button", { name: "Confirm & continue" }));
    expect(onLockChange).toHaveBeenCalledWith(true);
  });

  describe("POO-1037 — the long bridge step", () => {
    it("[R2] tells the user how long the bridge leg takes while it is running", async () => {
      renderWithProviders(
        <ProvisioningPanel
          input={SCENARIOS.usdcBridge}
          opLabel="Invest in Stable Yield"
          onDone={noop}
          onCancel={noop}
          buildPlanSteps={hangingBridgeSteps}
        />,
      );
      fireEvent.click(await screen.findByRole("button", { name: "Confirm & continue" }));
      // The mock plan carries no `estimatedFillTimeMs`, so the honest unknown-ETA line shows rather
      // than an invented constant.
      expect(
        await screen.findByText(/We'll continue as soon as your funds arrive/),
      ).toBeInTheDocument();
    });

    it("[R5] holds the dismissal lock for the whole settlement wait", async () => {
      const onLockChange = vi.fn();
      renderWithProviders(
        <ProvisioningPanel
          input={SCENARIOS.usdcBridge}
          opLabel="Invest in Stable Yield"
          onDone={noop}
          onCancel={noop}
          onLockChange={onLockChange}
          buildPlanSteps={hangingBridgeSteps}
        />,
      );
      fireEvent.click(await screen.findByRole("button", { name: "Confirm & continue" }));
      await waitFor(() => expect(onLockChange).toHaveBeenLastCalledWith(true));
      // The bridge never settles, so the lock must still be held: nothing may close the modal while
      // money is in flight between two chains.
      expect(onLockChange.mock.calls.filter(([locked]) => locked === false)).toHaveLength(1);
    });

    it("[R5] releases the lock exactly once when the wait degrades", async () => {
      const onLockChange = vi.fn();
      renderWithProviders(
        <ProvisioningPanel
          input={SCENARIOS.usdcBridge}
          opLabel="Invest in Stable Yield"
          onDone={noop}
          onCancel={noop}
          onLockChange={onLockChange}
          buildPlanSteps={ceilingBridgeSteps}
        />,
      );
      fireEvent.click(await screen.findByRole("button", { name: "Confirm & continue" }));
      // Mount reports unlocked, Confirm locks, the ceiling unlocks. Exactly once, in that order.
      await waitFor(() => expect(onLockChange.mock.calls).toEqual([[false], [true], [false]]));
    });

    it("[R3] degrades to the still-settling state at the ceiling, with the transfer verifiable", async () => {
      renderWithProviders(
        <ProvisioningPanel
          input={SCENARIOS.usdcBridge}
          opLabel="Invest in Stable Yield"
          onDone={noop}
          onCancel={noop}
          buildPlanSteps={ceilingBridgeSteps}
        />,
      );
      fireEvent.click(await screen.findByRole("button", { name: "Confirm & continue" }));

      expect(await screen.findByText("Still on its way")).toBeInTheDocument();
      // Never presented as a failure, and never as a success.
      expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
      // [R2] the user can verify the transfer independently, on the chain it was broadcast on.
      expect(screen.getByRole("link", { name: "View on explorer" })).toHaveAttribute(
        "href",
        expect.stringContaining(
          "0x9f2c1d4a6b8e0f3c5a7d9e1b2c4f6a8d0e2b4c6f8a0d2e4b6c8f0a2d4e6b8c0f",
        ),
      );
    });

    it("[R3] offers no retry at the ceiling, which would re-broadcast a bridge already in flight", async () => {
      renderWithProviders(
        <ProvisioningPanel
          input={SCENARIOS.usdcBridge}
          opLabel="Invest in Stable Yield"
          onDone={noop}
          onCancel={noop}
          buildPlanSteps={ceilingBridgeSteps}
        />,
      );
      fireEvent.click(await screen.findByRole("button", { name: "Confirm & continue" }));

      expect(await screen.findByText("Still on its way")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    });

    it("[R3] the plan stays recoverable: closing the degraded state returns to the host", async () => {
      const onCancel = vi.fn();
      const onDone = vi.fn();
      renderWithProviders(
        <ProvisioningPanel
          input={SCENARIOS.usdcBridge}
          opLabel="Invest in Stable Yield"
          onDone={onDone}
          onCancel={onCancel}
          buildPlanSteps={ceilingBridgeSteps}
        />,
      );
      fireEvent.click(await screen.findByRole("button", { name: "Confirm & continue" }));

      fireEvent.click(await screen.findByRole("button", { name: "Close" }));
      expect(onCancel).toHaveBeenCalledTimes(1);
      // The operation is NEVER resumed off an unsettled bridge: that would spend money that has not
      // arrived on the target chain.
      expect(onDone).not.toHaveBeenCalled();
    });
  });
});
