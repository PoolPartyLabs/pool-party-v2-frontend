/**
 * @id PP-CORE-CMP-044 (POO-1041)
 * @name ProvisioningPlanCard — real-step rendering tests
 * @implements-rules-version v2 (POO-1041 rules v1) · v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The card against a REAL plan, which is the only kind that carries legs, an ETA and a broadcast
 * hash. Rules under test:
 *   [R2] a bridge row shows its ETA and, once broadcast, a per-leg explorer link
 *   [R4] a missing network or hash renders NO link, never an explorer home page
 *   [R6] the rail's approval rows are rendered, so the card lists what the user actually signs
 */
import { describe, expect, it } from "vitest";
import {
  REAL_STEPS,
  realProvisioningPlan,
} from "../../../../../tests/fixtures/realProvisioningPlan";
import { renderWithProviders, screen } from "../../../../../tests/utils/renderWithProviders";
import { planRailSteps } from "../../lib/buildPlanSteps";
import { ProvisioningPlanCard } from "./ProvisioningPlanCard";
import { buildPlanView, type PlanViewOptions } from "./provisioningView";

const TX_HASH = "0x9f2c1d4a6b8e0f3c5a7d9e1b2c4f6a8d0e2b4c6f8a0d2e4b6c8f0a2d4e6b8c0f";

function renderCard(options: PlanViewOptions = {}) {
  const plan = realProvisioningPlan();
  const view = buildPlanView(plan, { railSteps: planRailSteps(plan), ...options });
  return renderWithProviders(<ProvisioningPlanCard view={view} opLabel="Invest in Stable Yield" />);
}

describe("ProvisioningPlanCard — real steps (POO-1041)", () => {
  it("[R6] lists the approval the rail will ask for, alongside the legs and the op anchor", () => {
    renderCard();

    expect(screen.getByText("Approve WETH")).toBeInTheDocument();
    // The swap label interpolates its destination token; before POO-1041 the mapper passed no
    // value and this row rendered the raw i18n key.
    expect(screen.getByText("Convert to USDC")).toBeInTheDocument();
    expect(screen.getByText("Move to Arbitrum")).toBeInTheDocument();
    expect(screen.getByText("Invest in Stable Yield")).toBeInTheDocument();
  });

  it("[R2] says how long the bridge takes, from the quote's own estimate", () => {
    renderCard();

    expect(screen.getByText(/about 3 minutes/)).toBeInTheDocument();
  });

  it("[R2] links an in-flight bridge row to its transaction, on the chain it broadcast on", () => {
    renderCard({ statusByKey: { "bridge-1": "active" }, txHashByKey: { "bridge-1": TX_HASH } });

    const link = screen.getByRole("link", { name: "View on explorer" });
    expect(link).toHaveAttribute("href", `https://polygonscan.com/tx/${TX_HASH}`);
  });

  it("[R4] renders no link at all until the leg has broadcast", () => {
    renderCard({ statusByKey: { "bridge-1": "active" } });

    expect(screen.queryByRole("link", { name: "View on explorer" })).not.toBeInTheDocument();
  });

  it("[R4] renders no link for a chain the app cannot name an explorer for", () => {
    const plan = realProvisioningPlan({
      steps: REAL_STEPS.map((step) =>
        step.key === "bridge-1"
          ? { ...step, chainId: 1, leg: step.leg && { ...step.leg, chainId: 1 } }
          : step,
      ),
    });
    const view = buildPlanView(plan, { txHashByKey: { "bridge-1": TX_HASH } });
    renderWithProviders(<ProvisioningPlanCard view={view} opLabel="Invest in Stable Yield" />);

    expect(screen.queryByRole("link", { name: "View on explorer" })).not.toBeInTheDocument();
  });
});
