/**
 * @id PP-MGR-LIB-023
 * @name toLayoutInput
 * @implements-rules-version v1 (POO-2153 rules v1)
 * @implements-rules-version v1 (POO-2301 shared local runtime; POO-2302 measured engine)
 * @analytics-events none, a pure mapping: nothing here is rendered or tracked.
 *
 * The only bridge from the stored plan (`BuildPlan`, S1) to the layout's structural input. It keeps
 * the order, the ids and the shares, names the hub ({@link HUB_NETWORK}), and says whether each
 * step is configured through S1's own reading (`toPortStepShape`: a card is configured when its
 * `config` is not null, HU2; a pill always is), so the ports `layoutGraph` places from
 * `portSlotsOf` agree with the menus of S5. Never mutates the plan.
 */
import { HUB_NETWORK } from "../../mandateDraft";
import type { BuildPlan, Chain, Step } from "../plan/buildPlan";
import { toPortStepShape } from "../plan/planRules";
import type { LayoutChain, LayoutInput, LayoutStep } from "./graphTypes";

function toLayoutStep(step: Step): LayoutStep {
  return {
    id: step.id,
    family: step.family,
    kind: step.kind,
    auto: step.family === "flow" ? step.auto : false,
    configured: toPortStepShape(step).configured,
  };
}

function toLayoutChain(chain: Chain): LayoutChain {
  const steps = chain.steps.flatMap((step, index) => {
    const mapped = toLayoutStep(step);
    if (
      step.family !== "position" ||
      step.kind !== "solanaHolding" ||
      step.config?.pair !== "SOL / USDC" ||
      chain.steps[index + 1]?.kind === "swap"
    )
      return [mapped];
    // PP-INTEGRATION-POINT: POO-2240/2262 owns real WSOL-to-USDC exit conversion; local drawing is intent only.
    return [
      mapped,
      {
        id: `local-return:${step.id}`,
        family: "flow" as const,
        kind: "swap",
        auto: true,
        configured: true,
        returnConversionOf: step.id,
      },
    ];
  });
  return { id: chain.id, sharePct: chain.sharePct, steps };
}

/** The layout input of a plan: hub chains and spokes left to right, steps top to bottom. */
export function toLayoutInput(
  plan: BuildPlan,
  options: { runtime?: "solana-local" } = {},
): LayoutInput {
  return {
    hubNetwork: HUB_NETWORK,
    hub: { chains: plan.hub.chains.map(toLayoutChain) },
    spokes: plan.spokes.map((spoke) => ({
      ...(options.runtime === "solana-local" && spoke.network === "solana"
        ? { context: "solana-local" as const }
        : {}),
      network: spoke.network,
      sharePct: spoke.sharePct,
      chains: spoke.chains.map(toLayoutChain),
    })),
  };
}
