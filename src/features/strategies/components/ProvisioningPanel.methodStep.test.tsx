/**
 * @id PP-CORE-CMP-046 (POO-1576, POO-1129)
 * @name ProvisioningPanel — the payment-method step
 * @implements-rules-version v2 (POO-1129 rules v1) · v1 (POO-1576 rules v1)
 *
 * The step between the buy amount and the Paybis checkout, end to end through the panel.
 *
 * The defect is not a missing decoration: the provisioning buy route NEVER ASKED. The mint called
 * `pickDefaultPaymentMethod`, which prefers a card by regex, and the widget opened on it. A buyer who
 * wanted a bank transfer, SEPA or Pix had no way to say so, and the charge the funding picker printed
 * belonged to a method they had not chosen. So the load-bearing assertion here is a NEGATIVE one:
 * the checkout does not mount until the buyer has answered.
 *
 * The two server actions behind `useBuyRouteQuote` are the only stubs. Everything between them and
 * the rendered row runs for real, including the row rules (`buildOnRampMethodRows`) and A7-b's
 * eligibility filter — the glue is exactly what the isolated suites cannot see, and this epic has
 * already shipped a feature that was unreachable through the UI for that reason.
 *
 * The POO-1129 block at the bottom pins the three rules that landed AFTER this step was written: no
 * `Best price` pill (D1), a row below its floor refuses selection and never reaches the mint (D2/D3),
 * and non-instant methods are deferred out of this iteration (A7-b).
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDevOverridesForTests, setOverride } from "@/lib/features/devOverrides";
import type {
  ProvisioningNeedInput,
  ProvisioningOrder,
  ProvisioningPlan,
  ProvisioningStep,
} from "@/lib/provisioning";
import { SCENARIOS } from "@/lib/provisioning";
import { REAL_STEPS, realProvisioningPlan } from "../../../../tests/fixtures/realProvisioningPlan";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import type { PlanRailReporters, ProvisioningPanelHandle } from "./ProvisioningPanel";
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

// The buy-route quote is gated OFF in mock mode (no Paybis rail behind the actions), so this whole
// suite has to run on the real side of that seam. `isMockMode` is a module constant read at import
// time, so it is replaced here rather than through `stubEnv`.
vi.mock("@/lib/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services")>()),
  isMockMode: false,
}));

const onRamp = vi.hoisted(() => ({
  getMethods: vi.fn(),
  getQuote: vi.fn(),
  getCurrencies: vi.fn(),
}));
vi.mock("@/lib/onramp/onRampActions", () => ({
  getOnRampPaymentMethodsAction: onRamp.getMethods,
  getOnRampQuoteAction: onRamp.getQuote,
  getOnRampSupportedCurrenciesAction: onRamp.getCurrencies,
}));

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

const rail = vi.hoisted(() => ({
  mintOnRampRequest: vi.fn(
    async (
      _order: unknown,
      _options: {
        confirmResume: (intent: unknown) => Promise<"resume" | "new">;
        paymentMethod?: string;
      },
    ) => ({ requestId: "req-1", wallet: "0xC3673ADc0000000000000000000000000000BEEF" }),
  ),
}));
vi.mock("../hooks/useProvisioningRail", () => ({
  useProvisioningRail: () => ({
    buildSteps: undefined,
    openJournal: () => {},
    closeJournal: () => {},
    mintOnRampRequest: rail.mintOnRampRequest,
  }),
}));

// A7-b's fail-open is invisible on screen (it looks exactly like an ordinary unfiltered list), so
// the report IS the behaviour and is asserted rather than the absence of a filter.
const reported = vi.hoisted(() => ({ reportClientError: vi.fn() }));
vi.mock("@/lib/observability/reportClientError", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/reportClientError")>()),
  reportClientError: reported.reportClientError,
}));

vi.mock("./provisioning/PaybisWidgetFrame", () => ({
  PaybisWidgetFrame: ({ requestId }: { requestId: string }) => (
    <div data-testid="paybis-frame" data-request-id={requestId} />
  ),
}));

/** The order the plan's buy step carries: `fiatAmount` is what the step prices its rows for. */
const ORDER: ProvisioningOrder = {
  currencyCode: "USDC-BASE",
  fiatAmount: "212.00",
  fiatCurrency: "USD",
};

const BUY_STEP: ProvisioningStep = {
  type: "buy",
  key: "buy",
  labelKey: "provisioning.steps.buy",
  fromToken: "USD",
  toToken: "USDC",
  toChainId: 8453,
  amountUsd: 212,
  poweredBy: "paybis",
  order: ORDER,
};

/** Frame `3e`'s own list: two instant methods at the same charge, and one with a $500 floor. */
const CARD = {
  paymentMethod: "poolparty-credit-card",
  displayName: "Card",
  minUsd: 10,
  minCurrencyCode: "USD",
  labels: ["Instant"],
};
const APPLE = {
  paymentMethod: "poolparty-apple-pay",
  displayName: "Apple Pay",
  minUsd: 10,
  minCurrencyCode: "USD",
  labels: ["Instant"],
};
/**
 * An INSTANT rail whose own floor is above this order, from the same live capture.
 *
 * It was a `Bank transfer` until POO-1129 A7-b deferred non-instant methods out of the first
 * iteration, which would have filtered it off the step and taken every "a row the quote would not
 * price" case with it. Skrill carries `instant`, so eligibility keeps it and the cases stay about
 * what they were always about: a floor, a refusal, and a row that is never hidden.
 */
const BANK = {
  paymentMethod: "poolparty_apm_bridgerpay_skrill",
  displayName: "Skrill",
  minUsd: 500,
  minCurrencyCode: "USD",
  labels: ["high-approval-rate", "instant"],
};

/** One entry of the UNPINNED listing quote (POO-1599): one per method the pair can price. */
function priced(id: string, name: string, chargeUsd: number) {
  return {
    id,
    name,
    chargeUsd,
    chargeAmount: chargeUsd.toFixed(2),
    chargeCurrencyCode: "USD",
    receiveAmount: "212.000000",
    receiveCurrencyCode: "USDC-BASE",
  };
}

/**
 * Frame `3e` exactly: Card and Apple Pay tie at $218.45, and the bank transfer is REFUSED by the
 * provider rather than priced, because a $212.00 order is below its own $500.00 floor.
 */
const LISTING_QUOTE = {
  ok: true as const,
  quote: {
    quoteId: "quote_1",
    currencyCodeFrom: "USD",
    currencyCodeTo: "USDC-BASE",
    requestedAmountType: "destination",
    paymentMethods: [
      priced("poolparty-credit-card", "Card", 218.45),
      priced("poolparty-apple-pay", "Apple Pay", 218.45),
    ],
    paymentMethodErrors: [{ paymentMethod: "poolparty_apm_bridgerpay_skrill" }],
  },
};

/** A one-step rail whose only step IS the fiat purchase, plus how that step ended. */
function observedBuyRail() {
  const outcome = { settled: false, failedWith: null as string | null };
  const buildSteps = (_plan: ProvisioningPlan, reporters: PlanRailReporters) => [
    {
      key: "buy",
      run: async () => {
        try {
          await reporters.runOnRampBuy?.({ order: ORDER, expectedToken: "USDC-BASE" as const });
          outcome.settled = true;
        } catch (error) {
          outcome.failedWith = (error as { cause?: { code?: string } }).cause?.code ?? "UNKNOWN";
          throw error;
        }
        return {};
      },
    },
  ];
  return { outcome, buildSteps };
}

function noop() {}

const INPUT: ProvisioningNeedInput = SCENARIOS.usdcBridge;

/** Render the panel with the on-ramp flag on and wait for the step to be up. */
async function renderToMethodStep() {
  vi.stubEnv("NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP", "on");
  const ref = createRef<ProvisioningPanelHandle>();
  const { outcome, buildSteps } = observedBuyRail();
  renderWithProviders(
    <ProvisioningPanel
      ref={ref}
      input={INPUT}
      opLabel="Invest in Stable Yield"
      onDone={noop}
      onCancel={noop}
      buildPlanSteps={buildSteps}
    />,
  );
  await screen.findByTestId("provisioning-method-step");
  return { ref, outcome };
}

/** The rows, in the order they are on screen. */
function rowNames() {
  return screen.queryAllByTestId("onramp-method-row").map((row) => row.dataset.method);
}

/**
 * One row, by its Paybis identifier. Queried on `data-method` rather than on a per-row test id: the
 * rows share one test id so they can be COUNTED, and the identifier is the row's real key anyway
 * (POO-1413: never a position).
 */
function rowFor(id: string): HTMLElement {
  const row = document.querySelector(`[data-testid="onramp-method-row"][data-method="${id}"]`);
  if (!row) throw new Error(`no row for ${id}`);
  return row as HTMLElement;
}

/**
 * Wait for the debounced listing quote to land, so a case about CHARGES is not sampled while the
 * rows are still showing names and minimums alone. That intermediate state is legitimate (the
 * charge is opportunistic, Q1) and has its own case below.
 */
async function awaitPricedRows() {
  await waitFor(() => expect(screen.getAllByText("$218.45")).toHaveLength(2));
}

function analyticsEvents(name: string) {
  return ((window.dataLayer ?? []) as Record<string, unknown>[]).filter(
    (entry) => entry.event === name,
  );
}

beforeEach(() => {
  __resetDevOverridesForTests();
  window.dataLayer = [];
  planHolder.current = realProvisioningPlan({
    steps: [BUY_STEP, REAL_STEPS[2] as ProvisioningStep],
  });
  rail.mintOnRampRequest.mockClear();
  reported.reportClientError.mockClear();
  onRamp.getMethods.mockReset();
  onRamp.getQuote.mockReset();
  onRamp.getCurrencies.mockReset();
  // POO-1621: the supported set, measured at 44 fiats on 2026-08-14. Three is enough to prove a
  // CHOICE exists; the count is the design's problem, not this contract's.
  onRamp.getCurrencies.mockResolvedValue({ ok: true, currencies: ["BRL", "EUR", "USD"] });
  onRamp.getMethods.mockResolvedValue({
    ok: true,
    currencyCodeFrom: "USD",
    methods: [CARD, APPLE, BANK],
  });
  onRamp.getQuote.mockResolvedValue(LISTING_QUOTE);
  localStorage.clear();
});

afterEach(() => {
  __resetDevOverridesForTests();
  vi.unstubAllEnvs();
});

describe("ProvisioningPanel — the payment-method step (POO-1576)", () => {
  /**
   * @rule R1 — THE behaviour change. Before this issue the buy step minted immediately and the
   * checkout opened on a card nobody chose. The checkout must now wait for an answer.
   */
  it("[R1] does not open the checkout until the buyer continues", async () => {
    await renderToMethodStep();

    expect(screen.queryByTestId("paybis-frame")).not.toBeInTheDocument();
    expect(rail.mintOnRampRequest).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("provisioning-method-continue"));

    expect(await screen.findByTestId("paybis-frame")).toBeInTheDocument();
  });

  /**
   * @rule R2 — beyond A7-b's eligibility, NOTHING is filtered and nothing is reordered.
   *
   * POO-1129 A7-b settled what was open here (POO-1606), and it settled exactly one question: which
   * methods may be OFFERED. Everything downstream of that answer keeps the provider's own order and
   * hides nothing, including a row this order cannot use. All three below are instant, so this case
   * measures the ordering rule alone; A7-b has its own cases.
   */
  it("[R2] offers every eligible method the provider returned, in its own order", async () => {
    await renderToMethodStep();

    await waitFor(() => expect(rowNames()).toHaveLength(3));
    expect(rowNames()).toEqual([
      "poolparty-credit-card",
      "poolparty-apple-pay",
      "poolparty_apm_bridgerpay_skrill",
    ]);
  });

  /** @rule R3/R5 — each row carries its OWN charge for this order, and the vendor's own labels. */
  it("[R3] prices every row from the listing quote, with the provider's labels", async () => {
    await renderToMethodStep();

    await awaitPricedRows();

    const card = screen.getByText("Card");
    expect(card.closest("[data-testid='onramp-method-row']")).toHaveTextContent("$218.45");
    expect(card.closest("[data-testid='onramp-method-row']")).toHaveTextContent("Instant");
  });

  /**
   * @rule R6 — the row the provider refused shows its MINIMUM where the charge would be, keeps its
   * radio and stays selectable, and `Continue` stays enabled.
   *
   * Still SELECTABLE after POO-1129 D3, deliberately. An absent charge is not a comparison, so this
   * row is unpriced rather than blocked, and the decided fail direction is that "a method wrongly
   * blocked removes an option the buyer could have used, while a method wrongly offered is
   * recoverable at checkout". `/deposit` treats the same method and the same order identically
   * (POO-1609 AC6): its pinned quote yields no charge either, so its own guard never fires.
   */
  it("[R6] shows the floor instead of a charge, and keeps the row selectable", async () => {
    await renderToMethodStep();

    await awaitPricedRows();

    const bank = screen.getByText("Skrill");
    const row = bank.closest("[data-testid='onramp-method-row']") as HTMLElement;
    expect(row).toHaveTextContent("Min. $500.00");
    expect(row).not.toHaveTextContent("$218.45");
    expect(screen.getByTestId("provisioning-method-continue")).toBeEnabled();

    fireEvent.click(row.querySelector("input[type='radio']") as HTMLInputElement);

    expect(row).toHaveAttribute("data-selected", "true");
    // The floor is named AFTER the pick, never in the row (frame 3e).
    expect(await screen.findByTestId("provisioning-method-minimum-notice")).toHaveTextContent(
      "$500.00",
    );
    expect(screen.getByTestId("provisioning-method-continue")).toBeEnabled();
  });

  /** @rule R6, premise 11 — picking a method the order cannot use is the blocked intent. */
  it("[R6] reports the blocked intent with the method's own floor and currency", async () => {
    await renderToMethodStep();

    await awaitPricedRows();

    const bank = screen.getByText("Skrill");
    const row = bank.closest("[data-testid='onramp-method-row']") as HTMLElement;
    fireEvent.click(row.querySelector("input[type='radio']") as HTMLInputElement);
    await act(async () => {});

    expect(analyticsEvents("funding_method_blocked")[0]).toMatchObject({
      funding_method: "poolparty_apm_bridgerpay_skrill",
      value: 500,
      currency: "USD",
    });
  });

  /**
   * @rule S2 (POO-1578) — the whole point: the buyer's choice reaches the MINT, which is what makes
   * the widget open on their method instead of the card the regex prefers.
   */
  it("[S2] threads the chosen method into the mint", async () => {
    await renderToMethodStep();

    const apple = await screen.findByText("Apple Pay");
    fireEvent.click(
      (apple.closest("[data-testid='onramp-method-row']") as HTMLElement).querySelector(
        "input[type='radio']",
      ) as HTMLInputElement,
    );
    fireEvent.click(screen.getByTestId("provisioning-method-continue"));
    await screen.findByTestId("paybis-frame");

    expect(rail.mintOnRampRequest).toHaveBeenCalledWith(ORDER, {
      confirmResume: expect.any(Function),
      paymentMethod: "poolparty-apple-pay",
      // POO-1618 [R2]: the flow's ONE currency resolution rides along even when the buyer never
      // touched the control, because the alternative is the mint resolving its own a second time
      // (POO-1621 defect 1: the screen prints one currency and the card is charged another).
      currencyCodeFrom: "USD",
    });
  });

  /** @rule R5, premise 11 — the submission names the method the buyer is actually continuing on. */
  it("reports the chosen method and the size of the list it came from", async () => {
    await renderToMethodStep();

    await awaitPricedRows();
    fireEvent.click(screen.getByTestId("provisioning-method-continue"));
    await screen.findByTestId("paybis-frame");

    expect(analyticsEvents("funding_method_viewed")).toHaveLength(1);
    expect(analyticsEvents("funding_method_chosen")[0]).toMatchObject({
      funding_method: "poolparty-credit-card",
      funding_method_count: 3,
    });
  });

  /**
   * @rule R8 — Cancel ends the purchase the same way closing the checkout does. Nothing was minted,
   * so nothing was charged and no journal record exists to reconcile.
   */
  it("[R8] cancelling ends the buy without minting anything", async () => {
    const { outcome } = await renderToMethodStep();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {});

    expect(rail.mintOnRampRequest).not.toHaveBeenCalled();
    expect(outcome.failedWith).toBe("ONRAMP_CLOSED");
    expect(analyticsEvents("funding_method_abandoned")).toHaveLength(1);
  });

  /**
   * @rule R8 — and the host's own dismissal is the same answer, not a `Stop here?`. Nothing is
   * signed, nothing is broadcast and nothing is minted: a confirmation on top of a question the user
   * is already being asked would be two competing decisions at once.
   */
  it("[R8] lets the host close during the step, with no confirmation", async () => {
    const { ref, outcome } = await renderToMethodStep();

    let proceed: boolean | undefined;
    act(() => {
      proceed = ref.current?.requestClose();
    });
    await act(async () => {});

    expect(proceed).toBe(true);
    expect(screen.queryByText("Stop here?")).not.toBeInTheDocument();
    expect(outcome.failedWith).toBe("ONRAMP_CLOSED");
  });

  /**
   * @rule R7 (Q3, Rafael 2026-08-13) — "vanishing is fine, but the empty state needs to inform the
   * user that the provider didn't give us any quotes so the user knows it's not a problem with our
   * platform." So it neither blocks nor silently skips, and Continue proceeds on the rail's own
   * prefill exactly as before this step existed.
   */
  it("[R7] informs and still continues when the provider returns nothing", async () => {
    onRamp.getMethods.mockResolvedValue({ ok: false, code: "NOT_FOUND", message: "no pair" });
    await renderToMethodStep();

    expect(screen.getByTestId("provisioning-method-unavailable")).toBeInTheDocument();
    expect(analyticsEvents("funding_method_unavailable")).toHaveLength(1);

    fireEvent.click(screen.getByTestId("provisioning-method-continue"));
    await screen.findByTestId("paybis-frame");

    // No `paymentMethod` at all: `pickDefaultPaymentMethod` inside the rail still prefills.
    expect(rail.mintOnRampRequest).toHaveBeenCalledWith(ORDER, {
      confirmResume: expect.any(Function),
    });
  });

  /**
   * @rule R3 — a charge is only shown when it answers for THIS order. The quote publishes one commit
   * behind the input that invalidated it, so a listing priced for another amount is withheld rather
   * than printed beside a purchase it does not describe (names and minimums survive, per Q1).
   */
  it("[R3] withholds the charges when the quote answers for a different amount", async () => {
    // The plan's order is $212.00; this quote is the panel's own pre-plan figure for another size.
    onRamp.getQuote.mockResolvedValue({
      ok: true,
      quote: { ...LISTING_QUOTE.quote, currencyCodeTo: "USDC-BASE" },
    });
    planHolder.current = realProvisioningPlan({
      steps: [
        { ...BUY_STEP, order: { ...ORDER, fiatAmount: "999.00" } } as ProvisioningStep,
        REAL_STEPS[2] as ProvisioningStep,
      ],
    });
    await renderToMethodStep();

    await waitFor(() => expect(rowNames()).toHaveLength(3));
    // The quote was requested for 999, and the mocked answer prices 212, so nothing is claimed.
    expect(screen.queryByText("$218.45")).not.toBeInTheDocument();
    // And with no admissible charge, nothing is REFUSED either (POO-1129 D3): the block is a fact
    // about a charge, so withholding the charge withholds the refusal with it.
    expect(document.querySelectorAll("[data-blocked='true']")).toHaveLength(0);
    // The list still names every method, and the high-floor row still carries its own floor.
    expect(rowNames()).toHaveLength(3);
    expect(screen.getByText("Min. $500.00")).toBeInTheDocument();
  });
});

/**
 * POO-1618 [R2]/[R3] (decided on POO-1576, 2026-08-14): the currency is the buyer's to choose, and
 * choosing it re-lists the methods.
 *
 * Rafael, 2026-08-14: "we can leave both selectors for the user to choose, none of them needs to be
 * read-only, we only need to add the skeleton to load new payment methods based on the currency
 * selected (e.g. brazil will likely load pix and euro can load mbway, so each new currency selected
 * needs a reload on payment method)."
 *
 * The wire ids and labels here are the LIVE sandbox capture (2026-08-14, `GET
 * /api/v1/on-ramp/payment-methods?currencyFrom=USD&currencyTo=USDC-SEPOLIA`), naming conventions and
 * all: `poolparty-credit-card` is hyphenated, `poolparty_bridgerpay_revolutpay` is not, and the only
 * labels that exist are `instant`, `low-fee` and `high-approval-rate`. There is no slowness label of
 * any kind - a bank rail simply OMITS `instant` - so nothing here may assert one.
 */
describe("ProvisioningPanel — the currency the buyer chooses (POO-1618)", () => {
  /** The live capture's own rows, verbatim: two rails, inconsistent id conventions, real labels. */
  const CARD_LIVE = {
    paymentMethod: "poolparty-credit-card",
    displayName: "Credit/Debit Card",
    minUsd: 10,
    minCurrencyCode: "USD",
    labels: ["instant"],
  };
  /**
   * A second rail for the USD set. It carries `instant`, because POO-1129 A7-b would otherwise
   * filter it off the step and these cases are about the CURRENCY control, not about eligibility.
   * The live `poolparty-trustly` (`low-fee`, `high-approval-rate`, no `instant`) is exactly the row
   * A7-b defers, and it is exercised as such in the POO-1129 cases below.
   */
  const TRUSTLY_LIVE = {
    paymentMethod: "poolparty_apm_bridgerpay_skrill",
    displayName: "Skrill",
    minUsd: 10,
    minCurrencyCode: "USD",
    labels: ["high-approval-rate", "instant"],
  };
  const REVOLUT_LIVE = {
    paymentMethod: "poolparty_bridgerpay_revolutpay",
    displayName: "Revolut Pay",
    minUsd: 10,
    minCurrencyCode: "USD",
    labels: ["high-approval-rate", "instant", "low-fee"],
  };
  /** What a BRL buyer is offered and a USD buyer is not. The set changes, not the labels. */
  const PIX = {
    paymentMethod: "poolparty_bridgerpay_directa24_pix",
    displayName: "PIX",
    minUsd: 50,
    minCurrencyCode: "BRL",
    labels: ["instant"],
  };

  /** The currency Select, which is only rendered when there is a set to choose from. */
  function currencySelect(): HTMLSelectElement {
    return screen.getByTestId("provisioning-method-currency") as HTMLSelectElement;
  }

  // @rule [R2] the browser PROPOSES. The chosen code leaves on `proposedCurrencyCodeFrom`, the field
  // the server validates against the supported set, and never as the pin the app uses for its own.
  it("[R2] proposes the chosen currency and re-lists the methods under it", async () => {
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [CARD_LIVE, TRUSTLY_LIVE],
    });
    await renderToMethodStep();
    await waitFor(() => expect(rowNames()).toHaveLength(2));

    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "BRL",
      methods: [PIX],
    });
    fireEvent.change(currencySelect(), { target: { value: "BRL" } });

    await waitFor(() => expect(rowNames()).toEqual(["poolparty_bridgerpay_directa24_pix"]));
    expect(onRamp.getMethods).toHaveBeenLastCalledWith(
      expect.objectContaining({ proposedCurrencyCodeFrom: "BRL" }),
    );
  });

  /**
   * @rule [R3] the reload is VISIBLE, and it is not the empty state.
   *
   * Leaving the previous currency's rows up is the POO-1513 stale-figure class (a charge for one
   * order printed beside another). Replacing them with "the provider returned no options" blames
   * Paybis for our own round trip. So: no rows, no accusation, a skeleton.
   */
  it("[R3] shows a loading list rather than the previous currency's rows", async () => {
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [CARD_LIVE, TRUSTLY_LIVE],
    });
    await renderToMethodStep();
    await waitFor(() => expect(rowNames()).toHaveLength(2));

    let settle: ((value: unknown) => void) | undefined;
    onRamp.getMethods.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    fireEvent.change(currencySelect(), { target: { value: "BRL" } });

    await waitFor(() =>
      expect(screen.getByTestId("provisioning-method-loading")).toBeInTheDocument(),
    );
    expect(rowNames()).toHaveLength(0);
    expect(screen.queryByText("Credit/Debit Card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("provisioning-method-unavailable")).not.toBeInTheDocument();
    // Never a dead end: the step's own rule holds through the reload as well as through an empty
    // answer, so a buyer is never trapped waiting on a list.
    expect(screen.getByTestId("provisioning-method-continue")).toBeEnabled();

    await act(async () => {
      settle?.({ ok: true, currencyCodeFrom: "BRL", methods: [PIX] });
    });
    expect(screen.queryByTestId("provisioning-method-loading")).not.toBeInTheDocument();
  });

  // @rule POO-1576 Q4: the selection survives everything EXCEPT a currency change, because the list
  // can legitimately retire the method under it (a BRL buyer has no Trustly row to keep selected).
  it("[R3] clears the chosen method when the currency changes", async () => {
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [CARD_LIVE, TRUSTLY_LIVE, REVOLUT_LIVE],
    });
    await renderToMethodStep();
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    const revolut = screen.getByText("Revolut Pay");
    fireEvent.click(
      (revolut.closest("[data-testid='onramp-method-row']") as HTMLElement).querySelector(
        "input[type='radio']",
      ) as HTMLInputElement,
    );
    await waitFor(() =>
      expect(
        screen.getByText("Revolut Pay").closest("[data-testid='onramp-method-row']") as HTMLElement,
      ).toHaveAttribute("data-selected", "true"),
    );

    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "BRL",
      methods: [PIX, CARD_LIVE],
    });
    fireEvent.change(currencySelect(), { target: { value: "BRL" } });
    await waitFor(() => expect(rowNames()).toHaveLength(2));

    // Back to the shipped fallback (`pickDefaultPaymentMethod`, a card), NOT a retired selection.
    const pix = screen.getByText("PIX").closest("[data-testid='onramp-method-row']") as HTMLElement;
    expect(pix).toHaveAttribute("data-selected", "false");
    expect(
      screen
        .getByText("Credit/Debit Card")
        .closest("[data-testid='onramp-method-row']") as HTMLElement,
    ).toHaveAttribute("data-selected", "true");
  });

  /**
   * @rule POO-1621 defect 1 / CR-CORE-023 — the mint resolves the currency AGAIN, and it is the one
   * that bills. Wired only into the hook, this screen would print BRL and charge USD.
   */
  it("[R2] threads the flow's currency into the mint", async () => {
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [CARD_LIVE],
    });
    await renderToMethodStep();
    await waitFor(() => expect(rowNames()).toHaveLength(1));

    onRamp.getMethods.mockResolvedValue({ ok: true, currencyCodeFrom: "BRL", methods: [PIX] });
    fireEvent.change(currencySelect(), { target: { value: "BRL" } });
    await waitFor(() => expect(rowNames()).toEqual(["poolparty_bridgerpay_directa24_pix"]));

    fireEvent.click(screen.getByTestId("provisioning-method-continue"));
    await screen.findByTestId("paybis-frame");

    expect(rail.mintOnRampRequest).toHaveBeenCalledWith(
      ORDER,
      expect.objectContaining({ currencyCodeFrom: "BRL" }),
    );
  });

  // @rule the ECHO decides, not the proposal. A refused choice must leave one currency on screen and
  // in the mint, or the buyer reads BRL and is billed in dollars.
  it("[R2] follows the currency the SERVER echoed when the proposal is refused", async () => {
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [CARD_LIVE],
    });
    await renderToMethodStep();
    await waitFor(() => expect(rowNames()).toHaveLength(1));

    // The server checked BRL against the supported set, refused it, and answered with the default.
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [CARD_LIVE],
    });
    fireEvent.change(currencySelect(), { target: { value: "BRL" } });
    await waitFor(() => expect(onRamp.getMethods).toHaveBeenCalledTimes(2));

    await waitFor(() => expect(currencySelect().value).toBe("USD"));
    fireEvent.click(screen.getByTestId("provisioning-method-continue"));
    await screen.findByTestId("paybis-frame");
    expect(rail.mintOnRampRequest).toHaveBeenCalledWith(
      ORDER,
      expect.objectContaining({ currencyCodeFrom: "USD" }),
    );
  });

  // @rule POO-1630 / POO-494 [R1]: never fabricate. With no readable set there is no control, and
  // the step states the resolved currency exactly as it did before the control existed.
  it("[R2] degrades to a read-only currency when the supported set cannot be read", async () => {
    onRamp.getCurrencies.mockResolvedValue({
      ok: false,
      code: "ONRAMP_CURRENCIES_UNAVAILABLE",
      message: "no",
    });
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [CARD_LIVE],
    });
    await renderToMethodStep();
    await waitFor(() => expect(rowNames()).toHaveLength(1));

    expect(screen.queryByTestId("provisioning-method-currency")).not.toBeInTheDocument();
    expect(screen.getByTestId("provisioning-method-currency-static")).toHaveTextContent("USD");
  });

  // @rule premise 11: a currency change is a money decision the buyer made, on a funnel that has to
  // be able to answer whether the control is used at all.
  it("reports the currency change on the funding funnel", async () => {
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [CARD_LIVE],
    });
    await renderToMethodStep();
    await waitFor(() => expect(rowNames()).toHaveLength(1));

    onRamp.getMethods.mockResolvedValue({ ok: true, currencyCodeFrom: "BRL", methods: [PIX] });
    fireEvent.change(currencySelect(), { target: { value: "BRL" } });
    await act(async () => {});

    expect(analyticsEvents("funding_method_currency_changed")[0]).toMatchObject({
      funding_method_currency: "BRL",
    });
  });
});

/**
 * DISPLAY ALL OPTIONS REGARDLESS (Rafael, 2026-08-14).
 *
 * "A method is never hidden - not when it is unpriced, not when its minimum exceeds the order, not
 * when it is blocked." The three cases are separate mechanisms and each has its own way of
 * disappearing, so each is pinned: a row the quote skipped, a row the vendor REFUSED by name in
 * `paymentMethodErrors`, and a row whose own floor is above the order. All three are listed, all
 * three keep a radio, and `Continue` is never disabled.
 */
describe("ProvisioningPanel — every option is offered (POO-1576)", () => {
  const CARD_LIVE = {
    paymentMethod: "poolparty-credit-card",
    displayName: "Credit/Debit Card",
    minUsd: 10,
    minCurrencyCode: "USD",
    labels: ["instant"],
  };
  /**
   * Above the $212.00 order: the frame `3e` case, its floor in its own currency.
   *
   * Instant, so A7-b keeps it on the step. `poolparty-trustly`'s real labels carry no `instant` and
   * that row is now deferred entirely, which is why its id is not reused here: a case asserting a
   * row is never hidden must use a row that can be shown.
   */
  const BANK_ABOVE_ORDER = {
    paymentMethod: "poolparty_bridgerpay_revolutpay",
    displayName: "Revolut Pay",
    minUsd: 500,
    minCurrencyCode: "USD",
    labels: ["low-fee", "high-approval-rate", "instant"],
  };
  /** The vendor refused this one BY NAME, which is a different fact from an absent charge. */
  const REFUSED = {
    paymentMethod: "poolparty_apm_bridgerpay_skrill",
    displayName: "Skrill",
    minUsd: 10,
    minCurrencyCode: "USD",
    labels: ["high-approval-rate", "instant"],
  };
  /** The quote simply never mentioned this one: no charge, no refusal, no floor above the order. */
  const UNMENTIONED = {
    paymentMethod: "poolparty_bridgerpay_neteller",
    displayName: "Neteller",
    minUsd: 10,
    minCurrencyCode: "USD",
    labels: ["high-approval-rate", "instant"],
  };

  it("lists the unpriced, the refused and the minimum-exceeded, and lets the buyer pick any", async () => {
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [CARD_LIVE, BANK_ABOVE_ORDER, REFUSED, UNMENTIONED],
    });
    onRamp.getQuote.mockResolvedValue({
      ok: true,
      quote: {
        ...LISTING_QUOTE.quote,
        paymentMethods: [priced("poolparty-credit-card", "Credit/Debit Card", 218.45)],
        paymentMethodErrors: [{ paymentMethod: "poolparty_apm_bridgerpay_skrill" }],
      },
    });
    await renderToMethodStep();

    await waitFor(() => expect(rowNames()).toHaveLength(4));
    expect(rowNames()).toEqual([
      "poolparty-credit-card",
      "poolparty_bridgerpay_revolutpay",
      "poolparty_apm_bridgerpay_skrill",
      "poolparty_bridgerpay_neteller",
    ]);

    // Each one is genuinely selectable, and none of them disables Continue.
    for (const id of [
      "poolparty_bridgerpay_revolutpay",
      "poolparty_apm_bridgerpay_skrill",
      "poolparty_bridgerpay_neteller",
    ]) {
      const row = rowFor(id);
      fireEvent.click(row.querySelector("input[type='radio']") as HTMLInputElement);
      expect(row).toHaveAttribute("data-selected", "true");
      expect(screen.getByTestId("provisioning-method-continue")).toBeEnabled();
    }
  });

  /**
   * @rule POO-1603 [R3]: the vendor's labels, verbatim and in the vendor's order, with nothing
   * branching on the value. A method carrying all three prints all three; one carrying two prints
   * exactly those two.
   *
   * The row that used to make the second half of this point was a bank rail with no `instant`, and
   * POO-1129 A7-b now defers that row off the step entirely, so the pair here are both eligible and
   * differ in WHICH labels they carry. The "invents none" half is unchanged and is the load-bearing
   * one: there is no slowness label in the vendor's vocabulary, so a row that is not instant says
   * nothing about its speed and nothing may synthesise "1-2 business days" for it.
   */
  it("renders every label the provider sent, verbatim, and invents none", async () => {
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [
        {
          paymentMethod: "poolparty_bridgerpay_revolutpay",
          displayName: "Revolut Pay",
          minUsd: 10,
          minCurrencyCode: "USD",
          labels: ["high-approval-rate", "instant", "low-fee"],
        },
        REFUSED,
      ],
    });
    await renderToMethodStep();

    await waitFor(() => expect(rowNames()).toHaveLength(2));
    const revolut = rowFor("poolparty_bridgerpay_revolutpay");
    expect(revolut).toHaveTextContent("high-approval-rate");
    expect(revolut).toHaveTextContent("instant");
    expect(revolut).toHaveTextContent("low-fee");

    const skrill = rowFor("poolparty_apm_bridgerpay_skrill");
    expect(skrill).toHaveTextContent("high-approval-rate");
    expect(skrill).toHaveTextContent("instant");
    expect(skrill).not.toHaveTextContent("low-fee");
    expect(skrill).not.toHaveTextContent("business day");
  });
});

/**
 * POO-1129 D1 / D2 / D3 / A7-b: the three rules that landed AFTER this step was written.
 *
 * They are corrections rather than additions, so each case here pins the NEW behaviour against the
 * shipped one it replaces, end to end through the panel. The load-bearing ones are negative: no
 * superlative of ours beside a money figure, and no way for a refused method to reach the mint.
 */
describe("ProvisioningPanel — the decided rules (POO-1129)", () => {
  /** Instant, and comfortably above its own floor: the row that always serves. */
  const OK_CARD = {
    paymentMethod: "poolparty-credit-card",
    displayName: "Credit/Debit Card",
    minUsd: 10,
    minCurrencyCode: "USD",
    labels: ["instant"],
  };
  /** Instant, so A7-b keeps it, and its floor is above this order, so D3 blocks it. */
  const BLOCKED_PIX = {
    paymentMethod: "directa24_pix",
    displayName: "Pix",
    minUsd: 500,
    minCurrencyCode: "USD",
    labels: ["instant"],
  };
  /** A real bank rail: no `instant`, so A7-b defers it out of the first iteration entirely. */
  const SLOW_BANK = {
    paymentMethod: "poolparty-trustly",
    displayName: "Online Banking",
    minUsd: 10,
    minCurrencyCode: "USD",
    labels: ["low-fee", "high-approval-rate"],
  };

  /** A listing quote pricing exactly the ids named, all at the frame's own $218.45. */
  function pricing(...ids: string[]) {
    return {
      ok: true as const,
      quote: {
        ...LISTING_QUOTE.quote,
        paymentMethods: ids.map((id) => priced(id, id, 218.45)),
        paymentMethodErrors: [],
      },
    };
  }

  /** The radio of one row. Never `disabled`, so it is always here and always reachable. */
  function radioOf(id: string): HTMLInputElement {
    return rowFor(id).querySelector("input[type='radio']") as HTMLInputElement;
  }

  /**
   * D1 — there is NO `Best price` pill.
   *
   * > Murilo: *"use as labels do vendor so."*
   *
   * The chip slot beside a money figure belongs to the VENDOR's labels and to nothing this app
   * computed. POO-1639 deleted `bestPrice.ts` as well, so nothing in the tree can compute the claim
   * either and this assertion is what stops it being rebuilt.
   */
  it("[D1] prints no Best price pill on any row, including a tie at the cheapest", async () => {
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [
        OK_CARD,
        { ...CARD, paymentMethod: "poolparty-apple-pay", displayName: "Apple Pay" },
      ],
    });
    onRamp.getQuote.mockResolvedValue(pricing("poolparty-credit-card", "poolparty-apple-pay"));
    await renderToMethodStep();

    // BOTH rows priced, and tied: the exact frame the pill was drawn on, so this is the case where
    // its absence is load-bearing rather than incidental.
    await waitFor(() => expect(screen.getAllByText("$218.45")).toHaveLength(2));
    expect(screen.queryAllByTestId("onramp-method-best-price")).toHaveLength(0);
    // Asserted as the CLAIM rather than one spelling of it, matching the deposit twin
    // (`DepositScreen.desktopMethods.test.tsx`) exactly. What D1 forbids is a superlative of ours
    // beside a money figure, so re-adding it as "Cheapest" or "Best value" has to fail here too.
    // Without this loop the comment above ("this assertion is what stops it being rebuilt") was
    // true of the deposit test and only half true of this one.
    for (const claim of [/best price/i, /cheapest/i, /best value/i, /lowest fee/i]) {
      expect(screen.queryByText(claim)).toBeNull();
    }
  });

  /**
   * D1 — and the PARAM goes with the pill. `funding_method_best_price` was a param on
   * `funding_method_chosen` rather than an event of its own, so no analytics census count moves;
   * what must not survive is a field reporting whether a claim we no longer make moved the buyer.
   */
  it("[D1] reports the chosen method without a best-price field", async () => {
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [OK_CARD],
    });
    onRamp.getQuote.mockResolvedValue(pricing("poolparty-credit-card"));
    await renderToMethodStep();

    await waitFor(() => expect(rowNames()).toHaveLength(1));
    fireEvent.click(screen.getByTestId("provisioning-method-continue"));
    await screen.findByTestId("paybis-frame");

    const chosen = analyticsEvents("funding_method_chosen")[0];
    expect(chosen).toMatchObject({ funding_method: "poolparty-credit-card" });
    expect(chosen).not.toHaveProperty("funding_method_best_price");
  });

  /**
   * D3 — the headline defect. A refused method used to stay SELECTABLE with `Continue` enabled, and
   * the mint then silently substituted or dropped the prefill, so the buyer picked one method and
   * the checkout opened on another.
   *
   * The row now renders in its own position, at reduced emphasis, and refuses the selection. This is
   * `/deposit`'s shipped semantics (PR #897) applied to the same rows, so the two screens cannot
   * disagree about what one method and one order mean (POO-1609 AC6).
   */
  it("[D3] renders a below-floor row in place, unselectable, and never disabled", async () => {
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [BLOCKED_PIX, OK_CARD],
    });
    onRamp.getQuote.mockResolvedValue(pricing("directa24_pix", "poolparty-credit-card"));
    await renderToMethodStep();

    await waitFor(() => expect(rowFor("directa24_pix")).toHaveAttribute("data-blocked", "true"));

    // Never hidden and never reordered: it is still the FIRST row the provider sent.
    expect(rowNames()).toEqual(["directa24_pix", "poolparty-credit-card"]);
    // The blocked line REPLACES the minimum, so a blocked row states one fact and not two.
    expect(rowFor("directa24_pix")).toHaveTextContent("Paybis needs at least $500.00.");
    expect(rowFor("directa24_pix")).not.toHaveTextContent("Min. $500.00");

    /**
     * `aria-disabled` and NEVER `disabled`. A `disabled` radio leaves the tab order, so a
     * screen-reader user never reaches the option and never hears why it does not serve them, which
     * is strictly worse than hearing that it is unavailable.
     */
    const radio = radioOf("directa24_pix");
    expect(radio).toHaveAttribute("aria-disabled", "true");
    expect(radio).not.toBeDisabled();
    radio.focus();
    expect(radio).toHaveFocus();

    // And it refuses the selection: the reachable row stays the one that is checked.
    fireEvent.click(radio);
    expect(rowFor("directa24_pix")).toHaveAttribute("data-selected", "false");
    expect(rowFor("poolparty-credit-card")).toHaveAttribute("data-selected", "true");
  });

  /** D3 — the whole point of the refusal: a blocked method can never be what the mint receives. */
  it("[D3] never mints a method the order is below the floor of", async () => {
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [BLOCKED_PIX, OK_CARD],
    });
    onRamp.getQuote.mockResolvedValue(pricing("directa24_pix", "poolparty-credit-card"));
    await renderToMethodStep();

    await waitFor(() => expect(rowFor("directa24_pix")).toHaveAttribute("data-blocked", "true"));
    fireEvent.click(radioOf("directa24_pix"));
    fireEvent.click(screen.getByTestId("provisioning-method-continue"));
    await screen.findByTestId("paybis-frame");

    expect(rail.mintOnRampRequest).toHaveBeenCalledWith(
      ORDER,
      expect.objectContaining({ paymentMethod: "poolparty-credit-card" }),
    );
  });

  /**
   * D3 — a selection the quote refuses AFTER the fact is handed back, not carried.
   *
   * The real ordering on this screen: the buyer picks a method while the rows still show names and
   * floors alone, and the listing quote lands a moment later revealing the floor is missed. The
   * pick cannot survive that, because `Continue` is live throughout and the method would reach the
   * mint. Derived rather than stored, so there is no effect racing the quote to unset it.
   */
  it("[D3] hands the selection back when the quote reveals the floor after the pick", async () => {
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [OK_CARD, BLOCKED_PIX],
    });
    // The quote is held open, which is the ordering this screen really has: the list resolves in one
    // round trip and the prices in a second, debounced one, and `Continue` is live between them.
    let releaseQuote: (answer: unknown) => void = () => {};
    onRamp.getQuote.mockReturnValue(
      new Promise((resolve) => {
        releaseQuote = resolve;
      }),
    );
    await renderToMethodStep();

    await waitFor(() => expect(rowNames()).toHaveLength(2));
    fireEvent.click(radioOf("directa24_pix"));
    expect(rowFor("directa24_pix")).toHaveAttribute("data-selected", "true");

    // The quote lands and prices Pix below its own floor.
    await act(async () => {
      releaseQuote(pricing("directa24_pix", "poolparty-credit-card"));
    });
    await waitFor(() => expect(rowFor("directa24_pix")).toHaveAttribute("data-blocked", "true"));

    expect(rowFor("directa24_pix")).toHaveAttribute("data-selected", "false");
    expect(rowFor("poolparty-credit-card")).toHaveAttribute("data-selected", "true");
  });

  /** D3, premise 11 — activating a blocked row is the blocked intent in its purest form. */
  it("[D3] reports the blocked intent with the method's own floor and currency", async () => {
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [BLOCKED_PIX, OK_CARD],
    });
    onRamp.getQuote.mockResolvedValue(pricing("directa24_pix", "poolparty-credit-card"));
    await renderToMethodStep();

    await waitFor(() => expect(rowFor("directa24_pix")).toHaveAttribute("data-blocked", "true"));
    fireEvent.click(radioOf("directa24_pix"));
    await act(async () => {});

    expect(analyticsEvents("funding_method_blocked")[0]).toMatchObject({
      funding_method: "directa24_pix",
      value: 500,
      currency: "USD",
    });
  });

  /**
   * D3 — the all-blocked dead end, drawn rather than left to happen (POO-1609 [P38], AC8).
   *
   * `/deposit` cannot reach this state: its quote is PINNED to one method, so blockedness is
   * accumulated one refusal at a time and the fallback is always CHECKED, which dispatches no change
   * event and therefore can never become the next refusal. That guarantee does not transfer here.
   * This step reads the UNPINNED listing quote (POO-1599), which prices every row at once, so every
   * row can be below its floor with no selection involved. A dead end is a defect and not a state,
   * so it is stated and its exit is named: the amount lives on the previous step and `Cancel` is the
   * control that returns to it.
   */
  it("[D3] disables Continue and names the lowest floor when every method is blocked", async () => {
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [BLOCKED_PIX, { ...OK_CARD, minUsd: 600 }],
    });
    onRamp.getQuote.mockResolvedValue(pricing("directa24_pix", "poolparty-credit-card"));
    await renderToMethodStep();

    await waitFor(() =>
      expect(screen.getByTestId("provisioning-method-all-blocked")).toBeInTheDocument(),
    );
    // The LOWEST floor: the smallest step that clears anything at all, not the first row's.
    expect(screen.getByTestId("provisioning-method-all-blocked")).toHaveTextContent("$500.00");
    expect(screen.getByTestId("provisioning-method-continue")).toBeDisabled();
    expect(rail.mintOnRampRequest).not.toHaveBeenCalled();
  });

  /**
   * A7-b — non-instant methods are OUT of the first iteration.
   *
   * > Rafael: *"defer both, we will add non-instant as an improvement in the future, not at the
   * > first iteration."*
   *
   * This contradicts the reference frames, which draw `Bank transfer` in this list. The rule wins;
   * the frames are being redrawn.
   */
  it("[A7-b] offers only the methods the vendor calls instant", async () => {
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [OK_CARD, SLOW_BANK],
    });
    await renderToMethodStep();

    await waitFor(() => expect(rowNames()).toEqual(["poolparty-credit-card"]));
    expect(screen.queryByText("Online Banking")).not.toBeInTheDocument();
  });

  /**
   * A7-b — FAIL OPEN, and loudly. The captured vocabulary is `instant` / `low-fee` /
   * `high-approval-rate`, all POSITIVE, so "not instant" is an ABSENCE and never an assertion. A set
   * carrying no `instant` at all is far more likely a vocabulary we have not captured than a world
   * with no instant rail, and a filter that matches nothing is worse than no filter.
   */
  it("[A7-b] shows every method, and reports it, when nothing carries the label", async () => {
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [SLOW_BANK, { ...SLOW_BANK, paymentMethod: "sepa", displayName: "SEPA" }],
    });
    await renderToMethodStep();

    await waitFor(() => expect(rowNames()).toEqual(["poolparty-trustly", "sepa"]));
    expect(reported.reportClientError).toHaveBeenCalledWith(
      "onramp.instant_filter_empty",
      expect.any(Error),
      expect.objectContaining({ methodCount: 2 }),
    );
  });

  // The eligibility rule reads a label's VALUE; the CHIP still may not (POO-1603 [R3]). Both hold at
  // once here: the row that survived the filter prints its labels verbatim and none of them changes
  // how it behaves.
  it("[A7-b] keeps the label a rendered string on the rows that survive it", async () => {
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [{ ...OK_CARD, labels: ["high-approval-rate", "instant"] }, SLOW_BANK],
    });
    await renderToMethodStep();

    await waitFor(() => expect(rowNames()).toHaveLength(1));
    const row = rowFor("poolparty-credit-card");
    expect(row).toHaveTextContent("high-approval-rate");
    expect(row).toHaveTextContent("instant");
  });
});

// -------------------------------------------------------------------------------------------------
// POO-1927 [R1]: the method step is a PAYBIS step, and its mount says so.
//
// It was mounted on `methodChoice` alone. That was safe by construction rather than by rule: only the
// Paybis branch of `runOnRampBuy` ever calls `setMethodChoice`, because the Privy branch returns one
// line earlier (`ProvisioningPanel.tsx:1826`). So the structural path was already right and the
// CONDITION was not, and the two come apart the moment the rail changes while a purchase is up,
// which is exactly what a tester does with the Dev menu on the POO-1821 sandbox spike: the buy
// branches on a ref captured at call time while the render reads the live hook.
//
// Privy's own modal owns method selection, so on that rail this step must not exist. The assertion
// is that the mount is gated on the RAIL, not that a particular code path happens not to reach it.
// -------------------------------------------------------------------------------------------------

describe("ProvisioningPanel: the method step belongs to the Paybis rail (POO-1927)", () => {
  // @rule R1: the step is gone the moment the rail is Privy, mid-purchase included.
  it("[R1] unmounts the method step when the rail becomes privy", async () => {
    const { outcome } = await renderToMethodStep();
    // Precondition: this is the Paybis rail, and the step is up, which is unchanged behaviour.
    expect(screen.getByTestId("provisioning-method-step")).toBeInTheDocument();

    // `privyOnRamp` ON over the `fiatOnRamp` this suite already stubs is `decideOnRampRail`'s
    // `"privy"`. The override store is what `useOnRampProvider` subscribes to, so this is the same
    // re-render a tester's Dev-menu flip causes.
    act(() => {
      setOverride("privyOnRamp", true);
    });

    await waitFor(() => {
      expect(screen.queryByTestId("provisioning-method-step")).not.toBeInTheDocument();
    });
    // And no orphaned Paybis surface takes its place: the rail owns the checkout on this path.
    expect(screen.queryByTestId("paybis-frame")).not.toBeInTheDocument();
    // The step LEAVING is only half the rule. `runOnRampBuy` is parked on the promise the step's
    // `decide` resolves, so a gate that merely stops rendering it strands the purchase on a question
    // nobody can be asked any more. These two assert the OTHER half: the leg actually settled, with
    // the cancel's own code (the suite's idiom for this resolution, as in the two [R8] cases), and
    // the panel painted the terminal screen that follows it. Neither becomes true if the effect is
    // deleted while the gate stays: the buy hangs and the panel never leaves `Working on it`.
    await waitFor(() => expect(outcome.failedWith).toBe("ONRAMP_CLOSED"));
    expect(
      await screen.findByText(
        "Your purchase did not go through, so no funds were moved. You can try again.",
      ),
    ).toBeInTheDocument();
  });

  // @rule R1: the step's heading is the screen's heading while it is up (POO-1576), so the panel's
  // own title has to come BACK when the step is gated away. Without this the Privy rail would render
  // a pending screen with no heading at all.
  it("[R1] returns the execution heading the step had taken over", async () => {
    await renderToMethodStep();
    expect(screen.queryByText("Working on it")).not.toBeInTheDocument();

    act(() => {
      setOverride("privyOnRamp", true);
    });

    await waitFor(() => {
      expect(screen.getByText("Working on it")).toBeInTheDocument();
    });
  });
});
