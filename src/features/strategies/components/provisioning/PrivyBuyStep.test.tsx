/**
 * @id PP-STR-CMP-029 (POO-1808) - tests
 * @name PrivyBuyStep - tests
 * @implements-rules-version v1 (POO-1808 rules v1)
 * @analytics-events tx_amount_blocked, asserted here on every refusal path.
 *
 * The step is rendered against MOCKED deps, never against a Privy provider: `@privy-io/react-auth`
 * is not mocked in this suite at all, because the component's inner half takes its adapter, watcher
 * and probe as props. That is the whole reason the component is split, and it is what lets these
 * cases drive an inconclusive exit or a ceiling without a network or an SDK.
 *
 * [R3] is the rule these cases exist for: the promise resolves on the observed DELTA and on nothing
 * else. A provider's `confirmed` is a claim about a card, not about money arriving, and resolving
 * there would be a new fabricated success.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/i18n/messages/en/strategies.json";
import type { OnRampObservationInput } from "@/lib/onramp/awaitOnRampSettlement";
import type { PrivyOnRampInput } from "@/lib/onramp/usePrivyOnRamp";
import type { ProvisioningOrder } from "@/lib/provisioning/types";
import { PrivyBuyStep, type PrivyBuyStepDeps, type PrivyBuyStepProps } from "./PrivyBuyStep";

const ADDRESS = "0x1111111111111111111111111111111111111111";

const USDC_ORDER: ProvisioningOrder = {
  currencyCode: "USDC-BASE",
  fiatAmount: "120.00",
  fiatCurrency: "USD",
};

/**
 * Typed doubles, hoisted rather than defaulted inline.
 *
 * `handlers.onFailed ?? vi.fn()` types as `Mock | ((e: Error) => void)`, and `.mock` does not exist
 * on the second half of that union, so every assertion about what the step rejected with failed to
 * compile. Declaring them here gives one `Mock` type for both the call and the inspection.
 */
function handlerDoubles() {
  return {
    onSettled: vi.fn<() => void>(),
    onFailed: vi.fn<(error: Error) => void>(),
  };
}

function renderStep(
  deps: Partial<PrivyBuyStepDeps> = {},
  order: ProvisioningOrder = USDC_ORDER,
  extra: Partial<Pick<PrivyBuyStepProps, "buyerCurrency" | "analytics">> = {},
) {
  const full: PrivyBuyStepDeps = {
    openCheckout: vi.fn(async () => ({
      attemptId: "att_1",
      moved: "confirmed" as const,
      reason: "ok",
    })),
    probeCoverage: vi.fn(async () => ({ status: "covered" as const, methods: [] })),
    readBalance: vi.fn(async () => BigInt(0)),
    watchVisible: vi.fn(async () => ({
      outcome: "settled" as const,
      delivered: { amount: "120", asset: "0xusdc", chain: "eip155:8453", observedAt: 1 },
    })),
    sleep: async () => {},
    now: () => 0,
    environment: "sandbox",
    ...deps,
  };
  const { onSettled, onFailed } = handlerDoubles();
  render(
    <NextIntlClientProvider locale="en" messages={{ strategies: messages }}>
      <PrivyBuyStep
        order={order}
        address={ADDRESS}
        onSettled={onSettled}
        onFailed={onFailed}
        deps={full}
        {...extra}
      />
    </NextIntlClientProvider>,
  );
  return { deps: full, onSettled, onFailed };
}

/** The code the step rejected with, typed so no case has to re-cast it. */
function rejectedCode(onFailed: ReturnType<typeof handlerDoubles>["onFailed"]): string | undefined {
  const error = onFailed.mock.calls[0]?.[0] as (Error & { code?: string }) | undefined;
  return error?.code;
}

/**
 * The first argument of the first call to an injected double.
 *
 * `noUncheckedIndexedAccess` makes every `.mock.calls[0][0]` a possible `undefined`, and asserting
 * it away at each of a dozen call sites reads worse than saying once, here, that these cases only
 * reach this line after a `waitFor` proved the call happened.
 */
function firstArg<T>(double: PrivyBuyStepDeps[keyof PrivyBuyStepDeps]): T {
  const calls = (double as ReturnType<typeof vi.fn>).mock.calls;
  const first = calls[0];
  if (!first) throw new Error("the double was never called");
  return first[0] as T;
}

/**
 * Click the CTA only once it is actually enabled.
 *
 * [R5] holds the button disabled until the baseline exists, so clicking on first render is a race
 * the component is designed to win: `userEvent.click` on a disabled button does nothing, and the
 * test would then assert against a step that never opened.
 */
async function clickOpen(): Promise<void> {
  const cta = await screen.findByRole("button");
  await waitFor(() => expect(cta).toBeEnabled());
  await userEvent.click(cta);
}

beforeEach(() => {
  window.dataLayer = [];
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("PrivyBuyStep", () => {
  // @rule R4
  it("[R4] refuses a native order before opening anything", async () => {
    // POO-1820 answered NO to selling native on this rail, so the gas-first leg is refused rather
    // than sent to a checkout that cannot fill it.
    const { deps, onFailed } = renderStep({}, { ...USDC_ORDER, currencyCode: "ETH-BASE" });

    await waitFor(() => expect(onFailed).toHaveBeenCalled());
    expect(rejectedCode(onFailed)).toBe("ONRAMP_NATIVE_UNAVAILABLE");
    expect(deps.openCheckout).not.toHaveBeenCalled();
    // Not even a balance read: work done for a checkout that never appears.
    expect(deps.readBalance).not.toHaveBeenCalled();
  });

  // @rule R8
  it("[R8] reports the native refusal as a blocked amount", async () => {
    renderStep({}, { ...USDC_ORDER, currencyCode: "ETH-BASE" });
    await waitFor(() =>
      expect(window.dataLayer).toContainEqual(
        expect.objectContaining({
          event: "tx_amount_blocked",
          block_reason: "onramp_native_unavailable",
        }),
      ),
    );
  });

  // @rule R8
  it("[R8] carries the flow and the strategy the panel gave it", async () => {
    // A blocked intent with no `flow` cannot be attributed to a funnel at all, which is the whole
    // point of measuring it. The panel is the only thing that knows either value.
    renderStep(
      {},
      { ...USDC_ORDER, currencyCode: "ETH-BASE" },
      {
        analytics: { flow: "invest", strategyId: "strat-7" },
      },
    );

    await waitFor(() =>
      expect(window.dataLayer).toContainEqual(
        expect.objectContaining({
          event: "tx_amount_blocked",
          block_reason: "onramp_native_unavailable",
          flow: "invest",
          strategy_id: "strat-7",
        }),
      ),
    );
  });

  // @rule R6
  it("[R6] refuses before opening when nobody will sell", async () => {
    const { deps, onFailed } = renderStep({
      probeCoverage: vi.fn(async () => ({ status: "uncovered" as const })),
    });

    await waitFor(() => expect(onFailed).toHaveBeenCalled());
    expect(rejectedCode(onFailed)).toBe("ONRAMP_UNCOVERED");
    expect(deps.openCheckout).not.toHaveBeenCalled();
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "tx_amount_blocked", block_reason: "onramp_uncovered" }),
    );
  });

  // @rule R6
  it("[R6] an unknown probe does NOT block", async () => {
    // "We could not find out" is not "nobody will sell", and refusing on it would take a purchase
    // away on the strength of a failed request.
    const { deps } = renderStep({
      probeCoverage: vi.fn(async () => ({
        status: "unknown" as const,
        reason: "upstream" as const,
      })),
    });

    await clickOpen();
    await waitFor(() => expect(deps.openCheckout).toHaveBeenCalled());
  });

  // @rule R6
  it("[R6] an amount below the RAIL's own floor does not block either", async () => {
    // The floor our order clears is ours (`ON_RAMP_FLOOR_USD`); the rail's display floor is theirs,
    // and treating it as a refusal here would put a second opinion of the floor in front of a buy
    // the planner already sized.
    const { deps } = renderStep({
      probeCoverage: vi.fn(async () => ({ status: "amount-too-low" as const, railFloor: 20 })),
    });

    await clickOpen();
    await waitFor(() => expect(deps.openCheckout).toHaveBeenCalled());
  });

  // @rule R7
  it("[R7] always passes the rail's FULL currency list, even on a covered probe", async () => {
    // A `covered` answer is about ONE amount in ONE currency. Narrowing `assets` to it would take
    // the buyer's own currency picker away inside the checkout on the strength of a question nobody
    // asked, and it is `defaultAsset` that decides where they land.
    const { deps } = renderStep();
    await clickOpen();
    await waitFor(() => expect(deps.openCheckout).toHaveBeenCalled());
    const input = firstArg<PrivyOnRampInput>(deps.openCheckout);
    expect(input.fiat.defaultAsset).toBe("usd");
    expect(input.fiat.assets.length).toBeGreaterThan(40);
  });

  // @rule R7
  it("[R7] opens in the SERVER-resolved buyer currency, not the order's constant USD", async () => {
    // `order.fiatCurrency` is written `"USD"` by the sizer for every buyer on earth, so reading the
    // currency off the order would open every checkout in dollars while looking like it had asked.
    const { deps } = renderStep({}, USDC_ORDER, { buyerCurrency: "EUR" });
    await clickOpen();
    await waitFor(() => expect(deps.openCheckout).toHaveBeenCalled());
    const input = firstArg<PrivyOnRampInput>(deps.openCheckout);
    expect(input.fiat.defaultAsset).toBe("eur");
  });

  // @rule R7
  it("[R7] falls back to USD only when no currency resolved at all", async () => {
    const { deps } = renderStep();
    await clickOpen();
    await waitFor(() => expect(deps.openCheckout).toHaveBeenCalled());
    const input = firstArg<PrivyOnRampInput>(deps.openCheckout);
    expect(input.fiat.defaultAsset).toBe("usd");
  });

  // @rule R7
  it("[R7] REFUSES a resolved currency the rail cannot charge in, never defaults it to USD", async () => {
    // The POO-1512 class: a silent USD fallback charges a buyer in money nobody chose for them and
    // lets their bank take the conversion, and it looks like a successful purchase from every angle
    // we can see. So it is a blocked intent instead.
    const { deps, onFailed } = renderStep({}, USDC_ORDER, { buyerCurrency: "XYZ" });

    await waitFor(() => expect(onFailed).toHaveBeenCalled());
    expect(rejectedCode(onFailed)).toBe("ONRAMP_CURRENCY_UNSUPPORTED");
    expect(deps.openCheckout).not.toHaveBeenCalled();
    expect(deps.readBalance).not.toHaveBeenCalled();
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({
        event: "tx_amount_blocked",
        block_reason: "onramp_currency_unsupported",
      }),
    );
  });

  // @rule R5
  it("[R5] keeps the CTA disabled until the baseline exists, says so, and REPORTS it", async () => {
    // A baseline we could not read is not a zero. Opening with a zero would credit the buyer's own
    // balance as a delivery the moment the watcher looked. The report is what makes the wall
    // visible: without it the buyer meets a line that never resolves and nothing records it.
    renderStep({
      readBalance: vi.fn(async () => {
        throw new Error("rpc down");
      }),
    });

    expect(await screen.findByRole("button")).toBeDisabled();
    expect(screen.getByText(/checking your balance/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(window.dataLayer).toContainEqual(
        expect.objectContaining({
          event: "tx_amount_blocked",
          block_reason: "onramp_baseline_unreadable",
        }),
      ),
    );
  });

  // @rule R5
  it("[R5] hands the SAME baseline to the checkout call and the watcher", async () => {
    const { deps } = renderStep({ readBalance: vi.fn(async () => BigInt(5_000_000)) });
    await clickOpen();
    await waitFor(() => expect(deps.watchVisible).toHaveBeenCalled());
    expect(firstArg<OnRampObservationInput>(deps.watchVisible).baseline).toBe(BigInt(5_000_000));
    // And the adapter gets it too, as the base-unit STRING its intent record stores: the mint is
    // what a later session reads the zero mark back from.
    const input = firstArg<PrivyOnRampInput>(deps.openCheckout);
    expect(input.baseline).toEqual({ raw: "5000000", decimals: 6 });
  });

  // @rule R3
  it("[R3] resolves only on the observed delta, never on the provider's claim", async () => {
    const { onSettled, deps } = renderStep();
    await clickOpen();

    await waitFor(() => expect(onSettled).toHaveBeenCalled());
    // The claim was `confirmed`, and it started the WATCH rather than settling anything.
    expect(deps.watchVisible).toHaveBeenCalled();
  });

  // @rule R3
  it("[R3] HANDS OVER to the settling screen at the ceiling, and never says cancelled", async () => {
    // Not a failure and not a cancellation: the money may be in flight. But not a pending promise
    // either, which froze the run on a step with no exit. `ONRAMP_SETTLING` is the code the panel's
    // own settling screen already reads on the other rail.
    const watchVisible = vi.fn(async () => ({ outcome: "settling" as const }));
    const { onSettled, onFailed } = renderStep({ watchVisible });
    await clickOpen();
    await waitFor(() => expect(watchVisible).toHaveBeenCalled());

    await waitFor(() => expect(onFailed).toHaveBeenCalled());
    expect(rejectedCode(onFailed)).toBe("ONRAMP_SETTLING");
    expect(onSettled).not.toHaveBeenCalled();
    expect(screen.queryByText(/cancel/i)).not.toBeInTheDocument();
  });

  // @rule R3
  it("[R3] an unverified ceiling hands over the same way", async () => {
    const watchVisible = vi.fn(async () => ({ outcome: "unverified" as const }));
    const { onSettled, onFailed } = renderStep({ watchVisible });
    await clickOpen();
    await waitFor(() => expect(watchVisible).toHaveBeenCalled());

    await waitFor(() => expect(onFailed).toHaveBeenCalled());
    expect(rejectedCode(onFailed)).toBe("ONRAMP_SETTLING");
    expect(onSettled).not.toHaveBeenCalled();
  });

  // @rule R3
  it("[R3] a watcher that THROWS reports an observer failure instead of hanging", async () => {
    // Whatever broke is ours, not the buyer's. Before this the rejection escaped an un-caught async
    // IIFE and the promise stayed pending forever.
    const watchVisible = vi.fn(async () => {
      throw new Error("rpc gone");
    });
    const { onFailed, onSettled } = renderStep({ watchVisible });
    await clickOpen();

    await waitFor(() => expect(onFailed).toHaveBeenCalled());
    expect(rejectedCode(onFailed)).toBe("ONRAMP_OBSERVER_FAILED");
    expect(onSettled).not.toHaveBeenCalled();
  });

  // @rule R3
  it("[R3] a hard no rejects with the MAPPED code, never the classifier's raw reason", async () => {
    /**
     * POO-1813 [R1]. The panel reports this `code` as the run's `error_code`, and the classifier's
     * own reason is a lowercase slug (`popup_blocked`): it fails `isAnalyticsErrorCodeShape`, so
     * `sanitizeParams` dropped it and `toAnalyticsErrorCode` folded the whole family into
     * `SYSTEM_UNKNOWN`. Every distinct hard no arrived as the same unusable row.
     */
    const { onFailed } = renderStep({
      openCheckout: vi.fn(async () => ({
        attemptId: null,
        moved: "no" as const,
        reason: "popup_blocked",
      })),
    });
    await clickOpen();

    await waitFor(() => expect(onFailed).toHaveBeenCalled());
    expect(rejectedCode(onFailed)).toBe("ONRAMP_POPUP_BLOCKED");
  });

  // @rule R3
  it("[R3] a reason nobody has mapped yet is still shape-valid, never blank", async () => {
    // A provider that adds a rejection message must not be able to break a purchase through the
    // analytics path, and an `ONRAMP_UNMAPPED` in a report IS the signal to add the row.
    const { onFailed } = renderStep({
      openCheckout: vi.fn(async () => ({
        attemptId: null,
        moved: "no" as const,
        reason: "something_privy_added_last_week",
      })),
    });
    await clickOpen();

    await waitFor(() => expect(onFailed).toHaveBeenCalled());
    expect(rejectedCode(onFailed)).toBe("ONRAMP_UNMAPPED");
  });

  /**
   * POO-1813 [R4]: the settled row, from the OBSERVED delta and from nothing else.
   *
   * Read off `window.dataLayer`, so what is asserted is what GTM would receive. The step's own
   * `onSettled` prop is the PANEL's promise and says nothing about analytics; asserting on it would
   * pass with the emitter deleted.
   */
  it("[R4] reports the observed delta as the purchase's settled row", async () => {
    const { onSettled } = renderStep();
    await clickOpen();
    await waitFor(() => expect(onSettled).toHaveBeenCalled());

    const [settled] = (window.dataLayer ?? []).filter(
      (row): row is Record<string, unknown> =>
        (row as { event?: string }).event === "funding_buy_settled",
    );
    expect(settled).toMatchObject({
      rail: "privy",
      attempt_id: "att_1",
      requested_usd: 120,
      prefill_usd: 120,
      // The watcher's figure, never the requested one.
      delivered_usd: 120,
      fiat_currency: "USD",
    });
  });

  // @rule R4
  it("[R4] omits prefill_usd, and names the CHARGE currency, for a non-USD buyer", async () => {
    // We send that buyer no amount at all, so a `prefill_usd: 0` would enter the buffer series as a
    // figure we never asked for. And `order.fiatCurrency` is the planner's constant "USD", so the
    // charge currency has to come from what the checkout actually opens in.
    const { onSettled } = renderStep({}, USDC_ORDER, { buyerCurrency: "EUR" });
    await clickOpen();
    await waitFor(() => expect(onSettled).toHaveBeenCalled());

    const [settled] = (window.dataLayer ?? []).filter(
      (row): row is Record<string, unknown> =>
        (row as { event?: string }).event === "funding_buy_settled",
    );
    expect(settled).not.toHaveProperty("prefill_usd");
    expect(settled).toMatchObject({ fiat_currency: "EUR", requested_usd: 120 });
  });

  // @rule R4 -- the inverted guard: a ceiling is not a settlement.
  it("[R4] reports NO settled row when the window closes without a delta", async () => {
    const { onFailed } = renderStep({
      watchVisible: vi.fn(async () => ({ outcome: "settling" as const })),
    });
    await clickOpen();
    await waitFor(() => expect(onFailed).toHaveBeenCalled());

    expect(
      (window.dataLayer ?? []).filter(
        (row) => (row as { event?: string }).event === "funding_buy_settled",
      ),
    ).toEqual([]);
  });

  // @rule R7
  it("[R7] prefills the USD amount the planner already computed, with no rate applied", async () => {
    const { deps } = renderStep();
    await clickOpen();
    await waitFor(() => expect(deps.openCheckout).toHaveBeenCalled());
    const input = firstArg<PrivyOnRampInput>(deps.openCheckout);
    expect(input.prefill).toEqual({ amount: 120, currency: "USD" });
    expect(input.requested).toEqual({ amount: 120, currency: "USD" });
  });

  // @rule R7
  it("[R7] sends no amount for a non-USD buyer, and prints the figure as MONEY", async () => {
    // The figure is a USD figure and the rail hands us no rate, so prefilling it as a euro amount
    // would ask for a different sum than the leg needs. The sentence carries no ticker at all: it
    // is what the buyer PAYS, and naming the stablecoin beside it confuses a spend amount with a
    // delivered one, which is the distinction this whole epic turns on.
    const { deps } = renderStep({}, USDC_ORDER, { buyerCurrency: "EUR" });

    const sentence = await screen.findByText(/enter the amount in the checkout/i);
    expect(sentence).toHaveTextContent("$120.00");
    expect(sentence).not.toHaveTextContent(/USDC|USDG/);
    await clickOpen();
    await waitFor(() => expect(deps.openCheckout).toHaveBeenCalled());
    const input = firstArg<PrivyOnRampInput>(deps.openCheckout);
    expect(input.prefill.amount).toBe(0);
  });

  // @rule R2
  it("[R2] labels the CTA with its own words, not the other rail's status sentence", async () => {
    // `open` reads "Complete your purchase in the checkout above", which is a STATUS line under a
    // mounted iframe. There is no checkout above this button.
    renderStep();
    const cta = await screen.findByRole("button");
    expect(cta).toHaveTextContent("Open secure checkout");
  });

  // @rule R2
  it("[R2] never names the provider in what the buyer reads", async () => {
    // Provider-neutral copy: the rail is an implementation detail and the ADR keeps a second rail
    // possible, so no screen may hard-code the first one's name.
    const { container } = { container: document.body };
    renderStep({}, { ...USDC_ORDER, currencyCode: "ETH-BASE" });
    await waitFor(() => expect(container.textContent).not.toMatch(/privy/i));
    expect(container.textContent).not.toMatch(/paybis/i);
  });
});
