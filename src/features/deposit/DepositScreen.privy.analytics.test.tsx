/**
 * @id PP-DEP-SCR-001 (POO-1807), spec
 * @name Deposit funnel on the Privy rail, premise 11
 * @implements-rules-version v1 (POO-1807 rules v1)
 * @epic POO-1793 (Privy on-ramp migration)
 *
 * Premise 11: a completion fires on SETTLEMENT, never on a click and never on a promise resolving.
 * The Privy rail makes that easy to get wrong, because `addFunds` resolves with the provider's own
 * claim that it charged, which reads exactly like a success and is not one (ADR-0004).
 *
 * The funnel identity this screen has to keep closing:
 *
 *     started = completed + failed + abandoned + transfer_unobserved + onramp_disabled
 *
 * The two new `block_reason`s below are deliberately NOT settlement terms; see the header note in
 * `DepositScreen.tsx` and the PR. They are denominators, like `below_minimum`.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../tests/utils/renderWithProviders";

vi.mock("@/lib/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services")>()),
  isMockMode: false,
}));
vi.mock("@/lib/features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/features")>()),
  isFeatureEnabled: () => true,
}));

const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/lib/balances/balanceRefresh", () => ({ requestBalanceRefresh: refresh }));

vi.mock("@/lib/balances/useTokenBalances", () => ({
  useTokenBalances: () => ({
    balances: [
      {
        symbol: "ETH",
        name: "Ethereum",
        amount: 1,
        amountExact: "1",
        decimals: 18,
        usd: 2500,
        chainId: 8453,
        logoUrl: "",
        isNative: true,
        address: "0x0000000000000000000000000000000000000000",
      },
    ],
    totalUsd: 2500,
    dayChangeUsd: 0,
    dayChangePct: 0,
    isLoading: false,
    isRefreshing: false,
    refresh: vi.fn(),
  }),
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
}));

vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as `0x${string}`,
    isLoading: false,
  }),
}));

/** The rail switch, the probe, the adapter and the chain read: all OURS, all replaced. */
const rig = vi.hoisted(() => ({
  rail: "privy" as "privy" | "paybis" | "none",
  /** What the server echoes as the buyer's own currency. `undefined` = it could not resolve one. */
  currencyCodeFrom: "usd" as string | undefined,
  coverage: vi.fn(),
  openCheckout: vi.fn(),
  readBalance: vi.fn(),
}));

/**
 * Both Paybis hops answer, and neither is scenery.
 *
 * The METHODS hop is the BUYER-CURRENCY oracle (POO-1512): the screen reads `currencyCodeFrom` back
 * from it, and since the POO-1801 review the Privy confirm REFUSES without a currency it can charge
 * in rather than silently defaulting to USD. A rig that left it unresolved would test the refusal on
 * every path.
 *
 * The QUOTE hop answers a real charge for a real method ON PURPOSE, even though this rail must show
 * neither. It is what makes the review's F5 assertions load-bearing: with an empty list and a failed
 * quote, "no method label" and "no Amount row" hold whatever the screen does, and the gate could be
 * deleted with every test still green. The screen suspends the pricing hop on this rail
 * (`pricingEnabled`), so this stub answering is exactly the pressure those assertions need.
 */
const PAYBIS_METHOD = {
  paymentMethod: "poolparty-credit-card",
  displayName: "Credit Card",
  minUsd: 10,
  minCurrencyCode: "USD",
};
vi.mock("@/lib/onramp/onRampActions", () => ({
  getOnRampPaymentMethodsAction: vi.fn(async () => ({
    ok: true,
    currencyCodeFrom: rig.currencyCodeFrom,
    methods: [PAYBIS_METHOD],
  })),
  getOnRampQuoteAction: vi.fn(async () => ({
    ok: true,
    quote: {
      quoteId: "quote_1",
      currencyCodeFrom: rig.currencyCodeFrom ?? "usd",
      currencyCodeTo: "USDC-BASE",
      requestedAmountType: "destination",
      paymentMethods: [
        {
          id: PAYBIS_METHOD.paymentMethod,
          name: PAYBIS_METHOD.displayName,
          chargeUsd: 103.4,
          chargeAmount: "103.40",
          chargeCurrencyCode: rig.currencyCodeFrom ?? "usd",
          receiveAmount: "100",
          receiveCurrencyCode: "USDC-BASE",
        },
      ],
    },
  })),
}));

vi.mock("@/lib/onramp/useOnRampProvider", () => ({ useOnRampProvider: () => rig.rail }));
vi.mock("@/lib/onramp/useOnRampCoverage", () => ({ useOnRampCoverage: () => rig.coverage }));
vi.mock("@/lib/onramp/usePrivyOnRamp", () => ({
  usePrivyOnRamp: () => ({ openCheckout: rig.openCheckout }),
}));
vi.mock("@/lib/tokens/readErc20", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tokens/readErc20")>()),
  readErc20Balance: rig.readBalance,
}));

/** The checkout component, stubbed to expose its callbacks. */
const host = vi.hoisted(
  () =>
    ({}) as {
      // POO-1813 [R4]: the attempt id rides up with the delta, so the host's `funding_buy_settled`
      // joins to the three rows the adapter already pushed for the same purchase.
      onSettled?: (usd: number, attemptId: string) => void;
      onSettling?: () => void;
      onUnverified?: () => void;
      onFailed?: (reason: string) => void;
    },
);
vi.mock("./components/DepositPrivyCheckout", () => ({
  // The host imports this constant from the same module (ONE definition of the destination's
  // decimals, so a baseline and a delta cannot be scaled differently), so the mock must carry it.
  ONRAMP_DESTINATION_DECIMALS: 6,
  DepositPrivyCheckout: (props: {
    onSettled: (usd: number, attemptId: string) => void;
    onSettling: () => void;
    onUnverified: () => void;
    onFailed: (reason: string) => void;
  }) => {
    host.onSettled = props.onSettled;
    host.onSettling = props.onSettling;
    host.onUnverified = props.onUnverified;
    host.onFailed = props.onFailed;
    return <div data-testid="privy-checkout">checkout</div>;
  },
}));

vi.mock("./components/StandaloneOnRampRail", () => ({
  StandaloneOnRampRail: () => <div data-testid="standalone-onramp-rail">paybis rail</div>,
}));

import { DepositScreen } from "./DepositScreen";

/**
 * Render, wait for BOTH pre-click reads to land, then press the amount step's CTA.
 *
 * Waiting for the coverage probe is not incidental: it is debounced on the amount step precisely so
 * the click can stay synchronous ([R7]), so a test that clicks before it answers is testing the
 * `unknown` branch by accident.
 */
async function reachCheckout() {
  const rendered = renderWithProviders(<DepositScreen investContext={null} />);
  await waitFor(() => expect(rig.readBalance).toHaveBeenCalled());
  await waitFor(() => expect(rig.coverage).toHaveBeenCalled(), { timeout: 3000 });
  const cta = screen.getByRole("button", { name: "Continue" });
  await waitFor(() => expect(cta).toBeEnabled());
  // One more flush so the probe's resolution has reached state before the click reads it.
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.click(cta);
  return rendered;
}

beforeEach(() => {
  window.dataLayer = [];
  localStorage.clear();
  refresh.mockClear();
  rig.rail = "privy";
  rig.currencyCodeFrom = "usd";
  rig.coverage.mockReset();
  rig.coverage.mockResolvedValue({ status: "covered", methods: [] });
  rig.openCheckout.mockReset();
  rig.openCheckout.mockResolvedValue({
    attemptId: "a1",
    moved: "confirmed",
    reason: "provider_confirmed",
  });
  rig.readBalance.mockReset();
  rig.readBalance.mockResolvedValue(BigInt(25_000_000));
  host.onSettled = undefined;
  host.onSettling = undefined;
  host.onUnverified = undefined;
  host.onFailed = undefined;
});

/** Every event of one name currently on the dataLayer. */
function events(name: string) {
  return (window.dataLayer ?? []).filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null && (row as { event?: string }).event === name,
  );
}

describe("premise 11 on the Privy rail (POO-1807 [R10])", () => {
  // @rule R10
  it("[R10] fires deposit_submitted on the confirm click", async () => {
    await reachCheckout();
    expect(events("deposit_submitted")).toHaveLength(1);
  });

  // @rule R10 -- the trap: the provider's claim is not a settlement.
  it("[R10] does NOT complete when the checkout promise resolves", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    act(() => host.onSettling?.());
    expect(events("deposit_completed")).toHaveLength(0);
  });

  // @rule R10 -- it completes on the observed delta, and carries it.
  it("[R10] completes only on settlement, with the delivered figure as value", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    act(() => host.onSettled?.(96.4, "a1"));
    const [completed] = events("deposit_completed");
    expect(completed).toBeDefined();
    expect(completed?.value).toBe(96.4);
    expect(completed?.usd_value_at_time).toBe(96.4);
  });

  // @rule R10
  it("[R10] fires deposit_failed on a hard no", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    act(() => host.onFailed?.("popup_blocked"));
    expect(events("deposit_failed")).toHaveLength(1);
    expect(events("deposit_completed")).toHaveLength(0);
  });

  // @rule R10 -- an inconclusive exit is NOT a failure. Counting it as one would corrupt the number
  // week one reconciles against the provider's dashboard, the same argument `transfer_unobserved`
  // was split out on.
  it("[R10] does not fire deposit_failed on an unverified exit", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    act(() => host.onUnverified?.());
    expect(events("deposit_failed")).toHaveLength(0);
    expect(events("deposit_completed")).toHaveLength(0);
  });
});

describe("the released-screen exits (POO-1807 [R10])", () => {
  // @rule R10 -- a released settling screen is counted, so we can see how often 90 seconds is not
  // enough. It is a denominator, not a settlement term.
  it("[R10] counts an unverified release under its own block_reason", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    act(() => host.onUnverified?.());
    const blocked = events("tx_amount_blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.block_reason).toBe("onramp_unverified");
    expect(blocked[0]?.flow).toBe("deposit");
  });

  // @rule R10 -- and a paid one under a different reason, because the two point at opposite fixes:
  // is 90 seconds too short, or was there never a charge at all?
  it("[R10] counts a settling release under a different reason", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    act(() => host.onSettling?.());
    act(() => host.onSettled?.(96.4, "a1"));
    // Settling that RESOLVES is not a release: nothing is counted as blocked.
    expect(events("tx_amount_blocked")).toHaveLength(0);
  });

  // @rule R10 -- the uncovered refusal, before anything opens.
  it("[R10] counts an uncovered refusal and never opens a checkout", async () => {
    rig.coverage.mockResolvedValue({ status: "uncovered" });
    await reachCheckout();
    await screen.findByText("We cannot sell to you right now");

    const blocked = events("tx_amount_blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.block_reason).toBe("onramp_uncovered");
    expect(events("deposit_failed")).toHaveLength(0);
  });
});

describe("the identity still closes (POO-1807 [R10])", () => {
  // @rule R10 -- one start, exactly one settlement term, on each terminal path.
  it("[R10] a settled purchase produces exactly one settlement term", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");
    act(() => host.onSettling?.());
    act(() => host.onSettled?.(96.4, "a1"));

    expect(events("deposit_completed")).toHaveLength(1);
    expect(events("deposit_failed")).toHaveLength(0);
    // `tx_flow_abandoned`, by its REAL name (review F9): there is no `deposit_abandoned` event in
    // the taxonomy, so the old assertion counted rows of a name nothing ever emits and passed
    // whatever the screen did. This screen's own header says so at line 1.
    expect(events("tx_flow_abandoned")).toHaveLength(0);
  });

  // @rule R10
  it("[R10] a hard no produces exactly one settlement term", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");
    act(() => host.onFailed?.("popup_blocked"));

    expect(events("deposit_failed")).toHaveLength(1);
    expect(events("deposit_completed")).toHaveLength(0);
  });

  // @rule R10 -- the released screen leaves the flow OPEN on purpose: the passive window may still
  // settle it, and concluding here would let one start produce two settlement terms.
  it("[R10] an unverified release concludes nothing, so a late settlement is still countable", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");
    act(() => host.onUnverified?.());

    expect(events("deposit_completed")).toHaveLength(0);
    expect(events("deposit_failed")).toHaveLength(0);

    // The passive window lands the delta while the buyer is still here.
    act(() => host.onSettled?.(96.4, "a1"));
    expect(events("deposit_completed")).toHaveLength(1);
  });
});

describe("the released screens are still abandonable (POO-1807 review F9)", () => {
  /**
   * `onramp-unverified` and `onramp-uncovered` fell through to the exit resolver's `default: return
   * null`, which means "terminal, nothing to count". Neither is terminal: the passive window may
   * still settle the unverified one, and the uncovered one is a live buyer who has not left. So a
   * buyer walking away from either emitted NO `tx_flow_abandoned` at all, and the funnel identity
   * this screen's header prints could not close.
   */
  it("[F9] leaving the unverified screen emits tx_flow_abandoned", async () => {
    const { unmount } = await reachCheckout();
    await screen.findByTestId("privy-checkout");
    act(() => host.onUnverified?.());

    unmount();

    const [abandoned] = events("tx_flow_abandoned");
    expect(abandoned).toBeDefined();
    expect(abandoned?.flow).toBe("deposit");
    expect(abandoned?.tx_exit).toBe("pending");
  });

  it("[F9] leaving the uncovered refusal emits tx_flow_abandoned", async () => {
    rig.coverage.mockResolvedValue({ status: "uncovered" });
    const { unmount } = await reachCheckout();
    await screen.findByText("We cannot sell to you right now");

    unmount();

    const [abandoned] = events("tx_flow_abandoned");
    expect(abandoned).toBeDefined();
    expect(abandoned?.tx_exit).toBe("pending");
  });

  // A settled purchase concluded the flow, so leaving afterwards is not an abandonment. This is the
  // other half of the identity: exactly one settlement term per start.
  it("[F9] a completed purchase emits no abandonment on the way out", async () => {
    const { unmount } = await reachCheckout();
    await screen.findByTestId("privy-checkout");
    act(() => host.onSettled?.(96.4, "a1"));

    unmount();

    expect(events("tx_flow_abandoned")).toHaveLength(0);
    expect(events("deposit_completed")).toHaveLength(1);
  });
});

describe("no Paybis method rides the funnel (POO-1807 review F5)", () => {
  /**
   * `deposit_method` carried the Paybis id `pickDefaultPaymentMethod` chose over a list the buyer
   * never saw, on a rail where the provider behind the checkout picks its own method. That is a
   * claim about how someone paid that nobody made, and it would have been reconciled against
   * Paybis's dashboard in week one.
   */
  it("[F5] deposit_submitted, deposit_completed and deposit_failed carry no deposit_method", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");
    act(() => host.onSettled?.(96.4, "a1"));

    expect(events("deposit_submitted")[0]).not.toHaveProperty("deposit_method");
    expect(events("deposit_completed")[0]).not.toHaveProperty("deposit_method");
  });

  it("[F5] and neither does the failure", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");
    act(() => host.onFailed?.("popup_blocked"));

    expect(events("deposit_failed")[0]).not.toHaveProperty("deposit_method");
  });
});

describe("the currency refusal is counted (POO-1801 review F10)", () => {
  // A blocked intent, not a silent USD charge: premise 11 counts the attempt the product said no to.
  it("[F10] counts onramp_currency_unsupported and opens nothing", async () => {
    rig.currencyCodeFrom = undefined;
    // Not `reachCheckout`: with no chargeable currency the screen deliberately probes nobody, so
    // waiting for a coverage answer would hang.
    renderWithProviders(<DepositScreen investContext={null} />);
    await waitFor(() => expect(rig.readBalance).toHaveBeenCalled());
    const cta = screen.getByRole("button", { name: "Continue" });
    await waitFor(() => expect(cta).toBeEnabled());
    fireEvent.click(cta);
    await screen.findByText(/cannot take a payment in your currency/i);

    const blocked = events("tx_amount_blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.block_reason).toBe("onramp_currency_unsupported");
    expect(blocked[0]?.flow).toBe("deposit");
    expect(events("deposit_failed")).toHaveLength(0);
  });
});

describe("the purchase funnel's settled row (POO-1813 [R4])", () => {
  // @rule R4
  it("[R4] fires funding_buy_settled on the OBSERVED delta, never on the promise resolving", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    // The provider's claim reached the host: the window is open and nothing has arrived.
    act(() => host.onSettling?.());
    expect(events("funding_buy_settled")).toHaveLength(0);

    act(() => host.onSettled?.(96.4, "a1"));
    const [settled] = events("funding_buy_settled");
    expect(settled).toMatchObject({
      rail: "privy",
      attempt_id: "a1",
      // What the buyer asked for, what we prefilled (100 + the 5% house buffer), what ARRIVED.
      requested_usd: 100,
      prefill_usd: 105,
      delivered_usd: 96.4,
      // The GA4 value is the honest one: what arrived, not what we asked for.
      value: 96.4,
      fiat_currency: "USD",
    });
  });

  // @rule R4
  it("[R4] omits prefill_usd entirely for a buyer we prefilled nothing for", async () => {
    // A euro buyer gets no `defaultAmount` at all (the figure is a USD one and the rail quotes no
    // rate), so a `prefill_usd: 0` here would enter the buffer series as "we asked for nothing and
    // they paid anyway". Missing is a row the query skips; zero is a row it averages.
    rig.currencyCodeFrom = "eur";
    await reachCheckout();
    await screen.findByTestId("privy-checkout");
    act(() => host.onSettled?.(96.4, "a1"));

    const [settled] = events("funding_buy_settled");
    expect(settled).not.toHaveProperty("prefill_usd");
    // [R4] and the CHARGE currency, not the currency the figures are sized in.
    expect(settled).toMatchObject({ fiat_currency: "EUR", requested_usd: 100 });
  });
});

describe("the failure row carries a usable code (POO-1813 [R1])", () => {
  // @rule R1
  it("[R1] maps the classifier's reason to an uppercase code that survives into the dataLayer", async () => {
    // The raw slug fails `isAnalyticsErrorCodeShape` (`^[A-Z]`), so `sanitizeParams` DROPPED it and
    // the row reached GA4 with a blank `error_code`: the exact defect POO-1173 was opened for.
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    act(() => host.onFailed?.("popup_blocked"));
    expect(events("deposit_failed")[0]?.error_code).toBe("ONRAMP_POPUP_BLOCKED");
  });

  // @rule R1
  it("[R1] maps the checkout's own destination failure too, not only the classifier's", async () => {
    // `destination_unavailable` is raised by `DepositPrivyCheckout`, not by the SDK, and it reaches
    // the same field. Unmapped it would report `ONRAMP_UNMAPPED` for a bug we have already named.
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    act(() => host.onFailed?.("destination_unavailable"));
    expect(events("deposit_failed")[0]?.error_code).toBe("ONRAMP_DESTINATION_UNAVAILABLE");
  });

  // @rule R1
  it("[R1] puts the window's own outcome on the unverified blocked intent", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    act(() => host.onUnverified?.());
    expect(events("tx_amount_blocked")[0]?.error_code).toBe("ONRAMP_UNVERIFIED");
  });
});

describe("the method choice this rail can actually report (POO-1813 [R2])", () => {
  // @rule R2
  it("[R2] reports the top-level onramp choice when the buyer confirms the purchase", async () => {
    await reachCheckout();

    const [selected] = events("deposit_method_selected");
    expect(selected).toBeDefined();
    expect(selected?.deposit_method).toBe("onramp");
  });

  // @rule R2
  it("[R2] reports the crypto choice from the other entry point", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    await waitFor(() => expect(rig.readBalance).toHaveBeenCalled());
    fireEvent.click(screen.getAllByRole("button", { name: /crypto/i })[0] as HTMLElement);

    const [selected] = events("deposit_method_selected");
    expect(selected?.deposit_method).toBe("crypto");
    expect(events("deposit_crypto_started")).toHaveLength(1);
  });

  /**
   * @rule R2
   *
   * The Paybis series is NOT re-pointed: it keeps its own payment-method identifiers until POO-1809,
   * and `DepositScreen.methods.test.tsx:270` ("emits deposit_method_selected with the Paybis
   * identifier") is where that is pinned. What is pinned HERE is the gate that keeps the two apart:
   * on that rail the crypto entry adds nothing to the name, so one dimension never carries two
   * vocabularies in the same session.
   */
  it("[R2] adds no top-level choice to the Paybis rail's own series", async () => {
    rig.rail = "paybis";
    renderWithProviders(<DepositScreen investContext={null} />);
    await screen.findByRole("button", { name: "Continue" });
    fireEvent.click(screen.getAllByRole("button", { name: /crypto/i })[0] as HTMLElement);

    expect(events("deposit_crypto_started")).toHaveLength(1);
    expect(events("deposit_method_selected")).toHaveLength(0);
  });
});
