/**
 * @id PP-CORE-CMP-046 (POO-1525)
 * @name ProvisioningPanel — the pinned CTA, wired (POO-1525 [M3.3])
 * @implements-rules-version v1 (POO-1525 rules v1)
 *
 * `StickyActionFooter.test.tsx` proves the wrapper itself pins, borders, backgrounds and
 * shadow-tracks correctly in isolation; `useStickyFooterShadow.test.ts` proves its scroll math. What
 * neither can see is whether every phase's terminal CTA is actually INSIDE one — the wiring, which is
 * exactly where the equivalent POO-1541 gap lived (an event correctly built, never actually called).
 *
 * This file covers the two sites reachable with no special module mock: `FundingSourceSelector`
 * (`sources`) and the running state button (`pending`, no failure). The other three sites each need a
 * mock only their own existing suite already sets up correctly (`vi.mock` is file-scoped, so
 * duplicating it here risks silently breaking the scenario rather than testing it):
 *   - the price-impact alert (`impact`) and `GasTopUpBody` (`gas`): `ProvisioningPanel.priceImpact.test.tsx`
 *   - the `8b` slippage-raise prompt (`pending`, second failure): `ProvisioningPanel.slippageRetry.test.tsx`
 * The `error` phase is deliberately absent everywhere: `TransactionErrorActions` is shared by five
 * other flows and out of this issue's scope (see the comment at its call site in `ProvisioningPanel.tsx`).
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import type { GasFeasibility } from "@/lib/provisioning";
import { SCENARIOS } from "@/lib/provisioning";
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
import { renderWithProviders, screen } from "../../../../tests/utils/renderWithProviders";
import { ProvisioningPanel } from "./ProvisioningPanel";

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
  useRouter: () => ({ push: vi.fn() }),
}));

function noop() {}

const POLYGON = 137;
const ARBITRUM = 42161;

/** The CTA's own testid, if present, must sit inside the pinned footer, not beside it. */
function expectPinned(ctaTestId: string) {
  const cta = screen.getByTestId(ctaTestId);
  const footer = screen.getByTestId("provisioning-sticky-footer");
  expect(footer).toContainElement(cta);
}

function verdict(chainId: number): GasFeasibility {
  return {
    chainId,
    verdict: "OK",
    quotedGasUsd: 0.02,
    requiredGasUsd: 0.075,
    shortfallUsd: 0,
    surplusUsd: 1,
    reasonKey: "provisioning.gasVerdict.ok",
  };
}

describe("ProvisioningPanel — the terminal CTA stays pinned (POO-1525)", () => {
  it("[sources] pins FundingSourceSelector's Confirm and start", async () => {
    const context: ProvisioningGateContext = {
      targetChainId: ARBITRUM,
      sources: [
        {
          address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
          chainId: POLYGON,
          symbol: "WETH",
          decimals: 18,
          amount: "400000000000000000",
          usd: 1_200,
          reachableChainIds: [POLYGON, ARBITRUM],
          isNative: false,
          logoUrl: "",
        } as FundingSource,
      ],
      gasByChain: { [POLYGON]: verdict(POLYGON), [ARBITRUM]: verdict(ARBITRUM) },
      balancesByChain: {
        [POLYGON]: { nativeUsd: 5, tokenUsd: 1_200 },
        [ARBITRUM]: { nativeUsd: 0, tokenUsd: 0 },
      },
      gasEstimateUsd: 0.075,
    };
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        context={context}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );
    await screen.findByTestId("funding-sources-confirm");

    expectPinned("funding-sources-confirm");
  });

  it("[pending, no failure] pins the running state button", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        // Never settles: the state button's disabled "Processing" moment is the one under test.
        buildPlanSteps={() => [{ key: "hang", run: () => new Promise<never>(() => {}) }]}
      />,
    );
    await screen.findByTestId("provisioning-exec-state");

    expectPinned("provisioning-exec-state");
  });
});
