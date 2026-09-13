/**
 * @id PP-CORE-CMP-046 (POO-1528)
 * @name ProvisioningPanel — the two signals a mobile host's own header needs (POO-1528 [M6.1])
 * @implements-rules-version v1 (POO-1528 rules v1)
 *
 * `onSourcesActiveChange` and `onCanGoBackChange` are deliberately separate from each other and
 * from `onLockChange` (the same "one signal, one name, one reason" precedent `onBuyActiveChange`,
 * POO-1527, already established). This file proves the straightforward half of each: the gear
 * signal fires once the `sources` step is reached, and the back signal stays `false` on the single-
 * route path (the common case, and the one every other `ProvisioningPanel` suite already exercises).
 *
 * The second describe below covers the other half: a REAL multi-route pick, reached the way
 * `ProvisioningPanel.onRamp.test.tsx` reaches it (the on-ramp flag on, so `resolveFundingRoutes`
 * returns three), so `onCanGoBackChange(true)`, `goBack()` reversing the pick, and the [R20] fallback
 * link's own 44pt floor are all exercised against the real screen rather than described in prose.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import { __resetDevOverridesForTests } from "@/lib/features/devOverrides";
import type { GasFeasibility } from "@/lib/provisioning";
import { SCENARIOS } from "@/lib/provisioning";
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import type { ProvisioningPanelHandle } from "./ProvisioningPanel";
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

const POLYGON = 137;
const ARBITRUM = 42161;

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

/** One holding that fully covers the requirement on its own chain: `shouldPickRoute` skips the
 * picker (only one viable route), so `sources` is reached directly with `routeChoice` still `null`
 * — the common path every other `ProvisioningPanel` suite already exercises this way. */
function singleRouteContext(): ProvisioningGateContext {
  return {
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
}

function noop() {}

describe("ProvisioningPanel — header signals (POO-1528 M6.1)", () => {
  it("[M6.1] reports onSourcesActiveChange(true) once the sources step is reached", async () => {
    const onSourcesActiveChange = vi.fn();
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        context={singleRouteContext()}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
        onSourcesActiveChange={onSourcesActiveChange}
      />,
    );
    await screen.findByTestId("funding-sources-confirm");

    expect(onSourcesActiveChange).toHaveBeenLastCalledWith(true);
  });

  it("[M6.1] reports onCanGoBackChange(false) on the single-route path (nothing to go back to)", async () => {
    const onCanGoBackChange = vi.fn();
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        context={singleRouteContext()}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
        onCanGoBackChange={onCanGoBackChange}
      />,
    );
    await screen.findByTestId("funding-sources-confirm");

    expect(onCanGoBackChange).toHaveBeenLastCalledWith(false);
    // [R20] Nothing to go back to on this path: the fallback link renders nothing at all.
    expect(screen.queryByText("Back")).not.toBeInTheDocument();
  });

  // @rule POO-1528 — `mobileHeaderMounted` must not change anything on a host that has not
  // adopted it: the prop defaults to `false`, so an un-migrated host (today, the two manager
  // modals) keeps every existing behaviour bit-for-bit.
  it("[M6.1] mobileHeaderMounted defaults to false and changes nothing by itself", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        context={singleRouteContext()}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    expect(await screen.findByTestId("funding-sources-confirm")).toBeInTheDocument();
  });

  it("[R20] goBack() is a safe no-op via the ref when there is nothing to go back to", async () => {
    const ref = { current: null as ProvisioningPanelHandle | null };
    renderWithProviders(
      <ProvisioningPanel
        ref={ref}
        input={SCENARIOS.usdcBridge}
        context={singleRouteContext()}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );
    await screen.findByTestId("funding-sources-confirm");

    expect(() => ref.current?.goBack()).not.toThrow();
    // Still on the sources screen: a no-op goBack must not have jumped the phase anywhere.
    expect(screen.getByTestId("funding-sources-confirm")).toBeInTheDocument();
  });
});

/**
 * The route-pick half. The on-ramp flag turns `resolveFundingRoutes` into three routes (tokens / buy /
 * deposit), which is what puts `1 Where from` on screen and makes a pick reversible — the same way
 * `ProvisioningPanel.onRamp.test.tsx` reaches that screen, flag and dev-override reset included,
 * because the client flag snapshot is memoised for the module's lifetime.
 */
describe("ProvisioningPanel — a real route pick to go back from (POO-1528 M6.1, [R20])", () => {
  beforeEach(() => {
    __resetDevOverridesForTests();
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP", "on");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    __resetDevOverridesForTests();
  });

  /** Render on `1 Where from`, then take the wallet route, which is the pick `goBack()` undoes. */
  async function pickTheWalletRoute(extra?: {
    onCanGoBackChange?: (canGoBack: boolean) => void;
    mobileHeaderMounted?: boolean;
    ref?: { current: ProvisioningPanelHandle | null };
  }) {
    renderWithProviders(
      <ProvisioningPanel
        {...(extra?.ref ? { ref: extra.ref } : {})}
        input={SCENARIOS.usdcBridge}
        context={singleRouteContext()}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
        {...(extra?.onCanGoBackChange ? { onCanGoBackChange: extra.onCanGoBackChange } : {})}
        {...(extra?.mobileHeaderMounted ? { mobileHeaderMounted: true } : {})}
      />,
    );
    expect(await screen.findByTestId("provisioning-panel")).toHaveAttribute("data-phase", "routes");
    fireEvent.click(screen.getByRole("button", { name: /^Use your \$/ }));
    await screen.findByTestId("funding-sources-confirm");
  }

  it("[M6.1] reports onCanGoBackChange(true) once a route has actually been picked", async () => {
    const onCanGoBackChange = vi.fn();
    await pickTheWalletRoute({ onCanGoBackChange });

    expect(onCanGoBackChange).toHaveBeenLastCalledWith(true);
  });

  /**
   * @rule POO-1526 [M5.2] / POO-1528 — the floor this control was DEFERRED to POO-1528 for. The
   * unified header only replaces it below `sm` on a host that mounts one, so the link itself has to
   * clear 44pt for every case that is left (above `sm`, and the two manager modals, which mount none).
   */
  it("[R20] the back link carries an explicit 44pt row of its own", async () => {
    await pickTheWalletRoute();

    expect(screen.getByRole("button", { name: "Back" })).toHaveClass("min-h-11");
  });

  // POO-1528 [M6.1]: with a host header mounted, the same link goes quiet BELOW `sm` only — it is
  // still the one back control above it, so it is hidden by breakpoint, never unmounted.
  it("[M6.1] the fallback link stays mounted and hides below sm once a host header exists", async () => {
    await pickTheWalletRoute({ mobileHeaderMounted: true });

    expect(screen.getByRole("button", { name: "Back" })).toHaveClass("hidden", "sm:flex");
  });

  it("[R20] goBack() reverses the pick and returns to the route picker", async () => {
    const ref = { current: null as ProvisioningPanelHandle | null };
    await pickTheWalletRoute({ ref });

    await act(async () => {
      ref.current?.goBack();
    });

    expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "routes");
  });
});
