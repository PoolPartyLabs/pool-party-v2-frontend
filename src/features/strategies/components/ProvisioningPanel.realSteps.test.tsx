/**
 * @id PP-CORE-CMP-046 (POO-1041)
 * @name ProvisioningPanel — real-step execution tests
 * @implements-rules-version v4 (POO-1041 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The panel driving a REAL plan. A mock plan cannot reach any of this: it carries no legs, so the
 * rail expands it into nothing, and no rail-only row ever appears.
 *
 * A separate file from `ProvisioningPanel.test.tsx`, deliberately: that suite is the mock-mode
 * behavioural proof and stubs the plan seam not at all, while this one has to replace it to inject
 * a plan the mock planner will never produce.
 *
 * Rules under test (POO-1041 rules v1):
 *   [R1] per-step status comes from the rail, in the vocabulary `WalletSteps` consumes
 *   [R2] a running bridge shows its ETA AND a link to the transaction, the instant it broadcasts
 *   [R6] the rail expands one plan step into an approval PLUS the leg, so the stepper's labels,
 *        statuses and hashes are matched by KEY. Matched by index, the bridge's status would land
 *        on a different row entirely.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProvisioningPlan } from "@/lib/provisioning";
import { SCENARIOS } from "@/lib/provisioning";
import { realProvisioningPlan } from "../../../../tests/fixtures/realProvisioningPlan";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { planRailSteps } from "../lib/buildPlanSteps";
import { ProvisioningPanel } from "./ProvisioningPanel";

// Two mounted surfaces render the locale-aware Link: POO-1043 [R9]'s cost breakdown in the plan phase
// (its buy-crypto peer option) and POO-1044 [R3]'s buy-crypto escape on the blocked error branch. It
// resolves Next's app-router navigation, which does not exist under jsdom, so it is stood in for, as
// in every other suite in this folder that mounts a navigating component.
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const TX_HASH = "0x9f2c1d4a6b8e0f3c5a7d9e1b2c4f6a8d0e2b4c6f8a0d2e4b6c8f0a2d4e6b8c0f";

// The plan seam is async and resolves the MOCK planner in tests; this replaces it with the shape the
// real planner emits, which is what the whole issue is about.
const { planHolder } = vi.hoisted(() => ({
  planHolder: { current: null as ProvisioningPlan | null },
}));
vi.mock("../hooks/useProvisioningPlan", () => ({
  useProvisioningPlan: () => ({
    plan: planHolder.current,
    loading: false,
    error: null,
    refresh: () => {},
  }),
}));

function noop() {}

/**
 * The rail as the real one behaves: each leg runs after its approval, and the bridge reports its
 * hash the instant it has one and then stays open for the settlement wait.
 */
const realRail = (plan: ProvisioningPlan, rail: { onLegBroadcast: (event: never) => void }) =>
  planRailSteps(plan).map((step) => ({
    key: step.key,
    run: async () => {
      if (step.kind === "leg" && step.leg?.kind === "bridge") {
        (rail.onLegBroadcast as (event: unknown) => void)({
          leg: step.leg,
          txHash: TX_HASH,
          at: Date.now(),
        });
        // A bridge leg does not return for minutes: its hash exists long before its result does.
        return new Promise<never>(() => {});
      }
      return { txHash: `0x${step.key}` };
    },
  }));

describe("ProvisioningPanel — real steps (POO-1041)", () => {
  beforeEach(() => {
    planHolder.current = realProvisioningPlan();
  });

  it("[R6] lists what the rail will really run, approvals included", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={realRail}
      />,
    );

    expect(await screen.findByText("Approve WETH")).toBeInTheDocument();
    expect(screen.getByText("Swap to USDC")).toBeInTheDocument();
    expect(screen.getByText("Move to Arbitrum")).toBeInTheDocument();
  });

  it("[R1]/[R6] marks the running bridge active by key, not by its position in the plan", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={realRail}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Confirm & continue" }));

    // The rail runs approve → swap → approve → bridge. The bridge is rail step 4 and plan step 2:
    // an index-matched stepper would light up the wrong row.
    await waitFor(() => {
      expect(screen.getByText("Move to Arbitrum").closest("li")).toHaveAttribute(
        "aria-current",
        "step",
      );
    });
    expect(screen.getByText("Step 4 of 4")).toBeInTheDocument();
  });

  it("[R2] shows the running bridge's ETA and a link to the transfer once it broadcasts", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={realRail}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Confirm & continue" }));

    expect(await screen.findByText(/about 3 minutes/)).toBeInTheDocument();
    // The gap POO-1037 left open: before this, a bridge only got a link once it had already given
    // up, so a user watching a five-minute transfer had no way to check it was moving.
    const link = await screen.findByRole("link", { name: "View on explorer" });
    expect(link).toHaveAttribute("href", `https://polygonscan.com/tx/${TX_HASH}`);
  });
});
