/**
 * @id PP-CORE-CMP-046 (POO-1808) - tests
 * @name ProvisioningPanel - the buy step routes by rail
 * @implements-rules-version v1 (POO-1808 rules v1)
 * @analytics-events none, the emissions are asserted in `ProvisioningPanel.privyBuy.analytics.test.tsx`.
 *
 * What the PANEL owns here is routing and the promise, not the purchase: `PrivyBuyStep.test.tsx`
 * proves the step's own rules against mocked deps, and this suite proves the panel hands the buy leg
 * to the right rail and lets the step settle it.
 *
 * So the step itself is doubled. That is the seam on purpose: driving a real checkout through the
 * panel would need a Privy provider and would test POO-1803's adapter a second time, while what is
 * actually at stake here is that `runOnRampBuy` resolves only when the step says the DELTA arrived,
 * and stays pending when it says the ceiling was reached.
 *
 * [R1] The Paybis path is not touched. Every existing `ProvisioningPanel.*.test.tsx` suite runs
 * unchanged beside this one, which is the real assertion behind that rule.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import { __resetDevOverridesForTests } from "@/lib/features/devOverrides";
import type { GasFeasibility, ProvisioningPlan } from "@/lib/provisioning";
import { SCENARIOS } from "@/lib/provisioning";
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
import type { ProvisioningOrder } from "@/lib/provisioning/types";
import { realProvisioningPlan } from "../../../../tests/fixtures/realProvisioningPlan";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { ProvisioningPanel, type ProvisioningPanelHandle } from "./ProvisioningPanel";

const { planHolder, railHolder, stepHolder } = vi.hoisted(() => ({
  planHolder: { current: null as ProvisioningPlan | null },
  railHolder: {
    /**
     * WHICH rail the panel sees. Mocked at the module rather than driven through the Dev-menu
     * override, because turning `fiatOnRamp` on also puts a buy ROUTE in front of step 2, and this
     * suite is about what `runOnRampBuy` does once a buy leg runs, not about how the buyer got there.
     */
    onRampRail: "privy" as "paybis" | "privy" | "none",
    openJournal: vi.fn(),
    closeJournal: vi.fn(),
    /** Captured from the panel so a test can run the buy leg the way the rail would. */
    runOnRampBuy: null as
      | ((args: { order: ProvisioningOrder; expectedToken: unknown }) => Promise<void>)
      | null,
    /** What the stub rail's single step does. Replaced per test. */
    buyRun: (async () => {}) as () => Promise<unknown>,
  },
  /** The props the panel handed the step, so a test can settle or fail it. */
  stepHolder: {
    order: null as ProvisioningOrder | null,
    onSettled: null as (() => void) | null,
    onFailed: null as ((error: Error) => void) | null,
    renders: 0,
  },
}));

vi.mock("@/lib/onramp/useOnRampProvider", () => ({
  useOnRampProvider: () => railHolder.onRampRail,
}));

vi.mock("../hooks/useProvisioningPlan", () => ({
  useProvisioningPlan: () => ({
    plan: planHolder.current,
    loading: false,
    error: null,
    refresh: () => {},
  }),
}));

vi.mock("../hooks/useProvisioningRail", () => ({
  useProvisioningRail: () => ({
    buildSteps: (
      _plan: ProvisioningPlan,
      reporters: {
        runOnRampBuy?: (args: {
          order: ProvisioningOrder;
          expectedToken: unknown;
        }) => Promise<void>;
      },
    ) => {
      railHolder.runOnRampBuy = reporters.runOnRampBuy ?? null;
      // The key MATCHES the plan's own buy step. The panel re-keys the flow's positional statuses by
      // step key (`statusByKey`), so a rail step named anything else leaves every row `idle` and the
      // error screen can never find the row that failed.
      return [{ key: "buy", run: async () => railHolder.buyRun() }];
    },
    openJournal: railHolder.openJournal,
    closeJournal: railHolder.closeJournal,
  }),
}));

/**
 * The step is doubled: this suite is about the panel's routing, not the step's internals.
 *
 * The three codes are re-exported with their real values rather than left off the mock. The panel
 * imports them to map a rejection to a sentence, and a mock that dropped them made the panel throw
 * on render, which reads as an empty screen and blames the assertion instead of the double.
 */
vi.mock("./provisioning/PrivyBuyStep", () => ({
  ONRAMP_NATIVE_UNAVAILABLE_CODE: "ONRAMP_NATIVE_UNAVAILABLE",
  ONRAMP_UNCOVERED_CODE: "ONRAMP_UNCOVERED",
  ONRAMP_CURRENCY_UNSUPPORTED_CODE: "ONRAMP_CURRENCY_UNSUPPORTED",
  ConnectedPrivyBuyStep: (props: {
    order: ProvisioningOrder;
    onSettled: () => void;
    onFailed: (error: Error) => void;
  }) => {
    stepHolder.order = props.order;
    stepHolder.onSettled = props.onSettled;
    stepHolder.onFailed = props.onFailed;
    stepHolder.renders += 1;
    return <div data-testid="privy-buy-step" />;
  },
}));

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

const ARBITRUM = 42161;
const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const OPERATION = { kind: "invest" as const, strategyId: "strat-1" };

const BUY_ORDER: ProvisioningOrder = {
  currencyCode: "USDC-BASE",
  fiatAmount: "120.00",
  fiatCurrency: "USD",
};

function noop() {}

/**
 * A plan that LEADS with the fiat buy, the shape `buildOnRampSteps` produces for a wallet with no
 * money on it. `realProvisioningPlan` is a swap-and-bridge plan with no buy leg at all, which is the
 * right default for every other case here and the wrong one for anything that asserts what a failed
 * BUY row says.
 */
function buyLedPlan(): ProvisioningPlan {
  return realProvisioningPlan({
    steps: [
      {
        type: "buy",
        key: "buy",
        labelKey: "provisioning.steps.buy",
        fromToken: "USD",
        toToken: "USDC",
        toChainId: 8453,
        amountUsd: 120,
        amountToken: "120.00",
        order: BUY_ORDER,
      },
      { type: "op", key: "op", labelKey: "provisioning.steps.op", amountUsd: 120 },
    ],
  });
}

function liveContext(): ProvisioningGateContext {
  const source: FundingSource = {
    chainId: ARBITRUM,
    address: USDC_ARBITRUM,
    symbol: "USDC",
    decimals: 6,
    amount: "500000000",
    usd: 500,
    reachableChainIds: [ARBITRUM],
    isNative: false,
    logoUrl: "",
  };
  const gas: GasFeasibility = {
    chainId: ARBITRUM,
    verdict: "OK",
    quotedGasUsd: 0.02,
    requiredGasUsd: 0.075,
    shortfallUsd: 0,
    surplusUsd: 5,
    reasonKey: "provisioning.gasVerdict.ok",
  };
  return {
    targetChainId: ARBITRUM,
    sources: [source],
    gasByChain: { [ARBITRUM]: gas },
    balancesByChain: { [ARBITRUM]: { nativeUsd: 5, tokenUsd: 500 } },
    gasEstimateUsd: 0.075,
  };
}

function renderPanel(
  extra: {
    onLockChange?: (locked: boolean) => void;
    onBuyActiveChange?: (active: boolean) => void;
    handleRef?: { current: ProvisioningPanelHandle | null };
  } = {},
) {
  const { handleRef, ...props } = extra;
  return renderWithProviders(
    <ProvisioningPanel
      ref={handleRef}
      input={SCENARIOS.usdcBridge}
      context={liveContext()}
      operation={OPERATION}
      opLabel="Invest in Stable Yield"
      onDone={noop}
      onCancel={noop}
      {...props}
    />,
  );
}

/**
 * Render and take the buy reporter the panel handed the rail.
 *
 * Deliberately NOT driven through the funding-route UI: with `fiatOnRamp` on, step 1 offers a buy
 * route that has its own flow, and clicking through it would make this suite a test of that flow
 * instead of of the routing it is about. `runOnRampBuy` is the contract the rail actually calls, so
 * these cases call it the same way.
 */
async function startRun(): Promise<void> {
  renderPanel();
  fireEvent.click(await screen.findByRole("button", { name: "Confirm and start" }));
}

beforeEach(() => {
  localStorage.clear();
  __resetDevOverridesForTests();
  planHolder.current = realProvisioningPlan();
  railHolder.runOnRampBuy = null;
  railHolder.onRampRail = "privy";
  railHolder.buyRun = async () => {};
  stepHolder.order = null;
  stepHolder.onSettled = null;
  stepHolder.onFailed = null;
  stepHolder.renders = 0;
});

afterEach(() => {
  localStorage.clear();
  __resetDevOverridesForTests();
});

describe("[R1] the buy step routes by rail", () => {
  it("[R1] renders the Privy step when the rail is privy", async () => {
    railHolder.buyRun = () =>
      railHolder.runOnRampBuy?.({ order: BUY_ORDER, expectedToken: null }) ?? Promise.resolve();
    await startRun();

    expect(await screen.findByTestId("privy-buy-step")).toBeInTheDocument();
    // The order rides through untouched: `buildOnRampSteps` and `ProvisioningOrder` are not modified
    // by this issue, so what the planner produced is what the step receives.
    await waitFor(() => expect(stepHolder.order).toEqual(BUY_ORDER));
  });

  it("[R1] does NOT render it on the Paybis path", async () => {
    // `fiatOnRamp` on, `privyOnRamp` off, which is today's rail and today's behaviour.
    railHolder.onRampRail = "paybis";
    railHolder.buyRun = () =>
      railHolder.runOnRampBuy?.({ order: BUY_ORDER, expectedToken: null }) ?? Promise.resolve();
    await startRun();

    // The Paybis path goes to the method step and the mint, and never to this step.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId("privy-buy-step")).not.toBeInTheDocument();
  });
});

describe("[R5] every exit path knows about the second rail", () => {
  /**
   * The four places the panel asks "is a buy up right now?" all read `onRampBuy`, which is the
   * PAYBIS state and stays null for the whole of a Privy purchase. Each gets its own case, because
   * each fails differently and silently: a modal that cannot be dismissed, a live drag over a card
   * form, an abandonment filed under the wrong screen, and a run orphaned behind an unmounted step.
   */
  it("[R5] releases the dismissal lock while the checkout is up", async () => {
    const onLockChange = vi.fn();
    railHolder.buyRun = () =>
      railHolder.runOnRampBuy?.({ order: BUY_ORDER, expectedToken: null }) ?? Promise.resolve();
    renderPanel({ onLockChange });
    fireEvent.click(await screen.findByRole("button", { name: "Confirm and start" }));

    await screen.findByTestId("privy-buy-step");
    // [R13]: the buyer is inside a provider's own surface with nothing of ours in flight, so the
    // modal stays dismissable. Locking here is the production trap that rule was written after.
    await waitFor(() => expect(onLockChange).toHaveBeenLastCalledWith(false));
  });

  it("[R5] reports the buy as ACTIVE, so the host disables drag-to-dismiss", async () => {
    const onBuyActiveChange = vi.fn();
    railHolder.buyRun = () =>
      railHolder.runOnRampBuy?.({ order: BUY_ORDER, expectedToken: null }) ?? Promise.resolve();
    renderPanel({ onBuyActiveChange });
    fireEvent.click(await screen.findByRole("button", { name: "Confirm and start" }));

    await screen.findByTestId("privy-buy-step");
    await waitFor(() => expect(onBuyActiveChange).toHaveBeenLastCalledWith(true));
  });

  it("[R5] requestClose fails the buy instead of orphaning the run behind an unmounted step", async () => {
    // Without this branch the close falls through to the `Stop here?` interception, and if it ever
    // proceeded, `runOnRampBuy` would be left pending behind a step that no longer exists: the rail
    // never advances and never fails, and nothing names what the purchase was funding.
    let rejection: unknown = null;
    railHolder.buyRun = () =>
      (
        railHolder.runOnRampBuy?.({ order: BUY_ORDER, expectedToken: null }) ?? Promise.resolve()
      ).catch((error: unknown) => {
        rejection = error;
      });
    const handle: { current: ProvisioningPanelHandle | null } = { current: null };
    renderPanel({ handleRef: handle });
    fireEvent.click(await screen.findByRole("button", { name: "Confirm and start" }));
    await screen.findByTestId("privy-buy-step");

    // Nothing of ours is signed or broadcast, so leaving is allowed and the close proceeds.
    expect(handle.current?.requestClose()).toBe(true);
    // `onRampTerminalError` builds a `TransactionError(message, cause)`, so the code rides on the
    // CAUSE, which is where `diagnostics.ts` walks for it. Asserted where it actually lives rather
    // than where a hand-built error would put it.
    await waitFor(() => expect(rejection).toMatchObject({ cause: { code: "ONRAMP_CLOSED" } }));
  });
});

describe("[R7] the panel is what the buyer actually reads on a refusal", () => {
  /**
   * The step paints its own refusal copy, and then its `onFailed` rejects the leg in the SAME React
   * batch: the panel swaps to the error screen and the sentence never survives a paint. So the
   * causes have to be spelled here too, or a buyer meets "your purchase did not go through, you can
   * try again" for a rail that will refuse identically every time.
   */
  it.each([
    ["ONRAMP_NATIVE_UNAVAILABLE", /can't buy ETH with cash/i],
    ["ONRAMP_UNCOVERED", /no payment provider can sell to you/i],
    ["ONRAMP_CURRENCY_UNSUPPORTED", /can't take a card payment/i],
  ])("[R7] %s reads as its own cause, not the generic failure", async (code, sentence) => {
    // A plan whose failing row IS a buy: the sentence is chosen by `failedRow.type`, so a plan with
    // no buy leg would take the generic wallet-transaction copy for reasons that have nothing to do
    // with the mapping under test.
    planHolder.current = buyLedPlan();
    railHolder.buyRun = () =>
      railHolder.runOnRampBuy?.({ order: BUY_ORDER, expectedToken: null }) ?? Promise.resolve();
    await startRun();
    await screen.findByTestId("privy-buy-step");

    stepHolder.onFailed?.(Object.assign(new Error("refused"), { code }));

    expect(await screen.findByText(sentence)).toBeInTheDocument();
    // And NOT the generic buy-failure body, whose promise is "you can try again". Matched on its own
    // full sentence rather than a fragment: the failed ROW's caption says "This step did not go
    // through" too, and that one is correct and stays.
    expect(
      screen.queryByText(/your purchase did not go through, so no funds were moved/i),
    ).not.toBeInTheDocument();
  });
});

describe("[R3] the promise resolves on the delta and nothing else", () => {
  it("[R3] resolves runOnRampBuy when the step reports a settlement", async () => {
    let resolved = false;
    railHolder.buyRun = () =>
      (
        railHolder.runOnRampBuy?.({ order: BUY_ORDER, expectedToken: null }) ?? Promise.resolve()
      ).then(() => {
        resolved = true;
      });
    await startRun();

    await screen.findByTestId("privy-buy-step");
    expect(resolved).toBe(false);

    stepHolder.onSettled?.();
    await waitFor(() => expect(resolved).toBe(true));
  });

  it("[R3] rejects with the step's typed error, so the run fails legibly", async () => {
    let rejection: unknown = null;
    railHolder.buyRun = () =>
      (
        railHolder.runOnRampBuy?.({ order: BUY_ORDER, expectedToken: null }) ?? Promise.resolve()
      ).catch((error: unknown) => {
        rejection = error;
      });
    await startRun();

    await screen.findByTestId("privy-buy-step");
    stepHolder.onFailed?.(
      Object.assign(new Error("no provider sells to this buyer right now"), {
        code: "ONRAMP_UNCOVERED",
      }),
    );

    await waitFor(() => expect(rejection).toMatchObject({ code: "ONRAMP_UNCOVERED" }));
  });

  it("[R3] leaves the promise PENDING while the step is still observing", async () => {
    // The ceiling case. Nothing is resolved, nothing is rejected, and the step stays on screen: the
    // run pauses rather than claiming an outcome nobody has observed.
    let outcome: "resolved" | "rejected" | null = null;
    railHolder.buyRun = () =>
      (
        railHolder.runOnRampBuy?.({ order: BUY_ORDER, expectedToken: null }) ?? Promise.resolve()
      ).then(
        () => {
          outcome = "resolved";
        },
        () => {
          outcome = "rejected";
        },
      );
    await startRun();

    await screen.findByTestId("privy-buy-step");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(outcome).toBeNull();
    expect(screen.getByTestId("privy-buy-step")).toBeInTheDocument();
  });
});
